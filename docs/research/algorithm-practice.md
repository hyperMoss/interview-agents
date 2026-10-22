# 算法模式学习的实现依据

本轮于 2026-10-22 核对下列维护者文档。用途是确定模式的适用条件，核心 Python 示例为本项目编写，不依赖远程抓取或用户模型。

| 参考 | 用到的判断 | 本项目实现 |
| --- | --- | --- |
| [USACO Guide · Two Pointers](https://usaco.guide/silver/two-pointers) | 有序数组两端移动可排除无效组合，同向窗口维护连续区间。 | 区分相向双指针与滑动窗口，并分别给出独立示例。 |
| [cp-algorithms · Binary Search](https://cp-algorithms.com/num_methods/binary_search.html) | 按判定函数二分需要单调性。 | 说明左闭右开边界和重复值，要求先证明可行性单调。 |
| [cp-algorithms · Breadth First Search](https://cp-algorithms.com/graph/breadth-first-search.html) | 普通 BFS 以层数给出无权图最短距离。 | 带权题面提示限制，不将普通 BFS 当成不同边权的通用题解。 |
| [cp-algorithms · Knapsack Problem](https://cp-algorithms.com/dynamic_programming/knapsack.html) | 一维 0/1 背包倒序处理容量以避免复用物品。 | 提供倒序 Python 代码，用“只有一件物品但容量足够取两次”的用例检查。 |

关键词推荐是本项目的教学启发式，不是这些来源提供的自动分类器。候选有重叠，显示原始命中词，不显示置信度。当前有十二种模式，目录以外的题目允许无匹配；模板展示的是独立例题的输入输出，不能冒充题库原题答案。

本轮没有安装外部 skill，也没有将用户题面或输入代码送往第三方服务。
