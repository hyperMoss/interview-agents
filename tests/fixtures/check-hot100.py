"""Host regression entry: repository-owned references only, never user input."""
import runpy
import sys
from pathlib import Path

shared = runpy.run_path(str(Path(__file__).resolve().parents[2] / 'packages/interview/src/hot100-checks.py'))
checks = shared['checks']
if __name__ == '__main__':
    if sys.argv[1] == '--list':
        import json
        print(json.dumps(sorted(checks)))
    else:
        question_id = int(sys.argv[1])
        scope = {key: shared[key] for key in ('ListNode', 'TreeNode', 'Node', 'linked', 'values', 'inorder', 'height')}
        exec(compile(sys.stdin.read(), f'hot100-{question_id}.py', 'exec'), scope)
        if 'Solution' in scope:
            scope['s'] = scope['Solution']()
        exec(compile(checks[question_id], f'checks-{question_id}.py', 'exec'), scope)
