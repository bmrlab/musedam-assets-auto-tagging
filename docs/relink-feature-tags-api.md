# 修复特征库标签关联

从主项目重新同步标签树后，旧标签被删除会使特征库关联的 `assetTagId` 变为 `null`，但关联记录保留的 `tagPath` 可以用来匹配新标签。

`POST /api/feature-library/relink-tags`

仅管理员可调用，预览和执行均通过服务端 `isAdminUserSlug` 校验，沿用项目的 `ADMIN_USER_IDS` 管理员配置。非管理员返回 HTTP 403。管理员仍需通过现有 `checkUserPermission` 团队权限校验；仅处理当前登录会话所属团队，不能传入其他团队 ID。无需数据库迁移。

## 请求

```json
{
  "types": ["product"],
  "dryRun": true
}
```

- `types`：可选，默认为 `["product"]`；支持 `product`（商品）、`brand`（品牌）、`person`（人物）、`ip`。可传多个类型。
- `dryRun`：可选，默认为 `true`，仅预览；`false` 才写入数据库。
- 必须传 JSON 对象；未知字段会被拒绝。

在已登录的当前项目页面打开浏览器控制台执行：

```js
const result = await fetch("/api/feature-library/relink-tags", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ types: ["product"], dryRun: true }),
}).then((r) => r.json());
console.log(result);
```

确认预览后，将 `dryRun` 改为 `false` 再调用。执行时重新读取最新数据。

## 返回

成功返回 `{ success: true, data: { dryRun, results } }`。`results` 每个库包括：

- `type`、`total`（关联记录数）、`matched`（可修复数）、`updated`（实际写入数，预览为 0）、`unchanged`、`skipped`。
- `details`：每条关联的 `linkId`、`featureId`、`tagPath`、`oldTagId`、`newTagId` 和 `status`。

| status       | 含义                                                       |
| ------------ | ---------------------------------------------------------- |
| relink       | 唯一匹配，预览时待修复，执行时已修复                       |
| unchanged    | 当前 ID 仍有效，保留原关联                                 |
| not_found    | 没有完全相同的标签路径，保留记录                           |
| ambiguous    | 相同完整路径对应多个标签，保留记录                         |
| invalid_path | 没有有效的历史路径，保留记录                               |
| duplicate    | 同一特征已关联或计划关联该标签，保留记录，避免唯一约束冲突 |

匹配采用完整路径的名称数组逐项精确比较，不忽略大小写或空格，不按末级名称猜测。不会修改图片、向量、路径快照和排序，也不会触发主项目同步。无历史关联记录或路径缺失时无法自动恢复。

所有选定库的修复在一个 Serializable 事务内完成，失败整体回滚；重复执行不会重复创建关联。并发冲突返回 HTTP 409，可重新预览后重试。其他状态包括 400（参数错误）、401（未登录）、403（权限不足）、500（执行失败）。
