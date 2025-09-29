# 打标接口文档

## 概述

本文档描述了 MuseDAM 自动打标系统的 API 接口，用于对指定的素材进行 AI 智能打标。

## 接口详情

### 发起打标任务

**接口地址**: `POST /api/tagging/predict-asset-tag`

**描述**: 根据团队 ID 和 MuseDAM 素材 ID 发起 AI 打标任务。接口会自动从 MuseDAM 同步最新的素材信息到本地数据库，然后启动 AI 打标流程。

#### 请求参数

**Headers**:

```
Content-Type: application/json
```

**Body**:

```json
{
  "teamId": 135,
  "assetId": 6908914,
  "matchingSources": {
    "basicInfo": true,
    "materializedPath": true,
    "contentAnalysis": false,
    "tagKeywords": true
  },
  "recognitionAccuracy": "balanced"
}
```

| 参数名              | 类型    | 必填 | 描述                                                                                                    |
| ------------------- | ------- | ---- | ------------------------------------------------------------------------------------------------------- |
| teamId              | number  | 是   | MuseDAM 团队 ID                                                                                         |
| assetId             | number  | 是   | MuseDAM 系统中的素材 ID                                                                                 |
| matchingSources     | object  | 否   | 打标数据源配置对象，包含各数据源的启用状态。不填写时默认所有数据源都启用                                |
| └─ basicInfo        | boolean | 否   | 是否启用基础信息数据源，默认 `true`                                                                     |
| └─ materializedPath | boolean | 否   | 是否启用文件路径数据源，默认 `true`                                                                     |
| └─ contentAnalysis  | boolean | 否   | 是否启用内容分析数据源，默认 `true`                                                                     |
| └─ tagKeywords      | boolean | 否   | 是否启用标签关键词数据源，默认 `true`                                                                   |
| recognitionAccuracy | string  | 否   | 识别精度模式，可选值：`precise`（精确）、`balanced`（平衡）、`broad`（广泛）。不填写时默认为 `balanced` |

#### 响应格式

**成功响应**:

1. **打标任务成功入队** (HTTP 200):

```json
{
  "success": true,
  "data": {
    "message": "Asset tagging task enqueued successfully",
    "queueItemId": 456,
    "status": "processing"
  }
}
```

2. **素材不在选定文件夹范围内，跳过打标** (HTTP 202):

```json
{
  "success": true,
  "data": {
    "message": "Asset 6908914 is not in the selected folders",
    "queueItemId": null,
    "status": null
  }
}
```

**错误响应**:

1. **团队不存在** (HTTP 404):

```json
{
  "success": false,
  "error": "Team not found"
}
```

2. **素材不存在** (HTTP 400):

```json
{
  "success": false,
  "error": "Failed to sync asset 6908914: Asset 6908914 not found"
}
```

3. **参数错误** (HTTP 400):

```json
{
  "success": false,
  "error": "Invalid request format",
  "details": [
    {
      "code": "invalid_type",
      "expected": "number",
      "received": "string",
      "path": ["teamId"],
      "message": "Expected number, received string"
    }
  ]
}
```

4. **服务器错误** (HTTP 500):

```json
{
  "success": false,
  "error": "Internal server error"
}
```

### 批量发起打标任务

**接口地址**: `POST /api/tagging/predct-asset-tag-batch`

**描述**: 根据团队 ID 批量发起 AI 打标任务。可以指定特定的素材 ID 列表，或者不指定 ID 自动处理团队下的素材。接口会自动从 MuseDAM 同步最新的素材信息到本地数据库，然后批量创建打标任务。

#### 请求参数

**Headers**:

```
Content-Type: application/json
```

**Body**:

```json
{
  "teamId": 135,
  "assetIds": [6908914, 6908915, 6908916],
  "batchSize": 100
}
```

| 参数名    | 类型      | 必填 | 描述                                                                              |
| --------- | --------- | ---- | --------------------------------------------------------------------------------- |
| teamId    | number    | 是   | MuseDAM 团队 ID                                                                   |
| assetIds  | number[]  | 否   | MuseDAM 系统中的素材 ID 数组。如果不提供，则自动处理团队下符合条件的素材           |
| batchSize | number    | 否   | 每批处理的数量，范围 1-500，默认 100。仅在未指定 assetIds 时生效                  |

#### 响应格式

**成功响应**:

1. **批量打标任务成功入队** (HTTP 200):

```json
{
  "success": true,
  "data": {
    "message": "Scheduled tagging completed",
    "totalAssets": 150,
    "enqueuedTasks": 120,
    "failedTasks": 5,
    "taskType": "scheduled"
  }
}
```

2. **打标功能未开启** (HTTP 200):

```json
{
  "success": true,
  "data": {
    "message": "Tagging is disabled for this team",
    "totalAssets": 0,
    "enqueuedTasks": 0,
    "failedTasks": 0,
    "taskType": "scheduled"
  }
}
```

3. **定时打标未开启** (HTTP 200):

```json
{
  "success": true,
  "data": {
    "message": "Scheduled tagging is not enabled",
    "totalAssets": 0,
    "enqueuedTasks": 0,
    "failedTasks": 0,
    "taskType": "scheduled"
  }
}
```

**错误响应**:

1. **团队不存在** (HTTP 404):

```json
{
  "success": false,
  "error": "Team not found"
}
```

2. **批量处理失败** (HTTP 400):

```json
{
  "success": false,
  "error": "Failed to sync asset 6908914: Asset 6908914 not found; Failed to process asset 6908915: Asset not in selected folders"
}
```

3. **参数错误** (HTTP 400):

```json
{
  "success": false,
  "error": "Invalid request format",
  "details": [
    {
      "code": "invalid_type",
      "expected": "number",
      "received": "string",
      "path": ["teamId"],
      "message": "Expected number, received string"
    }
  ]
}
```

4. **服务器错误** (HTTP 500):

```json
{
  "success": false,
  "error": "Internal server error"
}
```

#### 响应字段说明

| 字段名        | 类型   | 描述                                                                 |
| ------------- | ------ | -------------------------------------------------------------------- |
| totalAssets   | number | 总素材数量                                                           |
| enqueuedTasks | number | 成功入队的任务数量                                                   |
| failedTasks   | number | 失败的任务数量                                                       |
| taskType      | string | 任务类型，固定为 "scheduled"                                         |

#### 注意事项

1. 如果指定了 `assetIds`，则 `batchSize` 参数将被忽略
2. 如果未指定 `assetIds`，接口会自动查询团队下符合条件的素材，并按照 `batchSize` 限制处理数量
3. 接口会跳过已经在队列中处于 "pending" 或 "processing" 状态的素材，避免重复创建任务
4. 只有在应用范围设置中的素材才会被处理，超出范围的素材会被自动跳过
5. 接口使用异步处理，素材同步和任务创建都是并行的，提高处理效率
