# JD 备题验收

日期为 2026-10-22。范围为 REQ-013、REQ-014 及其与现有文本面试、题库和模型连接的兼容性。

## 通过的行为

- 仅填写岗位与 JD 即可生成 3 至 12 道题。每道题关联岗位能力、JD 连续原文、回答要点和追问。
- 实习、校招、社招和面试轮次共用现有难度规则。技术面生成技术问答，HR 与非技术岗生成行为问答。
- 模型输出的题量、类别、难度、引用和重复题经过服务端校验。鉴权、限流与无效 JD 输出返回不同错误；不降级到演示。
- 分类和题面可在入库前修改。空题面等未完成编辑在刷新后仍可恢复，保存按钮拒绝无效草稿。重新生成失败保留上一份题单。
- 用户确认后，题库在 owner 事务中批量写入。重复请求返回相同题目，容量不足整批回滚，其他身份无法查看或使用。
- 备题专用保存接口强制要求 JD 引用与分类；不含来源的批次在 HTTP 边界返回 400。
- 入库题目保留 JD 原文、能力与必备/加分分类；在题库继续编辑后仍保留这些信息。既有 JSONB payload 支持该可选字段，无需新增数据表。
- 保存并带入练习保留简历草稿，选择对应题库 ID 和严格模式。实际问题与已保存的编辑题面一致。
- 从练习资料点击提前备题时，显式携带当前 JD 与规划参数；直接打开 JD 标签页时，恢复独立备题草稿。
- Markdown 导出包含编辑后的题面、回答要点、原文依据和模式标识。桌面和 390px 移动端截图已检查，无横向溢出。
- 合法中文长批次超过 128 KB 仍能通过专用 2 MB HTTP 入口；重复保存键在边界被拒绝。

## 重跑与证据

```sh
pnpm build
docker compose -f infra/compose.yaml up -d --wait
docker compose -f infra/compose.test.yaml up -d --wait
RUN_INTEGRATION=1 pnpm exec vitest run --reporter=default --reporter=json --outputFile=docs/evidence/jd-test-results.json
pnpm dev
PLAYWRIGHT_JSON_OUTPUT_FILE=docs/evidence/jd-full-browser-results.json pnpm exec playwright test --reporter=line,json
```

- `pnpm build` 通过，包含类型检查、前端构建、工厂运行能力检查和软件工厂 skill 验证。
- [完整单元与集成结果](jd-test-results.json) 为 109 项通过，使用独立 PostgreSQL 测试库与本机 HTTP 模型协议 fixture。
- [完整浏览器结果](jd-full-browser-results.json) 为 11 项通过、1 项跳过。跳过的是需要显式 `RUN_PUBLIC_IMPORT=1` 的公网 LeetCode 验收，本次没有更改其导入逻辑。
- [桌面截图](screenshots/jd-preparation-desktop.png) 和 [移动截图](screenshots/jd-preparation-mobile.png) 使用固定虚构资料，不包含真实简历或密钥。

两轮独立代码评审发现并修复了五项问题：入库丢失 JD 依据、分类不能纠正、模型错误被合并、备题保存未强制来源、旧草稿覆盖当前资料入口。完整浏览器回归还修复了现有 Ant Design 界面的下拉和加载按钮可访问名称、虚拟选项可访问性以及题库成功与处理中提示同时出现的问题。原有未提交界面改动保留。具体修复见 [评审记录](jd-review.md)。

## 限制

真实收费模型和搜索账号未调用。HTTP fixture 证明应用确实经过模型 SDK 和契约，不证明第三方模型的提问质量。规则演示的题面来自固定模板，并在界面明确标识。

生成是最长 55 秒的单次请求，不保存后台备题任务。刷新后恢复输入与已有题单，进行中的生成需要重新发起。已保存题目的修改进入题库管理，避免修改题单后用相同幂等键覆盖已确认的内容。

本轮调研与实现只提供本项目证据，没有晋升跨项目工厂规则。外部架构通道中 Grok CLI 缺失，Claude 未登录；实际独立评审使用 GPT-5.6 Sol，没有声称跨供应商评审。`no-comments` 的专用 agent 文件在本机缺失，使用人工检查与独立代码评审检查本次注释，未修改全局 skill。
