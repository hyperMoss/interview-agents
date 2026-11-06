import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BossBrowser, BrowserUnavailable, liveBossProfile } from '../apps/worker/src/boss-browser';
import type { NativeFilterEvidence, SearchCard } from '../apps/worker/src/boss-browser';
import type { CareerPolicy } from '../packages/contracts/src/career';
import { startBossFixture } from './boss-site-fixture';

/** The synthetic site is not owner-scoped; the scan still carries an explicit observation scope. */
const FIXTURE_SCAN_SCOPE = { owner: 'fixture-owner', taskRevision: 0, sessionGeneration: 0 };

/** Drains the streamed searches into one list for the synthetic assertions below; the Worker itself reads each
 *  search's cards while that search is still current. */
async function collectSearches(browser: BossBrowser, policy: CareerPolicy, limit: number) {
  const cards: SearchCard[] = [];
  const evidence: NativeFilterEvidence[] = [];
  const seen = new Set<string>();
  for await (const batch of browser.searchPostings(policy, limit, FIXTURE_SCAN_SCOPE)) {
    evidence.push(batch.evidence);
    for (const card of batch.cards) {
      if (cards.length >= limit) return { evidence, cards };
      if (!card.sitePostingId || seen.has(card.sitePostingId)) continue;
      seen.add(card.sitePostingId);
      cards.push(card);
    }
  }
  return { evidence, cards };
}

const SYSTEM_CHROME = '/Applications/Google Chrome.app';
// Patchright drives the installed Chrome, so this suite needs the real browser on the host machine.
const available = process.env.RUN_INTEGRATION === '1' && (existsSync(SYSTEM_CHROME) || process.env.PATCHRIGHT_CHROME === '1');
const suite = available ? describe : describe.skip;

const policy: CareerPolicy = { roleTargets: ['fullstack'], cities: ['广州'], salaryUpperMinCnyMonthly: 18000, preferAiApplication: true, companyBlacklistKeywords: [] };
const greeting = '您好，我在简历中说明了全栈项目中的接口与数据建模经历，希望进一步沟通这个岗位。';

// Patchright + the installed Chrome as one headed persistent session against the synthetic BOSS-like
// fixture. Every assertion below counts real fixture HTTP requests or real browser state; nothing here
// is a mocked adapter return value, and no real BOSS page is contacted.

suite('patchright owned session against the synthetic BOSS site', () => {
  let fixture: Awaited<ReturnType<typeof startBossFixture>>;
  let dataDir: string;

  beforeAll(async () => {
    fixture = await startBossFixture();
    // The site starts logged out; only the private profile may hold a session cookie.
    fixture.state.loggedIn = false;
    dataDir = await mkdtemp(join(tmpdir(), 'career-patchright-'));
  }, 60000);

  afterAll(async () => {
    await fixture?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  }, 60000);

  function options(settings: { engine?: 'patchright' | 'playwright'; directory?: string; verified?: boolean } = {}) {
    return {
      engine: settings.engine ?? 'patchright' as const,
      origin: fixture.origin,
      profile: settings.verified === false ? liveBossProfile(fixture.origin) : fixture.profile,
      profileDirectory: settings.directory ?? join(dataDir, 'patchright-profile'),
      moliExecutable: 'moli',
      headedFallback: false,
    };
  }

  function requestsFor(pathname: string) {
    return fixture.state.requests.filter(path => path === pathname).length;
  }

  function detailReads() {
    return fixture.state.requests.filter(path => path.startsWith('/job_detail/')).length;
  }

  async function refusal(run: () => Promise<unknown>) {
    try {
      await run();
    } catch (error) {
      return error as BrowserUnavailable;
    }
    throw new Error('EXPECTED_BROWSER_REFUSAL');
  }

  it('starts nothing when the session was never opened', async () => {
    const browser = new BossBrowser(options());
    try {
      const observed = await browser.inspectSession();
      expect(observed.state).toBe('absent');
      expect(observed.engine).toBe('patchright');
      // No browser, no page, no profile directory and not a single fixture request.
      expect(browser.ownsProfile).toBe(false);
      expect(fixture.state.requests).toEqual([]);
      expect(existsSync(options().profileDirectory)).toBe(false);
    } finally {
      await browser.close();
    }
  }, 120000);

  it('navigates once on open, never on a repeated open or check, and keeps the logged-in profile across a restart', async () => {
    const browser = new BossBrowser(options());
    let marker: string | null = null;
    try {
      const opened = await browser.openSession();
      expect(opened.state).toBe('login_required');
      expect(opened.humanWindow).toBe('open');
      const settled = fixture.state.requests.length;
      expect(settled).toBeGreaterThan(0);

      // Re-opening and re-checking reuse the managed page: the fixture sees no extra request at all.
      expect((await browser.openSession()).state).toBe('login_required');
      expect((await browser.inspectSession()).state).toBe('login_required');
      expect(fixture.state.requests.length).toBe(settled);

      // The human logs in inside the very window the adapter holds; the check only reads it.
      const page = await browser.ensureBrowser();
      await page.click('#login-submit');
      await page.waitForSelector('.user-nav');
      const urlAfterLogin = page.url();
      const ready = await browser.inspectSession();
      expect(ready.state).toBe('ready');
      expect(ready.accountMarker).toMatch(/^[0-9a-f]{16}$/);
      expect(page.url()).toBe(urlAfterLogin);
      marker = ready.accountMarker;
    } finally {
      await browser.close();
    }

    // Worker restart: the private Patchright profile outlives the process and still carries the login.
    const restarted = new BossBrowser(options());
    try {
      const reopened = await restarted.openSession();
      expect(reopened.state).toBe('ready');
      expect(reopened.accountMarker).toBe(marker);
      expect(requestsFor('/login')).toBe(1);
    } finally {
      await restarted.close();
    }
  }, 180000);

  it('stops on a safety page, keeps it for the human and refuses scan or mutation until an explicit recovery', async () => {
    const browser = new BossBrowser(options());
    try {
      expect((await browser.openSession()).state).toBe('ready');
      const page = await browser.ensureBrowser();
      await page.goto(`${fixture.origin}/web/passport/zp/security`, { waitUntil: 'domcontentloaded' });

      const observed = await browser.inspectSession();
      expect(observed.state).toBe('verification_required');
      const settled = fixture.state.requests.length;
      const searchesBefore = requestsFor('/web/geek/job');

      const scanError = await refusal(() => collectSearches(browser, policy, 5));
      expect(scanError.code).toBe('SESSION_PAUSED');
      expect(scanError.detail).toMatchObject({ stage: 'navigation', pauseReason: 'verification_required' });
      // The refused scan neither navigated nor requested a search page, and the page stayed put.
      expect(fixture.state.requests.length).toBe(settled);
      expect(requestsFor('/web/geek/job')).toBe(searchesBefore);
      expect(new URL(page.url()).pathname).toBe('/web/passport/zp/security');

      // The fixture profile is marked verified, so only the latch can stop this mutation.
      const paused = await browser.initiateConversation({ postingUrl: fixture.profile.postingUrl('fixture-consent'), sitePostingId: 'fixture-consent', greeting, effectId: crypto.randomUUID() });
      expect(paused.outcome).toBe('pause_session');
      expect(paused.reason).toBe('verification_required');
      expect(fixture.state.messages).toHaveLength(0);
      expect(fixture.state.contactClicks).toHaveLength(0);

      // The human resolves it in the held window, but an automated observation may never lift the latch:
      // readiness polling elsewhere in the app would otherwise silently authorize automation again.
      await page.goto(`${fixture.origin}/`, { waitUntil: 'domcontentloaded' });
      expect((await browser.inspectSession()).state).toBe('ready');
      const stillPaused = await refusal(() => collectSearches(browser, policy, 5));
      expect(stillPaused.code).toBe('SESSION_PAUSED');

      // The owner's explicit session check is the only documented recovery.
      expect((await browser.checkSession()).state).toBe('ready');
      const search = await collectSearches(browser, policy, 5);
      expect(search.cards.some(card => card.sitePostingId === 'fixture-qualified-fullstack')).toBe(true);
    } finally {
      await browser.close();
    }
  }, 240000);

  it('pauses on a rendered frequency notice even when its container class is new', async () => {
    const browser = new BossBrowser(options());
    try {
      expect((await browser.openSession()).state).toBe('ready');
      fixture.state.restricted = true;
      // A container class the selectors never knew: the rendered notice sentence is the evidence.
      fixture.state.restrictionContainer = 'notice-panel';
      const scanError = await refusal(() => collectSearches(browser, policy, 5));
      expect(scanError.code).toBe('SESSION_PAUSED');
      expect(scanError.detail).toMatchObject({ stage: 'navigation', pauseReason: 'site_restricted' });
      expect(scanError.message).toContain('访问过于频繁');

      // The latched limit also stops a verified-profile mutation before any click.
      const paused = await browser.initiateConversation({ postingUrl: fixture.profile.postingUrl('fixture-qualified-fullstack'), sitePostingId: 'fixture-qualified-fullstack', greeting, effectId: crypto.randomUUID() });
      expect(paused.outcome).toBe('pause_session');
      expect(paused.reason).toBe('site_restricted');
      expect(fixture.state.messages).toHaveLength(0);
    } finally {
      fixture.state.restricted = false;
      fixture.state.restrictionContainer = 'error-page';
      await browser.close();
    }
  }, 180000);

  it('treats a generic error page as a page failure rather than a site restriction', async () => {
    const browser = new BossBrowser(options());
    try {
      expect((await browser.openSession()).state).toBe('ready');
      fixture.state.failSearch = true;
      const failure = await refusal(() => collectSearches(browser, policy, 5));
      // No pause code and no anti-bot claim: this is an ordinary unreadable page.
      expect(failure).not.toBeInstanceOf(BrowserUnavailable);
      expect(failure.message).toContain('没有可读岗位或筛选控件');
    } finally {
      fixture.state.failSearch = false;
      await browser.close();
    }
  }, 180000);

  it('reports a main-frame navigation loop, latches the pause and claims no control over the page script', async () => {
    // Its own private profile: the looping tab it leaves behind must not be restored by a later test.
    const browser = new BossBrowser(options({ directory: join(dataDir, 'loop-profile') }));
    try {
      expect((await browser.openSession()).state).toBe('ready');
      const page = await browser.ensureBrowser();
      await page.goto(`${fixture.origin}/loop/a`, { waitUntil: 'domcontentloaded' });
      const deadline = Date.now() + 20000;
      let observed = await browser.inspectSession();
      while (observed.state !== 'restricted' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 300));
        observed = await browser.inspectSession();
      }
      expect(observed.state).toBe('restricted');
      expect(observed.detail).toContain('页面自身的脚本可能仍在跳转');

      const searchesBefore = requestsFor('/web/geek/job');
      const loopError = await refusal(() => collectSearches(browser, policy, 5));
      expect(loopError.code).toBe('SESSION_PAUSED');
      expect(loopError.detail).toMatchObject({ stage: 'navigation', pauseReason: 'site_restricted' });
      expect(requestsFor('/web/geek/job')).toBe(searchesBefore);
    } finally {
      await browser.close();
    }
  }, 240000);

  it('keeps the live profile unverified so a real-site mutation is refused before any click', async () => {
    const browser = new BossBrowser(options({ verified: false, directory: join(dataDir, 'live-profile') }));
    try {
      expect((await browser.openSession()).state).toBe('ready');
      const blocked = await browser.initiateConversation({ postingUrl: liveBossProfile(fixture.origin).postingUrl('fixture-qualified-fullstack'), sitePostingId: 'fixture-qualified-fullstack', greeting, effectId: crypto.randomUUID() });
      expect(blocked.outcome).toBe('failed');
      expect(blocked.reason).toBe('live_mutation_unverified');
      expect(fixture.state.messages).toHaveLength(0);
      expect(fixture.state.attachments).toHaveLength(0);
    } finally {
      await browser.close();
    }
  }, 180000);

  it('turns a safety redirect that arrives during the pending detail read into a pause that stops the scan', async () => {
    const browser = new BossBrowser(options());
    try {
      expect((await browser.openSession()).state).toBe('ready');
      const search = await collectSearches(browser, policy, 5);
      expect(search.cards.length).toBeGreaterThanOrEqual(2);
      const evidence = search.evidence[0]!;
      fixture.state.detailRedirectToSecurity = true;
      const readsBefore = detailReads();

      const first = await refusal(() => browser.readPosting(search.cards[0]!, evidence));
      // The JD wait timed out, but the page it timed out on proves a safety path: not a page failure.
      expect(first.code).toBe('SESSION_PAUSED');
      expect(first.detail).toMatchObject({ stage: 'navigation', pauseReason: 'verification_required' });

      // The Worker's per-card loop must not walk on: the next posting is never requested.
      const second = await refusal(() => browser.readPosting(search.cards[1]!, evidence));
      expect(second.code).toBe('SESSION_PAUSED');
      expect(detailReads()).toBe(readsBefore + 1);
    } finally {
      fixture.state.detailRedirectToSecurity = false;
      await browser.close();
    }
  }, 240000);

  it('refuses the attachment upload when a limit page arrives while the attachment entry is awaited', async () => {
    const browser = new BossBrowser(options());
    const resumePath = join(dataDir, 'mid-interaction-resume.txt');
    try {
      expect((await browser.openSession()).state).toBe('ready');
      await writeFile(resumePath, Buffer.from('合成简历：全栈项目负责 React 与 NestJS 接口，并编写自动化测试。\n', 'utf8'));
      const postingId = 'fixture-qualified-fullstack';
      // An existing conversation exposes the entry link the read-only send path is allowed to follow.
      fixture.state.messages.push({ postingId, text: greeting });
      fixture.state.chatRedirectToLimit = true;
      const uploads = fixture.state.attachments.length;

      const observation = await browser.sendOriginalResume({
        postingUrl: fixture.profile.postingUrl(postingId), sitePostingId: postingId,
        filePath: resumePath, originalName: 'synthetic-resume.txt', sha256: 'a'.repeat(64), byteSize: 1,
      });
      expect(observation.outcome).toBe('pause_session');
      expect(observation.reason).toBe('site_restricted');
      // No upload and no submit request followed the blocking wait.
      expect(fixture.state.attachments).toHaveLength(uploads);
      expect(fixture.state.requests.some(path => path === `/chat/${postingId}/resume`)).toBe(false);
    } finally {
      fixture.state.chatRedirectToLimit = false;
      await browser.close();
    }
  }, 240000);

  it('blocks on any visible challenge indicator, not only the first matching element', async () => {
    const browser = new BossBrowser(options());
    try {
      expect((await browser.openSession()).state).toBe('ready');
      fixture.state.verification = true;
      fixture.state.hiddenFirstChallenge = true;
      const page = await browser.ensureBrowser();
      await page.goto(`${fixture.origin}/`, { waitUntil: 'domcontentloaded' });

      const observed = await browser.inspectSession();
      expect(observed.state).toBe('verification_required');
      const checked = await browser.checkSession();
      // The explicit check cannot clear a latch while the visible challenge is still on the page.
      expect(checked.state).toBe('verification_required');
      const refused = await refusal(() => collectSearches(browser, policy, 5));
      expect(refused.code).toBe('SESSION_PAUSED');
      expect(refused.detail.pauseReason).toBe('verification_required');
    } finally {
      fixture.state.verification = false;
      fixture.state.hiddenFirstChallenge = false;
      await browser.close();
    }
  }, 180000);
});
