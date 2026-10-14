# 数据归属与迁移

app.interviews 保存 owner 与面试状态；app.jobs 保存输入快照、revision、attempts、lease_until、request_hash。jobId 主键去重，部分唯一索引限制一个会话只有一个进行中任务。agent_runtime.receipts 是 Agent 持有的幂等生成结果。

业务删除级联 jobs，并由持久删除对账清理运行时 receipts；已取消的迟到请求不能恢复业务数据。

迁移先审查再执行，禁用能力不删除数据库或桶。
