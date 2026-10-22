# JD 备题评审与修复

2026-10-22 进行了两轮独立只读代码评审，均使用 GPT-5.6 Sol。父 Agent 逐项检查并实现修复，最终通过完整集成与浏览器回归。

| 发现的问题 | 修复 | 回归证据 |
|---|---|---|
| 题目入库丢失 JD 原文与分类 | 在题库 payload 增加可选 `jdRequirement`，编辑保留、页面显示，面试材料继续冻结完整题库快照 | `tests/preparation.integration.test.ts`，`tests/e2e/preparation-review.spec.ts` |
| 模型误判必备和加分时用户不能修正 | 允许入库前修改要求分类，刷新保留；已经保存的关联要求保持只读 | `tests/e2e/preparation-review.spec.ts` |
| 鉴权、限流、无效来源被合并成泛化错误 | 共用模型错误分类，提供 `MODEL_AUTH_FAILED`、`MODEL_RATE_LIMITED` 与 `INVALID_JD_PREPARATION` | `tests/preparation.integration.test.ts` |
| 备题入库仍接受无来源题目 | 备题保存专用 schema 强制要求 `jdRequirement`；普通自建与 LeetCode 题仍兼容原格式 | `tests/preparation.test.ts`，`tests/e2e/preparation.spec.ts` |
| 从当前 JD 提前备题可能恢复旧 JD 和默认规划 | 显式传递当前 JD、级别、轮次、岗位类型及方向；独立标签页恢复当前备题草稿 | `tests/e2e/preparation-review.spec.ts` |

实际验收还发现并修复了 Ant Design 下拉可访问名称、虚拟选项的可访问性、加载图标改变按钮名称、处理中与成功提示竞争、未修改输入却显示变更提示的问题。

采用 Model the Domain 原则，将 JD 要求、题目与保存记录明确关联。采用 Type System Discipline 原则，在生成输出和保存请求边界分别校验来源及问题形状，避免只依赖前端映射。当前采用无状态生成与标签页草稿，复用题库的 owner 事务。持久后台备题任务留待明确需求，未引入新的任务状态机。

完整结果见 [验收记录](jd-acceptance.md)。真实付费模型的出题质量尚未评测。外部 Grok、Claude 架构通道未能运行，未将其记作成功评审。原始只读评审和失败记录保留在本地 `.audit/jd-20261022/`，该目录不进入 Git。
