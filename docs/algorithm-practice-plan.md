# 算法套路与跟打练习

本次交付对应 REQ-015、REQ-016。已有面试与 JD 备题流程保持可用。

## 执行清单

1. `how` over the affected subsystem.
2. `architect` for parallel design exploration.
3. Write the throughput checkpoint as four todo items.
4. Delegate code-writing through provider dispatch.
5. Verify on the matching surface.
6. Rebase into small, ordered commits.
7. If the design is contested, `interrogate` before shipping.
8. Run **Opening a PR**.

代码由当前会话负责。已知外部编写服务不可用，设计与最终检查使用可用的原生只读代理。第六、八项本轮不执行，当前工作区包含上一轮功能与用户修改，尚未请求提交。

## 四项检查点

- Blocking first steps. 先更新 spec 与解析计划，再确定模式目录、对照结果和草稿结构。
- Independent workstreams. 只读设计审阅与父会话实现并行，代码修改只有一个所有者。
- Shared mutable state. 业务库继续由 API 管理。新功能仅通过已有 API 读取题库；跟打草稿仅存当前标签页，按目标文本分开。
- Smallest safe decomposition. 一个模式目录、一个纯函数模块、一个界面；不引入模型生成、任务队列、在线判题或新数据库表。

## 数据与调用

`AlgorithmPattern` 包含关键词、条件、步骤、陷阱、复杂度与独立示例代码。`suggestPatterns(text)` 返回多个候选及匹配词；推荐是提示，不保证题解。

`compareTyping(reference, typed)` 返回公共前缀、逐行状态和首次差异。统一 CRLF 为 LF，保留空格和缩进；按 Unicode 码点计数。

界面组织为题面输入、候选模式、套路讲解、双栏跟打。题库带入的是题面快照，示例代码有独立标题和输入输出，不能伪装成当前题答案。未命中仍可手动选择模式。

草稿保存题面、选中模式、跟打对象及各目标的输入。每条草稿携带对应目标原文，模板或题面变化不会套用旧输入。只保留最近二十个目标并说明范围；存储失败提示。没有密钥、简历或外发请求。

## 验证

用户已选择 Python。纯函数检查识别线索、误用限制、中文/emoji/换行/多余输入。固定的内置 Python 代码在测试进程中运行，检查边界用例；用户输入不进入该测试器。真实浏览器检查题库带入、两种跟打、切换、恢复、重置、无匹配与窄屏布局。

## Hot 100 全题跟打扩展（REQ-017）

- 为快照中全部 100 题维护原创 Python 参考解法，按题号与学习卡关联；数据加载时验证完整性。独立作答与通用套路保持原有入口。
- 每题提供“本题代码跟打”；无套路映射的题也可进入。复用文本对照、隐藏参考、复制、重置与返回原题功能。
- 跟打草稿按题号、对象类型与参考原文隔离；旧草稿继续按通用套路恢复。直接链接及刷新明确区分本题代码与套路例题。
- 验证全部参考代码的 Python 语法与固定边界用例；浏览器验证全部题目入口、同套路题隔离、刷新、重置、原题草稿与手机布局。网页继续不执行用户代码，不将固定用例称为原站通过。

验收（2026-11-18）：全部 100 份本题参考代码通过 Python 固定用例；Chrome 10 项算法回归通过，逐一核对全部 100 题参考文本，覆盖同套路题隔离、复制、隐藏、重置、刷新与手机布局。`pnpm build` 通过；`pnpm test` 413 项通过、146 项按默认开关跳过。新旧算法草稿共用 contracts 中的存储契约，工作空间重开、备份恢复与旧格式迁移均通过回归。上述固定用例不代表原站判题结果。
