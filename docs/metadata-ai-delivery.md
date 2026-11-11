# 元数据字段自动填写交付记录

## 2026-11-11 严格仅填写空字段

当前规则改为不覆盖任何已有非空值，包括 AI、人工、RULE 来源以及 false、0。后端 context、联动预览和记录锁内 apply 共用同一空值判断；旧待审核预测在提交时也重新校验。若新的上游 AI 提案与已有下游值的 LIMIT 约束冲突，跳过上游提案并保留已有值。允许填写从未有值、已清空或已软删除的值，不新增 migration 或 API/common 变更。后端 material 部署后生效，不能只部署自动打标应用。审核跳过提示统一为已有值或配置变更；历史验收中的 AI 更新行为已由本规则替代。

## 2026-11-10 联动追加

按用户追加要求，当前自动打标按 LIMIT/FILL 的传递依赖分层预测。每层有效提案送后端只读预览，下游模型仅接收限定后的选项，规则已填写的字段跳过预测；写入与审核时再复核最新限制。人工值和已有规则值受保护，AI 写入触发普通自动填写链，派生值标记 RULE 来源。范围仍为全部启用 AI 的离散字段，不按模板筛选；SHOW 规则不改变预测范围。后端改在 `codex/metadata-categories-field-types`，不再使用旧的 metadata-ai-fill 分支。

本轮自动打标 47 项相关测试、TypeScript 检查及后端 32 项测试通过。真实环境 9 已验证线上电商仅预测秋季，写入后连续填入 false 和面霜；来源、幂等、越界拒绝及索引事件均已核对。记录见 `development/metadata-test-data/联动验收记录.md` 和 `linkage-verification.json`。以下为历史交付记录，不能作为本轮真实环境验收证明。

核对日期：2026-11-05。本次重点为 M2，并接入 M3 的模板、停用和联动规则。结论是本地开发与相关验证完成；本文没有把组件样例、单测或 HTTP 200 当成完整的真实团队端到端验收。

## 代码位置

| 仓库 | 工作树 | 分支 |
|---|---|---|
| 自动打标 | `/Users/fuxuewei/.codex/worktrees/metadata-auto-tagging/musedam-assets-auto-tagging` | `codex/metadata-categories-field-types`，从本次拉取的 origin/main 创建 |
| 主站前端 | `/Users/fuxuewei/Public/tz-codes/.worktrees/metadata-main-site` | 接续 `codex/metadata-categories-field-types` |
| 主站后端 | `/Users/fuxuewei/Public/tz-codes/.worktrees/metadata-backend` | `codex/metadata-ai-fill`，基于已有元数据分支 |

原工作区存在的未提交修改均保留。未推送、未发布，未修改已有远端数据库。

Muse skill 来源已核对为 `https://git.tezign.com/muse/muse-skills.git`，完整 `origin/main:skills/muse-development` 安装到 `~/.agents/skills/muse-development`，包含 references；源提交 `effaad1f4cc15f7e259506921aef5f9bf8fb80d2`。安装前目标目录不存在；源工作树及其文档分支没有被覆盖。已遵循 SKILL、设计规范、前后端参考和相关仓库 AGENTS。

## 实现入口

自动打标：

- `src/app/(tagging)/types.ts`、`tagging/settings/*`：两个独立开关；旧标签状态保持，新字段开关默认关闭。保存失败回退字段开关，关闭前确认；模式和策略说明覆盖字段；管理入口沿用宿主消息协议。
- `src/lib/metadata/*`：单选、多选、级联、复选框预测。仅使用启用的信息源，复用标签的模型、备用模型、权重和评分函数；按批次限制字段数。校验选项 ID、字段版本及原文依据，布尔 false 不视为空值。
- `src/app/(tagging)/queue.ts`：同一任务中处理字段，支持直接应用、审核和测试；字段模式无需标签树，无匹配结果正常完成。写入前复核字段引擎开关，不增加独立计费项。
- `tagging/review/actions.ts`：联合 SQL 计数与分页，包含只有字段结果的素材。`MetadataInlineReview`、`MetadataReviewPanel` 支持全部内容、仅字段、逐条/批量采纳和删除、状态查询。
- `tagging/review/metadata-actions.ts`：团队隔离、权限校验、审核行锁、稳定幂等号。远端失败保持待审核；人工值或失效配置由主站写入端再次判定。
- `src/musedam/metadata*.ts`：复用团队凭据和请求封装；开关日志与配置同事务保存，网络失败保留事件并由消费者重试。
- `prisma/migrations/20261105120000_metadata_audit/migration.sql`：持久化字段审核记录。
- 根 `messages` 和业务 `messages`：17 语言。主站也逐语言执行了 fallback 后的实际导出核对，避免英文覆盖本地 Tooltip。`development/metadata-preview` 为真实组件加模拟数据的本地验收样例，不是生产路由。

主站前端：

- `services/metadataV3.ts`、`MetadataV3List.tsx`：读取 AI 来源与置信度；字段名旁标记和 Tooltip；人工编辑立即撤销标记，保存后由服务端清除来源。
- `MetadataFieldEditor.tsx`、`MetadataManagementPage.tsx`：引擎关闭时仍可配置，显示暂停提示；未开通引擎时不显示 AI 标签。
- `store/ai.ts`、`BizAutoTag/InitAutoTagApp.tsx`：通过现有受限 iframe 消息来源同步字段引擎开关。
- `OuterFolderSelector`、`BizFolderScopeSelector`：全部素材清空文件夹、禁用树及其键盘交互；确认返回的范围不混入文件夹。异步选择返回时也保留全部素材语义。
- `.kiwi/*/AppDashboard.ts`、`src/messages/*/metadataManagement.ts`：17 语言，并保留既有 fallback。

主站后端：

- `MetadataAiBizService` 与 `EnterpriseMetadataAiDTO`：窄范围的团队开放接口，只接受离散选项/复选框，不提供通用覆盖接口。
- `MetadataRecordBizService`、值 Entity/Mapper：记录锁内复核人工值；人工同值保存也清除 AI/联动来源。AI 低置信度或无新结果时保持原值。
- 复用 `MetadataRuntimeBizService` 和 `MetadataRuleEngine`：按适用模板取并集、跳过停用字段、执行选项限制和联动。AI 直接值标 AI，联动值标 RULE 并保存来源字段。
- `MetadataOutboxBizService`：字段配置、开关和 AI 写入进入现有操作日志及素材动态链路。使用稳定 batchCode，沿用日志服务已有幂等逻辑。
- `mini-dam-script/src/main/resources/sql/000118_metadata_ai.sql`：来源列及三个 open_service 方法登记。

新增静态样式使用 Tailwind，复用现有 Radix/AntD、按钮、选择器、Tooltip 和图标。保留现有审核卡片结构，增加字段区；没有为本任务替换整套组件或全局主题。

## 实际验证

| 检查 | 结果 |
|---|---|
| 自动打标相关测试 | 7 文件、87 项通过，包含真实 PostgreSQL 中的 13 项队列/审核/日志重试测试 |
| 新增生产代码 ESLint | 指定新增/改动组件及服务文件，`next lint --file …` 无警告或错误；仅有环境多锁文件提示 |
| 自动打标 TypeScript | `pnpm exec tsc --noEmit` 通过 |
| 主站元数据 Jest | 9 文件、38 项通过；包含 false 值标记、人工同值编辑清除标记、人工值无标记 |
| 主后端元数据回归 | JDK 21，230 项通过，包含真实 MySQL 的 7 项事务测试 |
| PostgreSQL 迁移 | 在两个全新、隔离的本地 pgvector 库执行全量迁移成功；最终库与 Prisma schema 的 diff 为空 |
| MySQL SQL | 对隔离的 MySQL 8 执行来源列迁移和三个开放方法登记成功；回读列、备注、索引及登记结果 |
| MySQL 写入行为 | false、来源/置信度、幂等、AI 更新、人工值保护、并发人工写入、失效版本/停用、联动限制及 RULE 来源、未入库拒绝写入均有覆盖 |
| 实际模型 | 使用已有模型配置和合成素材文本，两轮结构化输出冒烟通过；不涉及客户素材内容 |
| 浏览器组件样例 | 亮/暗主题、依据展开、独立开关、关闭确认与 Escape 取消、勾选后批量按钮、采纳后状态切换、失效字段禁用已实际操作；截图在附件目录 |
| Next 开发启动 | 3020 端口 Ready；登录入口 HTTP 200。仅证明启动与该路由编译，不代表已验证真实嵌入登录或完整业务依赖 |

后端测试使用 `-DreuseForks=false`。默认复用 JVM 时，仓库 Mockito 5.11 混用 inline/subclass mock maker 会触发内部断言；分隔测试类进程后全部通过，没有为绕过失败而改变业务规则。

## 验收清单对照

来源：[飞书方案第 15 节](https://tezign.feishu.cn/wiki/EdGXw6zdQiETJIk6mtMcvlNWnNY?fromScene=spaceOverview)，读取版本 8084。8 份 Markdown 附件已下载并阅读，另下载打标设置、匹配测试、审核三张原始截图作对照。资料及验证截图保留在 `/Users/fuxuewei/Public/tz-codes/.worktrees/metadata-acceptance`。

以下“通过”表示对应核心行为已经有可重复的本地证据，**不表示完整真实团队 BrowserUse 旅程已通过**。需要部署、真实成员、点数账单或完整嵌入交互的部分明确跳过。

| 用例 | 结果 | 本地证据或跳过原因 |
|---|---|---|
| 18.1 | 跳过 | 配置入口沿用已有主站实现；真实团队编辑/保存旅程未跑 |
| 18.2 | 通过 | 模块状态同时约束字段编辑入口、AI 标签及引擎侧入口；静态核对和服务端 guard |
| 18.3 | 通过 | 服务端只允许四种离散类型；策略测试覆盖其他类型拒绝 |
| 18.4 | 通过 | 宿主同步开关、精确警示文案、配置保持可编辑；静态核对 |
| 18.5 | 跳过 | AI 标签及权限门控已实现；完整主站列表交互待真实环境验证 |
| 18.6–18.9 | 通过 | MySQL 实际写入/刷新/人工保护 + 主站标记组件测试 |
| 18.10–18.11 | 通过 | 实际 MySQL + 现有联动引擎，验证限制选项和 RULE 来源 |
| 18.12 | 通过 | 联合分页真实 SQL、“仅字段”视图及本地浏览器样例 |
| 18.13 | 跳过 | 逐条/批量采纳及字段计数有本地验证；标签/特征/字段混合操作完整 toast 和真实宿主旅程待验 |
| 18.14 | 通过 | PostgreSQL 审核并发与 MySQL 写入端复核人工值 |
| 18.15 | 跳过 | 附件旧规则为待入库预填；按最新飞书正文归入 M4，本次明确不做 |
| 18.16 | 通过 | 服务端候选只含允许的级联节点，写入复用末级校验；实际模型仅选择给定 ID |
| 18.17 | 通过 | 复用模板解析和启用状态；模板/规则回归与停用写入测试 |
| 18.18 | 通过 | 匹配结果包含字段与来源；测试展示固定 80/60 分界，执行门槛仍随识别模式 |
| 18.19 | 通过 | 配置保存只写配置和日志，不入队重跑已有素材 |
| 18.20 | 跳过 | 沿用同一任务、未增加计费调用；真实点数账单未验 |
| 18.21 | 通过 | 基础版默认字段机制沿用；字段批次处理覆盖所有开启且适用的字段 |
| 18.22 | 通过 | 两个独立开关、默认迁移、元数据管理入口；本地浏览器操作及路径核对 |
| 18.23–18.24 | 通过 | 字段单独运行无标签树、直接/审核/空结果队列测试；关闭字段不进入预测 |
| 18.25 | 通过 | 浏览器实际验证关闭确认与取消，成功提示和失败回退已实现 |
| 18.26 | 通过 | 模式描述和策略说明覆盖字段，关键词明确仅对标签生效；17 语言 |
| 18.27 | 通过 | 能力查询不可用/未开通时不显示字段入口；标签团队不依赖新元数据接口 |
| 15.7–15.9 | 跳过 | 配置日志、持久化重试、日志 RPC/动态投递已有本地验证；实际日志服务和主站动态 UI 未联调 |
| M1/M3 回归 | 通过 | 主站 35 项原测试 + 后端元数据回归；不代替全部 BrowserUse 旅程 |

## 不确定点与采用的方案

1. **待入库范围冲突**：附件仍包含 M2 预填，最新正文已经改为 M4。采用最新正文，只处理已进入有效文件夹的素材；“全部素材”也不包含待入库。
2. **任务只点名两个项目，但缺少写入能力**：在主站既有后端元数据分支上补窄接口、来源、锁与日志，而非让前端通过旧通用 PATCH 冒充人工写入。
3. **门槛口径**：生产执行沿用精准/平衡/宽泛门槛和标签评分函数；匹配测试按附件固定 80 以上生效、60–79 候选。候选不会因为测试展示而被自动采纳。
4. **分支版本号**：指南要求分支 SNAPSHOT，但 Maven 禁止版本含 `/`。采用 `codex-metadata-ai-fill-SNAPSHOT`，保留分支识别信息。
5. **跨服务原子性**：不引入分布式事务；采用审核行锁、主站记录锁和稳定幂等回执。远端成功但本地提交失败可安全重试，人工值始终由主站最终保护。
6. **真实环境访问与发布**：本地现有数据库连接指向远端，因此未复用来迁移或写测试素材。使用新建的 PostgreSQL/MySQL 容器；真实模型只传合成文本。完整嵌入、日志 UI 和账单验收保留为部署后步骤。

## 发布前仍需完成

- 在目标环境先核对并执行 V3 基础 SQL，再执行 `000118_metadata_ai.sql`，登记三个开放方法；确认网关转发。没有执行任何线上 DDL。
- 对实际修改的 API 包，使用 JDK 21 和仓库 Maven settings 执行 **`mvn clean deploy -DskipTests -s ../../mini-dam-script/maven/settings.xml`**（在 `api/api-mini-dam` 下），再部署 material。这里只做了本地 install，没有向私服 deploy。
- 自动打标执行既有 `pnpm db:deploy` 后再部署新版本；字段引擎默认关闭；确认全部元数据写实例已升级、能力可用后，由团队按需开启。回滚前先关闭字段引擎，保留值及来源列；恢复后须把旧写实例期间编辑过的 AI 值保守归为人工来源，再开启，避免旧 writer 未清来源造成误覆盖。
- 在一个基础版和一个高级版真实团队执行 BrowserUse 旅程 11，以及相关模板/权限/升降级回归；验证 iframe 通知、日志动态和点数明细。
- 尚未完成完整的真实团队 UI 和线上外部依赖验收；没有把上述跳过项算作通过。

## HTML 原型补充核对（2026-11-05）

用户随后提供了 Downloads 下的三份完整 HTML：打标设置、打标审核、匹配测试。上一轮只有截图和 Markdown 附件，虽然已实现字段 UI，但未完成这些 HTML 原型的结构对齐；这是上一轮交付的遗漏。

本次读取 HTML 的页面结构与交互定义，并补充实际业务组件：

- 设置：两个开关独立分行、管理入口与对应说明同组，策略共享提示移动到策略组下方。
- 审核：`MetadataInlineReview` 改为「元数据字段 / AI 填写字段」左右对照，小屏纵向；新增 `MetadataCurrentValues`，复用现有 `/metadata-records-by-ids` 接口读取当前值。权限及团队归属在 server action 再校验；加载失败明确显示并可重试，不把失败显示为空值。
- 仅字段审核同样加入当前值对照；单条和批量审核仍使用原有受保护的写入链路。
- 匹配测试：`MetadataResults` 按字段结果行呈现计数、来源、生效/候选、置信度和展开依据；低于 60 的结果不计入测试展示。保留 false 和 0，过滤内部快照，并用快照选项名称替换级联节点 ID。
- 增补 17 语言文案；修改均位于自动打标工作树。本次没有调整后端、数据库或主站。

本次复验：相关 3 个测试文件 34 项通过、TypeScript 通过、新增生产文件定向 lint 无警告或错误。浏览器实际验证亮暗主题、依据展开、Escape 取消后开关保持、勾选后批量按钮可用、采纳后列表更新。预览新增设置/审核/匹配测试导航，使用真实组件及模拟素材，仍不代表完整生产页面、认证或 iframe 联调。截图目录：`/Users/fuxuewei/Public/tz-codes/.worktrees/metadata-acceptance/ui-prototype-followup`。

本次对齐的是元数据相关结构与交互；没有实现原型中其他功能的车漆、通知设置，也没有宣称整个页面达到逐像素一致。真实团队的当前值读取及混合审核联调仍在部署后验收项中。
