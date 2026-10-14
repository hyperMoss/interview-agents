# 建设边界

固定参考栈：React 19/Vite/TypeScript/TanStack Query；NestJS/Node；PostgreSQL/Drizzle/pg；独立 Hono/Mastra/Bun。服务端状态通过 Query 管理，界面状态局部保存；只有存在跨组件状态需求时才增加 Zustand。

Agent 能力拉入持久任务、Nest Worker/BullMQ/Redis。PostgreSQL 是任务真相；Redis 是通知。事务接受命令与任务，租约到期可恢复，提交用 revision 与递增租约代数 fencing。模型输出验证、超时和最多尝试次数都有界。业务表由 API/Worker 的同一业务执行模块持有；Agent 只写运行时表。副作用工具需要独立的权限、幂等与审计设计。

当前参考产品 `interview-agents` 的源码与契约用于学习实现，路径以项目实际位置为准。工厂 `generate` 只生成文档、上下文与配置索引，不复制空目录或声称生成了完整业务系统。

可选能力：文件/S3、MinerU、lexical/semantic/hybrid RAG、Embedding、Tavily/Firecrawl、ASR、TTS分别装配。TTS不引入ASR；搜索不引入文件存储；语义RAG与显式禁用Embedding必须冲突。planned 状态禁止通过生产成熟度门禁。

受管路径：docs/generated、docs/context、config/generated、infra/generated、capabilities.resolved.json、factory.lock.json。业务源码、手写ADR、需求补充由人维护。生成先做完整冲突预检，每个文件原子替换，锁文件最后提交；中断后可能留下新旧文件混合，下一次会因基线不一致停止，不宣称跨文件事务。`.factory-generate.lock` 残留时先确认没有在运行的生成进程，再审查恢复。

CLI `--help` 是命令唯一来源；各阶段完成状态以测试产物为准。
