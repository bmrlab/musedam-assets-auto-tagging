# Musedam 自动登录集成文档

## 前提条件

1. 第三方应用已创建，双方都拿到了 `appId` 和 `appSecret`
2. 测试团队已安装 autotagging 应用，建议使用 musedam 企业版团队 ID 135 来测试

## 接入流程

### 1. 生成登录 URL token

musedam 需要实现 token 生成逻辑，使用 `appSecret` 作为加密密码来加密用户和团队信息：

#### 加密算法实现

使用 AES-256-CBC 加密算法，参考以下实现：

```javascript
import crypto from "crypto";

const IV_LENGTH = 16;
const ALGORITHM = "aes-256-cbc";

function encryptText(text, appSecret) {
  const CIPHER_SECRET_KEY = crypto.scryptSync(appSecret, "salt", 32);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, CIPHER_SECRET_KEY, iv);

  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");

  const result = Buffer.concat([iv, Buffer.from(encrypted, "base64")]);

  return result.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
```

#### 生成 token 的数据结构

```javascript
const payload = {
  user: {
    id: currentUser.id,
    name: currentUser.name,
  },
  team: {
    id: currentTeam.id,
    name: currentTeam.name,
  },
  timestamp: Date.now(),
  expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24小时过期
};

const encryptedToken = encryptText(JSON.stringify(payload), appSecret);
```

### 2. 组装登录 URL

将加密后的 token 和回调页面参数组装成完整 URL：

```javascript
const loginUrl = `https://autotagging.yourdomain.com/auth/${encryptedToken}?callbackUrl=/tagging&theme=dark`;
```

### 3. iframe 嵌入

在 musedam 页面中通过 iframe 打开生成的 URL：

```html
<iframe src="生成的登录URL" width="100%" height="800px" frameborder="0"></iframe>
```

### 4. 支持的参数

#### callbackUrl 参数

支持的回调路径：

- `/tagging` - 打标控制台
- `/tags` - 标签管理

#### theme 参数

支持的主题设置：

- `dark` - 深色主题（默认）
- `light` - 浅色主题

#### locale 参数

支持的语言设置：

- `zh-CN` - 中文（默认）
- `en-US` - 英文

#### 参数组合示例

```javascript
// 使用深色主题 + 中文界面
const loginUrl = `https://autotagging.yourdomain.com/auth/${encryptedToken}?callbackUrl=/tagging&theme=dark&locale=zh-CN`;

// 使用浅色主题 + 英文界面
const loginUrl = `https://autotagging.yourdomain.com/auth/${encryptedToken}?callbackUrl=/tagging&theme=light&locale=en-US`;

// 只设置主题
const loginUrl = `https://autotagging.yourdomain.com/auth/${encryptedToken}?callbackUrl=/tagging&theme=dark`;

// 只设置语言
const loginUrl = `https://autotagging.yourdomain.com/auth/${encryptedToken}?callbackUrl=/tagging&locale=en-US`;
```

> 由于 theme 和 locale 参数可能在页面跳转中丢失，通过 auth 页面传入的 theme 和 locale 参数不是临时设置，而是会持久化在浏览器本地，如果每次 auth url 上都带着 theme 和 locale 参数，就可以确保始终同步。

## 参考代码

本项目提供了完整的加密实现，可参考：

- [cipher.ts](../src/lib/cipher.ts) - 加密解密实现
- [login-url.ts](../scripts/login-url.ts) - URL 生成示例

## 相关文档

- [发起打标接口文档](./tagging-api.md) - 打标相关 API 接口

## 测试

建议使用团队 ID 135 进行测试，确保加密算法和数据格式正确。

接入结束。
