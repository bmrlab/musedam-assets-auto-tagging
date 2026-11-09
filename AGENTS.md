# MuseDAM 自动打标：本地启动与开发

本文件用于进入本地开发。命令默认在本文件所在目录执行；核对日期：2026-11-05。已对照目标主分支源码、配置和脚本静态核对，未实际启动服务。

## 环境与配置

- Node.js >=22，pnpm 9.12.3（engines 明确要求 <10），具体版本以 package.json/锁文件为准。
- PostgreSQL：README 基线 15；先创建本项目独立开发库与 shadow 库。自动打标还需按当前 schema/迁移核对 pgvector。
- 根 .env.example 是配置模板。准备 DATABASE_URL、SHADOW_DATABASE_URL、AUTH_SECRET 和当前功能依赖。
- 翻译使用 `TRANSLATION_SERVICE_MODEL`，直接调用 `OPENAI_BASE_URL/chat/completions` 并使用 `OPENAI_API_KEY`。
- 商品、Logo、IP 分类开发页和检测调试页默认使用异步检测；仅当 `DETECTION_DEBUG_SYNC=true` 时使用同步检测。
- 自动打标需要模型/embedding 配置、对象存储及 MuseDAM 凭据。需要独立队列消费者时另开终端执行 `pnpm queue-processor`；同时核对 EMBEDDED_QUEUE_SCHEDULER 和 README，避免重复启动调度器。
- 商品、Logo、IP 默认使用新增 LLM 决策：配置 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`FEATURE_DECISION_MODEL` 和 `OCR_MODEL`（未设置 OCR 模型时禁用 OCR）。二者直接调用同一网关，不经过 `LLM_PROVIDER` 路由；决策模式、5 分钟调用超时和输出 token 上限统一在 `src/lib/feature-decision/config.ts` 定义；修改模式常量为 `"legacy"` 可切回旧算法。目前记录 token 用量，费用保留为 `null`。开发分类页的「图像模式」默认关闭，关闭时仍运行 OCR/LLM 决策，仅决策请求改为纯文本；页面支持两种输入模式的结果与 token 对比。真实打标队列（含 `tagging/review` 与 `tagging/test` 产生的任务）按团队 `TeamConfig` 的 `featureImageMode` 设置发送图像证据，默认关闭；设置页可按团队开启，不再使用 `DECISION_LLM_IMAGE_USE` 控制真实队列。决策应返回合理的低置信度预测或多个可能选项，不再输出 `ambiguous`；只有全部候选明显无关时使用 `no_match`，预测展示与自动应用阈值独立。完整 LLM 决策仅按团队置信度门槛筛选，conflicts/specificityLimit 作为诊断说明，不生成只读候选；待审核特征统一支持排除/恢复。

视频兜底 OCR 需要 PATH 中的 `ffmpeg`（Docker runner 已安装）。队列优先复用开放接口 OCR，缺失时抽取原视频清晰帧；抽帧失败回退缩略图，资源上限及诊断约定见 README 的 LLM 决策与 OCR 章节。

## 安装与首次数据库准备

```sh
test -f .env || cp .env.example .env
```

编辑 .env，确认两个连接均为本地开发库，再执行：

```sh
pnpm install
pnpm exec prisma generate
pnpm exec prisma migrate dev
```

已有数据库不要 reset；发现漂移时先核对 migration 和实际结构。

新增 `20261105090000_add_feature_llm_calls` 迁移用于 OCR/决策调用的用量、费用与诊断记录；文件已准备，未自动应用到数据库。启用新算法前需按上述开发库流程应用迁移并生成客户端，部署环境使用现有 `pnpm db:deploy`。

新增 `20261106090000_tag_soft_delete_queue_poll` 为标签软删除、活动名称唯一约束、事务内缓存版本和队列轮询索引；迁移及旧实例兼容说明见 [docs/tagging-performance.md](docs/tagging-performance.md)。历史开发库有其他分支迁移时，使用独立测试库验证，不 reset 或伪造 migration 状态。

## 启动

```sh
pnpm dev
```

默认 http://localhost:3000；需要并行启动其他项目时 `pnpm dev --port 3001`。登录使用 MuseDAM 嵌入链路或项目已有 login-url 工具，参数参照 README/脚本，不以空白首页判断认证是否正常。

## 开发入口

- src/app：App Router 页面、服务端 actions/route；src/components/ui 与业务组件：组件复用入口。
- src/musedam、src/lib、src/services：集成和服务（以实际存在目录为准）。
- prisma/schema.prisma 和 prisma/migrations：数据库；src/i18n、messages：国际化。

## 验证

`pnpm exec vitest run` 运行现有测试；新增逻辑优先选择相关测试文件。当前没有 typecheck 脚本，必要时按 tsconfig 运行 `pnpm exec tsc --noEmit`。

package 中的 lint 为 next lint，若当前 Next 版本已不支持该子命令，要记录这个已有问题；不能将命令退出误报为检查通过。数据库连接、迁移、认证和 iframe 细节见 [README.md](README.md)。

## UI 开发约定

MuseDAM 界面按 `muse-development/references/design-system.md`（由工作区 Muse 开发 skill 提供）；新增静态样式使用 Tailwind，先复用本项目组件与图标。两种主题均需适配。跨仓定位见 工作区 `muse-development/SKILL.md`。

团队级「图像模式」通过 AI 打标设置保存到现有 `TeamConfig.featureImageMode` 配置项（JSON 布尔值），默认关闭，无需 migration；队列处理时读取团队当前配置。开发分类页的临时图像开关不改写团队设置。

## 标签导入开发

批量合并和覆盖导入统一使用主仓 `import-tag-tree` 同步接口，不再通过环境变量切换旧接口；部署前核对主仓接口、`000119.sql` 及开放网关已就绪。导入恢复、人工配置标记及缓存版本约定见 README 的“同步标签树导入与恢复”。导入配置不触发 AI 策略初始化。

## 启动完成的判断与维护

以终端实际输出的监听地址为准，并验证数据库连接、认证和当前开发的主要流程；编译成功不代表外部依赖已可用。配置模板仅用于首次创建文件，不覆盖已有配置，不把凭据写入本文。数据库准备命令仅用于已确认的本地开发库。脚本、环境入口、端口或目录结构变化时，同步维护本文件。

历史特征重跑恢复使用 `scripts/resume-feature-rerun.ts`，默认只读预检；部署后先重跑绿茶牛奶水验证任务，再用 `--apply` 恢复。脚本校验当前提示词和完整决策结果，跳过已审核、已删除、活动任务及较新完整结果；详见 README 的“历史特征任务恢复”。
