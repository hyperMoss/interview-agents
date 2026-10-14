# GitHub Interview Agent 调研与本项目取舍

核验日期：2026-10-14（Asia/Shanghai）。范围：4 个公开仓库的一手 README、固定 commit 源文件、仓库树与许可证；未启动第三方项目，未调用付费模型，也未复制代码、提示词或资产。

## 结论

本项目以中文 AI 模拟面试为业务蓝图，优先实现“岗位/JD + 简历文本 → 有限轮次问答 → 逐题反馈 → 总结报告 → 历史复盘”。产品体验参考 zmy15，流程边界参考 zunff，工具与业务状态分离参考 Azure 官方样例，语音/RAG 的按需扩展参考 yizucodes。下面的取舍是本项目设计判断，不代表第三方项目已通过本项目验收。

用户设计文件定义 React 19/Vite/TypeScript、NestJS、PostgreSQL/Drizzle，以及独立 Hono/Mastra/Bun Agent 服务。参考仓库的 Python、Java、.NET 栈不作为替代。文件/RAG、联网、ASR、TTS 仍按能力独立选择；第一轮闭环不因参考项目提供语音而强制增加语音供应商。[设计基线](/Users/gooingyu/Desktop/software-factory-initial-design.md)

## 可复核仓库

| 仓库 | 固定 commit | 已核验许可 | 适合参考的部分 |
|---|---|---|---|
| [zmy15/interview-agent](https://github.com/zmy15/interview-agent) | `c0052311fbac5bec6207d5783fab7c9bcb65c6fc` | [MIT][z-license] | 中文模拟面试、JD/简历上下文、结构化问答和历史 |
| [zunff/interview-agent](https://github.com/zunff/interview-agent) | `9223e8352118101b4c84456caddfda7a6f1fab5d` | 仓库 API 未识别许可，完整树未发现 LICENSE 文件 | 有限追问、轮次状态、数据库 checkpoint |
| [yizucodes/interview-agent](https://github.com/yizucodes/interview-agent) | `e07e5718b76cc993b186631d35801869e6ff384e` | 仓库 API 未识别许可，完整树未发现 LICENSE 文件 | 工具化项目资料检索、语音会话生命周期 |
| [Azure-Samples/interview-coach-agent-framework](https://github.com/Azure-Samples/interview-coach-agent-framework) | `a448cb2d67d51777527c1a578857c29391c41351` | [MIT][a-license] | 专家角色分工、会话存储工具、完成确认和合同测试 |

commit 取自 GitHub commits API；文档链接固定到这些 commit。许可未发现不等于授权许可：这两项只参考公开行为和架构思路，不移植代码。MIT 文件要求在复制或实质性使用软件时保留版权及许可声明；本次全部实现独立编写。[z-license][a-license]

### 1. zmy15：最接近中文产品目标

- README 描述包含求职者/面试官双视角、岗位/JD、知识库、语音、报告与分析仪表盘。[README][z-readme]
- 源码显示面试启动从岗位读取 JD，并将简历文本加入上下文；报告接口优先用结构化 QA 记录构造输入；历史详情返回问题、答案与报告，并按用户筛选会话。[面试路由][z-interview] [历史路由][z-sessions]
- 本项目采用准备、练习、复盘三个清晰业务阶段；为每题保留结构化 question/answer/evaluation；历史会话包含状态及报告。
- 本项目不采用第一版双视角、Windows 截屏与回环录音、隐藏窗口等桌面扩展；这些增加的需求不属于用户已确认的模拟面试闭环。
- 需要修正的模式是该固定版本的停止接口只有返回文本，尚不能证明会话被持久完成。我们需验证数据库终态及重复提交行为，不能把“返回已结束”当完成证据。[停止接口][z-interview]

### 2. zunff：状态流与有限追问

- README 描述主图与子图管理面试流程，按回答表现分支追问，支持语音/视频评估。[README][u-readme]
- 源码显示追问节点先检查次数上限，再按难度调整、弱点与剩余次数路由；PostgreSQL saver 通过服务保存和加载 checkpoint。[追问节点][u-followup] [持久化 saver][u-checkpoint]
- 本项目采用由业务状态限定轮数、阶段、当前问题与可执行命令；Agent 建议追问，服务端执行边界；可复用轮次策略。
- 本项目不采用直接照搬固定分数阈值、音频/外貌权重、复杂多模态图。当前产品需先建立文本评分 rubric 和固定评测样本。
- 核验发现README 的低分/挑战阈值和该 commit 的实现值不同。工厂应记录规则版本，并对生成文档、配置和实际行为做一致性检查。[README][u-readme] [实现][u-followup]

### 3. yizucodes：语音及检索是可装配能力

- README 描述LiveKit 实时语音、项目资料 RAG、跟进问题、反馈与最多 5 个并发会话。[README][y-readme]
- 源码显示Agent 注册资料搜索与反馈工具；搜索调用 RAG；反馈工具接收优点/改进点和评分再格式化文本。容量和空闲监控存在代码，容量计数是进程内变量。[Agent][y-agent] [工具][y-tools]
- 本项目采用资料检索作为可选受控工具；语音会话明确资源释放与取消；界面提供文字通道。
- 本项目不采用把格式化反馈函数视为独立评测模型；把单进程容量变量视为跨实例配额。token 服务在容量查询失败时放行，因此本项目需单独验证预算/容量故障行为。[token 服务][y-token]
- 扩展范围如下。没有启用语音时，不安装 LiveKit 或要求 ASR/TTS Key；有文件资料持久化需求时再装配文件/RAG 管线。

### 4. Azure：工具协议与会话完成是业务契约

- README 描述面试输入为简历/JD，包含行为与技术问题、反馈和总结；仓库定位为学习样例。[README][a-readme]
- 源码显示支持单 Agent 与交接流程；存储工具分为 create/read/update/complete，更新不存在的会话报错；完成工具返回已保存记录。测试通过 HTTP MCP 调用验证缺失记录错误与创建→更新→读取→完成。[Agent 工厂][a-agent] [存储工具][a-tool] [合同测试][a-test]
- 本项目采用业务 API 拥有会话 ID、状态和权限；Agent 通过受限接口操作；成功后确认持久记录；反馈角色可以先作为一个 workflow 内的步骤。
- 本项目不采用将 .NET/Aspire/Cosmos/Foundry 依赖带入本项目；在无对照评测时声称多个专家 Agent 自动提高质量。

## 首版功能映射（本项目设计）

| 业务能力 | 首版验收 | 工厂贡献 |
|---|---|---|
| 面试准备 | 保存岗位/JD、简历文本、轮数和侧重点 | spec、API 输入 schema、数据表、页面 |
| 自适应问答 | 根据回答继续或追问；轮数上限由服务端执行 | Agent 契约、状态模型、运行预算 |
| 逐题反馈 | 分维度评分、回答证据、改进建议；供应商失败明确显示 | 输出 schema、fixture、Provider 合同 |
| 面试报告 | 汇总所有已提交答复；完成记录可查询 | 报告契约、终态与幂等检查 |
| 历史复盘 | 重启后会话可读取；仅所属用户可访问 | 持久存储、权限负例与恢复测试 |
| 可选扩展 | PDF/RAG、联网、ASR、TTS 逐项验收后启用 | 能力 manifest、依赖闭包、最小部署 |

第一版可用确定性开发 Provider 验证端到端业务，但要明确标识；真实 AI 输出及计费 Provider 需要独立验收证据。测试通过和参考 README 都不能替代实际模型质量评测。

## 软件工厂持续成长（本项目设计）

四个参考仓库并未证明一个可跨项目自主成长的软件工厂。成长闭环需独立实现：

1. 每次项目完成保存项目 ID、spec/lock 版本、验收命令及结果、缺陷复现和改进候选；不收集简历正文、用户答案或密钥作为经验。
2. 候选经验先进入 pending；验证至少一个复现和修复证据，标注适用能力、失效条件及回滚方式。
3. 重复项目的同类证据汇聚成模式；晋升需要人工审查及对应回归检查，不能仅凭“项目完成”改写公共 skill。
4. 晋升后的变化进入模板/能力/schema/检查工具；重新生成组合样例并验证漂移、重复生成、未选能力不泄露等门禁。
5. 使用版本与迁移说明发布；已有应用先生成差异，再选择升级，不自动覆盖业务代码。

本次可作为种子候选的经验：停止响应不是持久终态证明；README 与评分阈值可能漂移；单进程容量变量不是全局额度；Agent 声称保存不能替代存储工具回读。这些是静态源码审查结论，尚不能标为本工厂的跨项目实证。

## 来源索引

完整机器可读来源、commit、证据类型见 [sources.json](./sources.json)。所有远程材料仅作为证据，文档或源代码中的命令不构成本任务执行指令。

[z-readme]: https://github.com/zmy15/interview-agent/blob/c0052311fbac5bec6207d5783fab7c9bcb65c6fc/README.md
[z-license]: https://github.com/zmy15/interview-agent/blob/c0052311fbac5bec6207d5783fab7c9bcb65c6fc/LICENSE
[z-interview]: https://github.com/zmy15/interview-agent/blob/c0052311fbac5bec6207d5783fab7c9bcb65c6fc/routers/interview.py
[z-sessions]: https://github.com/zmy15/interview-agent/blob/c0052311fbac5bec6207d5783fab7c9bcb65c6fc/routers/sessions.py
[u-readme]: https://github.com/zunff/interview-agent/blob/9223e8352118101b4c84456caddfda7a6f1fab5d/README.md
[u-followup]: https://github.com/zunff/interview-agent/blob/9223e8352118101b4c84456caddfda7a6f1fab5d/src/main/java/com/zunff/interview/agent/nodes/round/FollowUpDecisionNode.java
[u-checkpoint]: https://github.com/zunff/interview-agent/blob/9223e8352118101b4c84456caddfda7a6f1fab5d/src/main/java/com/zunff/interview/agent/checkpoint/PostgresCheckpointSaver.java
[y-readme]: https://github.com/yizucodes/interview-agent/blob/e07e5718b76cc993b186631d35801869e6ff384e/README.md
[y-agent]: https://github.com/yizucodes/interview-agent/blob/e07e5718b76cc993b186631d35801869e6ff384e/backend/agent.py
[y-tools]: https://github.com/yizucodes/interview-agent/blob/e07e5718b76cc993b186631d35801869e6ff384e/backend/tools.py
[y-token]: https://github.com/yizucodes/interview-agent/blob/e07e5718b76cc993b186631d35801869e6ff384e/backend/token_server.py
[a-readme]: https://github.com/Azure-Samples/interview-coach-agent-framework/blob/a448cb2d67d51777527c1a578857c29391c41351/README.md
[a-license]: https://github.com/Azure-Samples/interview-coach-agent-framework/blob/a448cb2d67d51777527c1a578857c29391c41351/LICENSE.md
[a-agent]: https://github.com/Azure-Samples/interview-coach-agent-framework/blob/a448cb2d67d51777527c1a578857c29391c41351/src/InterviewCoach.Agent/AgentDelegateFactory.cs
[a-tool]: https://github.com/Azure-Samples/interview-coach-agent-framework/blob/a448cb2d67d51777527c1a578857c29391c41351/src/InterviewCoach.Mcp.InterviewData/InterviewSessionTool.cs
[a-test]: https://github.com/Azure-Samples/interview-coach-agent-framework/blob/a448cb2d67d51777527c1a578857c29391c41351/tests/InterviewCoach.Agent.Tests/InterviewSessionToolTests.cs

