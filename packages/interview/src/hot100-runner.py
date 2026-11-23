"""Browser runner, appended after shared checks. Not a security boundary.
The opaque-origin iframe / Worker and CSP enforce isolation.
"""
import json as _json
import traceback as _traceback
from typing import *
from collections import deque, defaultdict, Counter, OrderedDict
from functools import lru_cache, cache
from heapq import heappush, heappop, heapify
from math import inf


def run_hot100(question_id, code):
    scope = {key: globals()[key] for key in (
        'ListNode', 'TreeNode', 'Node', 'linked', 'values', 'inorder', 'height',
        'List', 'Optional', 'Tuple', 'Dict', 'Set', 'deque', 'defaultdict',
        'Counter', 'OrderedDict', 'lru_cache', 'cache', 'heappush', 'heappop',
        'heapify', 'inf')}
    try:
        exec(compile(code, 'solution.py', 'exec'), scope)
        if 'Solution' in scope:
            scope['s'] = scope['Solution']()
        exec(compile(checks[question_id], 'fixed-checks.py', 'exec'), scope)
        return _json.dumps({'status': 'passed', 'message': '本题固定用例全部通过；不代表 LeetCode 判题通过。'}, ensure_ascii=False)
    except BaseException as error:
        frames = _traceback.extract_tb(error.__traceback__)
        failed = next((frame.lineno for frame in reversed(frames) if frame.filename == 'fixed-checks.py'), None)
        check = checks[question_id].splitlines()[failed - 1] if failed else ''
        detail = ''.join(_traceback.format_exception_only(type(error), error))[:2000]
        return _json.dumps({'status': 'failed', 'message': detail, 'check': check[:2000]}, ensure_ascii=False)
