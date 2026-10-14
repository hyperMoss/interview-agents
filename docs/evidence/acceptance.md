# 面试应用初始文本版本验收记录

本文记录扩展前的 56 项测试与 4 个 Chrome 场景。当前能力与最终证据见 [扩展验收](extension-acceptance.md)。以下结果保留为历史。

验收日期：2026-10-14，Asia/Shanghai。当前交付范围为文本模拟面试，优先完成产品，暂停软件工厂扩展。

## 已验证

- `pnpm build` 通过严格 TypeScript 检查、Vite 生产前端构建、运行时能力一致性校验及已有 skill bundle 校验。
- `RUN_INTEGRATION=1 pnpm test`：56 个测试通过，组成是 7 个领域、14 个模型接入、14 个 PostgreSQL/运行时、21 个已有工厂回归测试。
- 模型边界验证地址规范化、禁止 URL 凭据与查询参数、部署开关、生产主机名策略；列表不需要模型名，短探测有效。
- 自带密钥在独立 Agent 表加密，公开配置、业务记录、浏览器存储和导出不含密钥；业务角色读取密钥表被数据库拒绝，另一身份无法使用连接。
- 实际 AI SDK/Mastra 调用本地 OpenAI-compatible fixture，使用所选模型和测试密钥完成面试；切换启用连接不改变已有会话，真实评分四维平均值由服务端计算，伪造依据不能推进状态。
- 默认模型地址或凭据变更时，旧任务在调用供应商之前拒绝执行；用户检查设置后可显式重试。默认快照采用带密钥 HMAC 引用，不保存部署方原始密钥。
- 模型故障保留原题与作答；显式重试幂等、不重复追加回答；恢复默认的重试 payload 不残留旧连接 ID；过期、清除或禁用连接不会降级到其他模型。
- PostgreSQL 事务验证并发答案只接受一次、旧租约拒绝、Worker 过期租约恢复、取消终态、持久删除任务与 Runtime tombstone；Agent 数据库角色不能读业务资料。
- `pnpm test:e2e`：4 个真实 Chrome 场景通过，实际 API、Worker、Hono/Mastra/Bun 与开发数据库运行，供应商为独立本地 fixture。覆盖模型列表、探测、保存启用、三题面试、逐题与汇总四维反馈、Markdown/JSON 导出、资料和答案草稿刷新、模型故障与恢复、重复练习、清除连接、取消/删除、浏览器身份隔离、伪造 Origin 拒绝和 390px 移动布局。
- 桌面报告、移动报告及模型设置截图已视觉核验。模型设置超过可视高度时在对话框内滚动。

浏览器原始结果：[browser-results.json](browser-results.json)。截图：[AI 报告](screenshots/live-report.png)、[移动报告](screenshots/report-mobile.png)、[模型设置](screenshots/model-settings.png)、[移动模型设置](screenshots/model-settings-mobile.png)。截图中的 coach-alpha 与密钥均来自测试 fixture，不代表供应商实测评分。

## 实际运行问题与修复

Chrome 验收曾发现模型连接已保存，但 Bun Agent 的生成停留在 preparing。数据库活动显示 Mastra 的并发索引初始化等待已打开的 receipt 事务。运行时改为先初始化共享存储，再接受任务；临时模型实例复用该存储，避免任务事务中的重复 DDL。实际 Bun 独立生成及完整浏览器面试恢复正常，最终测试均通过。

## 实现与验收边界

没有使用真实付费模型账号。因此实际账号权限、供应商限流与网络、收费情况及面试质量尚未核验。连接探测成功只证明协议连通，不能证明评分专业性。

当前使用签名浏览器身份，没有正式账号、组织或跨设备同步。默认临时自带连接有效 24 小时，显式长期保存 30 天；清除 Cookie 会失去旧身份访问能力。删除练习清理业务记录与派生结果；模型连接需单独清除或等待过期。

当前按身份限制每日最多 20 场保留会话；删除会话会降低计数。这不是公开服务的全局配额。取消与进程崩溃不保证第三方恰好计费一次。

PDF、RustFS、MinerU、RAG、联网搜索、ASR/TTS 在当前 spec 明确关闭，未作为产品功能或启动服务交付。生产 Docker 镜像组合、公开 HTTPS 部署、备份恢复、全局成本限制未验收。当前 Docker Compose 启动 PostgreSQL/Redis，应用服务通过本地运行命令启动。

## 已有软件工厂

本轮保留已有 P0 文档/上下文工厂和全局 software-factory skill，不扩展工厂能力。跨项目规则晋升测试使用合成 fixture，未伪造实际多项目交付记录。生成器无跨文件事务日志；规则版本改变未来开发上下文，代码升级仍需具体 diff 与回归。使用记录见 [软件工厂](../software-factory.md)。

GitHub 源码与许可核验见 [调研](../research/github-interview-agents.md)；用户设计原文见 [设计参考](../reference/software-factory-initial-design.md)。本项目独立实现，未复制无许可证代码。
