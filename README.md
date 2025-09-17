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
CREATE USER musedam WITH LOGIN PASSWORD 'musedam' SUPERUSER;
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

5. 启动打标处理服务（可选）

如果需要处理自动打标任务，需要启动队列处理器。首先在 `.env` 文件中配置内部 API 密钥：

```env
INTERNAL_API_KEY=your_secret_key_here
```

然后在新的终端窗口中运行：

```bash
pnpm queue-processor
```

队列处理器会：

- 每 10 秒自动调用一次 `/api/tagging/process-queue` 接口
- 每次处理最多 10 个待处理的打标任务
- 显示处理进度和状态信息

**注意：** 队列处理器需要与开发服务器同时运行才能正常工作。

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
pnpm login-url "123" "John Doe" "456" "My Team" "/tagging"
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

## 国际化配置

项目使用 next-intl 实现国际化支持，支持中文（zh-CN）和英文（en-US）。

### 消息文件结构

国际化文本消息文件采用分层管理：

1. **全局消息文件**：`messages/[locale].json`
   - 存放全局通用的翻译文本
   - 例如：`messages/zh-CN.json`、`messages/en-US.json`

2. **模块消息文件**：`src/app/[module]/messages/[locale].json`
   - 存放特定模块的翻译文本，避免全局消息文件过于庞大
   - **重要**：模块消息文件必须有根键名，用于区分不同模块
   - 例如：`src/app/(tagging)/messages/zh-CN.json` 包含 `"Tagging": {}` 根键

### 消息合并机制

所有消息文件会在运行时自动合并：

- **配置文件**：
  - `src/i18n/request.ts`：处理消息文件的动态加载和合并
  - `src/i18n/global.ts`：TypeScript 类型定义，确保类型安全

- **合并顺序**：全局消息 + 模块消息，后者会覆盖前者的同名键

### 使用方式

```tsx
import { useTranslations } from "next-intl";

function MyComponent() {
  const t = useTranslations("Homepage"); // 对应消息文件中的 Homepage 键
  return <h1>{t("title")}</h1>;
}
```

## URL 参数覆盖配置

项目支持通过 URL 参数动态设置主题和语言，实现即时生效且持久化存储。

### 支持的参数

#### 主题参数 (theme)

- `?theme=dark` - 深色主题
- `?theme=light` - 浅色主题

#### 语言参数 (locale)

- `?locale=zh-CN` - 中文
- `?locale=en-US` - 英文

### 参数优先级

1. **URL 参数**：优先级最高，立即生效
2. **Cookie 存储**：持久化用户设置
3. **系统默认**：深色主题 + 中文

### 实现机制

#### 主题 (theme) 参数处理

- **实现位置**：`src/components/ThemeProvider.tsx`
- **检测方式**：客户端组件在渲染时读取 URL 参数 `?theme=`，直接写入 localStorage 持久化
- **生效机制**：客户端渲染后，页面跳转会保留 theme 设置，如果在服务端重定向页面，theme 参数会丢失

#### 语言 (locale) 参数处理

- **实现位置**：`src/middleware.ts`
- **检测方式**：服务端中间件优先读取 URL 参数 `?locale=`，如果 cookie 值不存在或者不一致，则更新 cookie
- **生效机制**：会失踪保留此次 locale 设置，服务端直接重定向也会保留，直到下一次主动设置 locale

#### 认证页面额外处理 (`/auth/[token]`)

- **文件位置**：`src/app/(auth)/auth/[token]/page.tsx` 和 `TokenAuthPageClient.tsx`
- **特殊功能**：除了正常的参数处理外，还会在客户端渲染 auth 页面时**主动持久化**这两个参数
- **实现原因**：确保通过认证 URL 传入的主题和语言设置能够持续生效，避免页面跳转后丢失
- **持久化方式**：
  - `theme`：调用 `setTheme()` 强制更新 localStorage
  - `locale`：调用 `setLocale()` 强制更新 cookie

### 使用示例

```bash
# 设置深色主题 + 英文界面
https://yourdomain.com/auth/token?theme=dark&locale=en-US

# 设置浅色主题 + 中文界面
https://yourdomain.com/?theme=light&locale=zh-CN

# 只设置语言
https://yourdomain.com/tagging?locale=en-US
```

### 集成场景

特别适用于 iframe 嵌入场景，外部应用可通过 URL 参数控制嵌入页面的主题和语言，确保界面风格与外部应用保持一致。详见 [自动登录集成文档](./docs/auto-login-integration.md)。
