---
name: algorithm-practice
description: "在 interview-agents 项目中用 LeetCode Hot 100 练习 Python 算法题，进行选题、思路提示、核心代码讲解和解法复盘。用于算法编程练习与面试准备。"
---

# 算法编程练习

使用本项目同一份 Hot 100 数据做有题号、来源和边界的练习。默认语言为 Python；用户指定其他语言时遵从用户。当前网页提供独立作答、思路记录、自评与套路跟打，入口为“算法跟打 → Hot 100 题单”。

## 选题

在仓库根目录调用题单工具，而不是凭记忆列一百题。工具从本 skill 目录上溯两级即可找到。项目命令按 AGENTS.md 使用 rtk 前缀。

```sh
rtk pnpm algorithm list --group 哈希 --difficulty easy
rtk pnpm algorithm list --query 子串
rtk pnpm algorithm show 1
rtk pnpm algorithm show 1 --hint
```

用户指定题号或题目就练该题。未指定时选当前专题的简单题，默认第 1 题。首次只读取不含提示的练习卡，给题号、原题链接和练习目标。卡片摘要不是官方完整题面；确定输入输出、限制和边界后再推导解法。已有用户代码或解题请求时直接处理，不强迫重走教学流程。

## 提示、核心代码与复盘

- 用户要提示时，再读取 `show 题号 --hint`。先解释一个识别线索与核心不变量，等待其尝试；明确要求完整解法或代码时直接提供。
- 关联的 `routines` 是各自例题的通用模板，适用边界在 `conditions`，例题在 `example`。将模板改写成当前题的输入、输出、状态与边界，再称为本题代码。没有关联模板时，从本题条件推导实现，不能把最近的模板强套进去。
- 讲代码时给出核心 Python 实现、关键步骤、时间与额外空间复杂度，以及能区分错误实现的边界案例。关注空输入、重复值、负数、原地修改、节点引用、环与不可达等当前题真正涉及的条件。
- 复盘用户代码时先定位具体失败条件，再给最小修正与同类迁移练习。标记“静态检查”“已运行固定用例”或“原站提交结果”，使结论与证据相符。网页不运行用户代码，自评“已复习”与跟打一致均不代表通过判题。

## 题库与数据维护

导出用于应用现有 JSON 导入的学习摘要题库，不会自动写入任何用户题库。

```sh
rtk pnpm --silent algorithm export-bank
rtk pnpm --silent algorithm export-bank --group 回溯
```

`list` 和 `show` 输出来源、快照日期及官方元数据的 SHA-256；此哈希只覆盖元数据，不覆盖原创提示与作答。`export-bank` 只输出符合导入契约的 questions，方便直接导入。官方元数据在 `packages/interview/data/hot100.json`；本项目摘要、提示和模式关联在 `packages/interview/src/hot100-lessons.ts`。查询、网页和导出共同使用 `packages/interview/src/hot100.ts`，维护时保持一个数据来源。

只在用户要求刷新题单时，读取官方学习计划公开页面，用 `pnpm algorithm:update --html 文件路径` 提取快照，再运行 `tests/hot100.test.ts`。题号变化需要同步练习提示；解析失败保留已有快照。完整题面和题解仍链接原站，更新过程不需要 Cookie 或付费内容。
