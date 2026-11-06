# 服务所有权

实际服务集合：agent, api, web, worker。

React/Vite 只访问 NestJS 业务 API；NestJS/Worker 写入独立业务 SQLite 文件；Hono/Mastra Agent 只打开独立运行时文件。

SQLite 保存持久任务，Worker 每秒轮询；Redis/BullMQ 为可选通知。BEGIN IMMEDIATE 写事务、唯一索引、revision 与递增租约代际拒绝重复提交及迟到结果。

能力成熟度为 planned 的条目只输出设计，不是已实现的服务。
