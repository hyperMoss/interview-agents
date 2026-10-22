# 项目工作约定

@/Users/gooingyu/.codex/RTK.md

先读 `docs/generated/AGENTS.generated.md` 与能力矩阵。开发对应任务时按 `docs/context/index.json` 加载最小上下文。

业务请求由 NestJS 授权；共享契约位于 packages/contracts。API/Worker 的业务模块是 app 表唯一写入边界，Agent 只写 agent_runtime。spec 是能力来源；新增能力先改变 spec 与解析计划，再实现和验证。

开发或验收软件工厂、跨项目复盘时读取 `skills/software-factory/SKILL.md`。核心文档工厂只生成设计上下文与配置索引；不要把 planned 能力描述成已经接通。

真实环境文件和简历资料不进入公开报告或经验库。测试固定 fixture 不代表真实用户经历或多个已交付项目。

算法编程练习、Hot 100 选题或解法复盘时，读取 `skills/algorithm-practice/SKILL.md`。网页、题单工具与 skill 共用同一份题目数据。
