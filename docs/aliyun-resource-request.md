# 阿里云私有化部署 —— 资源申请清单（musedam-assets-auto-tagging）

用途：本项目是 MuseDAM 主站的 iframe 嵌套子应用（智能打标），随主站一起私有化部署到客户阿里云环境。
本清单列出**除主站方案之外**，本项目额外需要客户开通/提供的云资源与信息，供运维向客户提出资源申请。

主站方案参考：《MuseDAM 阿里云私有化部署方案》（ECS、PolarDB-MySQL、OSS、CDN 已在主站方案中覆盖，此处不重复列出）。

---

## 一、需要客户新开通的云资源

| # | 资源 | 规格建议 | 用途 | 备注 |
|---|------|----------|------|------|
| 1 | **PostgreSQL 数据库实例**（RDS PostgreSQL 或 PolarDB for PostgreSQL） | PostgreSQL **14 及以上**，2核4G 起（100-500人团队规模），需支持 **pgvector 扩展** | 本项目独立数据库，存储打标数据及向量特征 | ⚠️ 不能复用主站 PolarDB-MySQL 实例，数据库引擎不同。开通后需执行一次 `CREATE EXTENSION vector;`，申请前请客户确认所选产品是否支持该扩展 |
| 2 | **OSS Bucket（或已有主站 Bucket 下的独立目录）** | 与主站 OSS 同区域 | 存储打标图片、特征库文件 | 建议独立 bucket 或至少独立前缀（如 `auto-tagging/`），需支持匿名只读（见"三、需要的配置"） |
| 3 | **ACR 镜像仓库命名空间** | 与主站共用 ACR 实例即可，新增独立命名空间/仓库 | 存放本项目 3 个镜像：`musedam-auto-tagging-web`、`musedam-auto-tagging-scheduler`、`musedam-auto-tagging-migration` | 无需新开 ACR 实例，复用主站 |
| 4 | **ACK 集群内计算资源额度** | Web：0.5C1G（request）~1C2G（limit）× 1 副本<br>Scheduler：50m64Mi ~ 250m256Mi × 1 副本<br>CronJob：同 Scheduler 规格，按需触发 | 承载本项目 Web 服务、队列调度、每日定时任务 | 复用主站已有 ACK 集群，无需新建集群/新增 ECS 节点组（除非集群剩余资源不足） |
| 5 | **子域名 + TLS 证书** | 如 `tagging.客户域名.com` | 本项目对外访问入口，接入客户 ALB/Ingress | 必须支持 HTTPS（iframe 跨域 Cookie 要求 `Secure`），需客户 DNS 侧新增解析并签发/提供证书 |

---

## 二、需要的网络出站权限（如客户环境有出站白名单/防火墙限制）

本项目容器需要能够访问以下**我方托管的公网服务**（均为 HTTPS）：

| 服务 | 用途 | 是否必需 |
|------|------|----------|
| 我方模型网关（litellm，具体域名部署时提供） | AI 模型调用（打标推理），对应主站方案中"购买算力点数包，调用我方云端 API" | 必需 |
| Jina Embeddings API（`api.jina.ai`） | 图像向量特征提取 | 必需，如客户环境无法出网访问，需替换为客户可达的自建/代理地址 |
| 我方翻译服务（`cloudnative.tezign.com`） | 标签多语言翻译 | 必需，同上，可替换 |
| Logo 检测服务 | Logo 识别 | 视客户是否启用该功能而定，如需启用需单独确认地址 |

> 若客户内网出站限制严格，需要在防火墙/安全组上为以上域名开放 443 出站，或改为经由客户已有的统一出网代理转发。

---

## 三、需要客户侧提供/确认的配置信息

| 项目 | 说明 |
|------|------|
| PostgreSQL 连接串 | host、port、库名、账号密码（建议独立账号，仅授权本库权限） |
| OSS/RAM 访问凭证 | AccessKey ID/Secret（建议使用仅限该 bucket 前缀读写权限的 RAM 子账号，而非主账号 AK） |
| OSS 匿名读策略确认 | 是否允许对指定前缀（如 `auto-tagging/feature-library`）开放匿名 `GetObject`；如客户策略禁止对象级 ACL，需改为 bucket policy 方式（部署侧已支持两种方式，只需客户确认可选项） |
| 子域名 DNS 解析权限 | 客户侧配置到 ACK 集群 Ingress/ALB 的解析记录 |
| ACK 集群 kubeconfig / 命名空间权限 | 用于部署本项目的 Deployment / CronJob / Ingress |
| 是否有出站网络白名单机制 | 若有，需要客户配合放行"二、"中列出的域名 |
| MuseDAM 主站访问地址与 App 凭证 | `MUSEDAM_API_BASE_URL`、`MUSEDAM_APP_API_KEY`、`MUSEDAM_APP_SECRET`（主站部署时一并生成） |

---

## 四、建议的开通/部署顺序

1. 客户开通 PostgreSQL 实例 → 我方/运维验证 pgvector 扩展可用
2. 客户提供 OSS bucket + RAM 凭证 → 运维完成一次端到端裸 URL 匿名可读验证（上传对象后用非客户内网机器直接 curl 验证）
3. 客户开通子域名 + TLS 证书，DNS 指向 ACK Ingress
4. 确认出站网络策略，必要时开白名单
5. 推送镜像到 ACR → 执行一次性数据库迁移 Job（迁移前完成数据库备份）→ 部署 Web/Scheduler/CronJob → 验证登录与打标流程

---

## 五、PostgreSQL / pgvector 运维交付信息

本应用的数据库与 MuseDAM 主站的 MySQL **必须隔离**。以下内容可直接提供给客户数据库管理员或云运维执行；示例库名为 `auto_tagging`，可按客户命名规范替换。

### 5.1 实例与账号要求

| 项目 | 要求 |
|---|---|
| 数据库引擎 | PostgreSQL **14+**，并且实例已安装且允许启用 `pgvector` 扩展；请在采购/开通前由客户确认所选阿里云实例规格支持该扩展 |
| 实例位置 | 与 ACK 工作负载处于同一地域、同一 VPC 或网络可达；仅对 ACK 节点/Pod 网段开放数据库端口（默认 `5432`） |
| 数据库 | 新建独立数据库 `auto_tagging`，UTF-8 编码；不要与 MuseDAM 主站 MySQL 或其他应用共库 |
| 应用账号 | 新建独立的库所有者账号（如 `auto_tagging_app`）；该账号需要连接目标库，以及建表、建索引、建序列、创建/修改表结构的权限，以执行 Prisma 发布迁移 |
| 扩展权限 | `CREATE EXTENSION vector` 通常需要实例管理员或具备扩展创建权限的数据库所有者执行。若应用账号无此权限，请由数据库管理员在迁移前执行第 5.2 节 SQL |
| 连接安全 | `DATABASE_URL` 建议强制 TLS：`...?sslmode=require`；密码通过 ACK Secret 注入，禁止写入镜像、Git 仓库或工单正文 |
| 备份与容量 | 首次上线迁移前完成一次全量备份；开启自动备份与恢复演练。初始可按 2 核 4 GB、100 GB SSD 估算，向量数据量会随特征库图片数量增长，应按实际素材规模扩容 |

### 5.2 建库与启用 pgvector

请以实例管理员身份连接 PostgreSQL。以下命令仅适用于首次建库；如果客户已创建数据库，只需连接到目标库后执行扩展语句。

```sql
-- 在默认管理库（通常为 postgres）中执行；密码请由客户按其密码策略设置。
CREATE ROLE auto_tagging_app LOGIN PASSWORD '<由客户安全系统生成的强密码>';
CREATE DATABASE auto_tagging
  OWNER auto_tagging_app
  ENCODING 'UTF8'
  TEMPLATE template0;

-- 切换连接到 auto_tagging 数据库后执行。
CREATE EXTENSION IF NOT EXISTS vector;
```

如数据库管理员单独创建了库和账号，至少应保证应用账号可以连接并拥有该数据库：

```sql
GRANT CONNECT, TEMPORARY ON DATABASE auto_tagging TO auto_tagging_app;
ALTER DATABASE auto_tagging OWNER TO auto_tagging_app;
```

> 不要手工创建业务表或索引。所有业务 DDL、`LogoVector` / `IpVector` / `ProductVector` / `PersonVector` 向量表及其配套索引均由项目 Prisma migration 统一管理。

### 5.3 部署侧数据库连接串

运维需要将以下值以 ACK Secret 的 `DATABASE_URL` 注入 Web、Scheduler 和 Migration Job。`SHADOW_DATABASE_URL` 是本地开发命令 `prisma migrate dev` 才需要的变量，生产环境不需要提供。

```dotenv
DATABASE_URL="postgresql://auto_tagging_app:<URL 编码后的密码>@<RDS/PolarDB 内网地址>:5432/auto_tagging?sslmode=require"
```

如客户数据库未启用 TLS，可在客户内网隔离和安全评审通过后去掉 `sslmode=require`；不应为此改用公网暴露数据库。

### 5.4 初始化与升级方式

项目没有一份需要人工执行的“全量业务 SQL”。请使用与待发布版本一致的 Migration 镜像运行以下命令；该命令会按顺序执行仓库 `prisma/migrations/` 中尚未应用的 SQL，并在 `_prisma_migrations` 中记录版本：

```bash
npx prisma migrate deploy
```

ACK 交付物已提供 Migration Job 模板：`deploy/ack/migration-job.example.yaml`，迁移镜像由下列方式构建：

```bash
docker build -f Dockerfile.job -t <ACR 地址>/musedam-auto-tagging-migration:<版本号> .
```

执行顺序为：数据库备份 → 确认 `vector` 扩展 → 运行 Migration Job 并等待成功 → 部署/升级 Web 与 Scheduler。升级已存在环境前应先在同版本备份库演练；历史迁移可能涉及向量数据结构调整。

### 5.5 验收 SQL

数据库管理员可在 `auto_tagging` 库执行以下查询确认扩展、迁移和向量字段已经就绪：

```sql
-- pgvector 扩展必须返回一行，且 extversion 有值。
SELECT extname, extversion
FROM pg_extension
WHERE extname = 'vector';

-- 发布迁移应全部显示为已完成（finished_at 非空）。
SELECT migration_name, finished_at
FROM _prisma_migrations
ORDER BY started_at;

-- 验证四张向量表及其向量列；PersonVector 的维度为 512，其余为 1024。
SELECT table_name, column_name, format_type(atttypid, atttypmod) AS data_type
FROM pg_attribute
JOIN pg_class ON pg_class.oid = attrelid
JOIN pg_namespace ON pg_namespace.oid = relnamespace
WHERE pg_namespace.nspname = 'public'
  AND pg_class.relname IN ('LogoVector', 'IpVector', 'ProductVector', 'PersonVector')
  AND attname = 'embedding'
  AND attnum > 0
  AND NOT attisdropped
ORDER BY pg_class.relname;

-- 验证迁移创建的常规检索索引。
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('LogoVector', 'IpVector', 'ProductVector', 'PersonVector')
ORDER BY tablename, indexname;
```

预期：`vector` 扩展存在；所有已发布迁移均有 `finished_at`；`PersonVector.embedding` 显示 `vector(512)`，其他三张表显示 `vector(1024)`；最后一条查询能看到各向量表的主键、业务过滤和关联字段索引。当前项目版本未在最终迁移中保留 `ivfflat` / `hnsw` 近似向量索引，因此无需由运维额外创建此类索引。

---

以上五、六项完成后即可视为具备可部署运行的最小资源条件；具体环境变量与镜像构建细节参见 `docs/private-deployment.md`。
