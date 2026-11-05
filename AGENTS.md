# MuseDAM 自动打标：本地启动与开发

本文件用于进入本地开发。命令默认在本文件所在目录执行；核对日期：2026-11-05。已对照目标主分支源码、配置和脚本静态核对，未实际启动服务。

## 环境与配置

- Node.js >=22，pnpm 9.12.3（engines 明确要求 <10），具体版本以 package.json/锁文件为准。
- PostgreSQL：README 基线 15；先创建本项目独立开发库与 shadow 库。自动打标还需按当前 schema/迁移核对 pgvector。
- 根 .env.example 是配置模板。准备 DATABASE_URL、SHADOW_DATABASE_URL、AUTH_SECRET 和当前功能依赖。
- 自动打标需要模型/embedding 配置、对象存储及 MuseDAM 凭据。需要独立队列消费者时另开终端执行 `pnpm queue-processor`；同时核对 EMBEDDED_QUEUE_SCHEDULER 和 README，避免重复启动调度器。

## 安装与首次数据库准备

```sh
test -f .env || cp .env.example .env
```

编辑 .env，确认两个连接均为本地开发库，再执行：

```sh
pnpm install
pnpm exec prisma generate
pnpm exec prisma migrate dev
```

已有数据库不要 reset；发现漂移时先核对 migration 和实际结构。

## 启动

```sh
pnpm dev
```

默认 http://localhost:3000；需要并行启动其他项目时 `pnpm dev --port 3001`。登录使用 MuseDAM 嵌入链路或项目已有 login-url 工具，参数参照 README/脚本，不以空白首页判断认证是否正常。

## 开发入口

- src/app：App Router 页面、服务端 actions/route；src/components/ui 与业务组件：组件复用入口。
- src/musedam、src/lib、src/services：集成和服务（以实际存在目录为准）。
- prisma/schema.prisma 和 prisma/migrations：数据库；src/i18n、messages：国际化。

## 验证

`pnpm exec vitest run` 运行现有测试；新增逻辑优先选择相关测试文件。当前没有 typecheck 脚本，必要时按 tsconfig 运行 `pnpm exec tsc --noEmit`。

package 中的 lint 为 next lint，若当前 Next 版本已不支持该子命令，要记录这个已有问题；不能将命令退出误报为检查通过。数据库连接、迁移、认证和 iframe 细节见 [README.md](README.md)。

## UI 开发约定

MuseDAM 界面按 `muse-development/references/design-system.md`（由工作区 Muse 开发 skill 提供）；新增静态样式使用 Tailwind，先复用本项目组件与图标。两种主题均需适配。跨仓定位见 工作区 `muse-development/SKILL.md`。

## 启动完成的判断与维护

以终端实际输出的监听地址为准，并验证数据库连接、认证和当前开发的主要流程；编译成功不代表外部依赖已可用。配置模板仅用于首次创建文件，不覆盖已有配置，不把凭据写入本文。数据库准备命令仅用于已确认的本地开发库。脚本、环境入口、端口或目录结构变化时，同步维护本文件。
