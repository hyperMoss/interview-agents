# 服务所有权

实际服务集合：agent, api, postgres, redis, web, worker。

React/Vite 只访问 NestJS 业务 API；NestJS/Drizzle/pg 写入 app schema；Worker 调用独立 Hono/Mastra，Agent 只访问 agent_runtime schema。

PostgreSQL jobs 是持久任务与 Outbox。BullMQ/Redis 只传 jobId，Worker 每秒对账。90 秒租约与递增 attempts 作为提交 fencing，网络请求限制 60 秒，最多两次尝试。取消和版本检查拒绝迟到结果。

能力成熟度为 planned 的条目只输出设计，不是已实现的服务。
