# 面试生成采用持久任务

状态：已实现并以真实 PostgreSQL 集成测试验证。基线：用户的 software-factory-initial-design.md。

用户确定要 AI 模拟面试产品。结构比较了两种完整候选：API 同步调用独立生成服务；API 接受持久任务，由 Worker 执行有界生成。后一种直接满足文件中 agent.runtime → jobs.async → Nest Worker/BullMQ/Redis 的依赖，且浏览器断开后仍可恢复查询。

API 与 Worker 共享同一套业务契约、状态转换和 app schema。事务接受答案及持久 job，Redis 只通知；Worker 定时对账。租约为 90 秒，单次 runtime 请求为 60 秒，最多两次尝试。单个 session 的部分唯一索引、row lock、revision、递增 attempts 共同限制并发与旧结果提交。取消与提交遵循一致的 session → job 锁顺序。

独立 Hono/Mastra/Bun 不读业务表，接收已授权的上下文快照。Agent 通过 runtime receipts 缓存 jobId 结果；模型请求最多一步、输出有 token 上限、评分引用必须出现在实际答案中。Mastra PostgreSQL Store 使用 agent_runtime schema，生成调用不创建持久聊天 thread。

删除先创建持久清理任务，再删除业务数据；Runtime 删除在相同 jobId 的 advisory lock 中保存无内容 tombstone。晚到生成不能重新创建已删除内容。取消不会保证第三方停止计费，崩溃窗口也可能导致重复模型计费；这些边界不是 exactly-once 保证。

Arena 只运行了可用的原生设计与独立比较代理，没有运行 Claude/Grok，不宣称多模型共识。比较分数只评价设计；通过记录以实际测试为准。
