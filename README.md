## 本地开发

1. 安装依赖

```bash
pnpm install
```

2. 配置环境变量

```bash
cp .env.example .env
```

设置 `AUTH_SECRET`, read more: https://cli.authjs.dev

```bash
npx auth secret
```

3. 初始化数据库

安装 PostgreSQL 15

```bash
brew install postgresql@15
brew services start postgresql@15
```

新建本地数据库

```bash
psql -d postgres
CREATE USER musedam WITH LOGIN PASSWORD 'musedam' SUPERUSER;  # migration 执行时包含创建 vector extension, 需要 superuser 权限
CREATE DATABASE musedam_assets_auto_tagging OWNER musedam;
CREATE DATABASE musedam_assets_auto_tagging_shadow OWNER musedam;
\q
```

向 .env 文件写入数据库配置：

```env
DATABASE_URL=postgresql://musedam:musedam@localhost:5432/musedam_assets_auto_tagging
SHADOW_DATABASE_URL=postgresql://musedam:musedam@localhost:5432/musedam_assets_auto_tagging_shadow
```

执行 migrations

```bash
npx prisma generate  # 生成必要的类型定义
npx prisma migrate dev  # 执行数据库迁移
```

4. 启动开发服务器

```bash
pnpm dev
```

## Scripts

### login-url

用于生成认证 URL，可以直接通过此 URL 登录系统。

```bash
pnpm login-url <userId> <userName> <teamId> <teamName> [callbackUrl]
```

参数说明：

- `userId`: 用户 ID
- `userName`: 用户名
- `teamId`: 团队 ID
- `teamName`: 团队名称
- `callbackUrl`: 登录后重定向的 URL（可选，默认为 "/"）

示例：

```bash
# 使用默认测试数据
pnpm login-url

# 使用自定义数据
pnpm login-url user123 "John Doe" team456 "My Team" "/tagging"
```

## 外网访问配置

项目支持通过 frp 内网穿透实现外网访问。

### 1. 下载 frp 客户端

```bash
# 进入 devserver 目录
cd devserver

# 运行安装脚本（自动检测系统架构）
./setup-frpc.sh
```

### 2. 配置文件

frp 配置文件 `devserver/frpc.toml`：

```toml
serverAddr = "114.55.30.112"
serverPort = 7000

[[proxies]]
name = "musedam-auto-tagging"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3000
remotePort = 7093
```

### 3. 启动外网代理

```bash
# 确保在 devserver 目录下
cd devserver

# 启动 frp 客户端
./frpc -c ./frpc.toml
```

启动成功后，可通过以下地址访问：

🌐 **外网地址：** https://tagging.dev.musedam.cc
