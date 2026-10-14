# 实施与验收记录

用户目标：参考 GitHub interview-agent 项目，按桌面设计规范建设 AI 模拟面试产品，并提供跨项目持续改进的软件工厂 skill。

## 计划

- [x] Ground：核对设计文件、4 个 GitHub 仓库的固定 commit、源码与许可证。
- [x] Sketch：两种完整结构与独立比较，选用持久任务并保留有界生成。
- [x] Implement：文本面试、历史、报告、删除与独立 Hono/Mastra/Bun 服务。
- [x] Factory：spec、能力解析、按需设计/验收/上下文、受管文件保护及 runtime 一致性门禁。
- [x] Evolution：可复现证据、两项目候选晋升、范围化规则与版本回滚。
- [x] Verify：42 个测试、2 个 Chrome E2E、类型检查、构建、skill 元数据及独立目录安装后验收。

## 验收边界

首版先交付文本面试闭环；外部模型需要用户凭据才能真实验证。RAG、文件解析、联网搜索和语音按能力登记与成熟度管理。所有演示评分明确标记为规则演示。不得把未运行的基础设施或供应商测试标记为通过。

## 设计比较

Arena 阶段：Frame → 两个结构候选 → 独立比较 → 选基线 → 合并 → 验证。当前可用的原生设计代理输出两种结构；没有执行其他供应商模型，不宣称多模型一致性。

## 完成记录

- 模型 live 代码路径使用本地 OpenAI-compatible 协议 fixture 验证，未消耗真实模型额度。
- 独立检查发现混用搜索 Provider 时遗漏配置的问题，修复后回归通过。
- Runtime 注册表不是自动生成代码；构建与 API 启动强制核对实际实现与 spec，避免文档和实现漂移。
- 全局 skill 安装在 `/Users/gooingyu/.codex/skills/software-factory`。从 `/private/tmp` 独立运行它，完成基础蓝图 init/docs/context/diff，重复生成无变化。
- 安装后验证发现 CommonJS/ESM 加载缺口，已修复 bundle 并将独立执行加入 skill 验证器。
- 原 bundled Python skill validator 缺少 PyYAML；以仓库 Node/YAML 验证器完成 frontmatter、UI metadata、引用与可执行 bundle 校验。
- 测试数据库容器与合成数据已清理；开发 PostgreSQL/Redis 与应用保持可用。
- 没有伪造真实多项目学习记录；没有将 planned 能力标记为实现或承诺生产就绪。

具体证据与待验收事项见 `docs/evidence/acceptance.md`。

## 面试应用完成（用户调整优先级后）

用户明确要求先完成当前面试应用，因此暂停软件工厂功能扩展。新增应用内模型设置、短探测、模型列表、加密连接及有效期；每场面试固定模型快照，部署默认连接变更在发送资料前被拦截。

完成失败作答保留与显式幂等重试、四维反馈、Markdown/JSON 报告、填写与作答草稿恢复、历史查找、重复练习和清除连接。需求写入 REQ-005 至 REQ-007，并使用已有生成器更新本项目设计与验收文档。

实际 Chrome / Bun 链路发现 Mastra 存储初始化在 receipt 事务内等待索引的锁问题。改为启动时完成初始化、临时模型复用存储后通过；重试 payload 改为重新组装，恢复默认不会残留旧连接 ID。

本轮最终结果：56 个测试与 4 个 Chrome E2E，通过类型检查和构建。浏览器验证模型列表、探测、启用、三题面试、两种导出、草稿刷新、失败恢复、取消/删除、另一浏览器隔离、移动布局及重复练习。所有外部模型测试使用本地 fixture 和测试密钥，没有调用真实付费账号。

验收临时数据库已停止并删除，开发 PostgreSQL/Redis 和应用继续运行；最终 API 健康检查返回 ok，文档本地链接检查无缺失。

## 面试规划、简历、搜索与题库扩展

在当前应用加入本地简历提取预览、两种搜索连接、候选人级别与轮次规划、编程题资格、题库快照和三维 QA。手动重规划保留当前题与草稿，答案与重规划版本竞争只有一个接受。模型不能篡改严格原题或生成搜索来源。

完整回归 97 项通过，Chrome 7 项通过，包含实际 LeetCode 中国站 URL 导入与去重。付费模型与搜索协议使用本地 HTTP 夹具，未调用真实付费账号。前次浏览器失败和独立审查发现的长标题缺陷均保留证据，修复后回归通过。

本轮不扩展全局软件工厂 skill 或晋升跨项目规则，只同步本项目 spec 和能力文档。当前验收与限制见 docs/evidence/extension-acceptance.md，决策记录见 docs/evidence/extension-decisions.tsv。

最终独立审查和修复记录见 docs/evidence/extension-review.md。临时 interview_test 已清理，开发 API 健康检查为 ok，开发应用继续运行。
