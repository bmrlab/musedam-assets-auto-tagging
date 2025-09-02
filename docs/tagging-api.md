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
