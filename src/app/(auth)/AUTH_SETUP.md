# MuseDAM 登录系统使用说明

## 概述

本系统基于 Better Auth + Prisma + Next.js 实现了完整的用户认证和管理功能，包括：

- 邮箱密码登录
- 管理员权限管理
- 用户创建和管理
- 会话管理

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

复制 `.env.example` 到 `.env` 并填写相应配置：

```bash
cp .env.example .env
```

必填项：

- `DATABASE_URL`: PostgreSQL 数据库连接URL
- `SHADOW_DATABASE_URL`: Prisma 影子数据库URL（开发环境）
- `BETTER_AUTH_SECRET`: 32位随机字符串，用于加密会话

### 3. 数据库迁移

```bash
npx prisma db push
```

### 4. 注册首个用户并提升为管理员

首先启动开发服务器，然后通过注册页面创建账户：

```bash
pnpm dev
```

1. 访问 http://localhost:3000/register
2. 注册第一个用户账户
3. 使用脚本提升该用户为管理员：

```bash
pnpm make-admin admin@example.com
```

或直接使用 tsx：

```bash
tsx scripts/make-admin.ts admin@example.com
```

### 5. 启动开发服务器

```bash
pnpm dev
```

现在可以访问：

- 主页: http://localhost:3000
- 注册页面: http://localhost:3000/register
- 登录页面: http://localhost:3000/login
- 管理员面板: http://localhost:3000/admin

## 功能说明

### 用户角色

系统支持两种用户角色：

1. **普通用户 (user)**: 基础访问权限
2. **管理员 (admin)**: 完整管理权限

### 用户注册和登录流程

#### 新用户注册

1. 访问 `/register` 页面
2. 填写姓名、邮箱和密码
3. 点击"创建账户"完成注册
4. 自动登录并重定向到主页

#### 用户登录

1. 访问 `/login` 页面
2. 输入邮箱和密码
3. 系统验证身份并创建会话
4. 根据用户角色重定向到相应页面

#### 管理员权限提升

1. 用户先通过注册页面创建普通账户
2. 系统管理员使用 `pnpm make-admin <email>` 提升用户权限
3. 用户重新登录后获得管理员权限

### 管理员功能

管理员可以通过 `/admin` 页面进行以下操作：

#### 用户管理

- 查看所有用户列表
- 搜索用户（按邮箱）
- 创建新用户
- 设置用户角色
- 封禁/解封用户

#### 创建用户

管理员可以直接创建新用户，需要提供：

- 邮箱地址（必填，作为登录凭证）
- 用户姓名（必填）
- 初始密码（必填，至少6位）
- 用户角色（可选，默认为普通用户）

#### 用户状态管理

- **角色设置**: 可将用户设置为普通用户或管理员
- **封禁用户**: 临时禁止用户登录，可设置封禁原因
- **解封用户**: 恢复被封禁用户的登录权限

## 技术实现

### 认证架构

```
Better Auth (认证核心)
├── Prisma Adapter (数据持久化)
├── Admin Plugin (管理员功能)
├── Organization Plugin (组织管理)
└── Email/Password Provider (邮箱密码登录)
```

### 用户创建和权限管理流程

#### 用户注册流程（注册页面）

1. **前端表单验证**: 验证邮箱格式、密码长度、密码确认
2. **调用 `signUp.email`**: 使用 Better Auth 客户端注册方法
3. **自动密码哈希**: Better Auth 自动处理密码加密和存储
4. **创建关联账户**: 自动创建用户和账户记录的正确关联
5. **默认角色**: 新注册用户默认角色为 `user`

#### 管理员权限提升流程（脚本）

1. **检查用户存在**: 验证邮箱对应的用户是否存在
2. **检查用户状态**: 确认用户未被封禁
3. **更新用户角色**: 将用户角色从 `user` 更新为 `admin`
4. **验证邮箱**: 自动设置管理员邮箱为已验证状态

### 安全特性

1. **密码加密**: Better Auth 内置安全的密码哈希算法
2. **会话管理**: 基于 HTTP-only Cookie 的安全会话
3. **CSRF 保护**: Better Auth 内置 CSRF 防护
4. **角色验证**: 服务端和客户端双重权限检查
5. **标准化流程**: 使用 Better Auth 标准 API，确保安全性

### API 端点

Better Auth 自动生成以下 API 端点：

- `POST /api/auth/sign-in/email` - 邮箱登录
- `POST /api/auth/sign-out` - 退出登录
- `GET /api/auth/session` - 获取当前会话
- `POST /api/auth/admin/*` - 管理员操作（需要管理员权限）

## 开发指南

### 添加新的管理员功能

1. 在 `src/app/(auth)/admin/page.tsx` 中添加 UI 组件
2. 使用 `authClient.admin.*` 方法调用管理员 API
3. 确保在服务端也进行权限验证

### 自定义用户模型

如需扩展用户模型，修改 `prisma/schema.prisma` 中的 User 模型：

```prisma
model User {
  // 现有字段...
  customField String? // 新增字段
  // 其他扩展...
}
```

然后运行数据库迁移：

```bash
npx prisma db push
```

### 会话管理

在客户端组件中使用会话：

```tsx
import { useSession } from "@/app/(auth)/client";

function MyComponent() {
  const { data: session, isPending } = useSession();

  if (isPending) return <div>Loading...</div>;
  if (!session?.user) return <div>Please login</div>;

  return <div>Hello, {session.user.name}!</div>;
}
```

### 服务端认证

在服务端 API 路由中验证认证：

```tsx
import { auth } from "@/app/(auth)/auth";
import { headers } from "next/headers";

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 处理已认证的请求...
}
```

## 故障排除

### 常见问题

1. **登录失败**: 检查邮箱和密码是否正确，确认用户未被封禁
2. **管理员页面无法访问**: 确认当前用户具有 admin 角色
3. **会话过期**: 默认会话有效期为7天，可在 auth.ts 中调整

### 重置密码

系统目前不支持密码重置功能。如果忘记密码，可以：

1. 请其他管理员重置你的密码（通过管理员面板）
2. 或者联系系统管理员直接在数据库中处理

### 测试登录功能

使用内置的测试脚本验证登录：

```bash
# 列出所有用户
pnpm test-login --list

# 测试特定用户登录
pnpm test-login admin@example.com password123
```

### 调试模式

设置环境变量启用详细日志：

```bash
LOG_LEVEL=debug
```

这将在控制台输出数据库查询和认证相关的详细信息。

### 可用的脚本命令

- `pnpm make-admin <email>`: 提升现有用户为管理员
- `pnpm test-login <email> <password>`: 测试用户登录功能
- `pnpm test-login --list`: 列出所有可用用户账户

## 生产环境部署

### 环境变量设置

确保在生产环境中设置：

```bash
NODE_ENV=production
BETTER_AUTH_SECRET=your-production-secret-32-chars
BETTER_AUTH_URL=https://your-domain.com
DATABASE_URL=your-production-database-url
```

### 安全建议

1. 使用强随机密钥作为 `BETTER_AUTH_SECRET`
2. 启用 HTTPS
3. 配置适当的 CORS 策略
4. 定期更新依赖包
5. 监控异常登录行为

### 数据库

生产环境建议：

- 使用连接池（如 Prisma Accelerate）
- 定期备份数据库
- 监控数据库性能

## 扩展功能

系统预留了扩展接口，可以轻松添加：

- 双因子认证 (2FA)
- 社交登录 (Google, GitHub 等)
- 邮箱验证
- 密码重置
- 用户资料管理
- 组织和团队管理

需要这些功能时，可以参考 Better Auth 官方文档添加相应插件。

## 使用示例

### 完整的用户管理流程

1. **部署系统**

   ```bash
   pnpm install
   cp .env.example .env
   # 配置环境变量
   npx prisma db push
   pnpm dev
   ```

2. **创建首个管理员**
   - 访问 http://localhost:3000/register
   - 注册账户：admin@company.com
   - 提升权限：`pnpm make-admin admin@company.com`

3. **管理员操作**
   - 登录管理员面板：http://localhost:3000/admin
   - 创建更多用户账户
   - 管理用户角色和状态

4. **普通用户流程**
   - 用户通过 http://localhost:3000/register 注册
   - 通过 http://localhost:3000/login 登录
   - 使用系统功能
