# 恢复误标为已删除的审核素材

部署后使用 `POST /api/tagging/admin/restore-deleted-assets`。必须登录应用管理员账号（`ADMIN_USER_IDS`）；与现有取消排队任务接口一致，可按明确指定的 MuseDAM 团队执行。接口不接受开放平台 API Key 作为管理鉴权。

## Ulike 预览

在 `https://auto-tagging.apps.musedam.cc` 登录后，在浏览器控制台执行：

```js
await fetch('/api/tagging/admin/restore-deleted-assets', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ musedamTeamId: '159945', dryRun: true, limit: 20, afterId: 0 }),
}).then(r => r.json())
```

只扫描该团队 `extra.reviewAssetDeleted === true` 的素材，通过开放接口核实存在。结果 `eligible` 表示可恢复，`unavailable` 表示当前凭据仍查询不到，`changed` 表示标记已被其他请求清除。可加 `assetIds: ['25623674']` 限定素材。`limit` 最大 50；`afterId` 是本地素材记录 ID，不是 MuseDAM 素材 ID。

## 执行同一批恢复

```js
await fetch('/api/tagging/admin/restore-deleted-assets', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    musedamTeamId: '159945', dryRun: false,
    acknowledgeStatusReset: true, limit: 20, afterId: 0,
  }),
}).then(r => r.json())
```

恢复只清除删除标记，并把这些素材的 `rejected` 审核项改为 `pending`；保留其他素材元数据以及目前仍为 approved/pending 的审核项，不写回 MuseDAM 标签，不重新运行 AI。

**历史限制：** 原误标逻辑把素材全部审核项覆盖为 rejected，未保存原状态。因此恢复会包括原本人工拒绝或曾经通过后被覆盖的记录，需要重新审核。`previousStatusesUnavailable: true` 提示此限制；执行必须显式提交 `acknowledgeStatusReset: true`。

当响应 `hasMore: true`，使用执行响应的 `nextAfterId` 作为下一批的 `afterId`，重复预览与执行；直到 `hasMore: false`。不要用预览响应的游标跳过尚未恢复的这一批。unavailable 项会保留删除标记；权限修复后可从 `afterId: 0` 重新扫描。请求失败时可能已完成部分素材，重试该批即可，已清除标记的记录会被跳过。

每个素材的清标记和审核项重置在同一事务中执行，操作写入 `module=restore-deleted-assets` 的日志。执行后刷新待审核列表，并重新查询预览确认。

新的单条/批量审核遇到开放接口空结果时只报告失败、保留审核状态，不再推断素材已删除。
