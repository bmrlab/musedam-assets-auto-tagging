# MuseDAM 资产自动标记系统

基于 Next.js、Prisma、Better Auth 构建的智能资产管理和自动标记系统。

## 功能特性

- 🔐 完整的用户认证系统（Better Auth）
- 👥 管理员权限管理
- 🏷️ 智能资产标记
- 🤖 AI 驱动的内容分析
- 📁 资产组织和管理

## 技术栈

- **前端**: Next.js 15, React 19, TailwindCSS
- **后端**: Next.js API Routes
- **数据库**: PostgreSQL + Prisma ORM
- **认证**: Better Auth
- **AI**: OpenAI API

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 环境配置

复制环境变量模板并填写配置：

```bash
cp .env.example .env
```

必需的环境变量：

- `DATABASE_URL`: PostgreSQL 数据库连接
- `BETTER_AUTH_SECRET`: 32位随机字符串
- `OPENAI_API_KEY`: OpenAI API 密钥

### 3. 数据库设置

```bash
# 推送数据库模式
npx prisma db push

# (可选) 查看数据库
npx prisma studio
```

### 4. 创建首个管理员账户

```bash
# 首先通过注册页面创建用户账户：http://localhost:3000/register
# 然后提升该用户为管理员
pnpm make-admin admin@example.com
```

### 5. 启动开发服务器

```bash
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000) 查看应用。

## 认证系统

### 页面访问

- **注册页面**: `/register` - 新用户注册
- **登录页面**: `/login` - 用户登录
- **管理员面板**: `/admin` (需要管理员权限)

### 用户流程

1. **新用户**: 通过 `/register` 页面注册账户
2. **登录**: 通过 `/login` 页面登录系统
3. **提升权限**: 系统管理员可使用 `pnpm make-admin <email>` 提升用户为管理员

### 用户角色

- **普通用户**: 基础功能访问
- **管理员**: 完整管理权限，包括用户管理

### 管理员功能

管理员可以通过 `/admin` 面板：

- 查看和搜索所有用户
- 创建新用户账户
- 管理用户角色（普通用户/管理员）
- 封禁/解封用户账户

## 项目结构

```
src/
├── app/
│   ├── (auth)/           # 认证相关页面和配置
│   │   ├── auth.ts       # Better Auth 服务端配置
│   │   ├── client.ts     # Better Auth 客户端配置
│   │   ├── login/        # 登录页面
│   │   └── admin/        # 管理员面板
│   ├── api/
│   │   └── auth/         # 认证 API 路由
│   └── page.tsx          # 主页
├── prisma/
│   └── schema.prisma     # 数据库模式
└── scripts/
    └── create-admin.ts   # 创建管理员脚本
```

## 部署指南

### 环境变量

生产环境需要设置：

```bash
NODE_ENV=production
BETTER_AUTH_SECRET=your-production-secret
BETTER_AUTH_URL=https://your-domain.com
DATABASE_URL=your-production-database-url
```

### Vercel 部署

1. 连接 GitHub 仓库到 Vercel
2. 设置环境变量
3. 配置 PostgreSQL 数据库（推荐 Vercel Postgres）
4. 部署后运行数据库迁移：

```bash
npx prisma db push
```

## 开发说明

### 添加新功能

1. 修改数据库模式（如需要）
2. 更新 Prisma 模型
3. 创建 API 路由
4. 实现前端界面

### 管理员权限管理

```bash
# 提升用户为管理员
pnpm make-admin user@example.com

# 测试用户登录
pnpm test-login user@example.com password123
```

### 数据库变更

```bash
# 修改 schema.prisma 后
npx prisma db push

# 生成新的类型定义
npx prisma generate
```

### 调试

启用详细日志：

```bash
LOG_LEVEL=debug pnpm dev
```

## 文档

- [认证系统详细说明](./AUTH_SETUP.md)
- [Next.js 文档](https://nextjs.org/docs)
- [Better Auth 文档](https://www.better-auth.com)
- [Prisma 文档](https://www.prisma.io/docs)

## 许可证

MIT License
