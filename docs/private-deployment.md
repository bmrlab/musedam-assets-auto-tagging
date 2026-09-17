# 私有化部署指南

交付形式：我们提供 Docker 镜像，客户在自己的服务器/编排平台（docker-compose、自有 Kubernetes 等）上运行。
本仓库不假设客户的编排方式，也不提供针对某个客户环境的 K8s manifests ——
`.github/workflows/build-push-deploy.yml` 是我们自己 SaaS（AWS EKS）的部署流水线，与私有化交付无关。

## 1. 镜像

- 应用镜像：`Dockerfile`（standalone Next.js 输出，`CMD node server.js`，监听 `PORT`，默认 `3000`）
- 构建参数：`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`（必须在 `docker build` 时传入，私有部署要重新生成，不要沿用 SaaS 环境的值）
- `Dockerfile.job` 仅用于预下载/校验 Prisma 引擎二进制，不包含应用代码，不能直接拿来跑队列处理器。

## 2. 环境变量矩阵

以下按模块列出私有化部署**必须**确认的环境变量，完整定义/默认值见 `.env.example`。

### 数据库

| 变量                  | 说明                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | 客户 PostgreSQL 实例连接串，**需要 PostgreSQL 14+ 并启用 pgvector 扩展**：在实例上执行一次 `CREATE EXTENSION vector;` |
| `SHADOW_DATABASE_URL` | 仅 `prisma migrate dev` 需要；生产环境用 `npx prisma migrate deploy`，可不配置                                        |

### 对象存储（AWS S3 私部 vs 阿里云 OSS 私部）

同一套 `S3_*`/`AWS_*` 变量既能对接 AWS S3 也能对接阿里云 OSS（S3 兼容 API），仅通过改配置切换，代码无需改动（见 `src/lib/s3.ts`）。两组示例见 `.env.example`：

| 变量                                          | AWS S3                               | 阿里云 OSS                                                                                                 |
| --------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `STORAGE_PROVIDER`                            | `aws-s3`（仅日志提示用，不影响行为） | `aliyun-oss`                                                                                               |
| `S3_ENDPOINT_URL`                             | `https://s3.<region>.amazonaws.com`  | `https://s3.oss-<region>.aliyuncs.com`（OSS 的 S3 兼容 endpoint）                                          |
| `S3_REGION`                                   | 如 `us-east-1`                       | 如 `cn-hangzhou`                                                                                           |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM AK/SK                            | 阿里云 AccessKey ID/Secret                                                                                 |
| `S3_BUCKET` / `S3_FOLDER`                     | bucket 名 + 对象前缀                 | 同左                                                                                                       |
| `S3_FORCE_PATH_STYLE`                         | `true`（默认）                       | **必须为 `false`**，OSS 的 S3 兼容接口要求 virtual-hosted-style                                            |
| `S3_SEND_ACL_HEADER`                          | `true`（默认）                       | S3 兼容接口支持 `public-read`；如果客户策略禁止对象 ACL，设为 `false` 并通过 OSS Policy 仅开放 `S3_FOLDER` |

> 火山引擎 TOS、腾讯云 COS 等其他 S3 兼容存储预期可用同一套变量接入，具体寻址方式/ACL 支持度需实测后在 `.env.example` 补充示例。

### LLM 模型网关

私有化部署只需配置一个统一的模型网关，**不需要**客户环境访问 AWS Bedrock / Azure OpenAI：

| 变量                                 | 说明                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` | 指向我们托管的模型网关（litellm），覆盖所有模型（`qwen3-vl-flash`、`gpt-5*`、`claude-*` 等）                                            |
| `AWS_BEDROCK_*` / `AZURE_EASTUS2_*`  | **不要配置** —— 留空即可，`src/ai/provider.ts` 的 `llm()` 会自动回退到 `OPENAI_BASE_URL` 网关；若两者都缺失会在调用时抛出明确的配置错误 |

### MuseDAM API / 鉴权 / 其他

| 变量                                                                                             | 说明                                                                             |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `MUSEDAM_API_BASE_URL` / `MUSEDAM_APP_API_KEY` / `MUSEDAM_APP_SECRET`                            | 客户所在 MuseDAM 实例的地址与凭证                                                |
| `AUTH_SECRET` / `CIPHER_PASSWORD` / `INTERNAL_API_KEY`                                           | **必须为私有环境重新生成**，不能沿用 SaaS 环境的值                               |
| `IFRAME_ALLOWED_ORIGINS`                                                                         | 改为客户实际域名                                                                 |
| `JINA_API_KEY` / `JINA_EMBEDDINGS_URL` / `TRANSLATION_SERVICE_URL` / `LOGO_DETECTION_SERVER_URL` | 若客户环境无法访问对应外部服务，需要替换成客户可达的地址（自建或走同一网关代理） |

## 3. 迁移

应用 standalone 镜像不包含 Prisma CLI。使用 `Dockerfile.job` 构建固定 Prisma 版本的迁移镜像，并在发布 Web 前以 ACK Job 运行：

```bash
docker build -f Dockerfile.job -t <acr>/musedam-auto-tagging-migration:<version> .
```

ACK 模板见 `deploy/ack/migration-job.example.yaml`。生产迁移前必须完成数据库备份；历史迁移包含向量数据重建操作，已有环境必须先演练。

## 4. 定时/队列任务

应用暴露了两个内部 HTTP 接口（`Authorization: Bearer $INTERNAL_API_KEY`）。ACK 第一阶段使用 `Dockerfile.scheduler` 构建无第三方依赖的 scheduler 镜像：

- scheduler Deployment 每 30 秒调用 `POST /api/tagging/process-queue`
- CronJob 按 `Asia/Shanghai` 每天 0 点调用 `POST /api/tagging/process-scheduled`

ACK 模板见 `deploy/ack/`。第一阶段 Web 只运行一个副本，因为当前队列并发闸是进程级的；拆分独立 Worker 前不要水平扩容 Web。

### OSS CORS

浏览器会使用预签名 URL 直接上传 OSS，客户 Bucket 至少需要允许应用域名发起 `PUT`/`GET`/`HEAD`，允许 `Content-Type` 和实际启用的 `x-amz-acl` Header，并暴露 `ETag`。不要使用 `*` 作为生产 Allowed Origin。

## 5. 特征库（`S3_FOLDER=feature-library`）—— 上线前必须验证的一项

批量导入/导出（`src/app/(tagging)/tagging/{brand,ip,person,product}/batchFile.ts`）和推送给
MuseDAM（`src/musedam/push-feature-to-musedam.ts`）都调用 `getS3PublicObjectUrl()`，产出的是
**不带签名的裸 URL**，不是临时授权的 signed URL。这意味着对象**必须匿名公开可读**，这不是可选项而是硬性功能依赖：

- 导出的 Excel 里的图片链接要能在用户浏览器里直接打开
- `push-feature-to-musedam.ts` 把这个裸 URL 推给 MuseDAM 后端，**MuseDAM 侧的服务器必须能访问到这个 URL**（可能和客户私部环境不在同一网络里）
- 批量导入（`src/lib/tagging/batch-reference-image.ts`）在识别出"这是我们自己配置的存储桶对象"时会跳过额外的 SSRF 私网地址校验，这依赖 `isConfiguredS3PublicObjectUrl()` 与实际生成的 URL 保持一致（已用测试覆盖 path-style 和 virtual-hosted-style 两种寻址方式，见 `__test__/s3-storage-config.test.ts`）

**接入新的对象存储厂商（尤其阿里云 OSS）前，必须做一次端到端验证再上线**：

1. 上传一个测试对象（走 `uploadS3Object`，即正常的图片上传路径）
2. 用 `getS3PublicObjectUrl()` 拿到裸 URL，**不带任何签名/token**，用另一台机器（不在客户 VPC 内）直接 `curl` 这个 URL
3. 确认能公网访问：
   - 如果 `x-amz-acl: public-read` 在该厂商的 S3 兼容层上不生效 → 设置 `S3_SEND_ACL_HEADER=false`，改为在 bucket 层面配置匿名读策略（只开放给 `S3_FOLDER` 这个前缀，不要对整个 bucket 开放）
   - 确认 `S3_ENDPOINT_URL` 配置的是 S3 兼容公网 endpoint（如 `https://s3.oss-cn-hangzhou.aliyuncs.com`），不是内网/VPC endpoint —— 浏览器会直接使用预签名 URL 上传，MuseDAM 也要访问裸 URL

这一步之前出过一次从 OSS 切回 AWS S3 的历史（见 `git log 1b9a4a5`），commit message 没写原因；不确定是否正是这里踩过坑，接入 OSS 时建议重点排查这一条。

## 6. 其他已知待验证项

- 火山引擎 TOS / 腾讯云 COS 的 S3 兼容层细节（寻址方式、ACL header 支持度）尚未验证，接入前重复第 5 节的端到端检查

## 7. 从 SaaS 迁移团队数据（零运维路线）

导出、导入都做成了 admin 专用的 HTTP 接口（环境变量 `ADMIN_USER_IDS`，MuseDAM user id，多个用逗号隔开；未配置时回退到 SaaS 生产 admin，其它账号 403），全程只需要在浏览器里操作：

1. 用 admin 登录 SaaS，打开 `https://<saas-host>/api/tagging/migration/export?musedamTeamId=<id>`，下载 `team-<id>-export.json`。
   包里不含图片文件，`assets[].sourceUrl` 是 SaaS 桶的预签名链接，**7 天内有效**，过期重新导出。
2. 把 JSON 传到我们的 OSS，生成一个签名下载链接（客户网络只需要放行 SaaS 桶的公网域名，JSON 和图片链接都指向它）。
3. 用 admin 登录客户私有化环境，依次**触发**三个阶段（`dryRun` 默认 `true` 只做检查，显式 `dryRun=false` 才写库/写桶）：

   ```
   /api/tagging/migration/import?bundleUrl=<链接>&phase=db&dryRun=false
   /api/tagging/migration/import?bundleUrl=<链接>&phase=resources&dryRun=false&rewriteFolder=<SaaS 侧 S3_FOLDER>
   /api/tagging/migration/import?bundleUrl=<链接>&phase=verify
   ```

   触发接口**立即返回**（HTTP 202）一个任务 id，导入在后台跑，不受 Ingress 超时影响。然后：

   ```
   /api/tagging/migration/import?action=status    # 刷新看进度：当前表 / 已完成行数、失败项、最近 400 行日志、堆内存
   /api/tagging/migration/import?action=cancel    # 在当前批次结束后停止
   ```

   `status` 里 `job.status` 变成 `done` 再触发下一个阶段。进程内同一时间只允许一个任务，重复触发返回 409 和当前进度，不会并发写同一批行。

   - `rewriteFolder`：SaaS 侧 `S3_FOLDER` 和客户侧不一致时可传，脚本会把 objectKey 前缀改写成客户侧的；不传则 objectKey 原样保留（原样保留也能正常工作，最不容易出错）
   - `sourceUrlBase`：传了就一律从 `<sourceUrlBase>/<objectKey>` 下载图片，忽略包内签名链接。见下面"图片域名未放行"
   - `batchSize`：db 阶段每个事务写多少行，默认 200；`concurrency`：resources 阶段并发数，默认 8
   - 三个阶段全部幂等：失败或取消后重新触发同一阶段会跳过已完成项续传
   - 任务状态只在进程内存里，Pod 重启后 `status` 为空；导入本身幂等，重新触发即可
   - Pod stdout 也有结构化日志（`module=migration-import`，含 jobId、每 10 秒一条进度心跳和堆内存），便于在观测云里查

**图片域名未放行**：包内 `assets[].sourceUrl` 指向 SaaS 的 AWS 桶（`s3.cn-north-1.amazonaws.com.cn`）。客户如果只放行了我们的
OSS 域名，resources 阶段会全部 `连接源站失败`。不需要客户再改网络：在我们自己的机器上跑
`npx tsx scripts/migrate-team-mirror-assets.ts --in-url=<JSON 链接> --prefix=<OSS 目录>`（配目标 OSS 的 `S3_*` 变量），
把图片按 `<prefix>/<objectKey>` 镜像到那个 OSS 桶（目录需匿名可读），然后触发 resources 阶段时加
`sourceUrlBase=https://<bucket>.oss-cn-beijing.aliyuncs.com/<prefix>`。

**大包注意**：bundle 解析后在堆里大约是文件体积的 3 到 5 倍（向量表占大头），db 阶段每写完一张表就释放对应数组。
Web 容器堆上限默认 640MB（`NODE_OPTIONS`），100MB 以内的包可以直接跑；更大的包建议导入期间临时把 Web 的内存 limit 和 `--max-old-space-size` 调高，`status` 里的 `memory.heapUsedMB / heapLimitMB` 可以看到实际水位。

目标库必须是全新的私有化库：导入按源库的 `Team.id` 原样写入，同 id 已被别的团队占用会直接中止。
导入完成后按第 5 节验证客户桶的裸 URL 能匿名访问。

命令行形态 `scripts/migrate-team-import.ts`（`--in-dir` / `--in-file` / `--in-url`）与接口共用 `src/lib/migration/import-team.ts`，堡垒机场景仍可用。
