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
  "assetId": 6908914
}
```

| 参数名  | 类型   | 必填 | 描述                    |
| ------- | ------ | ---- | ----------------------- |
| teamId  | number | 是   | MuseDAM 团队 ID         |
| assetId | number | 是   | MuseDAM 系统中的素材 ID |

#### 响应格式

**成功响应** (HTTP 200):

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
