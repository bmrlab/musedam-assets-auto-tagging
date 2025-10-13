# 团队设置通信功能

## 概述

当项目内部授权完成后（基于路由上的auth参数），系统会自动将简化的团队设置信息传递给父窗口，包括手动触发标签功能是否开启以及当前用户的权限状态。

## 功能特性

1. **自动通知**：项目内部授权完成后自动获取并发送简化的团队设置
2. **API支持**：提供 `/api/team/settings` API端点获取简化的团队设置数据
3. **错误处理**：包含完整的错误处理和回退机制
4. **手动触发**：提供 `triggerTeamSettingsNotification()` 函数供手动触发

## 消息格式

### 发送给父窗口的消息

```typescript
{
  source: "musedam-app",
  target: "musedam",
  type: "event",
  event: "team-settings-ready",
  data: {
    manualTriggerTagging: boolean;
    hasPermission: boolean;
  },
  timestamp: string;
}
```

### 触发机制

团队设置通知会在以下情况下自动触发：

1. **页面加载完成后**：等待2秒确保授权完成，然后自动发送团队设置
2. **手动触发**：调用 `triggerTeamSettingsNotification()` 函数

## API端点

### GET /api/team/settings

获取当前用户的简化团队设置信息。

**响应格式：**

```typescript
{
  success: true,
  data: {
    manualTriggerTagging: boolean,
    hasPermission: boolean
  }
}
```

## 使用示例

### 父窗口监听团队设置就绪事件

```javascript
window.addEventListener("message", (event) => {
  if (
    event.data.source === "musedam-app" &&
    event.data.target === "musedam" &&
    event.data.event === "team-settings-ready"
  ) {
    const { manualTriggerTagging, hasPermission } = event.data.data;

    // 处理简化的团队设置数据
    console.log("手动触发标签:", manualTriggerTagging);
    console.log("用户权限:", hasPermission);

    // 根据设置更新UI或执行其他操作
    updateUI({ manualTriggerTagging, hasPermission });
  }
});
```

### 手动触发团队设置通知

```javascript
// 在iframe内部调用
import { triggerTeamSettingsNotification } from "@/embed/message";

// 在授权完成后的任何时间调用
triggerTeamSettingsNotification();
```

## 错误处理

- 如果获取团队设置失败，系统会发送一个不包含数据的就绪通知
- 所有错误都会被记录到控制台
- API调用包含完整的错误处理和状态码

## 数据说明

- **manualTriggerTagging**: 表示团队是否启用了手动触发标签功能
- **hasPermission**: 表示当前用户是否有使用标签功能的权限

## 注意事项

1. 团队设置通知会在页面加载完成后自动触发（延迟2秒）
2. 父窗口需要正确处理简化的团队设置数据
3. 该功能依赖于有效的用户会话和团队权限
4. 只返回必要的信息，减少数据传输量
5. 可以使用 `triggerTeamSettingsNotification()` 函数手动触发通知
