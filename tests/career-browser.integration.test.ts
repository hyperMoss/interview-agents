import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { BossBrowser } from '../apps/worker/src/boss-browser';
import type { CareerPolicy } from '../packages/contracts/src/career';
import type { NativeFilterEvidence, SearchCard } from '../apps/worker/src/boss-browser';
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

const MOLI = process.env.MOLI_EXECUTABLE ?? join(homedir(), '.local', 'bin', 'moli');
const suite = process.env.RUN_INTEGRATION === '1' && existsSync(MOLI) ? describe : describe.skip;

// Real Moli CDP session + mature Playwright client against the synthetic BOSS-like site.
// This is evidence about the local browser transport and fixtures only; it is not real BOSS compatibility.
suite('owned browser session against the synthetic BOSS site', () => {
  let fixture: Awaited<ReturnType<typeof startBossFixture>>;
  let dataDir: string;
  let browser: BossBrowser;
  let resumePath = '';
  let resumeSha = '';
  let resumeSize = 0;

  beforeAll(async () => {
    fixture = await startBossFixture();
    fixture.state.loggedIn = true;
    dataDir = await mkdtemp(join(tmpdir(), 'career-browser-'));
    browser = new BossBrowser({
      engine: 'moli', origin: fixture.origin, profile: fixture.profile, profileDirectory: join(dataDir, 'profile'),
      moliExecutable: MOLI, headedFallback: false,
    });
    const bytes = Buffer.from('合成简历：全栈项目负责 React 与 NestJS 接口、PostgreSQL 数据建模，并编写自动化测试。\n', 'utf8');
    resumePath = join(dataDir, 'synthetic-resume.txt');
    await writeFile(resumePath, bytes);
    resumeSha = createHash('sha256').update(bytes).digest('hex');
    resumeSize = bytes.length;
  }, 120000);

  afterAll(async () => {
    await browser?.close();
    await fixture?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  }, 60000);

  function report(label: string, value: unknown) {
    // Synthetic fixture data only; printed so an acceptance reviewer can see the observed transport result.
    console.log(`BROWSER_OBSERVATION ${label} ${JSON.stringify(value)}`);
  }

  it('checks without launching or navigating, then observes the human login on the page it kept', async () => {
    fixture.state.loggedIn = false;
    // A check never starts a browser, creates a page or navigates; it reports that no page is managed yet.
    const beforeOpen = await browser.inspectSession();
    report('session_before_open', { state: beforeOpen.state, detail: beforeOpen.detail, engine: beforeOpen.engine });
    expect(beforeOpen.state).toBe('absent');
    expect(fixture.state.requests).toHaveLength(0);

    const opened = await browser.openSession();
    report('session_opened', { state: opened.state, detail: opened.detail, engine: opened.engine, humanWindow: opened.humanWindow });
    expect(opened.state).toBe('login_required');
    const requestsAfterOpen = fixture.state.requests.length;
    expect(requestsAfterOpen).toBeGreaterThan(0);

    // Re-opening and re-checking keep the same managed page and cause no further navigation.
    expect((await browser.openSession()).state).toBe('login_required');
    expect((await browser.inspectSession()).state).toBe('login_required');
    expect(fixture.state.requests).toHaveLength(requestsAfterOpen);

    const page = await browser.ensureBrowser();
    await page.click('#login-submit');
    await page.waitForSelector('.user-nav');
    const urlAfterLogin = page.url();
    // A read-only observation reports the logged-in page but never lifts the login latch by itself.
    expect((await browser.inspectSession()).state).toBe('ready');
    // The owner's explicit session check is the documented recovery.
    const ready = await browser.checkSession();
    report('session_after_login', { state: ready.state, accountMarker: ready.accountMarker, page: page.url() === urlAfterLogin });
    expect(ready.state).toBe('ready');
    expect(ready.accountMarker).toMatch(/^[0-9a-f]{16}$/);
    // The explicit check read the current page instead of navigating to the home page.
    expect(page.url()).toBe(urlAfterLogin);
  }, 120000);

  it('applies and re-reads the native city/position/salary controls before trusting the card list', async () => {
    const search = await collectSearches(browser, { roleTargets: ['fullstack', 'agent_development'], cities: ['广州', '深圳'], salaryUpperMinCnyMonthly: 18000, preferAiApplication: true, companyBlacklistKeywords: [] }, 30);
    report('native_filter_evidence', search.evidence.map(item => ({ searchKey: item.searchKey, controls: item.controls.map(control => `${control.label}=${control.selected}`) })));
    expect(search.evidence.length).toBeGreaterThanOrEqual(4);
    expect(search.evidence.some(item => item.controls.some(control => control.label === 'salary' && control.selected === '10-20K'))).toBe(true);
    expect(fixture.state.requestedFilters.some(filter => filter.city === '广州' && filter.position === '全栈')).toBe(true);
    expect(fixture.state.requestedFilters.some(filter => filter.city === '深圳' && filter.position === 'Agent 开发')).toBe(true);
    const ids = search.cards.map(card => card.sitePostingId);
    expect(ids).toContain('fixture-qualified-fullstack');
    expect(ids).toContain('fixture-low-salary');
    expect(new Set(ids).size).toBe(ids.length);
  }, 180000);

  it('confirms a conversation only from the greeting evidence in the chat surface', async () => {
    const card = (await collectSearches(browser, { roleTargets: ['fullstack'], cities: ['广州'], salaryUpperMinCnyMonthly: 18000, preferAiApplication: true, companyBlacklistKeywords: [] }, 10)).cards.find(item => item.sitePostingId === 'fixture-qualified-fullstack');
    expect(card).toBeDefined();
    const observed = await browser.readPosting(card!, { searchKey: '广州:fullstack', controls: [{ label: 'city', selected: '广州', url: fixture.origin }] });
    expect(observed.identitySource).toBe('detail_link');
    expect(observed.company).toBe('示例自研科技');
    const greeting = '您好，我在简历中说明了全栈项目中 React 与 NestJS 接口的经历，希望进一步沟通这个岗位。';
    const observedEffect = await browser.initiateConversation({ postingUrl: observed.url, sitePostingId: observed.sitePostingId, greeting, effectId: crypto.randomUUID() });
    report('conversation_effect', observedEffect);
    report('fixture_messages', fixture.state.messages);
    expect(observedEffect.outcome).toBe('confirmed');
    expect(fixture.state.messages.some(message => message.postingId === 'fixture-qualified-fullstack' && message.text === greeting)).toBe(true);
  }, 120000);

  it('uploads the exact approved original bytes and confirms only an attachment card with matching name and size', async () => {
    const effect = await browser.sendOriginalResume({
      postingUrl: `${fixture.origin}/job_detail/fixture-qualified-fullstack.html`, sitePostingId: 'fixture-qualified-fullstack',
      filePath: resumePath, originalName: 'synthetic-resume.txt', sha256: resumeSha, byteSize: resumeSize,
    });
    report('attachment_effect', effect);
    report('fixture_attachments', fixture.state.attachments);
    expect(effect.outcome).toBe('confirmed');
    const received = fixture.state.attachments.find(item => item.postingId === 'fixture-qualified-fullstack');
    expect(received?.sha256).toBe(resumeSha);
    expect(received?.byteSize).toBe(resumeSize);
  }, 120000);

  it('treats a file whose bytes changed after approval as a proven no-effect failure', async () => {
    const before = fixture.state.attachments.length;
    const effect = await browser.sendOriginalResume({
      postingUrl: `${fixture.origin}/job_detail/fixture-qualified-fullstack.html`, sitePostingId: 'fixture-qualified-fullstack',
      filePath: resumePath, originalName: 'synthetic-resume.txt', sha256: 'f'.repeat(64), byteSize: resumeSize,
    });
    report('attachment_hash_mismatch', effect);
    expect(effect.outcome).toBe('failed');
    expect(effect.reason).toBe('attachment_hash_mismatch');
    expect(fixture.state.attachments.length).toBe(before);
  }, 120000);

  it('reports recipient consent separately instead of claiming the greeting or attachment was delivered', async () => {
    const effect = await browser.initiateConversation({ postingUrl: `${fixture.origin}/job_detail/fixture-consent.html`, sitePostingId: 'fixture-consent', greeting: '您好，我在简历中说明了全栈开发经历，希望进一步沟通。', effectId: crypto.randomUUID() });
    report('consent_effect', effect);
    expect(effect.outcome).toBe('awaiting_consent');
    expect(fixture.state.messages.some(message => message.postingId === 'fixture-consent')).toBe(false);
  }, 120000);

  it('reports an ambiguous dispatched conversation as unknown instead of scanning old history', async () => {
    const unknownSend = await browser.initiateConversation({ postingUrl: `${fixture.origin}/job_detail/fixture-unknown-send.html`, sitePostingId: 'fixture-unknown-send', greeting: '您好，我在简历中说明了全栈平台开发经历，希望进一步沟通这个岗位。', effectId: crypto.randomUUID() });
    report('unknown_send_effect', unknownSend);
    expect(unknownSend.outcome).toBe('unknown');
    expect(fixture.state.messages.filter(message => message.postingId === 'fixture-unknown-send')).toHaveLength(1);
  }, 120000);

  it('confirms an attachment only from a fresh site receipt matching the frozen hash, size and recipient', async () => {
    const startConversation = async (postingId: string) => {
      const effect = await browser.initiateConversation({ postingUrl: `${fixture.origin}/job_detail/${postingId}.html`, sitePostingId: postingId, greeting: `您好，我在简历中说明了全栈开发经历，希望进一步沟通 ${postingId} 这个岗位。`, effectId: crypto.randomUUID() });
      expect(effect.outcome).toBe('confirmed');
    };
    await startConversation('fixture-wrong-attachment');
    const wrongSize = await browser.sendOriginalResume({
      postingUrl: `${fixture.origin}/job_detail/fixture-wrong-attachment.html`, sitePostingId: 'fixture-wrong-attachment',
      filePath: resumePath, originalName: 'synthetic-resume.txt', sha256: resumeSha, byteSize: resumeSize,
    });
    report('wrong_size_effect', wrongSize);
    expect(wrongSize.outcome).toBe('unknown');
    expect(wrongSize.reason).toBe('attachment_receipt_mismatch');
    // Same name and same byte count with different persisted bytes: only the site receipt digest may confirm identity.
    await startConversation('fixture-corrupt-receipt');
    const corrupted = await browser.sendOriginalResume({
      postingUrl: `${fixture.origin}/job_detail/fixture-corrupt-receipt.html`, sitePostingId: 'fixture-corrupt-receipt',
      filePath: resumePath, originalName: 'synthetic-resume.txt', sha256: resumeSha, byteSize: resumeSize,
    });
    report('corrupt_receipt_effect', corrupted);
    expect(corrupted.outcome).toBe('unknown');
    expect(corrupted.reason).toBe('attachment_receipt_mismatch');
    expect(fixture.state.attachments.filter(entry => entry.postingId === 'fixture-corrupt-receipt')).toHaveLength(1);
  }, 180000);

  it('clears the private session so the site requires a fresh login', async () => {
    await browser.clearSession();
    expect(existsSync(join(dataDir, 'profile'))).toBe(false);
    // Clearing forgets the managed page: a check reports the absence instead of opening a new one.
    const afterClear = await browser.inspectSession();
    report('session_after_clear', { state: afterClear.state, detail: afterClear.detail });
    expect(afterClear.state).toBe('absent');
    // The dedicated profile is gone, so a fresh open starts logged out and navigates exactly once.
    fixture.state.loggedIn = false;
    const reopened = await browser.openSession();
    report('session_after_clear_open', { state: reopened.state, detail: reopened.detail });
    expect(reopened.state).toBe('login_required');
  }, 120000);
});
