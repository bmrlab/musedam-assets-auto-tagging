// 服务端 page.tsx 与客户端 DashboardClient 共用的常量。不能从 "use client" 模块导出给服务端组件使用：
// 服务端拿到的会是客户端引用而不是值。
export const DASHBOARD_INITIAL_PAGE_SIZE = 20;
