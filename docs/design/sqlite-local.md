# SQLite 本地存储

项目只支持 SQLite。业务与 Agent 使用两个独立私有文件，API/Worker 只打开业务文件，Agent 只打开运行时文件。启用 WAL、外键和 BEGIN IMMEDIATE 写事务，业务修订号、租约代际与唯一索引拒绝重复提交和迟到写入。初始化不会清空已有业务数据。

Drizzle 使用 SQLite proxy 与 Node/Bun 的 node:sqlite 原生连接，Mastra 使用官方 LibSQLStore。源码使用 SQLite 方言。BullMQ 通知仍可选；无 Redis 时依赖持久任务轮询。

配置：`DATABASE_URL=file:.local/app.sqlite`、`AGENT_DATABASE_URL=file:.local/agent.sqlite`、`REDIS_URL=`。在项目根目录运行 `pnpm db:migrate` 后启动；Mastra 另用 Agent URL 加 `.mastra` 的文件。数据库文件权限为 0600，目录为 0700；服务只打开指定文件，生产多用户部署需独立 OS 身份与访问权限。

唯一数据库定义位于 `infra/sqlite/001-init.sql`，初始化及已有表兼容逻辑位于 `packages/database/src/migrate.ts`。新增表需同步定义与行为测试；已有表变更必须显式迁移并验证数据保留。

备份需包括业务、Agent、Mastra 数据库与私有附件及浏览器会话目录。使用 SQLite backup API，或先停止写入服务再复制数据库及 WAL；运行中仅复制主文件可能丢失记录。保留原文件后恢复，再运行迁移和服务健康检查。

验证命令：`pnpm verify:sqlite`、`pnpm test:offline`、`pnpm build`。数据库验收不代表真实站点登录与外发验收。
