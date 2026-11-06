import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBossFixture } from './boss-site-fixture';

const SYSTEM_CHROME = '/Applications/Google Chrome.app';
// The command drives the installed Chrome through Patchright, so it needs the real browser.
const available = process.env.RUN_INTEGRATION === '1' && (existsSync(SYSTEM_CHROME) || process.env.PATCHRIGHT_CHROME === '1');
const suite = available ? describe : describe.skip;

// The maintained `pnpm boss:login` entry point, exercised against the synthetic site only. These cases
// check the command's own lifecycle decisions: an opened page that cannot be classified must stay open,
// while a genuine launch failure must report failure, clean up and never claim an opened session.
suite('boss:login command against the synthetic BOSS site', () => {
  let fixture: Awaited<ReturnType<typeof startBossFixture>>;
  let dataDir: string;
  const children: ChildProcess[] = [];

  beforeAll(async () => {
    fixture = await startBossFixture();
    fixture.state.loggedIn = true;
    dataDir = await mkdtemp(join(tmpdir(), 'boss-login-cli-'));
  }, 60000);

  afterAll(async () => {
    for (const child of children) if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
    await fixture?.close();
    // Chrome can still be flushing its profile when the signal returns; retry the temporary directory once.
    if (dataDir) await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }, 60000);

  function launch(settings: { owner: string; origin?: string; bareEntryPage?: boolean; slowEntry?: boolean }) {
    fixture.state.bareEntryPage = settings.bareEntryPage ?? false;
    fixture.state.slowEntry = settings.slowEntry ?? false;
    const args = ['--import', 'tsx', 'scripts/boss-login.ts', '--owner', settings.owner];
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CAREER_LOCAL_DATA_DIR: dataDir,
        BOSS_SITE_ORIGIN: settings.origin ?? fixture.origin,
        BOSS_BROWSER_ENGINE: 'patchright',
        BOSS_HEADED_FALLBACK: 'off',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const record = { child, out: '', err: '' };
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', chunk => { record.out += String(chunk); });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', chunk => { record.err += String(chunk); });
    children.push(child);
    return record;
  }

  async function until(record: ReturnType<typeof launch>, pattern: RegExp, timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const matched = pattern.exec(`${record.out}\n${record.err}`);
      if (matched) return matched;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`BOSS_LOGIN_TIMEOUT waiting for ${pattern} in:\n${record.out}\n${record.err}`);
  }

  function jsonOf(line: RegExpMatchArray) {
    return JSON.parse(line[1] ?? '{}') as Record<string, unknown>;
  }

  async function stop(record: ReturnType<typeof launch>) {
    const exited = new Promise<number | null>(resolve => record.child.once('exit', code => resolve(code)));
    record.child.kill('SIGTERM');
    return exited;
  }

  it('keeps an opened page it cannot classify and closes cleanly on a signal', async () => {
    const record = launch({ owner: crypto.randomUUID(), bareEntryPage: true });
    try {
      const opened = jsonOf(await until(record, /boss_login_opened (\{.*\})/));
      // The page loaded but matched no indicator: reported honestly as unknown, never as ready.
      expect(opened.state).toBe('unavailable');
      expect(opened.loadedPage).toBe(true);
      expect(opened.engine).toBe('patchright');
      expect(opened.humanWindow).toBe('open');
      // Production sending stays refused from this command as well.
      expect(opened.mutationsAllowed).toBe(false);
      expect(record.out).not.toContain('boss_login_failed');
      expect(record.err).toContain('页面已打开但选择器未能分类');
      // The controller stays alive holding the one window; the signal then closes it.
      expect(record.child.exitCode).toBeNull();
      expect(await stop(record)).toBe(0);
      expect(record.out).toContain('boss_login_closing');
    } finally {
      fixture.state.bareEntryPage = false;
      fixture.state.slowEntry = false;
    }
  }, 180000);

  it('reports a classified session and still holds one controller until a signal', async () => {
    const before = fixture.state.requests.length;
    const record = launch({ owner: crypto.randomUUID() });
    try {
      const opened = jsonOf(await until(record, /boss_login_opened (\{.*\})/));
      expect(opened.state).toBe('ready');
      expect(opened.accountObserved).toBe(true);
      expect(opened.mutationsAllowed).toBe(false);
      expect(record.child.exitCode).toBeNull();
      // Opening is a single navigation: this run requested the observed entry route exactly once.
      expect(fixture.state.requests.slice(before).filter(path => path === '/web/geek/jobs')).toHaveLength(1);
      expect(await stop(record)).toBe(0);
    } finally {
      fixture.state.bareEntryPage = false;
    }
  }, 180000);

  it('fails the open when the entry page commits but never reaches DOMContentLoaded', async () => {
    // The fixture commits headers and part of the document, then never ends the response. The browser sets
    // the URL, so a page-URL inference would call this success; the recorded lifecycle must not.
    const before = fixture.state.requests.length;
    const record = launch({ owner: crypto.randomUUID(), slowEntry: true });
    try {
      const code = await new Promise<number | null>(resolve => record.child.once('exit', resolve));
      // The entry really was requested and committed, yet the command reports a startup failure.
      expect(fixture.state.requests.slice(before)).toContain('/web/geek/job');
      expect(code).toBe(1);
      expect(record.out).not.toContain('boss_login_opened');
      const failed = jsonOf(await until(record, /boss_login_failed (\{.*\})/));
      expect(failed.code).toBe('BROWSER_UNAVAILABLE');
      expect(failed.stage).toBe('startup');
      expect(failed.initialNavigation).toBe('failed');
      // The failure text keeps host and path only: no scheme or challenge parameters reach the log.
      expect(String(failed.detail ?? '')).not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i);
      expect(record.out).toContain('boss_login_closing');
    } finally {
      fixture.state.slowEntry = false;
    }
  }, 180000);

  it('fails honestly with cleanup when the browser cannot reach the site at all', async () => {
    // An unused loopback port makes the initial navigation itself fail: a lifecycle failure, not a page.
    const record = launch({ owner: crypto.randomUUID(), origin: 'http://127.0.0.1:1' });
    const code = await new Promise<number | null>(resolve => record.child.once('exit', resolve));
    expect(code).toBe(1);
    expect(record.out).not.toContain('boss_login_opened');
    const failed = jsonOf(await until(record, /boss_login_failed (\{.*\})/));
    expect(failed.state).toBe('unavailable');
    expect(failed.code).toBe('BROWSER_UNAVAILABLE');
    expect(failed.stage).toBe('startup');
    // Failure still releases the controller and its lock instead of leaving a second owner behind.
    expect(record.out).toContain('boss_login_closing');
  }, 180000);
});
