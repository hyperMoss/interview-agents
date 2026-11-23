"""Shared Hot 100 fixed checks; user code runs only in browser sandbox."""
import sys


class ListNode:
    def __init__(self, val=0, next=None):
        self.val, self.next = val, next


class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val, self.left, self.right = val, left, right


class Node(ListNode):
    def __init__(self, val=0, next=None, random=None):
        super().__init__(val, next)
        self.random = random


def linked(values):
    dummy = tail = ListNode()
    for value in values:
        tail.next = ListNode(value)
        tail = tail.next
    return dummy.next


def values(head):
    result, seen = [], set()
    while head:
        assert head not in seen, 'unexpected cycle'
        seen.add(head)
        result.append(head.val)
        head = head.next
    return result


def inorder(root):
    return inorder(root.left) + [root.val] + inorder(root.right) if root else []


def height(root):
    if root is None:
        return 0
    left, right = height(root.left), height(root.right)
    assert abs(left - right) <= 1
    return 1 + max(left, right)


# Fixed regressions include repeated values, negative numbers, singleton inputs,
# in-place updates, shared node identities, cycles, and stateful class operations.
checks = {
1: """
assert s.twoSum([2, 7, 11, 15], 9) == [0, 1]
assert s.twoSum([3, 3], 6) == [0, 1]
assert s.twoSum([-3, 4, 3, 90], 0) == [0, 2]
""",
49: """
assert sorted(map(sorted, s.groupAnagrams(['eat', 'tea', 'tan', 'ate', 'nat', 'bat']))) == [['ate', 'eat', 'tea'], ['bat'], ['nat', 'tan']]
assert s.groupAnagrams(['']) == [['']]
assert s.groupAnagrams(['a', 'a']) == [['a', 'a']]
""",
128: """
assert s.longestConsecutive([100, 4, 200, 1, 3, 2]) == 4
assert s.longestConsecutive([0, -1, -1, 1]) == 3
assert s.longestConsecutive([]) == 0
""",
283: """
a = [0, 1, 0, 3, 12]; s.moveZeroes(a); assert a == [1, 3, 12, 0, 0]
a = [0, 0]; s.moveZeroes(a); assert a == [0, 0]
a = [1]; s.moveZeroes(a); assert a == [1]
""",
11: """
assert s.maxArea([1, 8, 6, 2, 5, 4, 8, 3, 7]) == 49
assert s.maxArea([1, 1]) == 1
assert s.maxArea([0, 0]) == 0
""",
15: """
assert s.threeSum([-1, 0, 1, 2, -1, -4]) == [[-1, -1, 2], [-1, 0, 1]]
assert s.threeSum([0, 0, 0, 0]) == [[0, 0, 0]]
assert s.threeSum([0, 1, 1]) == []
""",
42: """
assert s.trap([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]) == 6
assert s.trap([4, 2, 0, 3, 2, 5]) == 9
assert s.trap([1]) == 0
""",
3: """
assert s.lengthOfLongestSubstring('abcabcbb') == 3
assert s.lengthOfLongestSubstring('abba') == 2
assert s.lengthOfLongestSubstring('一😀一二') == 3
assert s.lengthOfLongestSubstring('') == 0
""",
438: """
assert s.findAnagrams('cbaebabacd', 'abc') == [0, 6]
assert s.findAnagrams('abab', 'ab') == [0, 1, 2]
assert s.findAnagrams('a', 'aa') == []
""",
560: """
assert s.subarraySum([1, 1, 1], 2) == 2
assert s.subarraySum([1, -1, 1], 1) == 3
assert s.subarraySum([0, 0, 0], 0) == 6
""",
239: """
assert s.maxSlidingWindow([1, 3, -1, -3, 5, 3, 6, 7], 3) == [3, 3, 5, 5, 6, 7]
assert s.maxSlidingWindow([1, 1, 1], 2) == [1, 1]
assert s.maxSlidingWindow([4, 2], 1) == [4, 2]
assert s.maxSlidingWindow([4, 2], 2) == [4]
""",
76: """
assert s.minWindow('ADOBECODEBANC', 'ABC') == 'BANC'
assert s.minWindow('a', 'aa') == ''
assert s.minWindow('aa', 'aa') == 'aa'
assert s.minWindow('a', 'a') == 'a'
""",
53: """
assert s.maxSubArray([-2, 1, -3, 4, -1, 2, 1, -5, 4]) == 6
assert s.maxSubArray([-2, -1]) == -1
assert s.maxSubArray([1]) == 1
""",
56: """
assert s.merge([[1, 3], [2, 6], [8, 10], [15, 18]]) == [[1, 6], [8, 10], [15, 18]]
assert s.merge([[1, 4], [4, 5]]) == [[1, 5]]
assert s.merge([[1, 4], [2, 3]]) == [[1, 4]]
""",
189: """
a = [1, 2, 3, 4, 5, 6, 7]; s.rotate(a, 3); assert a == [5, 6, 7, 1, 2, 3, 4]
a = [1, 2]; s.rotate(a, 4); assert a == [1, 2]
a = [1]; s.rotate(a, 0); assert a == [1]
""",
238: """
assert s.productExceptSelf([1, 2, 3, 4]) == [24, 12, 8, 6]
assert s.productExceptSelf([-1, 1, 0, -3, 3]) == [0, 0, 9, 0, 0]
assert s.productExceptSelf([0, 0]) == [0, 0]
""",
41: """
assert s.firstMissingPositive([3, 4, -1, 1]) == 2
assert s.firstMissingPositive([1, 1]) == 2
assert s.firstMissingPositive([1, 2, 0]) == 3
assert s.firstMissingPositive([7, 8, 9]) == 1
""",
73: """
a = [[1, 1, 1], [1, 0, 1], [1, 1, 1]]; s.setZeroes(a); assert a == [[1, 0, 1], [0, 0, 0], [1, 0, 1]]
a = [[0, 1], [1, 1]]; s.setZeroes(a); assert a == [[0, 0], [0, 1]]
a = [[1, 0]]; s.setZeroes(a); assert a == [[0, 0]]
""",
54: """
assert s.spiralOrder([[1, 2, 3], [4, 5, 6], [7, 8, 9]]) == [1, 2, 3, 6, 9, 8, 7, 4, 5]
assert s.spiralOrder([[1, 2, 3]]) == [1, 2, 3]
assert s.spiralOrder([[1], [2]]) == [1, 2]
""",
48: """
a = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]; s.rotate(a); assert a == [[7, 4, 1], [8, 5, 2], [9, 6, 3]]
a = [[1]]; s.rotate(a); assert a == [[1]]
""",
240: """
assert s.searchMatrix([[1, 4, 7], [2, 5, 8], [3, 6, 9]], 6)
assert not s.searchMatrix([[1, 4], [2, 5]], 3)
assert s.searchMatrix([[1]], 1)
""",
160: """
shared = linked([8, 4, 5]); a = ListNode(4, ListNode(1, shared)); b = ListNode(5, shared)
assert s.getIntersectionNode(a, b) is shared
assert s.getIntersectionNode(linked([1]), linked([1])) is None
assert s.getIntersectionNode(None, None) is None
""",
206: """
head = linked([1, 2, 3]); original = head; reversed_head = s.reverseList(head)
assert values(reversed_head) == [3, 2, 1] and original.next is None
assert s.reverseList(None) is None
""",
234: """
head = linked([1, 2, 2, 1]); assert s.isPalindrome(head); assert values(head) == [1, 2, 2, 1]
head = linked([1, 2]); assert not s.isPalindrome(head); assert values(head) == [1, 2]
assert s.isPalindrome(linked([1]))
""",
141: """
a = ListNode(1); a.next = a; assert s.hasCycle(a)
assert not s.hasCycle(linked([1, 2, 3]))
assert not s.hasCycle(None)
""",
142: """
a = linked([3, 2, 0, -4]); entry = a.next; a.next.next.next.next = entry
assert s.detectCycle(a) is entry
assert s.detectCycle(linked([1, 2])) is None
b = ListNode(1); b.next = b; assert s.detectCycle(b) is b
""",
21: """
assert values(s.mergeTwoLists(linked([1, 2, 4]), linked([1, 3, 4]))) == [1, 1, 2, 3, 4, 4]
a = linked([1]); assert s.mergeTwoLists(None, a) is a
assert s.mergeTwoLists(None, None) is None
""",
2: """
assert values(s.addTwoNumbers(linked([2, 4, 3]), linked([5, 6, 4]))) == [7, 0, 8]
assert values(s.addTwoNumbers(linked([9, 9]), linked([1]))) == [0, 0, 1]
assert values(s.addTwoNumbers(linked([0]), linked([0]))) == [0]
""",
19: """
assert values(s.removeNthFromEnd(linked([1, 2, 3, 4, 5]), 2)) == [1, 2, 3, 5]
assert s.removeNthFromEnd(linked([1]), 1) is None
assert values(s.removeNthFromEnd(linked([1, 2]), 2)) == [2]
""",
24: """
assert values(s.swapPairs(linked([1, 2, 3, 4]))) == [2, 1, 4, 3]
assert values(s.swapPairs(linked([1, 2, 3]))) == [2, 1, 3]
assert s.swapPairs(None) is None
""",
25: """
assert values(s.reverseKGroup(linked([1, 2, 3, 4, 5]), 2)) == [2, 1, 4, 3, 5]
assert values(s.reverseKGroup(linked([1, 2, 3, 4, 5]), 3)) == [3, 2, 1, 4, 5]
assert values(s.reverseKGroup(linked([1]), 1)) == [1]
""",
138: """
a, b = Node(7), Node(13); a.next = b; a.random = b; b.random = b
copy = s.copyRandomList(a)
assert copy is not a and copy.next is not b
assert values(copy) == [7, 13] and copy.random is copy.next and copy.next.random is copy.next
assert a.next is b and a.random is b
assert s.copyRandomList(None) is None
""",
148: """
assert values(s.sortList(linked([4, 2, 1, 3]))) == [1, 2, 3, 4]
assert values(s.sortList(linked([-1, 5, 3, 3, 0]))) == [-1, 0, 3, 3, 5]
assert s.sortList(None) is None
""",
23: """
assert values(s.mergeKLists([linked([1, 4, 5]), linked([1, 3, 4]), linked([2, 6])])) == [1, 1, 2, 3, 4, 4, 5, 6]
assert s.mergeKLists([]) is None
assert s.mergeKLists([None]) is None
""",
146: """
c = LRUCache(2); c.put(1, 1); c.put(2, 2); assert c.get(1) == 1
c.put(3, 3); assert c.get(2) == -1
c.put(1, 10); c.put(4, 4); assert c.get(3) == -1 and c.get(1) == 10
c = LRUCache(1); c.put(1, 1); c.put(2, 2); assert c.get(1) == -1 and c.get(2) == 2
""",
94: """
assert s.inorderTraversal(TreeNode(1, None, TreeNode(2, TreeNode(3)))) == [1, 3, 2]
assert s.inorderTraversal(None) == []
""",
104: """
assert s.maxDepth(TreeNode(3, TreeNode(9), TreeNode(20, TreeNode(15), TreeNode(7)))) == 3
assert s.maxDepth(None) == 0
""",
226: """
root = TreeNode(2, TreeNode(1), TreeNode(3)); original = root.left
assert s.invertTree(root) is root and root.right is original and inorder(root) == [3, 2, 1]
assert s.invertTree(None) is None
""",
101: """
assert s.isSymmetric(TreeNode(1, TreeNode(2, TreeNode(3)), TreeNode(2, None, TreeNode(3))))
assert not s.isSymmetric(TreeNode(1, TreeNode(2, None, TreeNode(3)), TreeNode(2, None, TreeNode(3))))
assert s.isSymmetric(None)
""",
543: """
assert s.diameterOfBinaryTree(TreeNode(1, TreeNode(2, TreeNode(4), TreeNode(5)), TreeNode(3))) == 3
assert s.diameterOfBinaryTree(TreeNode(1)) == 0
""",
102: """
assert s.levelOrder(TreeNode(3, TreeNode(9), TreeNode(20, TreeNode(15), TreeNode(7)))) == [[3], [9, 20], [15, 7]]
assert s.levelOrder(None) == []
""",
108: """
root = s.sortedArrayToBST([-10, -3, 0, 5, 9]); assert inorder(root) == [-10, -3, 0, 5, 9]; height(root)
assert inorder(s.sortedArrayToBST([1])) == [1]
""",
98: """
assert s.isValidBST(TreeNode(2, TreeNode(1), TreeNode(3)))
assert not s.isValidBST(TreeNode(5, TreeNode(1), TreeNode(4, TreeNode(3), TreeNode(6))))
assert not s.isValidBST(TreeNode(2, TreeNode(2)))
""",
230: """
root = TreeNode(3, TreeNode(1, None, TreeNode(2)), TreeNode(4))
assert s.kthSmallest(root, 1) == 1
assert s.kthSmallest(root, 4) == 4
""",
199: """
assert s.rightSideView(TreeNode(1, TreeNode(2, None, TreeNode(5)), TreeNode(3, None, TreeNode(4)))) == [1, 3, 4]
assert s.rightSideView(None) == []
""",
114: """
root = TreeNode(1, TreeNode(2, TreeNode(3), TreeNode(4)), TreeNode(5, None, TreeNode(6)))
s.flatten(root); result = []
while root:
    assert root.left is None
    result.append(root.val); root = root.right
assert result == [1, 2, 3, 4, 5, 6]
s.flatten(None)
""",
105: """
root = s.buildTree([3, 9, 20, 15, 7], [9, 3, 15, 20, 7]); assert inorder(root) == [9, 3, 15, 20, 7]
assert root.val == 3 and root.right.val == 20 and root.right.left.val == 15
assert s.buildTree([-1], [-1]).val == -1
""",
437: """
root = TreeNode(10, TreeNode(5, TreeNode(3, TreeNode(3), TreeNode(-2)), TreeNode(2, None, TreeNode(1))), TreeNode(-3, None, TreeNode(11)))
assert s.pathSum(root, 8) == 3
assert s.pathSum(TreeNode(0, TreeNode(0), TreeNode(0)), 0) == 5
assert s.pathSum(None, 1) == 0
""",
236: """
p, q = TreeNode(5), TreeNode(1); root = TreeNode(3, p, q)
assert s.lowestCommonAncestor(root, p, q) is root
p.left = TreeNode(6); assert s.lowestCommonAncestor(root, p, p.left) is p
""",
124: """
assert s.maxPathSum(TreeNode(-10, TreeNode(9), TreeNode(20, TreeNode(15), TreeNode(7)))) == 42
assert s.maxPathSum(TreeNode(-3)) == -3
assert s.maxPathSum(TreeNode(2, TreeNode(-1))) == 2
""",
200: """
assert s.numIslands([list('110'), list('010'), list('001')]) == 2
assert s.numIslands([list('0')]) == 0
assert s.numIslands([list('1')]) == 1
""",
994: """
assert s.orangesRotting([[2, 1, 1], [1, 1, 0], [0, 1, 1]]) == 4
assert s.orangesRotting([[2, 1, 1], [0, 1, 1], [1, 0, 1]]) == -1
assert s.orangesRotting([[0, 2]]) == 0
""",
207: """
assert s.canFinish(2, [[1, 0]])
assert not s.canFinish(2, [[1, 0], [0, 1]])
assert not s.canFinish(1, [[0, 0]])
assert s.canFinish(3, [])
""",
208: """
t = Trie(); t.insert('apple'); assert t.search('apple') and not t.search('app')
assert t.startsWith('app') and not t.startsWith('b')
t.insert('app'); assert t.search('app'); t.insert('apple'); assert t.search('apple')
""",
46: """
assert sorted(s.permute([1, 2, 3])) == [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]]
assert s.permute([0]) == [[0]]
""",
78: """
assert sorted(s.subsets([1, 2])) == [[], [1], [1, 2], [2]]
assert s.subsets([0]) == [[], [0]]
""",
17: """
assert s.letterCombinations('23') == ['ad', 'ae', 'af', 'bd', 'be', 'bf', 'cd', 'ce', 'cf']
assert s.letterCombinations('') == []
assert len(s.letterCombinations('79')) == 16
""",
39: """
assert s.combinationSum([2, 3, 6, 7], 7) == [[2, 2, 3], [7]]
assert s.combinationSum([2], 1) == []
assert s.combinationSum([2, 3, 5], 8) == [[2, 2, 2, 2], [2, 3, 3], [3, 5]]
""",
22: """
assert sorted(s.generateParenthesis(3)) == ['((()))', '(()())', '(())()', '()(())', '()()()']
assert s.generateParenthesis(1) == ['()']
""",
79: """
board = [list('ABCE'), list('SFCS'), list('ADEE')]
assert s.exist(board, 'ABCCED')
assert not s.exist(board, 'ABCB')
assert board == [list('ABCE'), list('SFCS'), list('ADEE')]
assert s.exist([['a']], 'a')
""",
131: """
assert s.partition('aab') == [['a', 'a', 'b'], ['aa', 'b']]
assert s.partition('a') == [['a']]
""",
51: """
assert s.solveNQueens(1) == [['Q']]
assert s.solveNQueens(2) == []
assert len(s.solveNQueens(4)) == 2
for board in s.solveNQueens(4):
    cols = [row.index('Q') for row in board]
    assert len(set(cols)) == 4
    assert len({r - c for r, c in enumerate(cols)}) == 4
    assert len({r + c for r, c in enumerate(cols)}) == 4
""",
35: """
assert s.searchInsert([1, 3, 5, 6], 5) == 2
assert s.searchInsert([1, 3, 5, 6], 2) == 1
assert s.searchInsert([1, 3], 9) == 2
assert s.searchInsert([1], 0) == 0
""",
74: """
assert s.searchMatrix([[1, 3, 5], [7, 9, 11]], 9)
assert not s.searchMatrix([[1, 3, 5], [7, 9, 11]], 6)
assert not s.searchMatrix([[1]], 2)
""",
34: """
assert s.searchRange([5, 7, 7, 8, 8, 10], 8) == [3, 4]
assert s.searchRange([], 0) == [-1, -1]
assert s.searchRange([2, 2], 2) == [0, 1]
assert s.searchRange([1], 2) == [-1, -1]
""",
33: """
assert s.search([4, 5, 6, 7, 0, 1, 2], 0) == 4
assert s.search([4, 5, 6, 7, 0, 1, 2], 3) == -1
assert s.search([1], 0) == -1
assert s.search([3, 1], 1) == 1
""",
153: """
assert s.findMin([3, 4, 5, 1, 2]) == 1
assert s.findMin([1, 2, 3]) == 1
assert s.findMin([1]) == 1
""",
4: """
assert s.findMedianSortedArrays([1, 3], [2]) == 2
assert s.findMedianSortedArrays([1, 2], [3, 4]) == 2.5
assert s.findMedianSortedArrays([], [1]) == 1
assert s.findMedianSortedArrays([0, 0], [0, 0]) == 0
""",
20: """
assert s.isValid('()[]{}')
assert not s.isValid('(]')
assert not s.isValid('([)]')
assert not s.isValid(']')
""",
155: """
m = MinStack(); m.push(-2); m.push(0); m.push(-3); assert m.getMin() == -3
m.pop(); assert m.top() == 0 and m.getMin() == -2
m.push(-2); m.pop(); assert m.getMin() == -2
""",
394: """
assert s.decodeString('3[a2[c]]') == 'accaccacc'
assert s.decodeString('12[a]bc') == 'a' * 12 + 'bc'
assert s.decodeString('2[abc]3[cd]ef') == 'abcabccdcdcdef'
""",
739: """
assert s.dailyTemperatures([73, 74, 75, 71, 69, 72, 76, 73]) == [1, 1, 4, 2, 1, 1, 0, 0]
assert s.dailyTemperatures([40, 40, 30]) == [0, 0, 0]
""",
84: """
assert s.largestRectangleArea([2, 1, 5, 6, 2, 3]) == 10
assert s.largestRectangleArea([2, 2]) == 4
assert s.largestRectangleArea([0]) == 0
assert s.largestRectangleArea([1, 2, 3]) == 4
""",
215: """
assert s.findKthLargest([3, 2, 1, 5, 6, 4], 2) == 5
assert s.findKthLargest([3, 2, 3, 1, 2, 4, 5, 5, 6], 4) == 4
assert s.findKthLargest([-1, -2], 2) == -2
""",
347: """
assert set(s.topKFrequent([1, 1, 1, 2, 2, 3], 2)) == {1, 2}
assert s.topKFrequent([1], 1) == [1]
assert s.topKFrequent([-1, -1, 2], 1) == [-1]
""",
295: """
m = MedianFinder(); m.addNum(1); m.addNum(2); assert m.findMedian() == 1.5
m.addNum(3); assert m.findMedian() == 2
m = MedianFinder()
for value in [-1, -2, -3, -4]: m.addNum(value)
assert m.findMedian() == -2.5
""",
121: """
assert s.maxProfit([7, 1, 5, 3, 6, 4]) == 5
assert s.maxProfit([7, 6, 4, 3, 1]) == 0
assert s.maxProfit([1]) == 0
""",
55: """
assert s.canJump([2, 3, 1, 1, 4])
assert not s.canJump([3, 2, 1, 0, 4])
assert s.canJump([0])
""",
45: """
assert s.jump([2, 3, 1, 1, 4]) == 2
assert s.jump([2, 3, 0, 1, 4]) == 2
assert s.jump([0]) == 0
""",
763: """
assert s.partitionLabels('ababcbacadefegdehijhklij') == [9, 7, 8]
assert s.partitionLabels('eccbbbbdec') == [10]
assert s.partitionLabels('abc') == [1, 1, 1]
""",
70: """
assert s.climbStairs(1) == 1
assert s.climbStairs(2) == 2
assert s.climbStairs(5) == 8
""",
118: """
assert s.generate(1) == [[1]]
assert s.generate(5) == [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1], [1, 4, 6, 4, 1]]
""",
198: """
assert s.rob([1, 2, 3, 1]) == 4
assert s.rob([2, 7, 9, 3, 1]) == 12
assert s.rob([0]) == 0
""",
279: """
assert s.numSquares(12) == 3
assert s.numSquares(13) == 2
assert s.numSquares(1) == 1
assert s.numSquares(100) == 1
""",
322: """
assert s.coinChange([1, 2, 5], 11) == 3
assert s.coinChange([2], 3) == -1
assert s.coinChange([1], 0) == 0
""",
139: """
assert s.wordBreak('leetcode', ['leet', 'code'])
assert s.wordBreak('applepenapple', ['apple', 'pen'])
assert not s.wordBreak('catsandog', ['cats', 'dog', 'sand', 'and', 'cat'])
""",
300: """
assert s.lengthOfLIS([10, 9, 2, 5, 3, 7, 101, 18]) == 4
assert s.lengthOfLIS([7, 7, 7]) == 1
assert s.lengthOfLIS([-2, -1]) == 2
""",
152: """
assert s.maxProduct([2, 3, -2, 4]) == 6
assert s.maxProduct([-2, 0, -1]) == 0
assert s.maxProduct([-2, 3, -4]) == 24
assert s.maxProduct([-2]) == -2
""",
416: """
assert s.canPartition([1, 5, 11, 5])
assert not s.canPartition([1, 2, 3, 5])
assert not s.canPartition([1, 2, 5])
assert s.canPartition([1, 1])
""",
32: """
assert s.longestValidParentheses('(()') == 2
assert s.longestValidParentheses(')()())') == 4
assert s.longestValidParentheses('') == 0
assert s.longestValidParentheses('()(())') == 6
""",
62: """
assert s.uniquePaths(3, 7) == 28
assert s.uniquePaths(1, 1) == 1
assert s.uniquePaths(1, 4) == 1
""",
64: """
assert s.minPathSum([[1, 3, 1], [1, 5, 1], [4, 2, 1]]) == 7
assert s.minPathSum([[1, 2, 3], [4, 5, 6]]) == 12
assert s.minPathSum([[0]]) == 0
""",
5: """
assert s.longestPalindrome('babad') in ('bab', 'aba')
assert s.longestPalindrome('cbbd') == 'bb'
assert s.longestPalindrome('a') == 'a'
assert s.longestPalindrome('aaaa') == 'aaaa'
""",
1143: """
assert s.longestCommonSubsequence('abcde', 'ace') == 3
assert s.longestCommonSubsequence('abc', 'def') == 0
assert s.longestCommonSubsequence('aaaa', 'aa') == 2
""",
72: """
assert s.minDistance('horse', 'ros') == 3
assert s.minDistance('', 'abc') == 3
assert s.minDistance('abc', '') == 3
assert s.minDistance('same', 'same') == 0
""",
136: """
assert s.singleNumber([4, 1, 2, 1, 2]) == 4
assert s.singleNumber([-1, 2, 2]) == -1
""",
169: """
assert s.majorityElement([3, 2, 3]) == 3
assert s.majorityElement([2, 2, 1, 1, 1, 2, 2]) == 2
assert s.majorityElement([1]) == 1
""",
75: """
a = [2, 0, 2, 1, 1, 0]; s.sortColors(a); assert a == [0, 0, 1, 1, 2, 2]
a = [2, 0, 1]; s.sortColors(a); assert a == [0, 1, 2]
a = [2, 2]; s.sortColors(a); assert a == [2, 2]
""",
31: """
a = [1, 2, 3]; s.nextPermutation(a); assert a == [1, 3, 2]
a = [3, 2, 1]; s.nextPermutation(a); assert a == [1, 2, 3]
a = [1, 1, 5]; s.nextPermutation(a); assert a == [1, 5, 1]
a = [1]; s.nextPermutation(a); assert a == [1]
""",
287: """
assert s.findDuplicate([1, 3, 4, 2, 2]) == 2
assert s.findDuplicate([3, 1, 3, 4, 2]) == 3
assert s.findDuplicate([3, 3, 3, 3, 3]) == 3
""",
}

