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

#### 按团队紧急暂停打标

管理员可通过 `POST /api/tagging/admin/team-suspension` 暂停指定团队，使用管理员登录的 `x-auth-token`：

```sh
curl --request POST 'https://你的打标服务域名/api/tagging/admin/team-suspension' \
  --header 'Content-Type: application/json' \
  --header 'x-auth-token: 管理员登录TOKEN' \
  --data '{"musedamTeamId":"158057","suspended":true}'
```

该操作在同一事务内保存 `TeamConfig.taggingSuspended=true`，并将该团队 pending/processing 的资产打标任务（含测试任务）标为 CANCELLED。新请求返回成功但不创建任务、不返回可扣点的 queueItemId；定时发起器跳过该团队，入队和执行前也会检查暂停状态。入队与暂停共用团队行锁，避免批量入队与暂停并发漏取消。现有 worker 的执行权检查及心跳会停止后续业务写入；已经发出的模型请求无法撤回。恢复时提交 `suspended:false`，不会恢复已取消任务。无需 migration，所有 web/worker 实例须升级后才能保证完整拦截。

当前主仓 `exchange-api-key` 检查团队存在和应用安装，不能作为订阅未到期的证明。团队暂停独立于用户可编辑的打标设置。若仅关闭定时打标，发起器和单素材 scheduled 回调入口均检查 `triggerTiming.scheduledTagging`；已排队任务仍需取消。主仓全素材定时扫描当前会遍历已有素材，不保证跳过已完成打标的素材，因此开启定时打标可能重复生成审核记录。

## 商品、Logo、IP 的 LLM 决策与 OCR

商品、Logo、IP 的开发分类页面提供默认关闭的「图像模式」开关。两种模式均执行 OCR 和 LLM 决策：开启时向决策模型发送源图和候选参考图；关闭时仅发送相似度、候选名称/类型/描述、文件名/路径及 OCR 等文字信息，且不下载候选参考图。OCR 在两种模式下仍单独读取源图。页面保留同一文件与元数据下最近一次图像/纯文本结果，可对比特征、置信度、决策 token 与 OCR token，并展开各次请求与响应；更换文件或元数据会清空对比。

默认使用 LLM 决策（`src/lib/feature-decision/config.ts` 中的 `FEATURE_DECISION_MODE = "llm"`）：检测框与 embedding 负责召回候选，最终由 LLM 结合候选信息、文件名、文件夹路径和 OCR 原文判断身份。真实打标队列默认使用纯文本决策；只有团队在 AI 识别设置中开启「图像模式」时，才额外向决策模型发送整张源图和候选参考图。商品、Logo、IP 分别保留有效去重后的所有召回区域，每个区域最多 3 个不同类别；图像模式下，商品/IP 按 `sort`、`createdAt`、`id` 的稳定顺序使用第一张参考图；Logo 将该标识全部已上传参考图按稳定顺序合成一张对照图，包含文字、图形和局部版本，不截断为首张或单张命中图。候选每 5 个分一批、最多并行 2 批；图像模式下一条决策请求最多包含 6 张图片（1 张源图 + 5 张候选参考图，Logo 的多样本对照图占一张），不发送检测裁剪图或检测框坐标。遗漏区域、缺失参考图和召回错误保留在诊断信息中。`/tagging/review` 展示的默认任务和 `/tagging/test` 创建的测试任务都经过这一队列配置。

商品候选除图像向量召回外，还会比较文件名、路径与当前团队已启用且处理完成的商品名称、备注别名和有效关联标签，按文字相关性最多补充 12 个候选。系列名同时命中时优先于仅命中品牌；若命中词完全被另一个商品更具体的命中短语覆盖，不再额外召回这个弱候选（原向量候选保留）。例如“滋盈”“光乳”不应把明确的“滋盈琉光乳”扩展为其他品牌；“系列”等通用后缀和文件扩展名不作为商品证据。文字召回不生成匹配置信度，也不伪造向量分数或文字所在区域；`metadataMatches` 记录来源和字面命中词，最终身份和分数仍由同一 LLM 决策产生。商品参考图仍使用稳定排序的首张；分批保持每批最多 5 个参考、最多 2 批并发，商品单独成批，避免商品竞争身份被 Logo/IP 拆散或借用其他类型的 ID；Logo/IP 小块能合并时仍合并。小型混合输入可能比原来多一条调用，但弱候选筛选会减少无关商品及其分批。跨批次上下文仅保留当前批次所评估的特征类型。每张参考图旁同时标注商品名称与候选 ID，决策不得把其他候选的名称或证据套到当前 ID。路径中的系列、文件名和商品形态应共同参与消歧；单瓶或套装中的单个组件不能仅凭品牌、颜色相近就被识别为整套水乳，存在未解决的单品/套装或系列冲突时模型应给出低于 50 的分数。

回归测试：`pnpm exec vitest run __test__/product-metadata-candidates.test.ts __test__/feature-decision-classify.test.ts`。针对 `Essential Revitalizing Emulsion EX_model 05` 的真实网关验证需显式设置 `RUN_PRODUCT_METADATA_LIVE=1` 后运行 `__test__/product-metadata-live.integration.test.ts`；配置目录可由 `PRODUCT_RECALL_ENV_DIR` 指定。该检查读取测试库任务 1754、1764、1765 的源图、OCR 和商品检测框（Logo 使用整图兜底），重新执行 embedding 与 LLM，记录新的调用用量，不重置任务、不写入审核项。默认结果摘要保存到 `/tmp/musedam-product-recall-validation/result-<taskId>.json`。

在已有 `.env` 中设置网关和模型，不要覆盖现有配置：

```env
OPENAI_BASE_URL=https://your-gateway.example/unified/v1
OPENAI_API_KEY=your_gateway_key
FEATURE_DECISION_MODEL=your_multimodal_decision_model
OCR_MODEL=your_ocr_model
```

真实打标队列优先复用开放接口的 `ocrContent`、`imageContentAnalysis.aiOcr` 和已同步内容中的显式 OCR 字段，不将 AI 描述当作 OCR。接口有文字时不再重复调用 OCR 模型；没有文字时保留模型 OCR 兜底。视频通过媒体处理服务的 `video_sprite` 接口从原视频抽取样本，去重后选取最多 8 帧检索商品、Logo 和 IP。模型 OCR 最多读取 4 个样本，图像模式使用样本对照图，候选按现有决策批次处理。人物识别在队列中继续使用缩略图。

视频采样失败且仍有处理时间时，队列可以使用缩略图识别特征，并尝试用 ffmpeg 从原视频取帧用于 OCR。已知时长时取第 1 秒（短于 2 秒时取中间帧），未知时长取首帧，长边不超过 2048；下载和抽帧总超时 60 秒，下载上限 128 MiB，全局串行执行，任务取消时终止并清理临时文件。原视频不可下载、超限或解码失败时继续使用缩略图。Docker 运行镜像安装 ffmpeg，本地运行也需在 PATH 中提供 ffmpeg。OCR 中的完整品牌别名可补充召回同团队启用的 Logo，允许以真实 OCR 为依据通过匹配，无需伪造向量命中；是否自动接受仍受最终模型置信度、冲突和阈值控制。

OCR 和决策均直接调用 `OPENAI_BASE_URL/chat/completions`，模型 ID 原样传递，不受 `LLM_PROVIDER` 的云服务路由影响。接口 OCR 缺失时一次素材处理至多调用模型 OCR 一次，再为启用的商品、Logo、IP 候选分批调用决策模型。未设置 `OCR_MODEL` 时 OCR 标记为禁用；没有可用源图时跳过调用，图像模式没有可用候选参考图或纯文本模式没有候选时跳过决策。OCR 失败仍可使用其余证据决策。单次调用有超时和输出 token 上限，不自动重试或调用模型修复响应；决策超时、输出格式错误或模型未配置时，特征结果保持未解决，不自动回退为 embedding 已确认结果。需要明确恢复旧算法时修改代码常量 `FEATURE_DECISION_MODE` 为 `"legacy"`；结果会标记为 legacy，并跳过新增 OCR/决策调用。

模型使用每批的短引用（如 `C1` 和 `C2`）选择候选。使用 `qwen3.8-flash` 时，请求的严格 JSON Schema 将可返回的引用限制在本批候选。应用精确校验引用及重复项，然后映射到真实特征 ID。调用诊断保留引用与真实 ID 的对应关系。

模型应尽量返回一个或多个合理的候选特征预测，即使所有置信度都较低；相似变体无法区分时返回多个可能选项，并在限制/冲突字段解释不确定性。响应仅支持 `matched` 和 `no_match`，不再支持 `ambiguous`；只有全部候选明显无关时才允许 `no_match` 与空数组。置信度为模型输出的 0–100 分，与召回相似度分别保存，并非校准概率。页面展示保留的预测（商品仅展示区域最高分身份）；已完整完成的 LLM 决策仅按团队置信度门槛判断可接受性；conflicts 和 specificityLimit 仅用于诊断说明，不再额外拦截。Logo、商品和 IP 不再有「不确定候选只读」分支；达到门槛的待审核结果统一支持 × 排除和恢复，每个商品区域仅保留最高分商品；同分时按该区域的检索相似度稳定排序，其余商品候选从最终结果及候选展示移除，不生成只读候选。同一商品出现在多个区域时仍按商品 ID 去重。低于门槛的预测保留在诊断中，失败或未完整完成的模型调用不进入可应用结果。标签应用、审核和特征绑定使用同一套接受结果。

新增迁移 `prisma/migrations/20261105090000_add_feature_llm_calls/migration.sql` 创建 `FeatureLlmCall`，保存每次调用的模型、输入/输出/总 token、缓存/推理/图片 token、耗时、状态、请求和响应，以及费用和价格快照。迁移文件已准备，本改动未执行数据库迁移；启用前，本地在确认开发库后执行 `pnpm exec prisma migrate dev`，部署环境通过现有 `pnpm db:deploy` 应用迁移，并执行 `pnpm exec prisma generate` 更新客户端。

请求设置集中在 `src/lib/feature-decision/config.ts`。超时为 `FEATURE_LLM_TIMEOUT_MS = 300_000`（5 分钟），输出上限为 `FEATURE_LLM_MAX_OUTPUT_TOKENS = 8192`。决策请求使用 `enable_thinking: false` 关闭推理。Qwen 网关在同时传入 `reasoning_effort` 时会拒绝请求。OCR 使用模型默认设置。这些设置和决策模式不从环境变量读取；图像证据通过团队 `TeamConfig.featureImageMode` 布尔配置启用，默认关闭，队列不再读取旧环境变量 `DECISION_LLM_IMAGE_USE`。目前只记录 token 用量，费用和单价字段保留为 `null`。

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

标签树导入流程为“上传 → 文件预检及预览 → 选择合并/覆盖 → 确认执行”。预检只读取文件本身，校验层级、名称和配置，合并重复标签路径及匹配/排除关键词，并展示不阻塞导入的合并提示。其余问题行可在预览后确认跳过；只要仍有有效树节点，两种模式均允许继续导入。预检不查询现有标签树，切换模式不重新预检。CSV/XLSX 的「MuseDAM 标签 ID」导出 MuseDAM 的纯数字标签 ID，不导出本地数据库 ID、slug 或 `g/` 前缀；没有有效 MuseDAM ID 映射的本地活动标签会在导出时清理。导入时有 ID 的行按当前团队的 MuseDAM ID 定位已有标签（找不到时报错，不回退成本地 ID 或同名路径），无 ID 的行按完整路径新增或复用；合并保留其他旧标签，覆盖仅删除未出现在文件树中的旧标签。确认执行后仍会重新校验文件、核对当前数据及权限，并在团队互斥锁内写入。

## 标签性能与软删除

标签的历史审核、任务和特征库关联通过 `AssetTag.deletedAt` 保留，正常标签查询仅返回未删除记录。同名重建使用新 ID。启用前先应用 `20261106090000_tag_soft_delete_queue_poll` 并重新生成 Prisma Client；不能混用不识别软删除的旧应用实例。

队列现在会在单个任务结束后补领空槽，不等待同批最慢任务完成，并按活动任务数保留现有车道并发限制。

排查依据、批量写入与队列索引、实际本地测量、迁移兼容和未完成的环境 9 端到端验证见 [标签处理性能与软删除](docs/tagging-performance.md)。

### 特征推荐置信度门槛

品牌标识、商品、人物、IP 特征库页头的“推荐门槛”按当前团队保存，范围为 0–100 的整数。默认值分别为 75、80、60、80。保存后新任务使用新门槛；刷新历史待审核页时，复用保存的最终决策重新筛选特征，确认添加前再次校验。已审核记录保留审核快照。未保存最终决策的旧任务不能仅凭检索相似度恢复，需要重新打标。详见 [性能与兼容说明](docs/tagging-performance.md)。

### 历史特征任务恢复（2026-11-07）

商品 `notes`（包含人工维护的昵称）与名称一起传入决策，分批时保留其他批次候选的名称、备注和区域作为消歧上下文。每批最多 5 个候选，并关闭决策模型思考模式。备注始终作为数据，不作为模型指令。

任一决策批次失败或存在未评估候选时，队列标记为 `FEATURE_RECOGNITION_FAILED`，保存诊断并停止应用本轮标签。历史部分失败结果在审核页显示“特征识别未完整完成”，不再静默当作未命中。每次处理前重新获取开放接口的素材、OCR 和路径；本地测试素材沿用本地输入。

`pnpm exec tsx scripts/resume-feature-rerun.ts` 默认只读预检原暂停批次。部署后先从测试页面重跑“绿茶牛奶水15ml_正面”，再添加 `--apply` 恢复。脚本要求最近 30 分钟内由工作进程生成的验证任务使用当前提示词、无部分失败、正确商品通过且错误“绿茶水”低于门槛；保留已审核、已删除、已有活动任务及较新成功结果的素材。新任务与原任务通过 `resumedQueueId` 关联，重复执行不会重复入队。原暂停记录不删除。

标签树导出会在当前团队的互斥锁和数据库事务内，删除没有有效 MuseDAM ID 映射的本地标签（包括当前展示层级之外的无映射节点），分批软删除并取消未完成的旧导入回执，在同一事务内更新配置缓存版本。成功导出的文件只含有 MuseDAM ID 的标签；编码或删除失败则整次回滚。无映射父节点下若有已映射子节点，导出会报错并保留所有标签，需先修复层级。清理仅依据本地 ID 映射，不向 MuseDAM 发起删除，也不实时核验远端标签是否仍存在；导出成功后页面刷新标签树并提示清理数量。

CSV/XLSX 导出中的匹配/排除关键词超过 30,000 字符时，按完整关键词拆为续行，避免表格软件的单元格长度限制。续行保留相同的 MuseDAM ID 和完整标签路径，并在「关键词续行」列标记为 `1`；其他配置只在首行输出。导入时校验续行与前一标签的 ID、路径一致后合并关键词，不把它当作重复标签；普通重复 ID 仍报错。请保留续行标记及行顺序，不要单独排序或删除续行。

AI 打标设置的「AI 识别设置」下提供团队级「图像模式」，默认关闭。配置保存在现有 `TeamConfig` 表的 `featureImageMode` JSON 布尔值中，按团队隔离，无需新增字段或 migration。新入队的打标任务（含测试任务）将团队图像模式及对应积分（关闭 1 点、开启 2 点）保存到队列 extra 快照，执行和重试沿用该快照；修改设置不影响已有快照的任务。无快照的历史任务仍在执行时读取团队当前设置；开启时特征决策模型接收源图和候选参考图，关闭时只使用文字证据，OCR 和向量检索仍会读取图像。开发分类页仍可用临时开关单次对比，不修改团队设置。

历史待审核特征使用保存的模型分数按当前团队门槛重新筛选，无需重新调用模型；已审核记录继续保留原快照。

多品识别将 OCR 明确标记为整图无坐标文本，不把文字自动归属到某个商品；向模型补充跨批次的同区域竞争商品及逐区域检索分数，避免将最强一次检索支持复制到所有区域。评分要求区分同一品牌下的产品形态和明确命名的变体，不把 Shampoo 同时用于证明护发乳，不跨品牌借用 OCR。OCR 提示要求跳过无法辨认的文字。未新增 OCR 调用或数据库迁移；新评分需重新识别，旧待审核记录可直接按已保存分数收敛为区域最高分结果。

Logo 的正向包含说明（例如“素材中包含 HERA 文字的都需要识别到该特征”）不会自动变成文字必要条件；只有明确的排他配置才限制匹配范围。图形 Logo 应与上传的图形样本比较，不因 OCR 未读出品牌文字而被排除，也不能仅凭商品品牌或通用字母形状自动命中。Logo 参考对照图使用有容量上限的短时缓存，样本增删替换后重新生成；任一样本读取失败时保留未完整评估状态，不静默丢弃该样本。无需新增数据库迁移。

Logo 成本控制：纯 Logo 决策批次仅保留 Logo 的候选与跨批次上下文，使用精简的 Logo 提示词，不附带商品规格和多品竞争规则；混合/商品批次保留原有商品决策规则。上传样本的对照图最长边限制为 768 像素，保留全部样本并按样本数调整布局；不向模型发送无助于判断的内部参考图片 UUID，不增加复核模型调用或 OCR 调用。

## AI 自动填写元数据字段

支持单选、多选、级联和复选框，与标签使用同一次队列任务及现有识别/匹配设置。字段开关独立且默认关闭；只处理已入库素材，人工值不覆盖，AI 原值可更新，联动值保留规则来源。匹配测试及审核均包含字段结果。

启用前须部署主站元数据 AI 开放接口、来源列和方法登记，并执行本项目新增 Prisma 迁移；确认所有元数据写实例均已升级，再开启字段引擎。回滚前先关闭字段引擎，保留字段值；恢复时保守处理旧 writer 期间编辑过的来源，避免误将人工值识别为 AI 值。

代码位置、SQL 顺序、实际验证、测试命令及尚未执行的真实环境验收见 [元数据自动填写交付记录](docs/metadata-ai-delivery.md)。

### 本地连接指定测试环境

`MUSEDAM_API_ENV_TAG=version-env-09` 为所有服务端 MuseDAM API 调用附加 `x-asm-prefer-tag`，未配置时不附加。主站须使用相同环境标记，并将本地打标嵌入地址设为 `http://localhost:3001`。数据库使用独立本地开发库；不要直接对现有远端库执行迁移。2026-11-06 已在本地 3001 启动、独立开发库完成全量迁移且内嵌队列运行；主站本地 3000 到达测试登录页，登录后的真实团队链路尚待验证。
