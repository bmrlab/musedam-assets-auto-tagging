## 镜像构建入口

两个环境使用同一套文件，构建方显式选择入口，避免在 test / origin 同步时反复覆盖 Dockerfile：

| 环境                   | 文件                   | 选择方式                                                                                 |
| ---------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| 统一测试平台           | `Dockerfile`           | 平台默认构建入口；沿用测试侧内部基础镜像、Apollo 启动和 8080 端口                        |
| SaaS 生产 / 私有化 Web | `Dockerfile.prod`      | GitHub Actions 的 build-app 或手动构建通过 `-f Dockerfile.prod` 指定；保留原生产镜像配置 |
| 数据库迁移             | `Dockerfile.job`       | 继续显式指定该文件                                                                       |
| 独立调度器             | `Dockerfile.scheduler` | 继续显式指定该文件                                                                       |

生产手动构建命令为 `docker build -f Dockerfile.prod -t <image>:<version> .`；构建参数仍按部署指南提供。文件名区分大小写，根目录构建上下文仍为 `.`。两份 Web Dockerfile 都应随代码同步至两个远端，不按远端名称切换或覆盖文件。GitHub Actions 仍只在 `v*` tag 推送时执行原有发布链路。

## 本地开发

1. 安装依赖

```bash
pnpm install
```

2. 配置环境变量

```bash
cp .env.example .env
```

设置 `AUTH_SECRET`, read more: https://cli.authjs.dev

```bash
npx auth secret
```

3. 初始化数据库

安装 PostgreSQL 15

```bash
brew install postgresql@15
brew services start postgresql@15
```

新建本地数据库

```bash
psql -d postgres
CREATE USER musedam WITH LOGIN PASSWORD 'musedam' SUPERUSER;
CREATE DATABASE musedam_assets_auto_tagging OWNER musedam;
CREATE DATABASE musedam_assets_auto_tagging_shadow OWNER musedam;
\q
```

向 .env 文件写入数据库配置：

```env
DATABASE_URL=postgresql://musedam:musedam@localhost:5432/musedam_assets_auto_tagging
SHADOW_DATABASE_URL=postgresql://musedam:musedam@localhost:5432/musedam_assets_auto_tagging_shadow
```

执行 migrations

```bash
npx prisma generate  # 生成必要的类型定义
npx prisma migrate dev  # 执行数据库迁移
```

4. 启动开发服务器

```bash
pnpm dev
```

5. 启动打标处理服务（可选）

如果需要处理自动打标任务，需要启动队列处理器。首先在 `.env` 文件中配置内部 API 密钥：

```env
INTERNAL_API_KEY=your_secret_key_here
```

然后在新的终端窗口中运行：

```bash
pnpm queue-processor
```

队列处理器会自动：

- 每 10 秒自动调用一次 `/api/tagging/process-queue` 接口
- 每次处理最多 10 个待处理的打标任务
- **每天凌晨 0 点自动执行定时标签任务**，遍历所有启用了 `settings.triggerTiming.scheduledTagging` 的团队
- 显示处理进度和状态信息

### 6. 定时标签功能

定时标签功能已经**集成在队列处理器中**，无需额外配置。每天凌晨 0 点会自动：

- 查询所有 `settings.triggerTiming.scheduledTagging` 为 `true` 的团队
- 为每个团队调用 `requestMuseDAMAPI("/timing-tag", { method: "POST", body: { folderIds: settings.applicationScope.selectedFolders, isAll: settings.applicationScope.scopeType === 'all' }})`
- 记录详细的执行日志和结果

#### 手动执行定时标签任务

如果需要立即运行一次定时标签任务（用于测试）：

```bash
pnpm scheduled-tagger
```

**注意：** 队列处理器需要在 `.env` 文件中配置 `INTERNAL_API_KEY` 来访问内部 API。

## 商品、Logo、IP 的 LLM 决策与 OCR

商品、Logo、IP 的开发分类页面提供默认开启的「图像模式」开关。两种模式均执行 OCR 和 LLM 决策：开启时向决策模型发送源图和候选参考图；关闭时仅发送相似度、候选名称/类型/描述、文件名/路径及 OCR 等文字信息，且不下载候选参考图。OCR 在两种模式下仍单独读取源图。页面保留同一文件与元数据下最近一次图像/纯文本结果，可对比特征、置信度、决策 token 与 OCR token，并展开各次请求与响应；更换文件或元数据会清空对比。

默认使用 LLM 决策（`src/lib/feature-decision/config.ts` 中的 `FEATURE_DECISION_MODE = "llm"`）：检测框与 embedding 负责召回候选，最终由多模态 LLM 比较整张源图和候选参考图，并结合文件名、文件夹路径和 OCR 原文判断身份。商品、Logo、IP 共用最多 5 个召回区域，每个区域最多 3 个不同类别；类别去重后，按 `sort`、`createdAt`、`id` 的稳定顺序使用第一张参考图。一条决策请求最多包含 16 张图片（1 张源图 + 15 张参考图），不发送检测裁剪图或检测框坐标。遗漏区域、缺失参考图和召回错误保留在诊断信息中。

在已有 `.env` 中设置网关和模型，不要覆盖现有配置：

```env
OPENAI_BASE_URL=https://your-gateway.example/unified/v1
OPENAI_API_KEY=your_gateway_key
FEATURE_DECISION_MODEL=your_multimodal_decision_model
OCR_MODEL=your_ocr_model
```

OCR 和决策均直接调用 `OPENAI_BASE_URL/chat/completions`，模型 ID 原样传递，不受 `LLM_PROVIDER` 的云服务路由影响。一次素材处理通常调用 OCR 一次，再为所有启用的商品、Logo、IP 候选合并调用决策模型一次。未设置 `OCR_MODEL` 时 OCR 标记为禁用；没有可用源图时跳过调用，图像模式没有可用候选参考图或纯文本模式没有候选时跳过决策。OCR 失败仍可使用其余证据决策。单次调用有超时和输出 token 上限，不自动重试或调用模型修复响应；决策超时、输出格式错误或模型未配置时，特征结果保持未解决，不自动回退为 embedding 已确认结果。需要明确恢复旧算法时修改代码常量 `FEATURE_DECISION_MODE` 为 `"legacy"`；结果会标记为 legacy，并跳过新增 OCR/决策调用。

模型应尽量返回一个或多个合理的候选特征预测，即使所有置信度都较低；相似变体无法区分时返回多个可能选项，并在限制/冲突字段解释不确定性。响应仅支持 `matched` 和 `no_match`，不再支持 `ambiguous`；只有全部候选明显无关时才允许 `no_match` 与空数组。置信度为模型输出的 0–100 分，与召回相似度分别保存，并非校准概率。页面展示全部预测；自动应用仍独立检查阈值和证据，不会因展示低置信度结果而自动打标。自动接受仍使用现有阈值：Logo 75、商品 80、IP 80；身份冲突或具体型号无法确认时不会自动接受。图像模式的 Logo 需要直接视觉证据；纯文本模式需有 Logo 区域的向量召回证据，不能仅凭文件名或文件夹品牌关联接受。标签应用、审核和特征绑定使用同一套接受结果。

新增迁移 `prisma/migrations/20261105090000_add_feature_llm_calls/migration.sql` 创建 `FeatureLlmCall`，保存每次调用的模型、输入/输出/总 token、缓存/推理/图片 token、耗时、状态、请求和响应，以及费用和价格快照。迁移文件已准备，本改动未执行数据库迁移；启用前，本地在确认开发库后执行 `pnpm exec prisma migrate dev`，部署环境通过现有 `pnpm db:deploy` 应用迁移，并执行 `pnpm exec prisma generate` 更新客户端。

请求设置集中在 `src/lib/feature-decision/config.ts`：超时 `FEATURE_LLM_TIMEOUT_MS = 300_000`（5 分钟），输出上限 `FEATURE_LLM_MAX_OUTPUT_TOKENS = 8192`。这些设置和决策模式不从环境变量读取。目前只记录 token 用量，费用和单价字段保留为 `null`。

开启现有 `DEBUG_PAGE=true` 后，`/tagging/product/classify`、`/tagging/brand/classify` 和 `/tagging/ip/classify` 可输入源文件名和路径，并查看 OCR 原文、最终置信度、每次调用的 token/费用/耗时、发送的文本与图片，以及模型原始响应和失败原因。

## Scripts

### login-url

用于生成认证 URL，可以直接通过此 URL 登录系统。

```bash
pnpm login-url <userId> <userName> <teamId> <teamName> [callbackUrl]
```

参数说明：

- `userId`: 用户 ID
- `userName`: 用户名
- `teamId`: 团队 ID
- `teamName`: 团队名称
- `callbackUrl`: 登录后重定向的 URL（可选，默认为 "/"）

示例：

```bash
# 使用默认测试数据
pnpm login-url

# 使用自定义数据
pnpm login-url "123" "John Doe" "456" "My Team" "/tagging"
```

### scheduled-tagger

手动触发定时标签任务的脚本（用于测试）：

```bash
pnpm scheduled-tagger
```

该脚本会立即执行一次定时标签任务：

- 查询所有启用了 `settings.triggerTiming.scheduledTagging` 的团队
- 为每个团队调用 `requestMuseDAMAPI("/timing-tag", { method: "POST", body: { folderIds: settings.applicationScope.selectedFolders, isAll: settings.applicationScope.scopeType === 'all' }})`
- 输出详细的执行报告

**注意：** 定时标签任务也会**自动通过 `pnpm queue-processor` 在每天凌晨 0 点运行**，无需手动执行。

## 外网访问配置

项目支持通过 frp 内网穿透实现外网访问。

### 1. 下载 frp 客户端

```bash
# 进入 devserver 目录
cd devserver

# 运行安装脚本（自动检测系统架构）
./setup-frpc.sh
```

### 2. 配置文件

frp 配置文件 `devserver/frpc.toml`：

```toml
serverAddr = "114.55.30.112"
serverPort = 7000

[[proxies]]
name = "musedam-auto-tagging"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3000
remotePort = 7093
```

### 3. 启动外网代理

```bash
# 确保在 devserver 目录下
cd devserver

# 启动 frp 客户端
./frpc -c ./frpc.toml
```

启动成功后，可通过以下地址访问：

🌐 **外网地址：** https://tagging.dev.musedam.cc

## 国际化配置

项目使用 next-intl 实现国际化支持，支持中文（zh-CN）和英文（en-US）。

### 消息文件结构

国际化文本消息文件采用分层管理：

1. **全局消息文件**：`messages/[locale].json`
   - 存放全局通用的翻译文本
   - 例如：`messages/zh-CN.json`、`messages/en-US.json`

2. **模块消息文件**：`src/app/[module]/messages/[locale].json`
   - 存放特定模块的翻译文本，避免全局消息文件过于庞大
   - **重要**：模块消息文件必须有根键名，用于区分不同模块
   - 例如：`src/app/(tagging)/messages/zh-CN.json` 包含 `"Tagging": {}` 根键

### 消息合并机制

所有消息文件会在运行时自动合并：

- **配置文件**：
  - `src/i18n/request.ts`：处理消息文件的动态加载和合并
  - `src/i18n/global.ts`：TypeScript 类型定义，确保类型安全

- **合并顺序**：全局消息 + 模块消息，后者会覆盖前者的同名键

### 使用方式

```tsx
import { useTranslations } from "next-intl";

function MyComponent() {
  const t = useTranslations("Homepage"); // 对应消息文件中的 Homepage 键
  return <h1>{t("title")}</h1>;
}
```

## URL 参数覆盖配置

项目支持通过 URL 参数动态设置主题和语言，实现即时生效且持久化存储。

### 支持的参数

#### 主题参数 (theme)

- `?theme=dark` - 深色主题
- `?theme=light` - 浅色主题

#### 语言参数 (locale)

- `?locale=zh-CN` - 中文
- `?locale=en-US` - 英文

### 参数优先级

1. **URL 参数**：优先级最高，立即生效
2. **Cookie 存储**：持久化用户设置
3. **系统默认**：深色主题 + 中文

### 实现机制

#### 主题 (theme) 参数处理

- **实现位置**：`src/components/ThemeProvider.tsx`
- **检测方式**：客户端组件在渲染时读取 URL 参数 `?theme=`，直接写入 localStorage 持久化
- **生效机制**：客户端渲染后，页面跳转会保留 theme 设置，如果在服务端重定向页面，theme 参数会丢失

#### 语言 (locale) 参数处理

- **实现位置**：`src/middleware.ts`
- **检测方式**：服务端中间件优先读取 URL 参数 `?locale=`，如果 cookie 值不存在或者不一致，则更新 cookie
- **生效机制**：会失踪保留此次 locale 设置，服务端直接重定向也会保留，直到下一次主动设置 locale

#### 认证页面额外处理 (`/auth/[token]`)

- **文件位置**：`src/app/(auth)/auth/[token]/page.tsx` 和 `TokenAuthPageClient.tsx`
- **特殊功能**：除了正常的参数处理外，还会在客户端渲染 auth 页面时**主动持久化**这两个参数
- **实现原因**：确保通过认证 URL 传入的主题和语言设置能够持续生效，避免页面跳转后丢失
- **持久化方式**：
  - `theme`：调用 `setTheme()` 强制更新 localStorage
  - `locale`：调用 `setLocale()` 强制更新 cookie

### 使用示例

```bash
# 设置深色主题 + 英文界面
https://yourdomain.com/auth/token?theme=dark&locale=en-US

# 设置浅色主题 + 中文界面
https://yourdomain.com/?theme=light&locale=zh-CN

# 只设置语言
https://yourdomain.com/tagging?locale=en-US
```

### 集成场景

特别适用于 iframe 嵌入场景，外部应用可通过 URL 参数控制嵌入页面的主题和语言，确保界面风格与外部应用保持一致。详见 [自动登录集成文档](./docs/auto-login-integration.md)。

### 同步标签树导入与恢复

导入文件中的关键词、必打、互斥等配置由人工维护，导入后的显式节点及其祖先通过 `extra.configurationSource=import` 标记，后台不会为这些节点生成证据策略或自动降级策略。表格未提供的字段保留原值；缺少独立证据策略时仍沿用已有的确定性解析规则。配置导入在短事务中先锁行再合并最新 JSON，避免覆盖并发初始化或人工编辑的其他字段。

批量合并与覆盖导入统一调用主仓 `import-tag-tree` 同步事务接口，不再通过环境变量切换，不回退旧的分批 `merge-tags` 导入链路。部署前需确认主仓接口、`mini-dam-script/src/main/resources/sql/000119.sql` 及企业开放网关转发已就绪。覆盖通过 `mode=overwrite` 在主仓同一事务复用同路径标签、创建缺失节点、删除文件中未包含的旧标签并写入回执；本地同步在主仓成功后以单一事务复用已有 ID 和配置，仅删除未包含的旧节点。新接口是同步请求，不新增后台导入任务。

启用后，一次最多 20000 个节点（包含父级），主仓在同一事务提交。本地补存按层级、每批最多 500 行进行；已有本地 ID 和未提供的配置保留，主仓 ID 以字符串映射到 slug。应用 HTTP 等待上限 75 秒；主仓事务上限 60 秒，需用真实数据库及网关验证最大规模耗时，不能把模拟测试视为容量承诺。

主仓请求号、原始节点载荷及成功结果保存在本项目 `TeamConfig` 的 `tag-tree-import:<载荷哈希>` 中。主仓提交后本地失败时保留 `remoteCommitted` 状态；重新导入同样的树，会补存本地，不再向主仓重复创建。请求超时且结果未知时保留 `pending`，再次提交相同请求号取得主仓幂等结果。`localSaved` 仅表示标签结构已补存，表格配置失败仍通过原导入失败行重试。成功后再次发起相同内容的独立导入会登记新请求号，以免误用已经被后续编辑或删除的历史结果。不要手动清理未完成回执。

标签导入与详情配置编辑的事务会递增 `TeamConfig.tagging-config-version`。队列下一批加载标签时核对版本，跨进程刷新标签树与候选索引；已在执行的预测继续使用其当前快照。旧写入入口仍有 30 秒 TTL 兜底。上述回执和版本复用现有 TeamConfig 表，无新增本地数据库迁移。

同一团队的整次表格标签导入（合并及覆盖）使用 `TeamConfig.tag-tree-import-owner` 互斥；预检可并行，正式导入从校验到配置回写完成只允许一个执行者。另一成员确认时立即提示“成员 xxxx 正在执行批量导入，请稍后刷新页面重试。”，保留预览及所选文件，不进入失败行列表。姓名取自已认证用户的本地成员记录，缺少姓名时使用成员标识。不同团队互不阻塞。

整次锁使用数据库时间、2 分钟租约和每 20 秒续租，并记录 startedAt/deadlineAt；单次导入最多执行 10 分钟，续租不能超过数据库记录的硬截止时间。升级前创建的旧锁缺少 deadlineAt 时按锁记录的 createdAt 加 10 分钟判定最大年龄，过期后可在重试时原子接管并换 token，不依赖旧进程停止续租。导入上下文中的上游请求（包括凭证交换与旧 merge-tags 接口）默认最多等待 75 秒，显式超时仍按调用方设置。达到整次时限后取消上游等待、停止续租，并拦截后续写入和逐行降级重试；租约清理最多等待 5 秒，失败交由租约过期恢复。正常结束或失败时只释放自己的锁。进程中断后租约到期可重新执行。各本地写入事务检查锁所有者并锁定租约行，失去租约的旧执行者不能恢复写入或释放新执行者的锁。此机制无新增数据库迁移，须所有应用写实例升级后才能提供完整保护；不覆盖直接 SQL 或其他未接入此入口的旁路写入。

回归测试 `__test__/tag-import-postgres.integration.test.ts` 可通过 `TAG_IMPORT_TEST_DATABASE_URL` 指定独立本地测试库运行；只接受 localhost/127.0.0.1 且数据库名以 `tag_import_test_` 开头的连接，测试会清空该测试库中的相关测试表，不能使用开发业务库或生产库。未指定时此组集成测试跳过。锁 SQL 的 advisory-lock 返回值显式转为 text，确保 Prisma 能解码；覆盖回执须明确返回 `mode=overwrite`，旧主仓未确认模式时客户端不会删除本地旧树。

标签树导入流程为“上传 → 文件预检及预览 → 选择合并/覆盖 → 确认执行”。预检只读取文件本身，校验层级、名称和配置，合并重复标签路径及匹配/排除关键词，并展示不阻塞导入的合并提示。其余问题行可在预览后确认跳过；只要仍有有效树节点，两种模式均允许继续导入。预检不查询现有标签树，切换模式不重新预检。两种模式都按完整路径复用已有标签，导出文件中的 ID 不参与标签树导入定位；合并保留其他旧标签，覆盖仅删除未出现在文件树中的旧标签。确认执行后仍会重新校验文件、核对当前数据及权限，并在团队互斥锁内写入。
