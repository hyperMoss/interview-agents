# 个人长期练习体验验收

验收日期：2026-10-23。范围为 REQ-019 至 REQ-023，保留现有 Ant Design 界面与 NestJS 业务写入边界。资料、草稿及算法进度保存在本机 IndexedDB；已提交的面试继续保存在服务端。

| 需求 | 已验证行为 | 可重跑证据 |
|---|---|---|
| REQ-019 | 旧标签页逐项迁移、关闭重开恢复、损坏隔离、存储失败仍可编辑、首次创建和更新的跨页面冲突、默认排除个人资料、恢复预览与原子提交 | `tests/workspace.test.ts`、`tests/e2e/usability.spec.ts` |
| REQ-020 | 首页继续练习、hash 路由、设置返回原任务、岗位档案保存与复制切换、三步资料向导、JD 与题库带入 | `tests/e2e/usability.spec.ts`、`tests/e2e/preparation-review.spec.ts`、`tests/e2e/preparation.spec.ts` |
| REQ-021 | Python 编辑器、键盘退出、专注编辑、独立作答恢复、收藏与专题进度、1/3/7/14 天复习、次日再练、筛选下到期优先、套路返回原题 | `tests/hot100-review.test.ts`、`tests/e2e/algorithm.spec.ts`、`tests/e2e/hot100.spec.ts`、`tests/e2e/usability.spec.ts` |
| REQ-022 | 65 条历史跨越旧 50 条上限、相同时间及微秒顺序稳定、归属隔离、摘要排除简历与答案、报告 QA 加入复习、合法长标题、删除关联草稿与复习 | `tests/history.integration.test.ts`、`tests/personal-data.test.ts`、`tests/e2e/interview.spec.ts` |
| REQ-023 | 本机运行时和依赖诊断、API 与 Agent 健康检查、断网与失败保留输入、手机布局与重试反馈 | `tests/doctor.test.ts`、`tests/e2e/usability.spec.ts`、`pnpm run doctor` |

## 最终执行结果

```sh
pnpm build
RUN_INTEGRATION=1 pnpm exec vitest run --reporter=default --reporter=json --outputFile=docs/evidence/usability-test-results.json
PLAYWRIGHT_JSON_OUTPUT_FILE=docs/evidence/usability-browser-results.json pnpm exec playwright test --reporter=line,json
pnpm run doctor
```

- 构建、类型检查、spec 运行时核对、项目 skill bundle 校验通过。
- 单元与真实 PostgreSQL 隔离集成：18 个测试文件，186 项通过，0 失败、0 跳过。原始结果：[测试 JSON](usability-test-results.json)。
- Chrome：24 项通过，1 项公网 LeetCode 导入按环境开关跳过，0 失败、0 flaky。原始结果：[浏览器 JSON](usability-browser-results.json)。
- Hot 100 选题修复后，相关场景另连续重复 10 次通过；完整回归在移除临时事件日志后再次通过。
- `pnpm run doctor`：Node.js、pnpm、Bun、5173/3000/4111 端口、API、Agent、PostgreSQL 只读查询、Redis PING 均通过。项目诊断不会启动服务或调用模型。`pnpm doctor` 是 pnpm 自身的不同命令。
- 项目算法 skill 通过官方 `quick_validate.py` 校验。网页与 skill 继续使用同一份 Hot 100 数据。
- axe 4.12.1 使用 `wcag2a,wcag2aa` 标签扫描算法页面，29 类通过、0 类明确违规、1 类待人工核对（4 个 Ant Design Select 遮叠输入与 1 个短行号的颜色对比度无法自动确定）。这不代表完整 WCAG 符合性。结果：[扫描 JSON](usability-accessibility-results.json)。

## 界面证据

- [首页](screenshots/usability-home.png)
- [手机资料向导](screenshots/usability-intake-mobile.png)
- [Hot 100 编辑与复习](screenshots/usability-hot100.png)
- [数据备份与恢复](screenshots/usability-data.png)
- [手机 Hot 100](screenshots/hot100-mobile.png)

人工查看了首页、手机向导和 Hot 100 完整截图。浏览器验收检查 390px 页面无横向溢出，并验证内容可操作。审阅问题及修复见 [审阅记录](usability-review.md)，过程决策见 [TSV 日志](usability-decisions.tsv)。

## 验证边界

模型与搜索的外部协议通过本地 HTTP fixture 驱动实际 API、Worker 与 Agent 链路；没有使用真实付费账号。测试资料均为固定合成内容，不代表真实用户经历。公网 LeetCode 导入本轮未重新验收，内置一百题 JSON 导入和重复跳过已验证。

本轮没有 Python 执行或在线判题；跟打比较和复习状态是文本比较与用户自评。浏览器存储不提供跨设备同步，清理浏览器前仍需自行下载备份。备份不包含身份 Cookie、模型或搜索密钥；服务端完整面试需单独导出。
