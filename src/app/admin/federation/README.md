# MuseDAM联合登录功能

## 简介

MuseDAM联合登录功能允许MuseDAM系统通过server action生成登录链接，实现用户无密码登录。

## 数据库设计

- `MuseDAMUser`: 存储MuseDAM用户ID，关联到本地User
- `MuseDAMOrganization`: 存储MuseDAM组织ID，关联到本地Organization
- 通过外键关联而不是metadata存储，保持数据结构清晰

## 使用方法

### 管理员测试界面

访问 `/admin/federation` 可以测试联合登录功能：

1. 输入MuseDAM用户ID和组织ID
2. 可选择填写用户和组织的额外信息
3. 点击生成登录链接
4. 复制链接在新窗口测试

### Server Action调用

```typescript
import { createMuseDAMLoginLink } from "@/app/admin/actions/federation";

const result = await createMuseDAMLoginLink({
  museDAMUserId: "musedam-user-123",
  museDAMOrgId: "musedam-org-456",
  userInfo: {
    name: "张三",
    email: "zhangsan@example.com",
    role: "user",
    organizationRole: "member",
  },
  orgInfo: {
    name: "测试公司",
    logo: "https://example.com/logo.png",
  },
});

if (result.success) {
  // 用户访问 result.data.loginUrl 即可登录
  console.log("登录链接:", result.data.loginUrl);
}
```

## 工作流程

1. 调用 `createMuseDAMLoginLink` 生成登录链接
2. 系统自动查找或创建MuseDAM用户和组织记录
3. 建立用户-组织关系，创建联合登录账户
4. 生成10分钟有效期的加密登录链接
5. 用户访问链接后解密信息，使用构造邮箱和统一密码登录
6. 设置活跃组织ID并重定向到首页

## 环境变量

确保设置以下环境变量：

```bash
CIPHER_PASSWORD=your-secret-password-for-encryption
FEDERATION_LOGIN_PASSWORD=your-unified-password-for-federation-login
```

## 安全特性

- 登录链接为加密的JSON字符串，无需数据库存储
- 令牌10分钟有效期，包含在加密数据中
- 仅管理员可生成登录链接
- 使用AES-256-CBC加密算法
- 使用构造邮箱和统一密码完成Better Auth标准登录
- 自动设置活跃组织ID到用户会话
