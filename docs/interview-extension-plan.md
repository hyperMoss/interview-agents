# 面试应用扩展执行计划

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame
- [x] Phase B: Design the workflow
- [x] Phase C: Run the loop
- [x] Phase D: Keep the audit trail
- [x] Phase E: Verify and hand back

架构步骤。Ground、Sketch、Agree、Implement、Scrap。Agree 不设置人工暂停。Scrap 仅在类型或模块边界反复产生相同阻碍时执行。

设计比较步骤。Frame、Fan out、Cross-judge、Pick、Graft、Verify。候选设计输出到独立目录。评分轴为规则单一归属、旧会话可恢复、秘密与资料隔离、动态规划可验证和实现复杂度。

完成条件。上传 PDF、DOCX 或文本简历后可以校正文本。可以配置并实际调用搜索接口。候选人级别与轮次改变计划。HR 上限 30 分钟且无编程题。编程题仅求职者技术岗。完成作答后自动重规划，手动重规划保留已完成轮次。题库支持自建与 LeetCode 导入，严格模式题目不得被模型改写。报告提供三维与逐题 QA。既有重试、删除、归属边界通过回归。

实施顺序。

1. 核对参考实现与当前任务链，设计两个完整数据模型。
2. 建立计划、题库与逐题报告契约，验证 HR 和资格规则。
3. 交付简历解析、题库管理与导入接口。
4. 交付搜索配置、结果引用与生成快照。
5. 连接计划到持久问答链，交付动态重规划。
6. 交付页面，并运行真实 Chrome、数据库、协议 fixture 验收。

吞吐检查。约六个可单独验证的交付单元。先实现共享契约和纯规划规则，后接 IO，再接界面，减少 API、Worker 与 Agent 之间的反复同步。参考目录只读，所有实现写入当前应用。付费供应商验收使用本地协议 fixture，不读取已有密钥。

吞吐检查的四项。

- [x] Blocking first steps. 先核对参考源码、许可、现有构建与契约，再接 IO。
- [x] Independent workstreams. 设计候选写入独立目录。业务契约与状态变更由主代理顺序集成。
- [x] Shared mutable state. 面试状态与任务只由 API/Worker 事务写入。模型与搜索凭据由 Agent 单独持有。
- [x] Smallest safe decomposition. 单一实现者集成状态链，避免多个写入者改同一份会话契约。上传、题库和搜索用独立模块及真实协议测试。

外部角色缺口。Grok CLI 未安装。Claude 子进程报告未登录。保留 receipt，未换供应商，也不声称多供应商设计或解释通过。原生设计候选继续，主代理按源码完成归属与流转核对。

全链路已接通，97 项测试及 7 项真实 Chrome 通过，构建通过。长标题审查缺陷已修复。原始失败、修复和最终结果见扩展验收及决策记录。审查修复已验证，临时测试数据库已清理，开发 API 健康为 ok。
