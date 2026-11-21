"""Execute only checked-in Hot 100 reference code against independent boundary fixtures."""
import json
import sys
from pathlib import Path


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


def linked(items):
    dummy = tail = ListNode()
    for item in items:
        tail.next = ListNode(item)
        tail = tail.next
    return dummy.next


def values(head):
    result, seen = [], set()
    while head:
        assert head not in seen, "unexpected cycle"
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


root = Path(__file__).resolve().parent
checks = {}
for filename in (
    'hot100-boundaries-a.py',
    'hot100-boundaries-b.py',
    'hot100-boundaries-c.py',
    'hot100-boundaries-d.py',
):
    namespace = {}
    path = root / filename
    exec(compile(path.read_text(encoding='utf-8'), str(path), 'exec'), namespace)
    checks.update(namespace['checks'])

if len(checks) != 100:
    raise SystemExit(f'expected 100 independent boundary fixtures, got {len(checks)}')

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: check-hot100-boundaries.py --list|QUESTION_ID')
    if sys.argv[1] == '--list':
        print(json.dumps(sorted(checks)))
        raise SystemExit(0)
    try:
        question_id = int(sys.argv[1])
    except ValueError:
        raise SystemExit('question ID must be an integer')
    if question_id not in checks:
        raise SystemExit(f'no boundary cases for Hot 100 question {question_id}')
    source = sys.stdin.read()
    if not source.strip():
        raise SystemExit('missing repository-owned Python reference code')
    scope = dict(ListNode=ListNode, TreeNode=TreeNode, Node=Node,
                 linked=linked, values=values, inorder=inorder, height=height)
    exec(compile(source, f'hot100-reference-{question_id}.py', 'exec'), scope)
    if 'Solution' in scope:
        scope['s'] = scope['Solution']()
    exec(compile(checks[question_id], f'hot100-boundary-{question_id}.py', 'exec'), scope)
