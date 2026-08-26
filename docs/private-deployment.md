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

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | 客户 PostgreSQL 实例连接串，**需要 PostgreSQL 14+ 并启用 pgvector 扩展**：在实例上执行一次 `CREATE EXTENSION vector;` |
| `SHADOW_DATABASE_URL` | 仅 `prisma migrate dev` 需要；生产环境用 `npx prisma migrate deploy`，可不配置 |

### 对象存储（AWS S3 私部 vs 阿里云 OSS 私部）

同一套 `S3_*`/`AWS_*` 变量既能对接 AWS S3 也能对接阿里云 OSS（S3 兼容 API），仅通过改配置切换，代码无需改动（见 `src/lib/s3.ts`）。两组示例见 `.env.example`：

| 变量 | AWS S3 | 阿里云 OSS |
| --- | --- | --- |
| `STORAGE_PROVIDER` | `aws-s3`（仅日志提示用，不影响行为） | `aliyun-oss` |
| `S3_ENDPOINT_URL` | `https://s3.<region>.amazonaws.com` | `https://oss-<region>.aliyuncs.com`（OSS 的 S3 兼容 endpoint） |
| `S3_REGION` | 如 `us-east-1` | 如 `oss-cn-hangzhou` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM AK/SK | 阿里云 AccessKey ID/Secret |
| `S3_BUCKET` / `S3_FOLDER` | bucket 名 + 对象前缀 | 同左 |
| `S3_FORCE_PATH_STYLE` | `true`（默认） | 默认 `true` 即可，两种寻址方式 OSS 都支持 |
| `S3_SEND_ACL_HEADER` | `true`（默认） | **需要在客户 bucket 上实测** `x-amz-acl` 是否生效；不支持时设为 `false`，改用 OSS bucket policy 对 `S3_FOLDER` 前缀开放匿名读 |

> 火山引擎 TOS、腾讯云 COS 等其他 S3 兼容存储预期可用同一套变量接入，具体寻址方式/ACL 支持度需实测后在 `.env.example` 补充示例。

### LLM 模型网关

私有化部署只需配置一个统一的模型网关，**不需要**客户环境访问 AWS Bedrock / Azure OpenAI：

| 变量 | 说明 |
| --- | --- |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` | 指向我们托管的模型网关（litellm），覆盖所有模型（`qwen3-vl-flash`、`gpt-5*`、`claude-*` 等） |
| `AWS_BEDROCK_*` / `AZURE_EASTUS2_*` | **不要配置** —— 留空即可，`src/ai/provider.ts` 的 `llm()` 会自动回退到 `OPENAI_BASE_URL` 网关；若两者都缺失会在调用时抛出明确的配置错误 |

### MuseDAM API / 鉴权 / 其他

| 变量 | 说明 |
| --- | --- |
| `MUSEDAM_API_BASE_URL` / `MUSEDAM_APP_API_KEY` / `MUSEDAM_APP_SECRET` | 客户所在 MuseDAM 实例的地址与凭证 |
| `AUTH_SECRET` / `CIPHER_PASSWORD` / `INTERNAL_API_KEY` | **必须为私有环境重新生成**，不能沿用 SaaS 环境的值 |
| `IFRAME_ALLOWED_ORIGINS` | 改为客户实际域名 |
| `JINA_API_KEY` / `JINA_EMBEDDINGS_URL` / `TRANSLATION_SERVICE_URL` / `LOGO_DETECTION_SERVER_URL` | 若客户环境无法访问对应外部服务，需要替换成客户可达的地址（自建或走同一网关代理） |

## 3. 迁移

```bash
npx prisma migrate deploy
```

## 4. 定时/队列任务

应用暴露了两个内部 HTTP 接口（`Authorization: Bearer $INTERNAL_API_KEY`），私有化部署推荐直接用客户自己的 cron/K8s CronJob 定时 `curl` 调用，而不必额外打包 `pnpm queue-processor`（该脚本依赖 `tsx`，不在生产 standalone 镜像里）：

- `POST /api/tagging/process-queue`：每 10 秒调用一次，处理待打标队列
- `POST /api/tagging/process-scheduled`：每天 0 点调用一次，处理团队定时打标

参考 compose 示例：`deploy/docker-compose.example.yml`。

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
   - 确认 `S3_ENDPOINT_URL` 配置的是**公网 endpoint**，不是内网/VPC endpoint —— 否则即使 ACL 没问题，MuseDAM 和用户浏览器仍然访问不到

这一步之前出过一次从 OSS 切回 AWS S3 的历史（见 `git log 1b9a4a5`），commit message 没写原因；不确定是否正是这里踩过坑，接入 OSS 时建议重点排查这一条。

## 6. 其他已知待验证项

- 火山引擎 TOS / 腾讯云 COS 的 S3 兼容层细节（寻址方式、ACL header 支持度）尚未验证，接入前重复第 5 节的端到端检查
