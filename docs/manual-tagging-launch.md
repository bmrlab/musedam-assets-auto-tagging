# 手动打标确认与应用范围

手动发起默认读取团队设置，确认弹窗只展示可处理素材数、预计积分与配置摘要。「调整本次设置」只修改当前任务的识别模式和匹配来源；图片、视频图像模式继续沿用团队配置。关闭后重开恢复团队默认值，不调用设置保存接口。

单素材的卡片菜单、右键菜单，以及纯素材批量选择的工具栏/右键菜单按团队应用范围隐藏打标入口。选中的文件夹仍由服务端展开并计算实际可处理数。混选弹窗展示范围外数量，只报价和提交范围内素材；全部不在范围内时禁止提交。素材任一父文件夹命中选中目录或子目录即在范围内，未入库素材始终排除。

## 跨仓协议与发布顺序

本次涉及三个仓库：`musedam-assets-auto-tagging`、主前端 `tezign-intelligence-frontend-minidam` 和 Java 后端的 `mini-dam-material`。无 migration，不涉及公共 API 包版本。

1. 先升级打标应用。`GET /api/team/settings` 的 `manualTaggingDefaults` 返回识别模式、匹配来源、图片/视频图像模式及展开后的 `allowedFolderIds`（`null` 表示全部已入库素材）。沿用 `team-settings-ready` 消息通知主站，团队切换清空旧配置。
2. `POST /api/tagging/credit-quote` 新增可选 `checkApplicationScope: true`。携带 `assetIds` 时只读获取父文件夹和媒体元数据，返回 `eligibleAssetIds`、`excludedCount`，仅范围内素材计费。缺少父目录数据或范围查询失败时拒绝报价。不带此参数的旧调用保留原协议。
3. 升级 material。`batchAutoMarkingCount` 按最多 100 个素材分批询价，返回范围内 `materialCount`、`excludedCount`、`eligibleMaterialIds` 和总积分；提交时重新询价并仅对返回的素材发起任务。新 material 会拒绝缺少范围信息的旧打标应用响应，避免显示错误报价。
4. 升级主前端。新弹窗要求范围感知报价；旧 material 不返回范围信息时提示报价失败并禁止提交。

最终入队接口仍保留服务端范围校验，处理确认后发生的配置或素材移动变化。积分与最终实际扣费仍以实际入队结果为准。

## 验证

- 打标应用：`pnpm exec vitest run __test__/credit-quote.test.ts __test__/manual-tagging-defaults.test.ts`；同时验证识别模式与匹配来源筛选的相关用例。
- material：`mvn -o -f mini-dam-material/pom.xml test -Dtest=AutoMarkingBizServiceProxyTest -Dmaven.test.skip=false -DskipTests=false -s mini-dam-script/maven/settings.xml`，34 项通过。
- 主前端：独立组件预览位于 `development/manual-tagging-preview`，包含范围菜单单测与真实弹窗交互检查；详见该目录 README。

UI 截图使用真实组件、真实翻译与主题 token，团队配置和报价为模拟数据，不连接远端、不入队、不扣点。组件预览不能替代真实团队认证、iframe 消息和三服务部署后的端到端验收。
