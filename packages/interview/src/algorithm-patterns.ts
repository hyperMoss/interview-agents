export type AlgorithmPattern = {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  conditions: string;
  steps: string[];
  pitfalls: string[];
  complexity: string;
  example: { title: string; statement: string; invocation: string; result: string };
  code: string;
};

export const algorithmPatterns: [AlgorithmPattern, ...AlgorithmPattern[]] = [
  {
    id: 'hash-map', title: '哈希表', summary: '把反复查找变成一次查询。',
    keywords: ['哈希', 'hash', '两数之和', 'two sum', '频次', '出现次数', '重复元素'],
    conditions: '需要按值快速查询、计数或去重。若要求保持特定顺序，另行维护顺序。',
    steps: ['先明确键和值各表示什么。', '遍历时先查找互补项，再记录当前项。', '用下标作值，防止重复使用同一个元素。'],
    pitfalls: ['同一个元素不能使用两次。', '重复值不能在查询前覆盖旧下标。'],
    complexity: '平均时间 O(n)，额外空间 O(n)。',
    example: { title: '两数之和', statement: '给定整数数组 nums 和目标 target，返回两个不同下标，使对应元素之和等于 target。不存在时返回空列表。', invocation: 'solve([2, 7, 11, 15], 9)', result: '[0, 1]' },
    code: `def solve(nums, target):
    seen = {}
    for i, value in enumerate(nums):
        need = target - value
        if need in seen:
            return [seen[need], i]
        seen[value] = i
    return []`,
  },
  {
    id: 'two-pointers', title: '相向双指针', summary: '利用有序性，每次排除一端。',
    keywords: ['双指针', 'two pointers', '有序数组', 'sorted', '两端', '回文'],
    conditions: '示例要求数组升序。移动一个指针后，必须能够证明被排除的组合不可能是答案。',
    steps: ['左右指针分别放在两端。', '和偏小就移动左指针，偏大就移动右指针。', '找到返回下标，指针相遇结束。'],
    pitfalls: ['不能直接用于无序数组。', '若先排序，原始下标会变化，需要额外保存。'],
    complexity: '时间 O(n)，额外空间 O(1)。',
    example: { title: '有序数组两数和', statement: '给定升序整数数组 nums 和目标 target，返回和为 target 的两个不同下标。不存在时返回空列表。', invocation: 'solve([1, 3, 5, 8], 9)', result: '[0, 3]' },
    code: `def solve(nums, target):
    left, right = 0, len(nums) - 1
    while left < right:
        total = nums[left] + nums[right]
        if total == target:
            return [left, right]
        if total < target:
            left += 1
        else:
            right -= 1
    return []`,
  },
  {
    id: 'sliding-window', title: '滑动窗口', summary: '连续区间，右扩左缩维护有效性。',
    keywords: ['滑动窗口', 'sliding window', '连续', '子串', '无重复', '最长子串', '至多'],
    conditions: '适合连续区间，且左端移动能恢复约束。示例维护无重复字符；含负数的和约束不能直接用收缩窗口。',
    steps: ['右指针纳入新元素。', '约束失效时持续移动左端并更新状态。', '窗口有效后更新最优长度。'],
    pitfalls: ['通常是 while 收缩，不是只缩一次。', '子序列不要求连续，不能直接套窗口。', '和为 k 且含负数时优先考虑前缀和与哈希表。'],
    complexity: '时间 O(n)，额外空间 O(字符集大小)。',
    example: { title: '无重复字符的最长子串', statement: '给定字符串 text，求不含重复字符的最长连续子串长度。空字符串返回 0。', invocation: 'solve("abcabcbb")', result: '3' },
    code: `def solve(text):
    window = set()
    left = 0
    best = 0
    for right, char in enumerate(text):
        while char in window:
            window.remove(text[left])
            left += 1
        window.add(char)
        best = max(best, right - left + 1)
    return best`,
  },
  {
    id: 'prefix-sum', title: '前缀和 + 哈希计数', summary: '把区间和转成两个前缀的差。',
    keywords: ['前缀和', 'prefix sum', '区间和', '子数组和', '和为', 'sum equals', '负数'],
    conditions: '连续子数组和等于 k 的计数问题，可以包含负数。不是“任意子序列和”的通用解法。',
    steps: ['初始化空前缀出现一次。', '累加当前前缀，查找 prefix - k 的出现次数。', '先累计答案，再记录当前前缀。'],
    pitfalls: ['遗漏 counts[0] = 1 会漏掉从开头开始的区间。', '先记录再查询会把空区间也计入 k = 0。'],
    complexity: '平均时间 O(n)，额外空间 O(n)。',
    example: { title: '和为 k 的子数组数量', statement: '给定可含负数的整数数组 nums 和整数 k，计算和等于 k 的非空连续子数组个数。', invocation: 'solve([1, -1, 1], 1)', result: '3' },
    code: `def solve(nums, k):
    counts = {0: 1}
    prefix = 0
    answer = 0
    for value in nums:
        prefix += value
        answer += counts.get(prefix - k, 0)
        counts[prefix] = counts.get(prefix, 0) + 1
    return answer`,
  },
  {
    id: 'binary-search', title: '二分查找', summary: '维护边界，寻找第一个满足条件的位置。',
    keywords: ['二分', 'binary search', '单调', '第一个满足', '最后一个满足', '最小可行', '有序'],
    conditions: '必须有单调性。示例在升序数组中找第一个 >= target 的位置，答案可能为 len(nums)。',
    steps: ['使用左闭右开区间 [left, right)。', '中点满足条件时收紧右界。', '否则排除中点及其左侧；最终 left 是插入位置。'],
    pitfalls: ['分清 >= 与 >，避免重复值时错一位。', '答案二分要先证明可行性函数单调。'],
    complexity: '时间 O(log n)，额外空间 O(1)。',
    example: { title: '查找左边界', statement: '给定升序数组 nums，返回第一个大于等于 target 的下标。如果全部小于 target，返回数组长度。', invocation: 'solve([1, 3, 3, 7], 3)', result: '1' },
    code: `def solve(nums, target):
    left, right = 0, len(nums)
    while left < right:
        mid = (left + right) // 2
        if nums[mid] >= target:
            right = mid
        else:
            left = mid + 1
    return left`,
  },
  {
    id: 'monotonic-stack', title: '单调栈', summary: '为尚未找到答案的下标等待下一个更大元素。',
    keywords: ['单调栈', 'monotonic stack', '下一个更大', '下一个更小', '每日温度', '柱状图'],
    conditions: '寻找每个元素左右最近的更大或更小元素。示例存下标，保持温度递减，寻找严格更高温度。',
    steps: ['栈里保存还没找到答案的下标。', '新值能解决栈顶时不断弹出并结算距离。', '把当前下标压栈。'],
    pitfalls: ['相等是否弹栈取决于题目要求。', '最大矩形还需单独处理宽度和边界，不能原样套温度示例。'],
    complexity: '时间 O(n)，额外空间 O(n)。',
    example: { title: '每日温度', statement: '给定每天温度 temperatures，返回各天至少等待几天才能遇到严格更高温度。之后没有更高温度则填 0。', invocation: 'solve([30, 40, 35, 50])', result: '[1, 2, 1, 0]' },
    code: `def solve(temperatures):
    answer = [0] * len(temperatures)
    stack = []
    for i, value in enumerate(temperatures):
        while stack and temperatures[stack[-1]] < value:
            previous = stack.pop()
            answer[previous] = i - previous
        stack.append(i)
    return answer`,
  },
  {
    id: 'bfs', title: '广度优先搜索 BFS', summary: '一层一层扩展无权图的最短距离。',
    keywords: ['bfs', '广度优先', '无权图', '最短步数', '最少步数', '层序', '最短路径'],
    conditions: '示例要求无权图或每条边代价相同。不同边权的最短路径通常需要 Dijkstra，不能直接套普通 BFS。',
    steps: ['起点入队并立即标记距离。', '取队首扩展未访问邻居。', '邻居入队时标记，防止重复加入。'],
    pitfalls: ['列表 pop(0) 会搬移元素，使用 deque。', '入队时标记，环图才不会无限访问。'],
    complexity: '时间 O(V + E)，额外空间 O(V)。',
    example: { title: '无权图最短距离', statement: '邻接表 graph 中每条边代价为 1，求 start 到 target 的最短距离。无法到达返回 -1。', invocation: 'solve({0: [1, 2], 1: [3], 2: [], 3: []}, 0, 3)', result: '2' },
    code: `from collections import deque

def solve(graph, start, target):
    queue = deque([start])
    distance = {start: 0}
    while queue:
        node = queue.popleft()
        if node == target:
            return distance[node]
        for neighbor in graph.get(node, []):
            if neighbor not in distance:
                distance[neighbor] = distance[node] + 1
                queue.append(neighbor)
    return -1`,
  },
  {
    id: 'backtracking', title: '回溯枚举', summary: '做选择、递归、撤销选择。',
    keywords: ['回溯', 'backtracking', '所有组合', '所有排列', '全排列', '子集', '枚举路径'],
    conditions: '需要枚举所有可行方案且数据规模允许指数级输出。示例元素互不相同，枚举子集。',
    steps: ['用 path 记录当前选择，用 start 控制下一步范围。', '到一个合法状态就保存 path 的副本。', '选入元素、递归，然后 pop 撤销。'],
    pitfalls: ['保存 path[:]，不能保存同一个可变列表。', '重复元素需要排序和同层去重；排列不能沿用子集的 start 约束。'],
    complexity: '含复制的时间 O(n × 2^n)，递归辅助空间 O(n)，输出空间 O(n × 2^n)。',
    example: { title: '不重复数组的所有子集', statement: '给定元素互不相同的数组 nums，返回全部子集，包含空集。答案顺序不限。', invocation: 'solve([1, 2])', result: '[[], [1], [1, 2], [2]]' },
    code: `def solve(nums):
    answer = []
    path = []

    def dfs(start):
        answer.append(path[:])
        for i in range(start, len(nums)):
            path.append(nums[i])
            dfs(i + 1)
            path.pop()

    dfs(0)
    return answer`,
  },
  {
    id: 'dp-knapsack', title: '动态规划 · 0/1 背包', summary: '用状态记录已解决的子问题。',
    keywords: ['动态规划', 'dynamic programming', '背包', 'knapsack', '选或不选', '容量', '每件一次'],
    conditions: '每个物品最多选择一次，重量为正整数。示例状态 dp[c] 表示总重量不超过 c 的最大价值。',
    steps: ['初始化 dp 为 0，代表允许不选物品。', '逐件枚举物品，并倒序枚举容量。', '用不选与选择当前物品的价值更新状态。'],
    pitfalls: ['正序容量会变成完全背包。', '恰好装满需要另设不可达状态，不能全部初始化 0。'],
    complexity: '时间 O(n × capacity)，额外空间 O(capacity)。',
    example: { title: '0/1 背包最大价值', statement: '物品以 (重量, 价值) 给出，重量为正整数，每件最多取一次。求不超过非负整数 capacity 的最大价值，允许不取。', invocation: 'solve([(2, 3), (3, 4), (4, 5)], 5)', result: '7' },
    code: `def solve(items, capacity):
    dp = [0] * (capacity + 1)
    for weight, value in items:
        for current in range(capacity, weight - 1, -1):
            dp[current] = max(
                dp[current],
                dp[current - weight] + value
            )
    return dp[capacity]`,
  },
  {
    id: 'heap-top-k', title: '堆 · Top K', summary: '小顶堆只保留当前最大的 k 个值。',
    keywords: ['堆', 'heap', 'top k', 'topk', '前k', '前 k', '第k大', '第 k 大', '最大的k', '最大的 k'],
    conditions: '需要 Top K 或不断到来的数据中的第 k 大。示例把重复值作为不同元素计算。',
    steps: ['维护大小最多为 k 的小顶堆。', '不足 k 时入堆，之后仅在新值更大时替换堆顶。', '遍历结束堆顶就是第 k 大。'],
    pitfalls: ['第 k 个不同的值需要先去重。', 'k 超出范围要明确处理。'],
    complexity: '时间 O(n log(k + 1))，额外空间 O(k)。',
    example: { title: '数组第 k 大', statement: '给定数组 nums 和整数 k，返回第 k 大元素，重复值分别计数。k 不在 1 到数组长度范围时返回 None。', invocation: 'solve([3, 2, 1, 5, 6, 4], 2)', result: '5' },
    code: `import heapq

def solve(nums, k):
    if k < 1 or k > len(nums):
        return None
    heap = []
    for value in nums:
        if len(heap) < k:
            heapq.heappush(heap, value)
        elif value > heap[0]:
            heapq.heapreplace(heap, value)
    return heap[0]`,
  },
  {
    id: 'union-find', title: '并查集', summary: '用代表元判断是否属于同一个连通分量。',
    keywords: ['并查集', 'union find', '连通分量', '合并集合', '连通性', '冗余连接'],
    conditions: '无向图连通性或动态合并集合。示例节点编号为 0 到 n - 1，不支持删除边和最短路径。',
    steps: ['每个节点初始化为自己的代表元。', '查询时路径压缩，合并时小树挂到大树。', '只有两个代表元不同才合并并减少分量数。'],
    pitfalls: ['并查集不能回答有向可达性。', '重复边或自环不能重复减少分量数。'],
    complexity: '时间 O(n + m α(n))，额外空间 O(n)。',
    example: { title: '无向图连通分量数', statement: '给定节点数 n 及无向边 edges，节点编号为 0 到 n - 1。返回包含孤立节点的连通分量数。', invocation: 'solve(5, [(0, 1), (1, 2), (3, 4)])', result: '2' },
    code: `def solve(n, edges):
    parent = list(range(n))
    size = [1] * n
    components = n

    def find(node):
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    for a, b in edges:
        root_a, root_b = find(a), find(b)
        if root_a == root_b:
            continue
        if size[root_a] < size[root_b]:
            root_a, root_b = root_b, root_a
        parent[root_b] = root_a
        size[root_a] += size[root_b]
        components -= 1
    return components`,
  },
  {
    id: 'topological-sort', title: '拓扑排序', summary: '从没有前置依赖的节点开始处理。',
    keywords: ['拓扑', 'topological', '依赖', '先修课程', '课程表', '入度', '有向无环'],
    conditions: '处理有向图的先后依赖。示例边 (a, b) 表示必须先完成 a 再完成 b，环图返回 None。',
    steps: ['建立邻接表并统计入度。', '所有入度为 0 的节点入队。', '弹出节点并减少后继入度，新出现 0 的节点入队。', '处理数量不足 n 说明有环。'],
    pitfalls: ['题目给的先修对可能方向相反，要先转成正确边。', '合法拓扑序通常不唯一。'],
    complexity: '时间 O(V + E)，额外空间 O(V + E)。',
    example: { title: '依赖任务的执行顺序', statement: 'n 个任务编号为 0 到 n - 1。依赖边 (a, b) 表示 a 必须在 b 之前完成。返回一种合法顺序，有环则返回 None。', invocation: 'solve(3, [(0, 1), (1, 2)])', result: '[0, 1, 2]' },
    code: `from collections import deque

def solve(n, edges):
    graph = [[] for _ in range(n)]
    indegree = [0] * n
    for a, b in edges:
        graph[a].append(b)
        indegree[b] += 1
    queue = deque(i for i in range(n) if indegree[i] == 0)
    order = []
    while queue:
        node = queue.popleft()
        order.append(node)
        for neighbor in graph[node]:
            indegree[neighbor] -= 1
            if indegree[neighbor] == 0:
                queue.append(neighbor)
    return order if len(order) == n else None`,
  },
];

export const defaultAlgorithmPattern = algorithmPatterns[0];
export function getAlgorithmPattern(id: string): AlgorithmPattern {
  return algorithmPatterns.find(pattern => pattern.id === id) ?? defaultAlgorithmPattern;
}

export function suggestPatterns(text: string) {
  const normalized = text.toLowerCase().replace(/[ \t]+/g, ' ');
  const candidates = algorithmPatterns.flatMap(pattern => {
    const matched = pattern.keywords.filter(keyword => {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const left = /^[a-z0-9_]/.test(keyword) ? '(?:^|[^a-z0-9_])' : '';
      const right = /[a-z0-9_]$/.test(keyword) ? '(?=$|[^a-z0-9_])' : '';
      return new RegExp(`${left}${escaped}${right}`).test(normalized);
    });
    return matched.length ? [{ pattern, matched }] : [];
  });
  candidates.sort((a, b) => b.matched.length - a.matched.length);
  const warnings: string[] = [];
  const sumConditions = normalized.replace(/非负数?|不含负数|没有负数|无负数|non[\s-]*negative|(?:no|without) negative(?: numbers)?/g, ' ');
  if (/负数|\bnegative\b/.test(sumConditions) && /和|sum/.test(normalized)) {
    warnings.push('若包含负数，普通求和收缩窗口的单调性会失效。和等于 k 的计数可考虑前缀和 + 哈希计数。');
  }
  const graphConditions = normalized.replace(/无权图?|等权图?|unweighted|equal[\s-]*weight(?:ed)?/g, ' ');
  if (/带权|加权|权重|边权|\bweighted\b|\bdijkstra\b/.test(graphConditions)) {
    warnings.push('若边权不同，不能直接用普通 BFS 求最短路。非负边权可考虑 Dijkstra，负权还需其他算法；当前目录未提供这些模板。');
  }
  return { candidates, warnings };
}
