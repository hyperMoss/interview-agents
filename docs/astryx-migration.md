# Astryx 迁移计划

需求来源：app.spec.yaml 的 REQ-063。目标使用 `@astryxdesign/core@0.7.16`、`@astryxdesign/theme-neutral@0.7.16` 与 StyleX，移除 antd 及其样式耦合。官方接入资料：https://github.com/meta/astryx/tree/main/packages/core 。

## 分工

实施工具统一为 pi，provider 为 `magpie`，模型为 `auto/deepseek-v4.1-flash`。协调与验收由主代理完成。工作者共同使用当前工作区，按文件所有权分组，不相互覆盖。

| 任务 | 所有权 | 验证重点 |
| --- | --- | --- |
| A 基础 | main、module-navigation、model-panel、search-panel、model-mode-tag、ui/confirm-action 及网页 CSS | 主题、中文、禁用传播、导航、异步确认与焦点 |
| B 练习 | intake、interview、preparation-panel、planning-panel、algorithm-panel、hot100-panel、bank-panel、code-editor、report-priorities、preparation-history-panel | 提交、受控输入、筛选、选题、进度、标签页 |
| C 资料 | boss-inbox-panel、data-panel、resume-library、resume-studio、home-panel、onboarding-panel、journey-map、resume-upload、career-panel | 上传、编辑、删除确认、抽屉及模态框 |
| 协调验收 | spec、generated 上下文、依赖与锁文件、测试与验收记录 | 审查全部改动、构建与回归、真实浏览器操作 |

## 执行与完成条件

1. 清点原组件调用与样式耦合，核实 Astryx 已发布包及类型；记录原有测试基线。
2. 先写 spec，再生成需求上下文；实施三个文件分组。组件优先直接使用 Astryx，公共确认操作可组合 Dialog，不复制整套旧组件 API。
3. 主代理检查事件参数、禁用状态、加载中防重复提交、可访问名称、键盘操作和布局；移除 antd 依赖与所有 `.ant-` 样式。
4. 运行类型检查、构建和既有测试；用临时 SQLite 数据库与合成资料执行浏览器回归，覆盖桌面与移动布局、确认取消与确认、输入与选择。
5. 实际结果记录在 docs/evidence/astryx-acceptance.md。未执行或失败的检查必须明确列出。

不修改业务授权、数据库写入边界、个人数据、模型连接或 BOSS 外部服务状态；不提交或推送 Git。
