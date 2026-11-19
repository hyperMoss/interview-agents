// Authored Python references. ListNode, TreeNode and Node are supplied by LeetCode.
export const hot100Solutions: Record<number, string> = {
  1: `class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for i, value in enumerate(nums):
            if target - value in seen:
                return [seen[target - value], i]
            seen[value] = i`,
  49: `from collections import defaultdict

class Solution:
    def groupAnagrams(self, strs):
        groups = defaultdict(list)
        for word in strs:
            groups[tuple(sorted(word))].append(word)
        return list(groups.values())`,
  128: `class Solution:
    def longestConsecutive(self, nums):
        values = set(nums)
        best = 0
        for value in values:
            if value - 1 not in values:
                end = value
                while end in values:
                    end += 1
                best = max(best, end - value)
        return best`,
  283: `class Solution:
    def moveZeroes(self, nums):
        write = 0
        for read in range(len(nums)):
            if nums[read] != 0:
                nums[write], nums[read] = nums[read], nums[write]
                write += 1`,
  11: `class Solution:
    def maxArea(self, height):
        left, right = 0, len(height) - 1
        best = 0
        while left < right:
            best = max(best, (right - left) * min(height[left], height[right]))
            if height[left] < height[right]:
                left += 1
            else:
                right -= 1
        return best`,
  15: `class Solution:
    def threeSum(self, nums):
        nums.sort()
        result = []
        for i in range(len(nums) - 2):
            if i > 0 and nums[i] == nums[i - 1]:
                continue
            if nums[i] > 0:
                break
            left, right = i + 1, len(nums) - 1
            while left < right:
                total = nums[i] + nums[left] + nums[right]
                if total < 0:
                    left += 1
                elif total > 0:
                    right -= 1
                else:
                    result.append([nums[i], nums[left], nums[right]])
                    left += 1
                    right -= 1
                    while left < right and nums[left] == nums[left - 1]:
                        left += 1
                    while left < right and nums[right] == nums[right + 1]:
                        right -= 1
        return result`,
  42: `class Solution:
    def trap(self, height):
        left, right = 0, len(height) - 1
        left_max = right_max = water = 0
        while left < right:
            if height[left] <= height[right]:
                left_max = max(left_max, height[left])
                water += left_max - height[left]
                left += 1
            else:
                right_max = max(right_max, height[right])
                water += right_max - height[right]
                right -= 1
        return water`,
  3: `class Solution:
    def lengthOfLongestSubstring(self, s):
        last = {}
        left = best = 0
        for right, char in enumerate(s):
            left = max(left, last.get(char, -1) + 1)
            last[char] = right
            best = max(best, right - left + 1)
        return best`,
  438: `class Solution:
    def findAnagrams(self, s, p):
        if len(s) < len(p):
            return []
        need, window = [0] * 26, [0] * 26
        for char in p:
            need[ord(char) - ord('a')] += 1
        result = []
        for right, char in enumerate(s):
            window[ord(char) - ord('a')] += 1
            if right >= len(p):
                window[ord(s[right - len(p)]) - ord('a')] -= 1
            if window == need:
                result.append(right - len(p) + 1)
        return result`,
  560: `class Solution:
    def subarraySum(self, nums, k):
        counts = {0: 1}
        prefix = result = 0
        for value in nums:
            prefix += value
            result += counts.get(prefix - k, 0)
            counts[prefix] = counts.get(prefix, 0) + 1
        return result`,
  239: `from collections import deque

class Solution:
    def maxSlidingWindow(self, nums, k):
        queue = deque()
        result = []
        for i, value in enumerate(nums):
            while queue and queue[0] <= i - k:
                queue.popleft()
            while queue and nums[queue[-1]] <= value:
                queue.pop()
            queue.append(i)
            if i >= k - 1:
                result.append(nums[queue[0]])
        return result`,
  76: `from collections import Counter

class Solution:
    def minWindow(self, s, t):
        if not t:
            return ''
        need = Counter(t)
        missing = len(t)
        left = start = 0
        best = len(s) + 1
        for right, char in enumerate(s):
            if need[char] > 0:
                missing -= 1
            need[char] -= 1
            while missing == 0:
                if right - left + 1 < best:
                    start, best = left, right - left + 1
                need[s[left]] += 1
                if need[s[left]] > 0:
                    missing += 1
                left += 1
        return '' if best > len(s) else s[start:start + best]`,
  53: `class Solution:
    def maxSubArray(self, nums):
        current = best = nums[0]
        for value in nums[1:]:
            current = max(value, current + value)
            best = max(best, current)
        return best`,
  56: `class Solution:
    def merge(self, intervals):
        result = []
        for start, end in sorted(intervals):
            if result and start <= result[-1][1]:
                result[-1][1] = max(result[-1][1], end)
            else:
                result.append([start, end])
        return result`,
  189: `class Solution:
    def rotate(self, nums, k):
        if not nums:
            return
        k %= len(nums)
        def reverse(left, right):
            while left < right:
                nums[left], nums[right] = nums[right], nums[left]
                left += 1
                right -= 1
        reverse(0, len(nums) - 1)
        reverse(0, k - 1)
        reverse(k, len(nums) - 1)`,
  238: `class Solution:
    def productExceptSelf(self, nums):
        result = [1] * len(nums)
        prefix = 1
        for i, value in enumerate(nums):
            result[i] = prefix
            prefix *= value
        suffix = 1
        for i in range(len(nums) - 1, -1, -1):
            result[i] *= suffix
            suffix *= nums[i]
        return result`,
  41: `class Solution:
    def firstMissingPositive(self, nums):
        n = len(nums)
        for i in range(n):
            while 1 <= nums[i] <= n and nums[nums[i] - 1] != nums[i]:
                target = nums[i] - 1
                nums[i], nums[target] = nums[target], nums[i]
        for i, value in enumerate(nums):
            if value != i + 1:
                return i + 1
        return n + 1`,
  73: `class Solution:
    def setZeroes(self, matrix):
        first_row = any(value == 0 for value in matrix[0])
        first_col = any(row[0] == 0 for row in matrix)
        rows, cols = len(matrix), len(matrix[0])
        for r in range(1, rows):
            for c in range(1, cols):
                if matrix[r][c] == 0:
                    matrix[r][0] = matrix[0][c] = 0
        for r in range(1, rows):
            for c in range(1, cols):
                if matrix[r][0] == 0 or matrix[0][c] == 0:
                    matrix[r][c] = 0
        if first_row:
            matrix[0][:] = [0] * cols
        if first_col:
            for row in matrix:
                row[0] = 0`,
  54: `class Solution:
    def spiralOrder(self, matrix):
        top, bottom = 0, len(matrix) - 1
        left, right = 0, len(matrix[0]) - 1
        result = []
        while top <= bottom and left <= right:
            for c in range(left, right + 1):
                result.append(matrix[top][c])
            top += 1
            for r in range(top, bottom + 1):
                result.append(matrix[r][right])
            right -= 1
            if top <= bottom:
                for c in range(right, left - 1, -1):
                    result.append(matrix[bottom][c])
                bottom -= 1
            if left <= right:
                for r in range(bottom, top - 1, -1):
                    result.append(matrix[r][left])
                left += 1
        return result`,
  48: `class Solution:
    def rotate(self, matrix):
        n = len(matrix)
        for r in range(n):
            for c in range(r + 1, n):
                matrix[r][c], matrix[c][r] = matrix[c][r], matrix[r][c]
        for row in matrix:
            row.reverse()`,
  240: `class Solution:
    def searchMatrix(self, matrix, target):
        row, col = 0, len(matrix[0]) - 1
        while row < len(matrix) and col >= 0:
            if matrix[row][col] == target:
                return True
            if matrix[row][col] > target:
                col -= 1
            else:
                row += 1
        return False`,
  160: `class Solution:
    def getIntersectionNode(self, headA, headB):
        a, b = headA, headB
        while a is not b:
            a = a.next if a else headB
            b = b.next if b else headA
        return a`,
  206: `class Solution:
    def reverseList(self, head):
        previous = None
        while head:
            following = head.next
            head.next = previous
            previous, head = head, following
        return previous`,
  234: `class Solution:
    def isPalindrome(self, head):
        if head is None or head.next is None:
            return True
        def reverse(node):
            previous = None
            while node:
                following = node.next
                node.next = previous
                previous, node = node, following
            return previous
        slow = fast = head
        while fast.next and fast.next.next:
            slow, fast = slow.next, fast.next.next
        second_half = reverse(slow.next)
        left, right = head, second_half
        matches = True
        while right:
            if left.val != right.val:
                matches = False
                break
            left, right = left.next, right.next
        slow.next = reverse(second_half)
        return matches`,
  141: `class Solution:
    def hasCycle(self, head):
        slow = fast = head
        while fast and fast.next:
            slow, fast = slow.next, fast.next.next
            if slow is fast:
                return True
        return False`,
  142: `class Solution:
    def detectCycle(self, head):
        slow = fast = head
        while fast and fast.next:
            slow, fast = slow.next, fast.next.next
            if slow is fast:
                entry = head
                while entry is not slow:
                    entry, slow = entry.next, slow.next
                return entry
        return None`,
  21: `class Solution:
    def mergeTwoLists(self, list1, list2):
        dummy = tail = ListNode()
        while list1 and list2:
            if list1.val <= list2.val:
                tail.next, list1 = list1, list1.next
            else:
                tail.next, list2 = list2, list2.next
            tail = tail.next
        tail.next = list1 or list2
        return dummy.next`,
  2: `class Solution:
    def addTwoNumbers(self, l1, l2):
        dummy = tail = ListNode()
        carry = 0
        while l1 or l2 or carry:
            total = carry
            if l1:
                total += l1.val
                l1 = l1.next
            if l2:
                total += l2.val
                l2 = l2.next
            carry, digit = divmod(total, 10)
            tail.next = ListNode(digit)
            tail = tail.next
        return dummy.next`,
  19: `class Solution:
    def removeNthFromEnd(self, head, n):
        dummy = ListNode(0, head)
        slow = fast = dummy
        for _ in range(n):
            fast = fast.next
        while fast.next:
            slow, fast = slow.next, fast.next
        slow.next = slow.next.next
        return dummy.next`,
  24: `class Solution:
    def swapPairs(self, head):
        dummy = ListNode(0, head)
        previous = dummy
        while previous.next and previous.next.next:
            first = previous.next
            second = first.next
            first.next = second.next
            second.next = first
            previous.next = second
            previous = first
        return dummy.next`,
  25: `class Solution:
    def reverseKGroup(self, head, k):
        dummy = ListNode(0, head)
        previous = dummy
        while True:
            end = previous
            for _ in range(k):
                end = end.next
                if end is None:
                    return dummy.next
            following = end.next
            current = previous.next
            reversed_head = following
            while current is not following:
                next_node = current.next
                current.next = reversed_head
                reversed_head, current = current, next_node
            old_head = previous.next
            previous.next = end
            previous = old_head`,
  138: `class Solution:
    def copyRandomList(self, head):
        copies = {None: None}
        current = head
        while current:
            copies[current] = Node(current.val)
            current = current.next
        current = head
        while current:
            copies[current].next = copies[current.next]
            copies[current].random = copies[current.random]
            current = current.next
        return copies[head]`,
  148: `class Solution:
    def sortList(self, head):
        if not head or not head.next:
            return head
        slow, fast = head, head.next
        while fast and fast.next:
            slow, fast = slow.next, fast.next.next
        right = slow.next
        slow.next = None
        left, right = self.sortList(head), self.sortList(right)
        dummy = tail = ListNode()
        while left and right:
            if left.val <= right.val:
                tail.next, left = left, left.next
            else:
                tail.next, right = right, right.next
            tail = tail.next
        tail.next = left or right
        return dummy.next`,
  23: `import heapq

class Solution:
    def mergeKLists(self, lists):
        heap = [(node.val, i, node) for i, node in enumerate(lists) if node]
        heapq.heapify(heap)
        dummy = tail = ListNode()
        while heap:
            _, i, node = heapq.heappop(heap)
            tail.next = node
            tail = node
            if node.next:
                heapq.heappush(heap, (node.next.val, i, node.next))
        return dummy.next`,
  146: `from collections import OrderedDict

class LRUCache:
    def __init__(self, capacity):
        self.capacity = capacity
        self.values = OrderedDict()

    def get(self, key):
        if key not in self.values:
            return -1
        self.values.move_to_end(key)
        return self.values[key]

    def put(self, key, value):
        self.values[key] = value
        self.values.move_to_end(key)
        if len(self.values) > self.capacity:
            self.values.popitem(last=False)`,
  94: `class Solution:
    def inorderTraversal(self, root):
        stack, result = [], []
        while root or stack:
            while root:
                stack.append(root)
                root = root.left
            root = stack.pop()
            result.append(root.val)
            root = root.right
        return result`,
  104: `class Solution:
    def maxDepth(self, root):
        if root is None:
            return 0
        return 1 + max(self.maxDepth(root.left), self.maxDepth(root.right))`,
  226: `class Solution:
    def invertTree(self, root):
        if root:
            root.left, root.right = self.invertTree(root.right), self.invertTree(root.left)
        return root`,
  101: `class Solution:
    def isSymmetric(self, root):
        def mirror(left, right):
            if left is None or right is None:
                return left is right
            return (left.val == right.val
                    and mirror(left.left, right.right)
                    and mirror(left.right, right.left))
        return root is None or mirror(root.left, root.right)`,
  543: `class Solution:
    def diameterOfBinaryTree(self, root):
        best = 0
        def depth(node):
            nonlocal best
            if node is None:
                return 0
            left, right = depth(node.left), depth(node.right)
            best = max(best, left + right)
            return 1 + max(left, right)
        depth(root)
        return best`,
  102: `from collections import deque

class Solution:
    def levelOrder(self, root):
        queue = deque([root] if root else [])
        result = []
        while queue:
            level = []
            for _ in range(len(queue)):
                node = queue.popleft()
                level.append(node.val)
                if node.left:
                    queue.append(node.left)
                if node.right:
                    queue.append(node.right)
            result.append(level)
        return result`,
  108: `class Solution:
    def sortedArrayToBST(self, nums):
        def build(left, right):
            if left > right:
                return None
            middle = (left + right) // 2
            return TreeNode(nums[middle], build(left, middle - 1), build(middle + 1, right))
        return build(0, len(nums) - 1)`,
  98: `class Solution:
    def isValidBST(self, root):
        def valid(node, low, high):
            if node is None:
                return True
            return (low < node.val < high
                    and valid(node.left, low, node.val)
                    and valid(node.right, node.val, high))
        return valid(root, float('-inf'), float('inf'))`,
  230: `class Solution:
    def kthSmallest(self, root, k):
        stack = []
        while root or stack:
            while root:
                stack.append(root)
                root = root.left
            root = stack.pop()
            k -= 1
            if k == 0:
                return root.val
            root = root.right`,
  199: `class Solution:
    def rightSideView(self, root):
        result = []
        def visit(node, depth):
            if node is None:
                return
            if depth == len(result):
                result.append(node.val)
            visit(node.right, depth + 1)
            visit(node.left, depth + 1)
        visit(root, 0)
        return result`,
  114: `class Solution:
    def flatten(self, root):
        current = root
        while current:
            if current.left:
                predecessor = current.left
                while predecessor.right:
                    predecessor = predecessor.right
                predecessor.right = current.right
                current.right = current.left
                current.left = None
            current = current.right`,
  105: `class Solution:
    def buildTree(self, preorder, inorder):
        positions = {value: i for i, value in enumerate(inorder)}
        index = 0
        def build(left, right):
            nonlocal index
            if left > right:
                return None
            value = preorder[index]
            index += 1
            middle = positions[value]
            return TreeNode(value, build(left, middle - 1), build(middle + 1, right))
        return build(0, len(inorder) - 1)`,
  437: `class Solution:
    def pathSum(self, root, targetSum):
        counts = {0: 1}
        def visit(node, prefix):
            if node is None:
                return 0
            prefix += node.val
            result = counts.get(prefix - targetSum, 0)
            counts[prefix] = counts.get(prefix, 0) + 1
            result += visit(node.left, prefix) + visit(node.right, prefix)
            counts[prefix] -= 1
            return result
        return visit(root, 0)`,
  236: `class Solution:
    def lowestCommonAncestor(self, root, p, q):
        if root is None or root is p or root is q:
            return root
        left = self.lowestCommonAncestor(root.left, p, q)
        right = self.lowestCommonAncestor(root.right, p, q)
        if left and right:
            return root
        return left or right`,
  124: `class Solution:
    def maxPathSum(self, root):
        best = float('-inf')
        def gain(node):
            nonlocal best
            if node is None:
                return 0
            left = max(0, gain(node.left))
            right = max(0, gain(node.right))
            best = max(best, node.val + left + right)
            return node.val + max(left, right)
        gain(root)
        return best`,
  200: `class Solution:
    def numIslands(self, grid):
        rows, cols = len(grid), len(grid[0])
        count = 0
        for r in range(rows):
            for c in range(cols):
                if grid[r][c] != '1':
                    continue
                count += 1
                grid[r][c] = '0'
                stack = [(r, c)]
                while stack:
                    x, y = stack.pop()
                    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                        if 0 <= nx < rows and 0 <= ny < cols and grid[nx][ny] == '1':
                            grid[nx][ny] = '0'
                            stack.append((nx, ny))
        return count`,
  994: `from collections import deque

class Solution:
    def orangesRotting(self, grid):
        rows, cols = len(grid), len(grid[0])
        queue = deque()
        fresh = 0
        for r in range(rows):
            for c in range(cols):
                if grid[r][c] == 2:
                    queue.append((r, c))
                elif grid[r][c] == 1:
                    fresh += 1
        minutes = 0
        while queue and fresh:
            for _ in range(len(queue)):
                r, c = queue.popleft()
                for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                    if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 1:
                        grid[nr][nc] = 2
                        fresh -= 1
                        queue.append((nr, nc))
            minutes += 1
        return minutes if fresh == 0 else -1`,
  207: `from collections import deque

class Solution:
    def canFinish(self, numCourses, prerequisites):
        graph = [[] for _ in range(numCourses)]
        indegree = [0] * numCourses
        for course, prerequisite in prerequisites:
            graph[prerequisite].append(course)
            indegree[course] += 1
        queue = deque(i for i in range(numCourses) if indegree[i] == 0)
        completed = 0
        while queue:
            course = queue.popleft()
            completed += 1
            for following in graph[course]:
                indegree[following] -= 1
                if indegree[following] == 0:
                    queue.append(following)
        return completed == numCourses`,
  208: `class Trie:
    def __init__(self):
        self.root = {}

    def insert(self, word):
        node = self.root
        for char in word:
            node = node.setdefault(char, {})
        node['#'] = True

    def search(self, word):
        node = self.root
        for char in word:
            if char not in node:
                return False
            node = node[char]
        return '#' in node

    def startsWith(self, prefix):
        node = self.root
        for char in prefix:
            if char not in node:
                return False
            node = node[char]
        return True`,
  46: `class Solution:
    def permute(self, nums):
        result, path = [], []
        used = [False] * len(nums)
        def visit():
            if len(path) == len(nums):
                result.append(path.copy())
                return
            for i, value in enumerate(nums):
                if not used[i]:
                    used[i] = True
                    path.append(value)
                    visit()
                    path.pop()
                    used[i] = False
        visit()
        return result`,
  78: `class Solution:
    def subsets(self, nums):
        result = [[]]
        for value in nums:
            result += [subset + [value] for subset in result]
        return result`,
  17: `class Solution:
    def letterCombinations(self, digits):
        if not digits:
            return []
        letters = {'2': 'abc', '3': 'def', '4': 'ghi', '5': 'jkl',
                   '6': 'mno', '7': 'pqrs', '8': 'tuv', '9': 'wxyz'}
        result = ['']
        for digit in digits:
            result = [prefix + char for prefix in result for char in letters[digit]]
        return result`,
  39: `class Solution:
    def combinationSum(self, candidates, target):
        candidates = sorted(candidates)
        result, path = [], []
        def visit(start, remaining):
            if remaining == 0:
                result.append(path.copy())
                return
            for i in range(start, len(candidates)):
                value = candidates[i]
                if value > remaining:
                    break
                path.append(value)
                visit(i, remaining - value)
                path.pop()
        visit(0, target)
        return result`,
  22: `class Solution:
    def generateParenthesis(self, n):
        result = []
        def visit(path, opened, closed):
            if closed == n:
                result.append(path)
                return
            if opened < n:
                visit(path + '(', opened + 1, closed)
            if closed < opened:
                visit(path + ')', opened, closed + 1)
        visit('', 0, 0)
        return result`,
  79: `class Solution:
    def exist(self, board, word):
        rows, cols = len(board), len(board[0])
        def visit(r, c, index):
            if index == len(word):
                return True
            if not (0 <= r < rows and 0 <= c < cols) or board[r][c] != word[index]:
                return False
            char = board[r][c]
            board[r][c] = None
            found = any(visit(nr, nc, index + 1) for nr, nc in
                        ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)))
            board[r][c] = char
            return found
        return any(visit(r, c, 0) for r in range(rows) for c in range(cols))`,
  131: `class Solution:
    def partition(self, s):
        result, path = [], []
        def visit(start):
            if start == len(s):
                result.append(path.copy())
                return
            for end in range(start + 1, len(s) + 1):
                part = s[start:end]
                if part == part[::-1]:
                    path.append(part)
                    visit(end)
                    path.pop()
        visit(0)
        return result`,
  51: `class Solution:
    def solveNQueens(self, n):
        columns, diagonals, anti_diagonals = set(), set(), set()
        result, path = [], []
        def visit(row):
            if row == n:
                result.append(['.' * col + 'Q' + '.' * (n - col - 1) for col in path])
                return
            for col in range(n):
                if col in columns or row - col in diagonals or row + col in anti_diagonals:
                    continue
                columns.add(col)
                diagonals.add(row - col)
                anti_diagonals.add(row + col)
                path.append(col)
                visit(row + 1)
                path.pop()
                columns.remove(col)
                diagonals.remove(row - col)
                anti_diagonals.remove(row + col)
        visit(0)
        return result`,
  35: `class Solution:
    def searchInsert(self, nums, target):
        left, right = 0, len(nums)
        while left < right:
            middle = (left + right) // 2
            if nums[middle] < target:
                left = middle + 1
            else:
                right = middle
        return left`,
  74: `class Solution:
    def searchMatrix(self, matrix, target):
        rows, cols = len(matrix), len(matrix[0])
        left, right = 0, rows * cols
        while left < right:
            middle = (left + right) // 2
            if matrix[middle // cols][middle % cols] < target:
                left = middle + 1
            else:
                right = middle
        return left < rows * cols and matrix[left // cols][left % cols] == target`,
  34: `class Solution:
    def searchRange(self, nums, target):
        def lower_bound(value):
            left, right = 0, len(nums)
            while left < right:
                middle = (left + right) // 2
                if nums[middle] < value:
                    left = middle + 1
                else:
                    right = middle
            return left
        first = lower_bound(target)
        if first == len(nums) or nums[first] != target:
            return [-1, -1]
        return [first, lower_bound(target + 1) - 1]`,
  33: `class Solution:
    def search(self, nums, target):
        left, right = 0, len(nums) - 1
        while left <= right:
            middle = (left + right) // 2
            if nums[middle] == target:
                return middle
            if nums[left] <= nums[middle]:
                if nums[left] <= target < nums[middle]:
                    right = middle - 1
                else:
                    left = middle + 1
            elif nums[middle] < target <= nums[right]:
                left = middle + 1
            else:
                right = middle - 1
        return -1`,
  153: `class Solution:
    def findMin(self, nums):
        left, right = 0, len(nums) - 1
        while left < right:
            middle = (left + right) // 2
            if nums[middle] > nums[right]:
                left = middle + 1
            else:
                right = middle
        return nums[left]`,
  4: `class Solution:
    def findMedianSortedArrays(self, nums1, nums2):
        if len(nums1) > len(nums2):
            return self.findMedianSortedArrays(nums2, nums1)
        m, n = len(nums1), len(nums2)
        left, right = 0, m
        while left <= right:
            i = (left + right) // 2
            j = (m + n + 1) // 2 - i
            a = nums1[i - 1] if i else float('-inf')
            b = nums1[i] if i < m else float('inf')
            c = nums2[j - 1] if j else float('-inf')
            d = nums2[j] if j < n else float('inf')
            if a <= d and c <= b:
                if (m + n) % 2:
                    return max(a, c)
                return (max(a, c) + min(b, d)) / 2
            if a > d:
                right = i - 1
            else:
                left = i + 1`,
  20: `class Solution:
    def isValid(self, s):
        pairs = {')': '(', ']': '[', '}': '{'}
        stack = []
        for char in s:
            if char in pairs:
                if not stack or stack.pop() != pairs[char]:
                    return False
            else:
                stack.append(char)
        return not stack`,
  155: `class MinStack:
    def __init__(self):
        self.stack = []

    def push(self, val):
        minimum = min(val, self.stack[-1][1]) if self.stack else val
        self.stack.append((val, minimum))

    def pop(self):
        self.stack.pop()

    def top(self):
        return self.stack[-1][0]

    def getMin(self):
        return self.stack[-1][1]`,
  394: `class Solution:
    def decodeString(self, s):
        stack = []
        current, count = '', 0
        for char in s:
            if char.isdigit():
                count = count * 10 + int(char)
            elif char == '[':
                stack.append((current, count))
                current, count = '', 0
            elif char == ']':
                previous, repeat = stack.pop()
                current = previous + current * repeat
            else:
                current += char
        return current`,
  739: `class Solution:
    def dailyTemperatures(self, temperatures):
        result = [0] * len(temperatures)
        stack = []
        for i, value in enumerate(temperatures):
            while stack and temperatures[stack[-1]] < value:
                previous = stack.pop()
                result[previous] = i - previous
            stack.append(i)
        return result`,
  84: `class Solution:
    def largestRectangleArea(self, heights):
        stack = [-1]
        best = 0
        for i in range(len(heights) + 1):
            current = heights[i] if i < len(heights) else 0
            while len(stack) > 1 and heights[stack[-1]] > current:
                height = heights[stack.pop()]
                best = max(best, height * (i - stack[-1] - 1))
            stack.append(i)
        return best`,
  215: `import heapq

class Solution:
    def findKthLargest(self, nums, k):
        heap = []
        for value in nums:
            heapq.heappush(heap, value)
            if len(heap) > k:
                heapq.heappop(heap)
        return heap[0]`,
  347: `from collections import Counter

class Solution:
    def topKFrequent(self, nums, k):
        buckets = [[] for _ in range(len(nums) + 1)]
        for value, count in Counter(nums).items():
            buckets[count].append(value)
        result = []
        for bucket in reversed(buckets):
            result.extend(bucket)
            if len(result) >= k:
                return result[:k]`,
  295: `import heapq

class MedianFinder:
    def __init__(self):
        self.low, self.high = [], []

    def addNum(self, num):
        heapq.heappush(self.high, -heapq.heappushpop(self.low, -num))
        if len(self.high) > len(self.low):
            heapq.heappush(self.low, -heapq.heappop(self.high))

    def findMedian(self):
        if len(self.low) > len(self.high):
            return -self.low[0]
        return (-self.low[0] + self.high[0]) / 2`,
  121: `class Solution:
    def maxProfit(self, prices):
        lowest, best = float('inf'), 0
        for price in prices:
            lowest = min(lowest, price)
            best = max(best, price - lowest)
        return best`,
  55: `class Solution:
    def canJump(self, nums):
        farthest = 0
        for i, distance in enumerate(nums):
            if i > farthest:
                return False
            farthest = max(farthest, i + distance)
        return True`,
  45: `class Solution:
    def jump(self, nums):
        end = farthest = steps = 0
        for i in range(len(nums) - 1):
            farthest = max(farthest, i + nums[i])
            if i == end:
                steps += 1
                end = farthest
        return steps`,
  763: `class Solution:
    def partitionLabels(self, s):
        last = {char: i for i, char in enumerate(s)}
        result = []
        start = end = 0
        for i, char in enumerate(s):
            end = max(end, last[char])
            if i == end:
                result.append(end - start + 1)
                start = i + 1
        return result`,
  70: `class Solution:
    def climbStairs(self, n):
        previous = current = 1
        for _ in range(n):
            previous, current = current, previous + current
        return previous`,
  118: `class Solution:
    def generate(self, numRows):
        result = []
        for row in range(numRows):
            current = [1] * (row + 1)
            for col in range(1, row):
                current[col] = result[-1][col - 1] + result[-1][col]
            result.append(current)
        return result`,
  198: `class Solution:
    def rob(self, nums):
        previous = current = 0
        for value in nums:
            previous, current = current, max(current, previous + value)
        return current`,
  279: `class Solution:
    def numSquares(self, n):
        squares = [value * value for value in range(1, int(n ** 0.5) + 1)]
        dp = [0] + [n + 1] * n
        for total in range(1, n + 1):
            for square in squares:
                if square > total:
                    break
                dp[total] = min(dp[total], dp[total - square] + 1)
        return dp[n]`,
  322: `class Solution:
    def coinChange(self, coins, amount):
        dp = [0] + [amount + 1] * amount
        for total in range(1, amount + 1):
            for coin in coins:
                if coin <= total:
                    dp[total] = min(dp[total], dp[total - coin] + 1)
        return dp[amount] if dp[amount] <= amount else -1`,
  139: `class Solution:
    def wordBreak(self, s, wordDict):
        words = set(wordDict)
        longest = max(map(len, words), default=0)
        dp = [True] + [False] * len(s)
        for end in range(1, len(s) + 1):
            dp[end] = any(dp[start] and s[start:end] in words
                          for start in range(max(0, end - longest), end))
        return dp[-1]`,
  300: `from bisect import bisect_left

class Solution:
    def lengthOfLIS(self, nums):
        tails = []
        for value in nums:
            index = bisect_left(tails, value)
            if index == len(tails):
                tails.append(value)
            else:
                tails[index] = value
        return len(tails)`,
  152: `class Solution:
    def maxProduct(self, nums):
        high = low = best = nums[0]
        for value in nums[1:]:
            high, low = max(value, high * value, low * value), min(value, high * value, low * value)
            best = max(best, high)
        return best`,
  416: `class Solution:
    def canPartition(self, nums):
        total = sum(nums)
        if total % 2:
            return False
        target = total // 2
        dp = [True] + [False] * target
        for value in nums:
            for current in range(target, value - 1, -1):
                dp[current] = dp[current] or dp[current - value]
        return dp[target]`,
  32: `class Solution:
    def longestValidParentheses(self, s):
        stack = [-1]
        best = 0
        for i, char in enumerate(s):
            if char == '(':
                stack.append(i)
            else:
                stack.pop()
                if not stack:
                    stack.append(i)
                else:
                    best = max(best, i - stack[-1])
        return best`,
  62: `class Solution:
    def uniquePaths(self, m, n):
        dp = [1] * n
        for _ in range(1, m):
            for col in range(1, n):
                dp[col] += dp[col - 1]
        return dp[-1]`,
  64: `class Solution:
    def minPathSum(self, grid):
        cols = len(grid[0])
        dp = [float('inf')] * cols
        dp[0] = 0
        for row in grid:
            for col, value in enumerate(row):
                dp[col] = value + min(dp[col], dp[col - 1] if col else float('inf'))
        return dp[-1]`,
  5: `class Solution:
    def longestPalindrome(self, s):
        start = length = 0
        for center in range(len(s)):
            for left, right in ((center, center), (center, center + 1)):
                while left >= 0 and right < len(s) and s[left] == s[right]:
                    if right - left + 1 > length:
                        start, length = left, right - left + 1
                    left -= 1
                    right += 1
        return s[start:start + length]`,
  1143: `class Solution:
    def longestCommonSubsequence(self, text1, text2):
        dp = [0] * (len(text2) + 1)
        for char in text1:
            diagonal = 0
            for j, other in enumerate(text2, 1):
                previous = dp[j]
                dp[j] = diagonal + 1 if char == other else max(dp[j], dp[j - 1])
                diagonal = previous
        return dp[-1]`,
  72: `class Solution:
    def minDistance(self, word1, word2):
        dp = list(range(len(word2) + 1))
        for i, char in enumerate(word1, 1):
            diagonal, dp[0] = dp[0], i
            for j, other in enumerate(word2, 1):
                previous = dp[j]
                dp[j] = diagonal if char == other else 1 + min(diagonal, dp[j], dp[j - 1])
                diagonal = previous
        return dp[-1]`,
  136: `class Solution:
    def singleNumber(self, nums):
        result = 0
        for value in nums:
            result ^= value
        return result`,
  169: `class Solution:
    def majorityElement(self, nums):
        candidate = count = 0
        for value in nums:
            if count == 0:
                candidate = value
            count += 1 if value == candidate else -1
        return candidate`,
  75: `class Solution:
    def sortColors(self, nums):
        left = current = 0
        right = len(nums) - 1
        while current <= right:
            if nums[current] == 0:
                nums[left], nums[current] = nums[current], nums[left]
                left += 1
                current += 1
            elif nums[current] == 2:
                nums[right], nums[current] = nums[current], nums[right]
                right -= 1
            else:
                current += 1`,
  31: `class Solution:
    def nextPermutation(self, nums):
        i = len(nums) - 2
        while i >= 0 and nums[i] >= nums[i + 1]:
            i -= 1
        if i >= 0:
            j = len(nums) - 1
            while nums[j] <= nums[i]:
                j -= 1
            nums[i], nums[j] = nums[j], nums[i]
        left, right = i + 1, len(nums) - 1
        while left < right:
            nums[left], nums[right] = nums[right], nums[left]
            left += 1
            right -= 1`,
  287: `class Solution:
    def findDuplicate(self, nums):
        slow = fast = 0
        while True:
            slow, fast = nums[slow], nums[nums[fast]]
            if slow == fast:
                break
        entry = 0
        while entry != slow:
            entry, slow = nums[entry], nums[slow]
        return entry`,
};
