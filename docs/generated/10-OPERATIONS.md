# 运行与恢复

复制 .env.example，pnpm db:migrate，再 pnpm dev。默认无需数据库服务或 Redis。备份需保留业务 SQLite、Agent SQLite、Mastra SQLite 与私有附件及浏览器文件；使用 SQLite backup API 或先停止服务，不在写入时只复制主文件。

Worker 轮询恢复未完成任务，租约与修订号拒绝重复提交和迟到结果；外部结果未知时需核对，不能盲目重发。
