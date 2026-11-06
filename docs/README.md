# 文档索引

## 使用与开发

- [项目首页](../README.md)：安装、功能入口和开发验证。
- [使用指南](user-guide.md)：面试、备题、题库、算法与草稿备份。
- [JSON 简历制作](resume-builder.md)：JSON 导入、独立副本、预览、导出与投递附件。
- [SQLite 存储](design/sqlite-local.md)：文件位置、初始化、隔离和备份恢复。
- [持续验证](continuous-verification.md)：CI 流程和失败产物。

## 实现与设计

`app.spec.yaml` 是需求来源；`generated/`、`context/` 与配置索引通过 `pnpm factory:docs` 生成。

- [能力矩阵](generated/03-CAPABILITY-MATRIX.md)
- [架构与所有权](generated/01-ARCHITECTURE.md)
- [BOSS 工作流](boss-workflow.md)
- [BOSS 功能审查](design/boss-functional-review.md)

## 历史与研究

`adr/` 保存既有决策，`evidence/` 保存按日期产生的测试结果，`research/` 保存参考项目研究，`reference/` 保存原始设计资料和许可。

历史测试使用的存储方案、命令与服务名称保持原文，不能当作当前 SQLite 验收或启动指引。当前源代码、依赖和运行配置只支持 SQLite；历史服务不由本项目启动或管理。

## 文件约定

- `infra/sqlite/001-init.sql`：当前唯一数据库定义；迁移执行入口为 `pnpm db:migrate`。
- `scripts/`：维护中的初始化、诊断、验证与工具脚本。
- `.local/`、`test-results/`、`dist/`、`.cache/`：本地数据或生成产物，不进入版本控制。
- 真实环境文件、浏览器会话、简历与附件保持私有，不能加入文档或测试证据。
