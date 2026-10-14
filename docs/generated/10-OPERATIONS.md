# 运行与恢复

本参考产品启动：pnpm install --frozen-lockfile；复制 .env.example；docker compose -f infra/compose.yaml up -d --wait；pnpm dev。PostgreSQL 和 Redis 使用本项目独立端口。

重启 Worker 后扫描未完成任务；过期租约重新执行，成功结果按 jobId 缓存。进程在模型响应与缓存写入之间崩溃可能重复计费，不承诺外部调用 exactly-once。取消阻止提交，不保证已发生的第三方费用被撤销。生产需要独立部署与备份恢复演练。
