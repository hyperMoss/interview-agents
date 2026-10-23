import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { formatDoctor, runDoctor } from '../scripts/doctor';

function listen(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
}

describe('safe startup doctor', () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); });

  it('reports invalid configuration names without exposing values or making paid requests', async () => {
    const secret = 'private-fixture-token-and-password';
    const checks = await runDoctor({ DATABASE_URL: `not-a-url-${secret}`, REDIS_URL: `https://user:${secret}@example.test`, API_PORT: '70000' });
    const rendered = formatDoctor(checks);
    expect(rendered).toContain('DATABASE_URL');
    expect(rendered).toContain('REDIS_URL');
    expect(rendered).toContain('API_PORT');
    expect(rendered).not.toContain(secret);
    expect(checks.some(check => check.name === 'API')).toBe(false);
  });

  it('checks health endpoints, ports and authenticated Redis PING without writes', async () => {
    const paths: string[] = [];
    const http = createHttpServer((request, response) => {
      paths.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
    });
    await listen(http);
    cleanup.push(() => new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve())));
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture address');
    let commands = '';
    const redis = createTcpServer(socket => {
      socket.on('data', chunk => { commands += chunk.toString(); if (commands.includes('PING')) socket.write('+OK\r\n+PONG\r\n'); });
    });
    await listen(redis);
    cleanup.push(() => new Promise<void>((resolve, reject) => redis.close(error => error ? reject(error) : resolve())));
    const redisAddress = redis.address();
    if (!redisAddress || typeof redisAddress === 'string') throw new Error('Missing Redis fixture address');
    const checks = await runDoctor({
      API_PORT: String(address.port), AGENT_URL: `http://127.0.0.1:${address.port}`, WEB_ORIGIN: `http://127.0.0.1:${address.port}`,
      REDIS_URL: `redis://fixture-user:private-redis-password@127.0.0.1:${redisAddress.port}`,
      DATABASE_URL: 'postgresql://fixture:private-db-password@127.0.0.1:1/unavailable',
    });
    expect(paths.sort()).toEqual(['/api/v1/health', '/health']);
    for (const name of ['前端端口', 'API 端口', 'Agent 端口', 'API', 'Agent', 'Redis']) {
      expect(checks.find(check => check.name === name)?.status).toBe('ok');
    }
    expect(checks.find(check => check.name === 'PostgreSQL')?.status).toBe('error');
    expect(commands).toBe('*3\r\n$4\r\nAUTH\r\n$12\r\nfixture-user\r\n$22\r\nprivate-redis-password\r\n*1\r\n$4\r\nPING\r\n');
    expect(formatDoctor(checks)).not.toMatch(/private-redis-password|private-db-password/);
  });

  it('does not mistake another HTTP service for a healthy API or Agent', async () => {
    const server = createHttpServer((_request, response) => { response.writeHead(200); response.end('unrelated service'); });
    await listen(server);
    cleanup.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture address');
    const checks = await runDoctor({ API_PORT: String(address.port), AGENT_URL: `http://127.0.0.1:${address.port}`, WEB_ORIGIN: `http://127.0.0.1:${address.port}`, DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/unavailable', REDIS_URL: 'redis://127.0.0.1:1' });
    expect(checks.find(check => check.name === 'API 端口')?.status).toBe('ok');
    expect(checks.find(check => check.name === 'API')?.status).toBe('error');
    expect(checks.find(check => check.name === 'Agent')?.status).toBe('error');
    expect(checks.find(check => check.name === 'Redis')?.status).toBe('error');
  });
});
