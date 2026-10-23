import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import { connect as connectTls } from 'node:tls';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { z } from 'zod';

export type DoctorCheck = {
  name: string;
  status: 'ok' | 'error';
  detail: string;
  fix?: string;
};

const timeoutMs = 2500;
const healthSchema = z.object({ status: z.literal('ok') });
const portSchema = z.coerce.number().int().min(1).max(65535);
const configSchema = z.object({
  API_PORT: portSchema.default(3000),
  AGENT_PORT: portSchema.default(4111),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  AGENT_URL: z.url().default('http://127.0.0.1:4111'),
  DATABASE_URL: z.url().default('postgresql://app:local-app-password@127.0.0.1:55439/interview'),
  REDIS_URL: z.url().default('redis://127.0.0.1:56389'),
}).superRefine((config, context) => {
  for (const [key, protocols] of [
    ['WEB_ORIGIN', ['http:', 'https:']], ['AGENT_URL', ['http:', 'https:']],
    ['DATABASE_URL', ['postgres:', 'postgresql:']], ['REDIS_URL', ['redis:', 'rediss:']],
  ] satisfies [keyof Pick<typeof config, 'WEB_ORIGIN' | 'AGENT_URL' | 'DATABASE_URL' | 'REDIS_URL'>, string[]][]) {
    if (URL.canParse(config[key]) && !protocols.includes(new URL(config[key]).protocol)) context.addIssue({ code: 'custom', path: [key], message: 'Invalid protocol' });
  }
});

function hostname(url: URL) { return url.hostname.replace(/^\[|\]$/g, ''); }

function runtimeCheck(command: 'pnpm' | 'bun', fix: string): Promise<DoctorCheck> {
  return new Promise(resolve => {
    execFile(command, ['--version'], { timeout: timeoutMs, maxBuffer: 4096 }, (error, stdout) => {
      const version = stdout.trim();
      resolve(!error && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)
        ? { name: command, status: 'ok', detail: version }
        : { name: command, status: 'error', detail: '未找到可用的运行时，或命令执行超时。', fix });
    });
  });
}

async function tcpCheck(name: string, host: string, port: number, fix: string): Promise<DoctorCheck> {
  const available = await new Promise<boolean>(resolve => {
    const socket = connect({ host, port });
    const finish = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
  return available ? { name, status: 'ok', detail: `端口 ${port} 已监听。` }
    : { name, status: 'error', detail: `端口 ${port} 未响应。`, fix };
}

async function httpCheck(name: string, url: URL, fix: string): Promise<DoctorCheck> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    if (response.ok && healthSchema.safeParse(await response.json()).success) return { name, status: 'ok', detail: '健康检查通过。' };
  } catch { }
  return { name, status: 'error', detail: '健康检查失败，服务可能未启动或依赖尚未就绪。', fix };
}

async function postgresCheck(connectionString: string): Promise<DoctorCheck> {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs });
  pool.on('error', () => {});
  try {
    await pool.query('SELECT 1');
    return { name: 'PostgreSQL', status: 'ok', detail: '连接、身份认证与只读查询通过。' };
  } catch {
    return { name: 'PostgreSQL', status: 'error', detail: '连接或身份认证失败。', fix: '检查 DATABASE_URL；本机依赖可运行 docker compose -f infra/compose.yaml up -d --wait。' };
  } finally { await pool.end(); }
}

function redisCommand(parts: string[]) {
  return `*${parts.length}\r\n${parts.map(part => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`;
}

async function redisCheck(url: URL): Promise<DoctorCheck> {
  let available = false;
  try {
    const password = decodeURIComponent(url.password);
    const username = decodeURIComponent(url.username);
    const commands = password ? [redisCommand(username ? ['AUTH', username, password] : ['AUTH', password]), redisCommand(['PING'])] : [redisCommand(['PING'])];
    available = await new Promise<boolean>(resolve => {
      const host = hostname(url);
      const options = { host, port: Number(url.port || 6379) };
      const socket = url.protocol === 'rediss:' ? connectTls({ ...options, servername: host }) : connect(options);
      const finish = (ok: boolean) => { socket.destroy(); resolve(ok); };
      let response = '';
      socket.setTimeout(timeoutMs);
      socket.once(url.protocol === 'rediss:' ? 'secureConnect' : 'connect', () => socket.write(commands.join('')));
      socket.on('data', chunk => {
        response += chunk.toString('utf8');
        if (response.length > 4096 || response.startsWith('-')) finish(false);
        else if (response.endsWith('+PONG\r\n')) finish(password ? response.startsWith('+OK\r\n') : true);
      });
      socket.once('error', () => finish(false));
      socket.once('timeout', () => finish(false));
      socket.once('end', () => finish(false));
    });
  } catch { }
  return available ? { name: 'Redis', status: 'ok', detail: 'PING 响应通过。' }
    : { name: 'Redis', status: 'error', detail: '连接、身份认证或 PING 响应失败。', fix: '检查 REDIS_URL；本机依赖可运行 docker compose -f infra/compose.yaml up -d --wait。' };
}

export async function runDoctor(env: NodeJS.ProcessEnv = process.env): Promise<DoctorCheck[]> {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const nodeSupported = major > 22 || major === 22 && minor >= 16;
  const checks: DoctorCheck[] = [{ name: 'Node.js', status: nodeSupported ? 'ok' : 'error', detail: process.versions.node,
    ...(!nodeSupported ? { fix: '安装 Node.js 22.16 或更高版本，再运行 pnpm install。' } : {}) }];
  checks.push(...await Promise.all([
    runtimeCheck('pnpm', '运行 corepack enable，再运行 corepack prepare pnpm@12.11.2 --activate。'),
    runtimeCheck('bun', '先运行 pnpm install；若项目内 Bun 不可用，再运行 pnpm runtime:setup。'),
  ]));
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map(issue => String(issue.path[0] ?? '配置')))];
    checks.push({ name: '服务配置', status: 'error', detail: `以下配置格式无效：${fields.join('、')}。`, fix: '参考 .env.example 修正对应变量。诊断不会显示变量值。' });
    return checks;
  }
  const config = result.data;
  const agent = new URL(config.AGENT_URL);
  const web = new URL(config.WEB_ORIGIN);
  const api = new URL(`http://127.0.0.1:${config.API_PORT}`);
  checks.push(...await Promise.all([
    tcpCheck('前端端口', hostname(web), Number(web.port || (web.protocol === 'https:' ? 443 : 80)), '运行 pnpm dev:web。'),
    tcpCheck('API 端口', '127.0.0.1', config.API_PORT, '运行 pnpm dev:api。'),
    tcpCheck('Agent 端口', hostname(agent), Number(agent.port || (agent.protocol === 'https:' ? 443 : 80)), '运行 pnpm dev:agent，并核对 AGENT_URL。'),
    httpCheck('API', new URL('/api/v1/health', api), '查看 pnpm dev:api 的错误，并确认 PostgreSQL 已就绪。'),
    httpCheck('Agent', new URL('/health', agent), '查看 pnpm dev:agent 的错误，并确认 Agent 数据库权限与迁移已就绪。'),
    postgresCheck(config.DATABASE_URL),
    redisCheck(new URL(config.REDIS_URL)),
  ]));
  return checks;
}

export function formatDoctor(checks: DoctorCheck[]) {
  return checks.map(check => `${check.status === 'ok' ? '✓' : '✗'} ${check.name}：${check.detail}${check.fix ? `\n  修复：${check.fix}` : ''}`).join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const checks = await runDoctor();
  process.stdout.write(`${formatDoctor(checks)}\n\n仅检查运行时、端口和服务连通性；未启动服务，未调用模型或联网搜索。\n`);
  process.exitCode = checks.some(check => check.status === 'error') ? 1 : 0;
}
