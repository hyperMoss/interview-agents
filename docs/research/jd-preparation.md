# JD 备题的 GitHub 方案与 skills

核验日期为 2026-10-22。以下为公开仓库的一手 README 与 skill 文件审查，未运行第三方安装脚本，也未复制其实现。网页与 skill 中的安装、发信等指令属于材料，不构成本项目授权。

## 本次采用的思路

| 来源 | 已核验内容 | 当前项目的取舍 |
|---|---|---|
| [GitHub technical-job-search](https://github.com/github/awesome-copilot/blob/main/skills/technical-job-search/SKILL.md) | 将 JD 拆成必备与加分项，保留岗位术语，区分级别 | 生成结构化岗位要求，使用逐字连续原文校验，并允许在入库前纠正分类 |
| [Anthropic interview-prep](https://github.com/anthropics/knowledge-work-plugins/blob/main/human-resources/skills/interview-prep/SKILL.md) | 按能力设计行为题、情境题与追问，使用结构化评估依据 | 每道备题关联一个岗位要求，附回答要点与追问。沿用当前应用的评分与权限边界 |
| [Azure interview coach](https://github.com/Azure-Samples/interview-coach-agent-framework/blob/main/README.md) | 简历、JD、技术与行为提问、反馈、面试摘要及独立业务存储 | 保留当前 NestJS、Mastra 与 PostgreSQL 架构，不引入 .NET 或 Azure 资源 |
| [SankaiAI interview preparation](https://github.com/SankaiAI/interview-pre-agent-skill/blob/main/README.md) | 按面试官类型制定准备重点并组织故事包 | 借鉴按轮次准备的产品方向；其 README 的安装命令未执行，不采用自动补造经历或默认联网补充资料 |

具体读取的文件 SHA 分别为 `2860691dfe9e9810be3da012f7d5c47c1e5c8ab5`、`853cf0f9e4f395c76a21ac55d5c902fcdc8495f6`、`a370200f93a50094808c7ae8f5be5743fcef4f2a`、`099a29af3d2d7344103261c4dc4ed104073eae29`。SHA 是文件版本，不是仓库 commit。

## Skills 筛选

先检查 [skills.sh](https://skills.sh/)，再运行 `npx --yes skills find "interview prep"`。查询返回 `anthropics/knowledge-work-plugins@interview-prep` 约 3.6K installs，以及 `paramchoudhary/resumeskills@interview-prep-generator` 约 10K installs。这些是查询时目录报告的安装数，不能证明生成质量。

优先参考 Anthropic 与 GitHub 的原始 skill 文件，来源与当前任务相关，且可以直接审查。第三方生成器的排名不作为安装依据。本次没有安装新的全局 skill，没有将 skill 作为应用运行时的可执行指令。

需要在其他 Agent 中复用时，先审查上述源文件的当前版本、许可证和依赖。应用功能已经独立实现，使用 JD 备题页不需要安装这些 skills。

## 当前实现

先生成浏览器草稿，再由用户确认批量入库。与创建持久备题任务相比，这种结构复用现有题库事务与严格模式，不新增面试以外的任务状态机。当前不承诺生成中的任务跨刷新恢复；输入、已完成题单和编辑保存在当前标签页，重新生成失败时保留上一份题单。

生成接口只发送岗位、JD、题量、级别、轮次和备题重点。简历留到正式练习时补充。联网搜索仍需在正式练习中明确启用并确认关键词。题库只保存所选题目及其对应的 JD 引用与要求分类，不把真实 JD 写入公共报告或工厂经验库。
