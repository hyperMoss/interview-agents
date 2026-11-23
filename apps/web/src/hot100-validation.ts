import checks from '../../../packages/interview/src/hot100-checks.py?raw';
import runner from '../../../packages/interview/src/hot100-runner.py?raw';

export type ValidationResult = { status: 'passed' | 'failed' | 'error'; message: string; check?: string };
export const pythonRuntimeUrl = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';

// This worker lives in an opaque origin, never in the application's origin.
const workerSource = `
let port;
onmessage = async event => {
  port = event.ports[0];
  try {
    importScripts(${JSON.stringify(pythonRuntimeUrl + 'pyodide.js')});
    const py = await loadPyodide({ indexURL: ${JSON.stringify(pythonRuntimeUrl)}, stdout: () => {}, stderr: () => {} });
    await py.runPythonAsync(event.data.harness);
    py.globals.set('question_id', event.data.questionId);
    py.globals.set('user_code', event.data.code);
    port.postMessage({ phase: 'running' });
    const result = py.runPython('run_hot100(question_id, user_code)');
    port.postMessage({ phase: 'done', result: JSON.parse(result) });
  } catch (_) {
    port.postMessage({ phase: 'done', result: { status: 'error', message: 'Python 运行时加载或执行失败，请检查网络后重试。' } });
  }
};`;

export function sandboxDocument() {
  // No same-origin permission; no app cookies/storage/DOM, no API connections.
  // Runtime assets alone are allowed from the pinned CDN path.
  const csp = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: ${pythonRuntimeUrl}; worker-src blob:; connect-src ${pythonRuntimeUrl};`;
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script>
const workerSource = ${JSON.stringify(workerSource).replace(/</g, '\\u003c')};
let started = false;
addEventListener('message', event => {
  if (started || event.source !== parent || !event.ports[0]) return;
  started = true;
  const worker = new Worker(URL.createObjectURL(new Blob([workerSource], {type:'text/javascript'})));
  worker.postMessage(event.data, [event.ports[0]]);
});
</script>`;
}

export function validateHot100(questionId: number, code: string, onPhase: (phase: 'loading' | 'running') => void): { result: Promise<ValidationResult>; cancel: () => void } {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.title = 'Python 固定用例隔离执行';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  const channel = new MessageChannel();
  let settle: (value: ValidationResult) => void;
  let finished = false;
  let timer: ReturnType<typeof setTimeout>;
  const result = new Promise<ValidationResult>(resolve => { settle = resolve; });
  const finish = (value: ValidationResult) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    channel.port1.close();
    channel.port2.close();
    frame.remove();
    settle(value);
  };
  const timeout = () => finish({ status: 'error', message: '验证超时，已销毁执行环境。请检查循环或网络后重试。' });
  onPhase('loading');
  timer = setTimeout(timeout, 60000);
  channel.port1.onmessage = event => {
    if (event.data?.phase === 'running') {
      clearTimeout(timer);
      timer = setTimeout(timeout, 5000);
      onPhase('running');
    } else if (event.data?.phase === 'done') {
      const value = event.data.result;
      if (value && ['passed', 'failed', 'error'].includes(value.status) && typeof value.message === 'string') {
        finish({ status: value.status, message: value.message.slice(0, 2000), check: typeof value.check === 'string' ? value.check.slice(0, 2000) : undefined });
      }
    }
  };
  frame.onload = () => frame.contentWindow?.postMessage({ questionId, code, harness: checks + '\n' + runner }, '*', [channel.port2]);
  frame.srcdoc = sandboxDocument();
  document.body.append(frame);
  return { result, cancel: () => finish({ status: 'error', message: '已取消验证。' }) };
}
