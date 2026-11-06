import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rm } from 'node:fs/promises';
import lockfile from 'proper-lockfile';
import { chromium as patchrightChromium } from 'patchright';
import { chromium as playwrightChromium, type Browser } from 'playwright';
import { CAREER_MAX_POSTINGS, observedPostingSchema, type BossEngine, type CareerPolicy, type ObservedPosting } from '../../../packages/contracts/src/career';
import {
  BOSS_DETAIL_RESPONSE_TIMEOUT_MS, BOSS_SEARCH_RESPONSE_TIMEOUT_MS, BossDetailLedger, BossResponseObserver, acceptDetail,
  acceptSearch, activePostingIdentity, awaitBossCapture, bossControlMismatches, bossPostingLinkSelector, cardSelectorFor, classifyBossRelease,
  decideDetailOpening, findReusableDetailCapture, postingIdFromUrl, type BossBodyTicket, type BossCapture,
  type BossCaptureWait, type BossObservationScope, type BossPaneSnapshot, type BossReleaseObservation,
  type BossRenderedList, type BossSearchEncoding, type BossSuccessSemantics,
} from './boss-response';

export { postingIdFromUrl };

// Owned local browser for the BOSS career workflow. Patchright is the default driver: it launches the
// installed Chrome once as a long-lived headed persistent context, so a human logs in and clears any
// verification in the very window the automation later uses. Moli (loopback CDP) and Playwright stay
// available as explicit legacy engines. Nothing here accepts a URL, selector or script from the UI or
// the model, and no fingerprint or signature is fabricated.

export type { BossEngine };

// Patchright and Playwright are the same driver API published under different type identities (Patchright
// adds optional arguments to evaluate/evaluateHandle). This adapter declares the bounded surface it
// actually uses, so both packages satisfy it structurally and no driver object is cast away.

export type ManagedLocator = {
  first(): ManagedLocator;
  nth(index: number): ManagedLocator;
  locator(selector: string): ManagedLocator;
  /** The driver's own text filter; the conversation link excludes the site's apply button by its label. */
  filter(options: { hasNotText: string | RegExp }): ManagedLocator;
  /** The driver's supported shortcut for matching only visible elements. */
  visible(): ManagedLocator;
  count(): Promise<number>;
  isVisible(options?: { timeout?: number }): Promise<boolean>;
  isDisabled(options?: { timeout?: number }): Promise<boolean>;
  innerText(options?: { timeout?: number }): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  evaluate<R>(pageFunction: (element: HTMLElement) => R | Promise<R>): Promise<R>;
  evaluate<R, Arg>(pageFunction: (element: HTMLElement, arg: Arg) => R | Promise<R>, arg: Arg): Promise<R>;
  evaluateAll<R>(pageFunction: (elements: HTMLElement[]) => R | Promise<R>): Promise<R>;
  evaluateAll<R, Arg>(pageFunction: (elements: HTMLElement[], arg: Arg) => R | Promise<R>, arg: Arg): Promise<R>;
  selectOption(values: string | { label: string }): Promise<string[]>;
  fill(value: string): Promise<void>;
  click(options?: { timeout?: number }): Promise<void>;
  setInputFiles(files: { name: string; mimeType: string; buffer: Buffer }): Promise<void>;
};

export type ManagedRequest = {
  url(): string;
  method(): string;
  /** Declared request headers, read only for the body content type of a search submit. */
  headers(): Record<string, string>;
  /** Form body of a submit, projected into the four bounded search fields and then discarded. */
  postData(): string | null;
};

export type ManagedResponse = {
  /** The request this response answered: the identity a capture is correlated by. */
  request(): ManagedRequest;
  status(): number;
  /** Declared response headers, read only to check the body size before the body is acquired. */
  headers(): Record<string, string>;
  text(): Promise<string>;
};

export type ManagedPage = {
  url(): string;
  isClosed(): boolean;
  mainFrame(): object;
  locator(selector: string): ManagedLocator;
  goto(url: string, options?: { waitUntil?: 'domcontentloaded'; timeout?: number }): Promise<unknown>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  waitForLoadState(state?: 'domcontentloaded'): Promise<void>;
  waitForTimeout(timeout: number): Promise<void>;
  waitForFunction<R, Arg>(pageFunction: (arg: Arg) => R, arg: Arg, options?: { timeout?: number }): Promise<{ jsonValue(): Promise<R> }>;
  on(event: 'framenavigated', listener: (frame: unknown) => void): unknown;
  /** The driver's own request/response events: registered before the initial navigation and every action, so
   *  a capture is always tied to the action that caused it. */
  on(event: 'request', listener: (request: ManagedRequest) => void): unknown;
  on(event: 'response', listener: (response: ManagedResponse) => void): unknown;
  off(event: 'request', listener: (request: ManagedRequest) => void): unknown;
  off(event: 'response', listener: (response: ManagedResponse) => void): unknown;
  once(event: 'close', listener: () => void): unknown;
  bringToFront(): Promise<void>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  content(): Promise<string>;
  close(): Promise<void>;
};

export type ManagedContext = {
  pages(): ManagedPage[];
  newPage(): Promise<ManagedPage>;
  close(): Promise<void>;
  setDefaultTimeout(timeout: number): void;
  setDefaultNavigationTimeout(timeout: number): void;
};

/** Where in a step a refusal happened; driver/DOM errors keep their own message, never `site_restricted`. */
export type ActionStage = 'navigation' | 'pre_click' | 'post_click';

/** A locally latched pause: automation stays stopped until the owner watches the page and explicitly re-checks. */
export type PauseReason = 'login_required' | 'verification_required' | 'restricted' | 'navigation_loop';

/** Explicit lifecycle result of one open. It records whether the browser and its single initial navigation
 *  were established; it never infers that from the page URL, because a navigation can commit and still fail. */
export type OpenLifecycle = {
  status: 'opened' | 'failed';
  initialNavigation: 'not_required' | 'performed' | 'failed';
  detail: string | null;
};

export type ObservedSession = {
  /** `absent` means no managed page is open; nothing was launched, created or navigated to observe it. */
  state: 'login_required' | 'verification_required' | 'restricted' | 'ready' | 'unavailable' | 'absent';
  detail: string;
  accountMarker: string | null;
  engine: BossEngine;
  humanWindow: 'none' | 'open';
  limitation: string | null;
};

export type EffectObservation = {
  outcome: 'confirmed' | 'awaiting_consent' | 'failed' | 'unknown' | 'pause_session';
  reason: string | null;
  evidence: Array<{ observedAt: string; url: string; summary: string }>;
  session?: ObservedSession;
  /** The actor stopped itself before the next external step because its persisted authority was withdrawn. */
  stopped?: boolean;
};

/** Consulted between external steps: the actor must stop when the durable work authority is gone. */
export type EffectGuard = { stillAllowed: () => Promise<boolean> };

export type NativeFilterEvidence = {
  method?: 'native_controls' | 'search_url';
  searchKey: string;
  controls: Array<{ label: string; selected: string; url: string }>;
};

export type SearchCard = { sitePostingId: string | null; url: string; title: string; company: string; location: string; salary: string };

export type BossSelectors = {
  loginIndicator: string;
  verificationIndicator: string;
  readyIndicator: string;
  accountMarker: string | null;
  resultCard: string;
  resultLink: string;
  card: { title: string; company: string; location: string; salary: string };
  detail: { title: string; company: string; location: string; salary: string; jd: string; companyProfile: string };
  contact: string;
  chatInput: string;
  chatSend: string;
  chatMessages: string;
  /** Container that carries the site's own posting/recipient identity for the conversation. */
  chatContainer: string;
  /** Anchor the site exposes only for an already existing conversation; reconciliation never clicks the apply button. */
  conversationLink: string;
  consentNotice: string;
  attachmentInput: string;
  attachmentSubmit: string;
  attachmentMessage: string;
  /** Element carrying the site's upload receipt attributes (hash/size), the only acceptable attachment identity proof. */
  attachmentReceipt: string;
};

/** The live site's rendered search surface, as recorded in the curated DOM/filter/pane evidence. The labels are
 *  the site's own rendered text and the selectors are the observed containers; none of them is a filter
 *  parameter, so no search URL and no city code can be built from this profile. */
export type RenderedSearchCandidates = {
  keywordPlaceholder: string;
  submitName: string;
  cityPanelTitle: string;
  /** The label the salary control shows while it filters nothing. */
  salaryControlLabel: string;
  /** The only salary state this adapter accepts: a narrower band would silently drop postings whose monthly
   *  upper bound still qualifies, and the broad band filters nothing. */
  broadSalaryBand: string;
};

/** Selectors of the observed rendered surface. The result list is read in one pass and the own detail pane in
 *  one pass; every control is addressed through what the page itself renders. */
export type RenderedSurfaceSelectors = {
  keyword: string;
  submit: string;
  /** The observed result list; every card lookup is scoped inside it. */
  cardList: string;
  /** One card container inside the observed list. */
  card: string;
  /** The one card the frontend currently has selected, inside the observed list. */
  activeCard: string;
  /** A card's own posting link; the only identity a card is matched by. */
  cardLink: string;
  loading: string;
  empty: string;
  cityLabel: string;
  cityDialog: string;
  salarySelect: string;
  salaryCurrent: string;
  pane: string;
};

/** Fields every profile provides; the surface variants below decide how that surface is driven. */
type CommonBossSiteProfile = {
  name: string;
  /** `verified` is false until a real, observed site check proved the controls and selectors. */
  verified: boolean;
  note: string;
  /** The one known site entry the explicit open navigates to when no page exists yet. */
  entryUrl: string;
  postingUrl: (sitePostingId: string) => string;
  selectors: BossSelectors;
};

/** The live site renders its filters as in-page widgets and shows a posting in the list's right pane. */
export type RenderedBossProfile = CommonBossSiteProfile & {
  surface: 'rendered';
  rendered: RenderedSearchCandidates;
  /** The observed rendered surface the response evidence is bound to. */
  surfaceSelectors: RenderedSurfaceSelectors;
  /** The observed search-form field names and city encoding, or null while a real request has not established
   *  them. Nothing is inferred from a guessed name or code. */
  encoding: BossSearchEncoding | null;
  /** The observed application-success discriminator, or `unknown` while no real successful envelope has
   *  established it. `unknown` accepts no envelope at all. */
  success: BossSuccessSemantics;
};

/** The synthetic fixture renders a plain HTML form and a separate detail page. */
export type SyntheticBossProfile = CommonBossSiteProfile & {
  surface: 'synthetic';
  /** The fixture's own result route; one deliberate navigation, with no filter parameter. */
  listingUrl: string;
  /** The fixture's HTML `<select>` controls. */
  filters: { city: string; salary: string; position: string };
};

/** How a profile's pages are driven. It decides how the scan reaches a posting, never what it may claim. */
export type WorksBossProfile = CommonBossSiteProfile & { surface: 'works_dom' };
export type BossSiteProfile = RenderedBossProfile | SyntheticBossProfile | WorksBossProfile;

/** The site's own keyword for each configured role target. */
function searchPosition(role: CareerPolicy['roleTargets'][number]) {
  return role === 'fullstack' ? '全栈' : 'Agent 开发';
}

export type CareerRoleTarget = string;

/** One city+role search, in the order the scan runs them. */
export type SearchTarget = { city: string; role: CareerRoleTarget; position: string };

/** One search's cards together with the exact filter evidence of the controls that produced them. */
export type SearchBatch = { evidence: NativeFilterEvidence; cards: SearchCard[] };

/** The deterministic search order: every city for every role target, once each. */
export function searchPlan(policy: CareerPolicy): SearchTarget[] {
  return policy.cities.flatMap(city => [...policy.roleTargets.map(role => ({ city, role, position: searchPosition(role) })), ...(policy.customRoleKeywords ?? []).map(keyword => ({ city, role: keyword, position: keyword }))].filter((target,index,all) => all.findIndex(item => item.position.normalize('NFKC').toLowerCase() === target.position.normalize('NFKC').toLowerCase()) === index));
}

/**
 * Runs one search at a time and yields its batch as soon as that search is on the page. The caller's work for
 * a batch — reserving the durable read slot and reading each posting — therefore finishes while that search is
 * still the current page, instead of after a later city/role has replaced the result list.
 */
export async function* streamSearches(plan: SearchTarget[], search: (target: SearchTarget) => Promise<SearchBatch>): AsyncGenerator<SearchBatch, void, undefined> {
  for (const target of plan) yield await search(target);
}

/** The controls a search requested, and the ones the page was re-read to show after it. */
export type AppliedSearch = { city: string; position: string; salary: string };

/** Evidence may only be recorded for the controls the page still shows. */
export function appliedSearchMatches(requested: AppliedSearch, observed: AppliedSearch) {
  const mismatched = bossControlMismatches(requested, observed);
  return mismatched.length ? { ok: false as const, mismatched } : { ok: true as const };
}

/**
 * Live BOSS profile. The selectors and labels below are the curated observations of one static v6789 page;
 * the adapter addresses exactly those containers, requires exactly one visible match for each and re-reads
 * every applied control. It carries no search-parameter encoding yet: the site's parameter names and the
 * submitted city's encoded value are established only by a real response, so a live search pauses instead of
 * inferring a city code. No live BOSS control or response is claimed verified.
 */
export function liveBossProfile(origin: string): RenderedBossProfile {
  const keywordPlaceholder = '搜索职位、公司';
  return {
    name: 'boss-live',
    verified: false,
    note: '未在真实 BOSS 页面验证的控件与选择器；读取或写回失败时暂停并显示证据。',
    // Explicit initial opening uses the public home page; an existing page is never redirected.
    entryUrl: new URL('/', origin).toString(),
    // The live scan never navigates and never builds a search URL: it drives the controls this page renders.
    surface: 'rendered',
    rendered: {
      keywordPlaceholder,
      submitName: '搜索',
      cityPanelTitle: '请选择城市',
      salaryControlLabel: '薪资待遇',
      broadSalaryBand: '不限',
    },
    // The rendered surface of the curated static page: the search form, the result list, the own detail pane
    // and the filters. The city panel is only checked for its own title; the curated evidence contains no city
    // options, so a city this page does not already show cannot be selected.
    surfaceSelectors: {
      keyword: `.job-search-form input[placeholder='${keywordPlaceholder}']`,
      submit: '.job-search-form a.search-btn',
      cardList: '.rec-job-list',
      card: '.rec-job-list .job-card-wrap',
      activeCard: '.rec-job-list .job-card-wrap.active',
      cardLink: bossPostingLinkSelector(),
      loading: '.job-rec-loading',
      empty: '.job-empty',
      cityLabel: '.c-filter-condition .city-label .cur-city-label',
      cityDialog: '.city-select-dialog',
      salarySelect: '.condition-filter-select',
      salaryCurrent: '.current-select',
      pane: '.job-detail-box',
    },
    // Not observed yet: no live request established the form field names or the submitted city's encoded
    // value, so the live scan cannot map a search submit onto the submitted controls and pauses before
    // accepting a list. Nothing is guessed from a code or a name.
    encoding: null,
    // Not observed yet: the curated client shows a numeric identity branch but no live successful envelope was
    // supplied, so no discriminator is configured and every envelope stays unrecognized.
    success: { status: 'unknown' },
    postingUrl: sitePostingId => `${origin}/job_detail/${encodeURIComponent(sitePostingId)}.html`,
    selectors: {
      loginIndicator: ".login-form, .sign-form, li.nav-sign a, a.header-login-btn, a[ka='403_login']",
      verificationIndicator: '.captcha, iframe[src*="captcha"], [class*="verify"], [class*="geetest"]',
      readyIndicator: 'li.nav-figure .label-text, li.nav-figure img, [class*="user-nav"], [class*="header-user"]',
      accountMarker: '[data-uid], [data-userid]',
      resultCard: 'li.job-card-wrapper, .job-list-box li',
      resultLink: 'a.job-card-left',
      card: { title: '.job-name', company: '.company-name', location: '.job-area', salary: '.salary' },
      detail: { title: '.job-banner .name', company: '.company-info .name', location: '.job-banner .text-city', salary: '.job-banner .salary', jd: '.job-sec-text', companyProfile: '.company-info' },
      contact: 'a.btn-startchat, .btn-startchat, [class*="startchat"]',
      chatInput: '#chat-input, .chat-input',
      chatSend: '.chat-op .btn-send, [class*="send"]',
      chatMessages: '.chat-message-list, [class*="message-list"]',
      chatContainer: '[data-job-id], .chat-message-list, [class*="message-list"]',
      conversationLink: 'a[href*="/chat"], [class*="continue-chat"]',
      consentNotice: '[class*="consent"], [class*="agree"]',
      attachmentInput: 'input[type=file]',
      attachmentSubmit: '[class*="send-resume"] button, [class*="attachment"] button',
      attachmentMessage: '[class*="message-card"], [class*="resume-card"]',
      attachmentReceipt: '[data-resume-sha256], [class*="message-card"], [class*="resume-card"]',
    },
  };
}

/** URL/DOM preview modeled on works 21a9618. Does not claim native filter or outbound verification. */
export function worksBossProfile(origin: string): WorksBossProfile {
  const base = liveBossProfile(origin);
  return {
    ...base, surface: 'works_dom', verified: false,
    note: '搜索 URL + 页面 DOM 预览；原生筛选与真实外发未验证。',
    selectors: {
      ...base.selectors,
      resultCard: 'ul.rec-job-list li.job-card-box, li.job-card-wrapper',
      resultLink: 'a[href*="/job_detail/"]',
      card: { title: 'a.job-name, .job-name', company: '.company-name, .boss-name', location: '.company-location, .job-area', salary: '.salary, .job-salary' },
      detail: { ...base.selectors.detail, title: '.job-banner h1', company: '.sider-company .company-info a', companyProfile: '.sider-company' },
    },
  };
}

export function worksSearchUrl(origin: string, target: SearchTarget) {
  // Official city snapshot distributed in works; these are route parameters, not observed selected controls.
  const cities: Record<string, string> = { '广州': '101280100', '深圳': '101280600' };
  const city = cities[target.city];
  if (!city) throw new BrowserUnavailable('NATIVE_FILTER_UNVERIFIED', '搜索城市不在已记录的站点城市映射中。');
  const url = new URL('/web/geek/jobs', origin);
  url.searchParams.set('query', target.position);
  url.searchParams.set('city', city);
  return url.toString();
}

export class BrowserUnavailable extends Error {
  constructor(
    readonly code: 'BROWSER_UNAVAILABLE' | 'BROWSER_ENGINE_UNSUPPORTED' | 'NATIVE_FILTER_UNVERIFIED' | 'SITE_PROOF_UNVERIFIED' | 'SESSION_PAGE_NOT_READY' | 'SESSION_OWNERSHIP' | 'SESSION_PAUSED',
    message: string,
    readonly detail: { stage?: ActionStage; pauseReason?: 'login_required' | 'verification_required' | 'site_restricted'; companyControls?: Array<{tag:string;className:string;text:string;parent:string}> } = {},
  ) {
    super(`${code}: ${message}`);
  }
}

export type BrowserOptions = {
  engine: BossEngine;
  origin: string;
  profile: BossSiteProfile;
  profileDirectory: string;
  moliExecutable: string;
  headedFallback: boolean;
};

// Finite bounds for every driver wait, so no read can hang the owned actor indefinitely.
const LAUNCH_TIMEOUT_MS = 30000;
const NAVIGATION_TIMEOUT_MS = 20000;
const ACTION_TIMEOUT_MS = 10000;
// Local diagnostic thresholds for a main-frame navigation loop. They say nothing about the site's
// own scripts, which keep running in the page even after program actions stop.
const LOOP_WINDOW_MS = 12000;
const LOOP_NAVIGATION_LIMIT = 6;
const LOOP_SAME_PATH_LIMIT = 4;
// One bounded wait for the fixture's result list; the live response waits are bounded in ./boss-response.
const RESULT_WAIT_MS = 15000;
// One bounded wait for the own detail pane of a selected posting to finish rendering.
const PANE_WAIT_MS = 5000;
// A navigation this actor caused (goto/select/click) is not evidence of a site-side loop.
const SELF_NAVIGATION_WINDOW_MS = 3000;

/** Observed safety page paths. Only these exact passport paths are treated as verification. */
const SAFETY_PATH = /^\/web\/passport\/zp\/(?:security|verify|slide|captcha)/i;
const LIMIT_NOTICES = ['访问过于频繁', '操作过于频繁', '请求过于频繁', '次数已达上限', '访问受限', '异常访问'];

/** Evidence and log lines keep only host and path: a query string can carry challenge or session data. */
export function redactUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return '';
  }
}

/** Stored site link: origin and path only, so tracking or challenge parameters never enter business data. */
export function canonicalUrl(url: string) {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

/** Driver errors can quote the current URL. Strip every URL-shaped run to host and path before an error
 *  message reaches session state, evidence, task details or a log line. */
export function redactError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown';
  return message
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'`)<>]+/gi, match => redactUrl(match) || '[url]')
    .slice(0, 300);
}

function loadedDocument(url: string) {
  return Boolean(url) && url !== 'about:blank';
}

/** One declared header value, lower-cased name; the only headers this adapter ever reads. */
export function headerValue(headers: Record<string, string> | undefined, name: string) {
  if (!headers) return null;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return entry?.[1] ?? null;
}

/** The declared body size, or null when the response declares none. */
export function declaredBytes(value: string | null) {
  if (!value) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;
const MOLI_LISTEN = /protocol server listening[^\n]*?addr=([0-9.]+):(\d+)/;

/** Moli announces the exact loopback endpoint it bound. A configured shared port could belong to
 *  another owner's server, so only this child's own announcement is trusted. */
function moliEndpoint(log: string) {
  const match = MOLI_LISTEN.exec(log.replace(ANSI_ESCAPE, ''));
  if (!match?.[1] || !match[2]) return null;
  return { host: match[1], port: Number(match[2]) };
}

/** Opaque local marker for an observed site account; the raw site id never reaches business data. */
export function accountMarkerFor(rawUid: string) {
  return createHash('sha256').update(`boss-account:${rawUid}`).digest('hex').slice(0, 16);
}

export class BossBrowser {
  private browser: Browser | null = null;
  private context: ManagedContext | null = null;
  private page: ManagedPage | null = null;
  private moli: ChildProcess | null = null;
  private release: (() => Promise<void>) | null = null;
  private ownershipLost = false;
  private activeEngine: BossEngine;
  private endpoint: { host: string; port: number } | null = null;

  private headedLabel: string | null = null;
  private opened: OpenLifecycle | null = null;
  private initialNavigation: OpenLifecycle['initialNavigation'] = 'not_required';
  private pause: { reason: PauseReason; detail: string } | null = null;
  private navigations: Array<{ at: number; path: string }> = [];
  private lastProgramActionAt = 0;
  // Response evidence of the read-only scan: one serialized action at a time, and one bounded capture list.
  private observer: BossResponseObserver | null = null;
  private observerPage: ManagedPage | null = null;
  private observerGeneration = 0;
  private readonly bodyReads = new Set<BossBodyTicket>();
  private apiHandlers: { onRequest: (request: ManagedRequest) => void; onResponse: (response: ManagedResponse) => void } | null = null;
  private actionEpoch = 0;
  private actionBusy = false;
  private scan: { scope: BossObservationScope; ledger: BossDetailLedger; encoding: BossSearchEncoding | null; success: BossSuccessSemantics } | null = null;

  constructor(readonly options: BrowserOptions) {
    this.activeEngine = options.engine;
  }

  get engine() {
    return this.activeEngine;
  }

  /** True while this actor holds the profile lease, i.e. a check may assert ownership without launching. */
  get ownsProfile() {
    return Boolean(this.release) && !this.ownershipLost;
  }

  /** Descriptive only: whether the actor currently holds a page with a nonblank URL. Page classification
   *  and open success are reported separately, so this is never used to decide whether an open succeeded. */
  get managedPageLoaded() {
    const page = this.page;
    return page !== null && !page.isClosed() && loadedDocument(page.url());
  }

  /** The explicit result of the last `openSession()`: launch and initial-navigation lifecycle, recorded at
   *  the point that performed it. Null until an open has been attempted. */
  get openLifecycle(): OpenLifecycle | null {
    return this.opened;
  }

  private recordOpen(status: OpenLifecycle['status'], error?: unknown) {
    this.opened = { status, initialNavigation: this.initialNavigation, detail: status === 'failed' ? redactError(error) : null };
  }

  /** The loopback endpoint this actor's own Moli child bound, for diagnostics and ownership checks. */
  get cdpEndpoint() {
    return this.endpoint;
  }

  /** External mutations are refused while the site profile's controls are still unverified. */
  get mutationsAllowed() {
    return this.options.profile.verified;
  }

  // ---------- session ownership ----------
  /** Process identity is proven from the exact private profile marker, never from a bare PID. */
  private async ownedProcesses() {
    const marker = this.options.profileDirectory;
    const output = await new Promise<string>((resolve, reject) => {
      execFile('ps', ['-axo', 'pid=,command='], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => (error ? reject(new BrowserUnavailable('BROWSER_UNAVAILABLE', 'Cannot inspect local processes')) : resolve(stdout)));
    });
    const found: Array<{ pid: number; command: string }> = [];
    for (const line of output.split('\n')) {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      const pid = Number(match?.[1] ?? 0);
      const command = match?.[2] ?? '';
      if (!pid || pid === process.pid || !command.includes(marker)) continue;
      if (!/(moli|chromium|google chrome)/i.test(command)) continue;
      found.push({ pid, command });
    }
    return found;
  }

  /** Acquires the exclusive profile lock with a maintained lock library, then quiesces verified leftovers. */
  private async ensureOwnership() {
    if (this.release) return;
    const target = this.options.profileDirectory;
    // The owned profile directory is private and must exist before the lock file can be created.
    await mkdir(target, { recursive: true, mode: 0o700 });
    await chmod(target, 0o700);
    try {
      this.release = await lockfile.lock(target, {
        stale: 60000, update: 10000, realpath: false, retries: { retries: 10, minTimeout: 200, maxTimeout: 1000 },
        onCompromised: () => {
          this.release = null;
          this.ownershipLost = true;
          // Stop the owned page/process immediately so a stale actor cannot keep clicking.
          void this.closeBrowser().catch(() => {});
        },
      });
    } catch {
      throw new BrowserUnavailable('SESSION_OWNERSHIP', 'Another actor holds this private browser profile; automation stays paused until it is released.');
    }
    await this.quiesceOwnedProcesses();
  }

  private async releaseOwnership() {
    const release = this.release;
    this.release = null;
    if (release) await release().catch(() => {});
  }

  private async quiesceOwnedProcesses() {
    const live = await this.ownedProcesses();
    for (const { pid } of live) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        throw new BrowserUnavailable('SESSION_OWNERSHIP', `Owned browser process ${pid} could not be terminated`);
      }
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!(await this.ownedProcesses()).length) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new BrowserUnavailable('SESSION_OWNERSHIP', 'Owned browser processes did not exit; refusing to start a second browser for this profile');
  }

  /** Called before every external step so a compromised lease stops admitting commands. */
  assertOwned() {
    if (!this.release || this.ownershipLost) throw new BrowserUnavailable('SESSION_OWNERSHIP', 'This worker no longer owns the browser profile');
  }

  // ---------- engine lifecycle ----------
  /** Starts this actor's own Moli server on an OS-assigned loopback port and only attaches to the
   *  endpoint that this exact child announced. */
  private async startMoli() {
    const child = spawn(this.options.moliExecutable, ['serve', '--host', '127.0.0.1', '--port', '0', '--layout', '--profile-dir', this.options.profileDirectory], { stdio: ['ignore', 'ignore', 'pipe'] });
    this.moli = child;
    let log = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', chunk => {
      log = `${log}${String(chunk)}`.slice(-4000);
    });
    child.once('exit', () => {
      if (this.moli === child) this.moli = null;
    });
    const endpoint = await this.awaitMoliEndpoint(child, () => log).catch(error => {
      child.kill('SIGTERM');
      throw error;
    });
    if (endpoint.host !== '127.0.0.1' || endpoint.port < 1024) {
      child.kill('SIGTERM');
      throw new BrowserUnavailable('BROWSER_UNAVAILABLE', `Moli announced an unusable endpoint ${endpoint.host}:${endpoint.port}`);
    }
    this.endpoint = endpoint;
    return playwrightChromium.connectOverCDP(`http://${endpoint.host}:${endpoint.port}`, { timeout: 20000 });
  }

  /** Spawn failure, an early exit or a silent child fails fast instead of probing someone else's port. */
  private awaitMoliEndpoint(child: ChildProcess, readLog: () => string) {
    return new Promise<{ host: string; port: number }>((resolve, reject) => {
      let settled = false;
      const done = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poller);
        child.off('error', onError);
        child.off('exit', onExit);
        action();
      };
      const onError = (error: Error) => done(() => reject(new BrowserUnavailable('BROWSER_UNAVAILABLE', `Moli could not start: ${error.message.slice(0, 200)}`)));
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => done(() => reject(new BrowserUnavailable('BROWSER_UNAVAILABLE', `Moli exited before exposing a CDP endpoint (code ${code ?? 'null'}, signal ${signal ?? 'none'}): ${readLog().trim().slice(-200)}`)));
      const check = () => {
        const endpoint = moliEndpoint(readLog());
        if (endpoint) done(() => resolve(endpoint));
      };
      const timer = setTimeout(() => done(() => reject(new BrowserUnavailable('BROWSER_UNAVAILABLE', `Moli exposed no CDP endpoint within 20s: ${readLog().trim().slice(-200)}`))), 20000);
      const poller = setInterval(check, 100);
      child.once('error', onError);
      child.once('exit', onExit);
      check();
    });
  }

  /** Patchright opens the installed Chrome once as a headed persistent context: the window the human
   *  uses for login and verification is the same context this adapter reads. No launch args, headers or
   *  fingerprint scripts are added; `viewport: null` and `acceptDownloads: false` keep it a normal window. */
  private async startPatchright() {
    try {
      const context = await patchrightChromium.launchPersistentContext(this.options.profileDirectory, {
        channel: 'chrome', headless: false, chromiumSandbox: true, viewport: null, acceptDownloads: false, timeout: LAUNCH_TIMEOUT_MS,
      });
      this.headedLabel = 'patchright-system-chrome';
      this.applyTimeouts(context);
      return context;
    } catch (error) {
      throw new BrowserUnavailable('BROWSER_UNAVAILABLE', `Patchright 无法启动本机 Chrome：${error instanceof Error ? error.message.split('\n')[0]?.slice(0, 200) : 'unknown'}`);
    }
  }

  /** Legacy headed Playwright context, opened only when the configured Moli engine has no human window. */
  private async startHeadedPlaywright() {
    const launches: Array<{ channel?: 'chrome'; label: string }> = [{ label: 'playwright-chromium' }, { channel: 'chrome', label: 'system-chrome' }];
    const failures: string[] = [];
    for (const launch of launches) {
      try {
        const context = await playwrightChromium.launchPersistentContext(this.options.profileDirectory, { headless: false, viewport: null, acceptDownloads: false, timeout: LAUNCH_TIMEOUT_MS, ...(launch.channel ? { channel: launch.channel } : {}) });
        this.headedLabel = launch.label;
        this.applyTimeouts(context);
        return context;
      } catch (error) {
        failures.push(`${launch.label}: ${error instanceof Error ? error.message.split('\n')[0]?.slice(0, 160) : 'unknown'}`);
      }
    }
    throw new BrowserUnavailable('BROWSER_UNAVAILABLE', `Headed browser could not start (${failures.join(' | ')})`);
  }

  private applyTimeouts(context: ManagedContext) {
    context.setDefaultTimeout(ACTION_TIMEOUT_MS);
    context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  }

  private limitation() {
    if (this.activeEngine === 'moli') return 'Moli 1.1.19 无可见窗口；需要人工登录或验证时改用有头浏览器。';
    if (this.headedLabel === 'playwright-chromium' || this.headedLabel === 'system-chrome') return 'Moli 1.1.19 无可见窗口，已按已批准的成熟浏览器回退打开独立的 headed Playwright 会话。';
    return null;
  }

  /** Latched pause: program actions stop, the page stays in place for the human, and only an explicit
   *  check that observes a usable page clears it. The site's own scripts keep running regardless. */
  private markPaused(reason: PauseReason, detail: string) {
    if (!this.pause) this.pause = { reason, detail };
  }

  private pausedError(stage: ActionStage) {
    return new BrowserUnavailable('SESSION_PAUSED', this.pause?.detail ?? '本机会话已暂停，等待人工处理后显式检查。', { stage, pauseReason: this.pauseState() });
  }

  /** The task-level reason of the current latch, shared by errors and pause observations. */
  private pauseState(): 'login_required' | 'verification_required' | 'site_restricted' {
    const reason = this.pause?.reason ?? 'restricted';
    return reason === 'login_required' || reason === 'verification_required' ? reason : 'site_restricted';
  }

  private assertNotPaused(stage: ActionStage) {
    if (this.pause) throw this.pausedError(stage);
  }

  /** Counts only main-frame navigations this actor did not cause, so a JS loop is reported honestly. */
  private recordNavigation(page: ManagedPage) {
    if (Date.now() - this.lastProgramActionAt <= SELF_NAVIGATION_WINDOW_MS) return;
    let path = '';
    try {
      path = new URL(page.url()).pathname;
    } catch {
      return;
    }
    const now = Date.now();
    this.navigations.push({ at: now, path });
    this.navigations = this.navigations.filter(sample => now - sample.at <= LOOP_WINDOW_MS);
    const repeated = this.navigations.filter(sample => sample.path === path).length;
    if (this.navigations.length >= LOOP_NAVIGATION_LIMIT || repeated >= LOOP_SAME_PATH_LIMIT) {
      this.markPaused('navigation_loop', `12 秒内主框架自行跳转 ${this.navigations.length} 次（同一路径 ${repeated} 次），已停止程序动作并保留当前页；页面自身的脚本可能仍在跳转，请人工确认后显式检查恢复。`);
    }
  }

  /** Adopts the one page this actor manages, tracks its main-frame navigations and observes its business
   *  responses. The observation is registered here, before the initial navigation and before any action, so a
   *  capture is always tied to the action that caused it. */
  private adoptPage(page: ManagedPage) {
    this.page = page;
    this.navigations = [];
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) this.recordNavigation(page);
    });
    this.attachApi(page);
    page.once('close', () => {
      if (this.page === page) this.page = null;
      this.closeObserver();
      this.detachApi();
    });
  }

  // ---------- response evidence ----------
  //
  // Only requests the site itself sends to the two published endpoints on the configured first-party origin with
  // the method the observed frontend uses are candidates. The request object is only an opaque identity key:
  // the four bounded search fields are projected out of the submit body immediately and everything else — the
  // complete query, the complete body, securityId/lid, headers, cookies — is dropped at that point.

  /** Registers the driver's own request/response events on the owned page, once, before the initial navigation
   *  and therefore before every normal action. Without a scan observer the events are ignored. */
  private attachApi(page: ManagedPage) {
    if (this.observerPage === page && this.apiHandlers) return;
    this.detachApi();
    const onRequest = (request: ManagedRequest) => this.observer?.noteRequest({
      identity: request,
      url: request.url(),
      method: request.method(),
      contentType: headerValue(request.headers(), 'content-type'),
      // The body of the observed search submit is projected immediately; a detail request's query is never read.
      body: request.method() === 'POST' ? request.postData() : null,
    });
    const onResponse = (response: ManagedResponse) => {
      const observer = this.observer;
      if (!observer) return;
      const ticket = observer.noteResponse(response.request(), response.status(), declaredBytes(headerValue(response.headers(), 'content-length')));
      if (!ticket) return;
      // The driver offers no streaming or cancellation here, so the read is bounded by what this adapter starts
      // and accepts (see BossResponseObserver); a late body is dropped by its generation and deadline checks.
      void response.text().then(text => observer.noteBody(ticket, text), () => observer.noteBody(ticket, null));
    };
    page.on('request', onRequest);
    page.on('response', onResponse);
    this.observerPage = page;
    this.apiHandlers = { onRequest, onResponse };
  }

  /** Removes the page listeners; the observer is disposed separately so no in-flight body can be stored. */
  private detachApi() {
    const page = this.observerPage;
    const handlers = this.apiHandlers;
    if (page && handlers) {
      page.off('request', handlers.onRequest);
      page.off('response', handlers.onResponse);
    }
    this.observerPage = null;
    this.apiHandlers = null;
  }

  /** Starts the observation lifetime of one scan; a new lifetime id fences every late body of the previous one. */
  private openObserver(scan: { scope: BossObservationScope; encoding: BossSearchEncoding | null; success: BossSuccessSemantics }) {
    this.observer?.dispose();
    this.observerGeneration += 1;
    this.observer = new BossResponseObserver({
      origin: this.options.origin,
      success: scan.success,
      encoding: scan.encoding,
      scope: scan.scope,
      generation: this.observerGeneration,
      bodyReads: this.bodyReads,
      actionEpoch: () => this.actionEpoch,
    });
  }

  /** Ends the observation lifetime: the observer is disposed, so every in-flight body is fenced off. */
  private closeObserver() {
    this.observer?.dispose();
    this.observer = null;
  }

  /** Starts one serialized page action; a response is only attributable to the action that caused it. */
  private beginAction() {
    if (this.actionBusy) throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', '上一个页面动作尚未结束；程序不会并发操作同一个页面。');
    this.actionBusy = true;
    this.actionEpoch += 1;
    return this.actionEpoch;
  }

  private endAction() {
    this.actionBusy = false;
  }

  /** Admission for a bounded wait: a lost lease, a closed page or a latched pause ends the wait at once. */
  private canObserve() {
    if (this.pause) return false;
    const page = this.page;
    return this.ownedForPolling() && Boolean(page) && !page!.isClosed();
  }

  /** Waits a bounded time for the response of one action, without ever navigating or clicking again. */
  private async awaitApi(page: ManagedPage, kind: 'search' | 'detail', actionEpoch: number): Promise<BossCaptureWait> {
    const observer = this.observer;
    if (!observer) return { status: 'stopped' };
    return awaitBossCapture({
      poll: () => observer.find(kind, actionEpoch),
      admit: () => this.canObserve(),
      now: () => Date.now(),
      sleep: async ms => {
        await page.waitForTimeout(ms);
      },
      deadlineMs: kind === 'search' ? BOSS_SEARCH_RESPONSE_TIMEOUT_MS : BOSS_DETAIL_RESPONSE_TIMEOUT_MS,
    });
  }

  /** The monotonic detail-arrival sequence of the active observer; `0` when no scan observes the page. */
  private get detailActivity() {
    return this.observer?.detailActivity ?? 0;
  }

  /** The one active card's own posting identity, from the scoped list container only. */
  private async readActiveIdentity(page: ManagedPage, profile: RenderedBossProfile): Promise<{ ok: true; identity: string | null } | { ok: false; detail: string }> {
    const snapshot = await page.locator(profile.surfaceSelectors.activeCard).evaluateAll((elements, linkSelector) => ({
      cardCount: elements.length,
      paths: elements.flatMap(element => Array.from(element.querySelectorAll<HTMLAnchorElement>(linkSelector), link => link.pathname)),
    }), profile.surfaceSelectors.cardLink).catch(() => null);
    return activePostingIdentity(snapshot);
  }

  /** The pinned frontend release, read from the scripts the owned page actually loaded. */
  private async observeRelease(page: ManagedPage): Promise<BossReleaseObservation> {
    const sources = await page.locator('script[src]').evaluateAll(elements => elements.map(element => (element as HTMLScriptElement).src)).catch(() => [] as string[]);
    return classifyBossRelease(sources);
  }

  /** Returns the managed page, adopting a page the persistent profile restored or creating one. Only a
   *  page with no loaded document is navigated, and then exactly once; a restored login/verification
   *  page is never touched. */
  private async managePage(context: ManagedContext): Promise<ManagedPage> {
    const managed = this.page && !this.page.isClosed() ? this.page : null;
    if (managed) return managed;
    const opened = context.pages().filter(page => !page.isClosed());
    const page = opened.find(candidate => loadedDocument(candidate.url())) ?? opened[0] ?? (await context.newPage());
    this.adoptPage(page);
    if (!loadedDocument(page.url())) {
      this.lastProgramActionAt = Date.now();
      // One known site entry page, opened once: the explicit open never re-checks the site home page.
      this.initialNavigation = 'performed';
      try {
        await page.goto(this.options.profile.entryUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
      } catch (error) {
        // The URL can commit before `domcontentloaded` is awaited, so a rejected initial navigation is a
        // lifecycle failure regardless of the current address; the caller must not report it as opened.
        this.initialNavigation = 'failed';
        throw error;
      }
    }
    return page;
  }

  private async ownPage(): Promise<ManagedPage> {
    if (this.page && !this.page.isClosed()) return this.page;
    throw new BrowserUnavailable('SESSION_PAGE_NOT_READY', 'No owned page is open');
  }

  async ensureBrowser(engine: BossEngine = this.activeEngine) {
    // One profile can only be driven by one browser: switching engine closes the current one first.
    if ((this.context || this.browser) && this.activeEngine !== engine) await this.closeBrowser();
    await this.ensureOwnership();
    if (engine === 'moli') {
      const cdp = this.browser ?? (this.browser = await this.startMoli());
      const context = cdp.contexts()[0] ?? (await cdp.newContext());
      this.context = context;
      this.activeEngine = 'moli';
      return this.managePage(context);
    }
    if (!this.context) {
      this.context = engine === 'patchright' ? await this.startPatchright() : await this.startHeadedPlaywright();
      this.activeEngine = engine;
    }
    return this.managePage(this.context);
  }
  /** True when any element matching the selector list is visible. `locator.visible()` is the driver's own
   *  supported filter, so a hidden first match cannot hide a visible challenge further down the list. */
  private async anyVisible(page: ManagedPage, selector: string) {
    return (await page.locator(selector).visible().count().catch(() => 0)) > 0;
  }

  /** A frequency or limit notice is only trusted when that exact phrase is rendered, so a generic error
   *  page stays an ordinary page failure instead of being reported as anti-bot. */
  private async limitNotice(page: ManagedPage) {
    const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    return LIMIT_NOTICES.find(notice => text.includes(notice)) ?? null;
  }

  /** Self-initiated main-frame navigations still inside the diagnostic window. */
  private recentNavigations() {
    const now = Date.now();
    this.navigations = this.navigations.filter(sample => now - sample.at <= LOOP_WINDOW_MS);
    return this.navigations;
  }

  /** Reads the managed page without ever navigating or lifting a latch. Detection is always live. */
  private async observePage(page: ManagedPage): Promise<ObservedSession> {
    const selectors = this.options.profile.selectors;
    const loopPause = this.pause?.reason === 'navigation_loop' ? this.pause : null;
    if (loopPause && this.recentNavigations().length) {
      return { state: 'restricted', detail: loopPause.detail, accountMarker: null, engine: this.activeEngine, humanWindow: this.headedLabel ? 'open' : 'none', limitation: this.limitation() };
    }
    let path = '';
    try {
      path = new URL(page.url()).pathname;
    } catch {
      path = '';
    }
    // Any matching element must be visible: a hidden first match may not mask a visible later one.
    const visible = (selector: string) => this.anyVisible(page, selector);
    let state: ObservedSession['state'] = 'unavailable';
    let detail = `未识别页面状态：${redactUrl(page.url()) || 'about:blank'}`;
    try {
      const notice = await this.limitNotice(page);
      if (SAFETY_PATH.test(path)) {
        state = 'verification_required';
        detail = '站点把人机校验放在独立页面，请在当前浏览器窗口内手动完成；程序不会自动刷新或返回。';
      } else if (await visible(selectors.verificationIndicator)) {
        state = 'verification_required';
        detail = '站点要求人机校验，请在当前浏览器窗口内手动完成。';
      } else if (notice) {
        // A rendered frequency/limit sentence is the evidence; its container markup may change freely.
        state = 'restricted';
        detail = `站点显示明确的访问频率或次数限制提示（${notice}），程序已停止后续动作，等待人工处理后显式检查。`;
      } else if (await visible(selectors.loginIndicator)) {
        state = 'login_required';
        detail = '需要在本机浏览器窗口中完成登录。';
      } else if (await visible(selectors.readyIndicator)) {
        state = 'ready';
        detail = '已检测到登录后的站点导航。';
      }
    } catch (error) {
      detail = `页面读取失败：${redactError(error)}`;
    }
    if (state === 'login_required' || state === 'verification_required' || state === 'restricted') this.markPaused(state, detail);
    let accountMarker: string | null = null;
    if (state === 'ready' && selectors.accountMarker) {
      const markers = page.locator(selectors.accountMarker).visible();
      const raw = await markers.count() === 1
        ? await markers.first().evaluate(element => element.getAttribute('data-uid') ?? element.getAttribute('data-userid')).catch(() => null)
        : null;
      if (raw) accountMarker = accountMarkerFor(raw);
    }
    return { state, detail, accountMarker, engine: this.activeEngine, humanWindow: this.headedLabel ? 'open' : 'none', limitation: this.limitation() };
  }

  /** Observes the current page and refuses program actions on a blocked login/verification/limit page. */
  private async requireActable(page: ManagedPage, stage: ActionStage) {
    if (this.pause) throw this.pausedError(stage);
    const observed = await this.observePage(page);
    if (observed.state === 'ready' || observed.state === 'unavailable') return observed;
    throw this.pausedError(stage);
  }

  /** Blocking evidence the actor can prove without navigating: an existing latch, or a login, verification
   *  or limit page the current document shows. A page it cannot classify is not evidence of either. */
  private async pauseEvidence(page: ManagedPage): Promise<ObservedSession | null> {
    const observed = await this.observePage(page).catch(() => null);
    if (observed && (observed.state === 'login_required' || observed.state === 'verification_required' || observed.state === 'restricted')) return observed;
    if (!this.pause) return null;
    return observed ?? { state: 'restricted', detail: this.pause.detail, accountMarker: null, engine: this.activeEngine, humanWindow: this.headedLabel ? 'open' : 'none', limitation: this.limitation() };
  }

  /** A navigation or read failure is re-read on the page it left behind. Only independently observed block
   *  evidence becomes SESSION_PAUSED; otherwise the original driver or Timeout error is preserved. */
  private async pageFailure(page: ManagedPage, error: unknown, stage: ActionStage): Promise<never> {
    if (await this.pauseEvidence(page)) throw this.pausedError(stage);
    throw error;
  }

  private unavailableObservation(error: unknown): ObservedSession {
    return {
      state: 'unavailable', detail: redactError(error),
      accountMarker: null, engine: this.activeEngine, humanWindow: this.headedLabel ? 'open' : 'none', limitation: this.limitation(),
    };
  }

  private absentObservation(): ObservedSession {
    return {
      state: 'absent', detail: '尚无受管的 BOSS 页面：程序不会自行启动浏览器或导航，请先打开登录/验证窗口。',
      accountMarker: null, engine: this.activeEngine, humanWindow: 'none', limitation: this.limitation(),
    };
  }

  /** Opens or focuses the owned browser. An existing managed page is only observed and never navigated;
   *  a page without a loaded document gets exactly one initial navigation. */
  async openSession(): Promise<ObservedSession> {
    this.initialNavigation = 'not_required';
    try {
      const preferred: BossEngine = this.context || this.browser ? this.activeEngine : this.options.engine;
      if (preferred === 'moli') {
        const page = await this.ensureBrowser('moli');
        this.recordOpen('opened');
        await page.bringToFront().catch(() => {});
        const observed = await this.observePage(page);
        if (observed.state === 'ready' || !this.options.headedFallback) return observed;
        // Moli 1.1.19 has no operable window; reopen the same private profile as a disclosed headed session.
        await this.closeBrowser();
        this.initialNavigation = 'not_required';
        const fallback = await this.ensureBrowser('playwright');
        this.recordOpen('opened');
        await fallback.bringToFront().catch(() => {});
        return await this.observePage(fallback);
      }
      const page = await this.ensureBrowser(preferred);
      this.recordOpen('opened');
      await page.bringToFront().catch(() => {});
      return await this.observePage(page);
    } catch (error) {
      this.recordOpen('failed', error);
      return this.unavailableObservation(error);
    }
  }

  /** Read-only session check. It never launches a browser, creates a page or navigates anywhere, and an
   *  automated check may never lift a latched pause: only the owner's explicit `checkSession` can. */
  async inspectSession(): Promise<ObservedSession> {
    const page = this.page;
    if (!page || page.isClosed()) return this.absentObservation();
    try {
      return await this.observePage(page);
    } catch (error) {
      return this.unavailableObservation(error);
    }
  }

  /** The owner's explicit session check after handling a login, verification or limit page. It reads the
   *  page exactly like a check does and is the only path that may lift the local pause latch. A page that
   *  is still navigating itself reports `restricted`, so it never reads as recovered. */
  async checkSession(): Promise<ObservedSession> {
    const page = this.page;
    if (!page || page.isClosed()) return this.absentObservation();
    try {
      const observed = await this.observePage(page);
      if (observed.state === 'ready') this.pause = null;
      return observed;
    } catch (error) {
      return this.unavailableObservation(error);
    }
  }

  /** Explicit read-only evidence for native-filter verification. No values, cookies, navigation or input. */
  async observeControls() {
    this.assertOwned();
    const page=await this.ownPage();
    if(new URL(page.url()).origin!==new URL(this.options.origin).origin)throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED','当前页面不属于配置站点。');
    const evidence=await page.locator('body').evaluate(body=>{
      const doc=body.ownerDocument;
      const groups=['li.nav-figure .label-text, li.nav-figure img','.login-form, .sign-form'].map(selector=>Array.from(doc.querySelectorAll(selector)).filter(element=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(element).visibility!=='hidden';}).slice(0,12).map(element=>({tag:element.tagName,id:element.id.slice(0,100),className:element.getAttribute('class')?.slice(0,180)??''})));
      return {
        pagePath:doc.location.pathname,
        authenticatedNavigation:groups[0]??[],
        loginForms:groups[1]??[],
        inputs:Array.from(doc.querySelectorAll('input,select')).filter(element=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(element).visibility!=='hidden';}).slice(0,40).map(element=>({tag:element.tagName,id:element.id.slice(0,100),className:element.getAttribute('class')?.slice(0,180)??'',name:element.getAttribute('name')?.slice(0,80)??'',type:element.getAttribute('type')??'',placeholder:element.getAttribute('placeholder')?.slice(0,120)??''})),
        forms:Array.from(doc.querySelectorAll('form')).slice(0,8).map(element=>({tag:element.tagName,id:element.id.slice(0,100),className:element.getAttribute('class')?.slice(0,180)??'',method:element.method,actionPath:new URL(element.action,doc.location.href).pathname})),
        controls:Array.from(doc.querySelectorAll('a,button,[role="button"],label')).filter(element=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(element).visibility!=='hidden';}).map(element=>({element,text:element.textContent?.replace(/\s+/g,' ').trim()??''})).filter(item=>item.text.length<=40&&/搜索|城市|薪资|广州|深圳|切换|不限|待遇|职位|简历/.test(item.text)).slice(0,50).map(({element,text})=>({tag:element.tagName,id:element.id.slice(0,100),className:element.getAttribute('class')?.slice(0,180)??'',text,linkPath:element.tagName==='A'?new URL(element.getAttribute('href')??'',doc.location.href).pathname:null})),
        scripts:Array.from(doc.querySelectorAll('script[src]')).slice(0,30).map(element=>{const raw=element.getAttribute('src')??'';return new URL(raw,doc.location.href).pathname;}),
      };
    });
    if(new URL(page.url()).origin!==new URL(this.options.origin).origin||new URL(page.url()).pathname!==evidence.pagePath)throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED','观测期间页面发生变化，未接纳证据。');
    return{observedAt:new Date().toISOString(),...evidence};
  }

  async observeSiteResume(expectedName: string) {
    this.assertOwned();
    const page = await this.ownPage();
    await this.requireActable(page, 'navigation');
    const origin = new URL(this.options.origin).origin;
    if (new URL(page.url()).origin !== origin) throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED','简历检查页面不属于配置站点。');
    if (new URL(page.url()).pathname !== '/web/geek/resume') {
      const links = page.locator('a[href*="/web/geek/resume"]').visible();
      const count = await links.count();
      if (!count) throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED','页面没有可见的站内简历入口。');
      let href: string | null = null;
      for (let index=0;index<count;index++) {
        const observedHref=await links.nth(index).getAttribute('href');
        const destination=new URL(observedHref??'',page.url());
        if(destination.origin!==origin||destination.pathname!=='/web/geek/resume')throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED','简历入口目标不一致，未导航。');
        href=destination.toString();
      }
      if (!href) throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED','站内简历入口缺失。');
      this.lastProgramActionAt = Date.now();
      try { await page.goto(new URL(href,origin).toString(),{waitUntil:'domcontentloaded',timeout:NAVIGATION_TIMEOUT_MS}); }
      catch(error){await this.pageFailure(page,error,'navigation');}
    }
    await this.requireActable(page, 'navigation');
    if (new URL(page.url()).origin !== origin || new URL(page.url()).pathname !== '/web/geek/resume') throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED','简历页未就绪，未读取其他页面。');
    const evidence = await page.locator('body').evaluate((body,name)=>({
      pagePath:body.ownerDocument.location.pathname,
      expectedNameMatched:(body.textContent??'').includes(name),
      controls:Array.from(body.querySelectorAll('a,button,span,div,input')).filter(element=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(element).visibility!=='hidden';}).map(element=>({element,text:Array.from(element.childNodes).filter(node=>node.nodeType===3).map(node=>node.textContent??'').join(' ').replace(/\s+/g,' ').trim()})).filter(item=>item.text.length>0&&item.text.length<=100&&/简历|附件|\.pdf|\.docx?|发送|预览|上传|在线/.test(item.text)).slice(0,60).map(({element,text})=>({tag:element.tagName,className:element.getAttribute('class')??'',text,role:element.getAttribute('role'),fileId:element.getAttribute('data-file-id'),resumeId:element.getAttribute('data-resume-id')})),
    }),expectedName);
    await this.requireActable(page,'navigation');
    return {observedAt:new Date().toISOString(),...evidence};
  }

  async closeBrowser() {
    this.navigations = [];
    this.lastProgramActionAt = 0;
    this.closeObserver();
    this.detachApi();
    this.scan = null;
    this.actionBusy = false;
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    if (this.moli) {
      this.moli.kill('SIGTERM');
      this.moli = null;
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.endpoint = null;
    await this.releaseOwnership();
  }

  async clearSession() {
    await this.closeBrowser();
    await this.quiesceOwnedProcesses().catch(() => {});
    await rm(this.options.profileDirectory, { recursive: true, force: true });
    await this.releaseOwnership();
    this.pause = null;
  }

  async close() {
    await this.closeBrowser();
  }

  // ---------- native filters and reading ----------
  /** Legacy synthetic adapter: the fixture renders real HTML `<select>` controls, so they are driven as
   *  selects. The live site never uses this path. */
  private async selectIfPresent(page: ManagedPage, selector: string, label: string) {
    // The latch and the current page are admitted immediately before the interaction, not only after it.
    await this.requireActable(page, 'pre_click');
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) throw new BrowserUnavailable('NATIVE_FILTER_UNVERIFIED', `Native control not found: ${selector}`);
    this.lastProgramActionAt = Date.now();
    try {
      await locator.selectOption({ label }).catch(async () => {
        await locator.selectOption(label).catch(() => {
          throw new BrowserUnavailable('NATIVE_FILTER_UNVERIFIED', `Native control ${selector} could not select ${label}`);
        });
      });
      // Native controls on the real site submit and navigate; the page is re-read before trusting it.
      await page.waitForLoadState('domcontentloaded');
    } catch (error) {
      // A rejected postback that landed on a safety or limit page is a session block, not a bad control;
      // with no such evidence the original control or driver error is preserved unchanged.
      await this.pageFailure(page, error, 'pre_click');
    } finally {
      await page.waitForTimeout(200);
    }
    await this.requireActable(page, 'pre_click');
    const refreshed = page.locator(selector).first();
    const selected = await refreshed.evaluate(element => {
      const target = element as HTMLSelectElement & HTMLInputElement;
      if ('selectedOptions' in target && target.selectedOptions?.length) return target.selectedOptions[0]?.textContent?.trim() ?? '';
      return target.value;
    }).catch(() => '');
    if (!selected.includes(label)) throw new BrowserUnavailable('NATIVE_FILTER_UNVERIFIED', `Native control ${selector} did not keep ${label}`);
    return selected;
  }

  /** Streams one search at a time. Each batch carries the exact evidence of the controls that produced it and
   *  is yielded while that search is still the page's current one, so the caller reserves and reads its cards
   *  before the next city/role replaces the result list. The profile's surface decides how a search is driven;
   *  neither path accepts a URL, selector or salary band from outside. Every observation of this scan carries
   *  the owner, task revision and session generation it was admitted under, and the scan's detail reservations
   *  are held until the scan ends. */
  async *searchPostings(policy: CareerPolicy, limitPerSearch: number, scope: BossObservationScope): AsyncGenerator<SearchBatch, void, undefined> {
    const page = await this.ownPage();
    const profile = this.options.profile;
    this.closeObserver();
    this.scan = {
      scope,
      ledger: new BossDetailLedger(CAREER_MAX_POSTINGS),
      encoding: profile.surface === 'rendered' ? profile.encoding : null,
      success: profile.surface === 'rendered' ? profile.success : { status: 'unknown' },
    };
    // The observer lives for this scan only: its lifetime id fences every body of an older scan, and the
    // synthetic fixture surface never reads a business response.
    if (profile.surface === 'rendered') {
      this.attachApi(page);
      this.openObserver({ scope, encoding: profile.encoding, success: profile.success });
    }
    try {
      yield* streamSearches(searchPlan(policy), target => (profile.surface === 'synthetic'
        ? this.searchSynthetic(page, profile, target, policy.salaryUpperMinCnyMonthly, limitPerSearch)
        : profile.surface === 'works_dom'
          ? this.searchWorks(page, target, limitPerSearch)
          : this.searchRendered(page, profile, target)));
    } finally {
      this.closeObserver();
      this.scan = null;
    }
  }

  /** Reserves one distinct detail identity before any opening. Slots are never refunded, and the shared
   *  thirty-posting budget of the task is the outer bound the scan cannot exceed. */
  reserveDetailRead(identity: string) {
    const scan = this.scan;
    if (!scan) throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', '当前没有进行中的只读扫描，无法预留详情读取名额。');
    const reservation = scan.ledger.reserve(identity, Date.now());
    return reservation.ok ? { ok: true as const, reserved: scan.ledger.count } : { ok: false as const, reason: reservation.reason };
  }

  /** Fixture-only search: one plain listing navigation, then the fixture's HTML selects. Every native salary
   *  band that can include a qualified monthly upper bound is selected in turn, so a narrow band cannot
   *  silently drop a qualifying range; each posting range is re-checked after reading. */
  private async searchSynthetic(
    page: ManagedPage, profile: SyntheticBossProfile, target: SearchTarget, salaryUpperMinCnyMonthly: number, limit: number,
  ): Promise<SearchBatch> {
    this.assertNotPaused('navigation');
    this.lastProgramActionAt = Date.now();
    try {
      await page.goto(profile.listingUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      // A rejected search navigation is re-read on the page it reached: only real block evidence stops
      // the scan, otherwise the original driver or Timeout error stays a page failure.
      await this.pageFailure(page, error, 'navigation');
    }
    // A login, verification or limit page stops the whole scan here instead of becoming a page failure.
    await this.requireActable(page, 'navigation');
    const hasCards = await page.waitForSelector(profile.selectors.resultCard, { timeout: RESULT_WAIT_MS }).then(() => true).catch(() => false);
    if (!hasCards) {
      const observed = await this.observePage(page);
      if (observed.state === 'login_required' || observed.state === 'verification_required' || observed.state === 'restricted') throw this.pausedError('navigation');
      // An empty result list is legitimate while the native controls are readable; a page without
      // them is an ordinary read failure, never an unverified native control.
      if ((await page.locator(profile.filters.city).count()) === 0) {
        throw new Error(`搜索结果页没有可读岗位或筛选控件：${redactUrl(page.url()) || 'about:blank'}`);
      }
    }
    const salaryLabels = await this.salaryControlLabels(page, profile, salaryUpperMinCnyMonthly);
    const salaryControls: NativeFilterEvidence['controls'] = [];
    const cards: SearchCard[] = [];
    const seen = new Set<string>();
    const city = await this.selectIfPresent(page, profile.filters.city, target.city);
    const position = await this.selectIfPresent(page, profile.filters.position, target.position);
    for (const salaryLabel of salaryLabels.length ? salaryLabels : [null]) {
      if (salaryLabel) salaryControls.push({ label: 'salary', selected: await this.selectIfPresent(page, profile.filters.salary, salaryLabel), url: redactUrl(page.url()) });
      for (const card of await this.readSearchResults(limit)) {
        if (!card.sitePostingId || seen.has(card.sitePostingId)) continue;
        seen.add(card.sitePostingId);
        cards.push(card);
      }
      if (salaryControls.length > 3) break;
    }
    return {
      evidence: {
        searchKey: `${target.city}:${target.role}`,
        controls: [
          { label: 'city', selected: city, url: redactUrl(page.url()) },
          { label: 'position', selected: position, url: redactUrl(page.url()) },
          ...salaryControls,
        ],
      },
      cards,
    };
  }

  private async searchWorks(page: ManagedPage, target: SearchTarget, limit: number): Promise<SearchBatch> {
    await this.requireActable(page, 'navigation');
    const url = worksSearchUrl(this.options.origin, target);
    this.assertNotPaused('navigation');
    this.lastProgramActionAt = Date.now();
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }); }
    catch (error) { await this.pageFailure(page, error, 'navigation'); }
    await this.requireActable(page, 'navigation');
    const hasCards = await page.waitForSelector(this.options.profile.selectors.resultCard, { timeout: RESULT_WAIT_MS }).then(() => true).catch(() => false);
    await this.requireActable(page, 'navigation');
    if (new URL(page.url()).origin !== new URL(this.options.origin).origin || new URL(page.url()).pathname !== '/web/geek/jobs') {
      throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', '搜索跳转后不在预期职位页，已停止读取。');
    }
    if (!hasCards && !(await page.locator('.job-empty').count())) {
      throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', '未观察到受支持的岗位列表或空结果标记，已暂停预览。');
    }
    const cards = hasCards ? await this.readSearchResults(limit) : [];
    if (hasCards && !cards.some(card => card.sitePostingId)) {
      throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', '岗位卡片没有可核对的详情链接，未猜测标识或点击。');
    }
    return { cards, evidence: {
      method: 'search_url', searchKey: `${target.city}:${target.role}`,
      controls: [
        { label: 'URL 请求城市（未验证原生控件）', selected: target.city, url },
        { label: 'URL 请求关键词', selected: target.position, url },
        { label: '薪资筛选方式', selected: '本地逐岗核对，未设置站点薪资筛选', url },
      ],
    } };
  }

  /** Salary bands are read from the fixture's select; the band whose parsed upper bound can reach the
   *  configured monthly threshold is selected, and the per-posting range is re-checked after reading. */
  private async salaryControlLabels(page: ManagedPage, profile: SyntheticBossProfile, threshold: number) {
    const locator = page.locator(profile.filters.salary).first();
    if ((await locator.count()) === 0) return [];
    const labels = await locator.evaluate(element => Array.from((element as HTMLSelectElement).options).map(option => option.textContent?.trim() ?? '').filter(Boolean));
    return labels.filter(label => {
      const numbers = label.match(/\d+/g)?.map(Number) ?? [];
      const upper = numbers.length >= 2 ? numbers[1] : numbers[0];
      return typeof upper === 'number' && upper * 1000 >= threshold;
    });
  }

  // ---------- rendered surface (live site) ----------
  //
  // The live site renders its filters as in-page widgets and shows a posting in the list's right-hand pane.
  // Every selector below is a curated observation of that page: a lookup must resolve to exactly one visible
  // control, every applied control is re-read, and a search is accepted only from the response that answered
  // this actor's own submit. A detail is accepted only from the response that answered its own card click and
  // only for an identity reserved inside the task's shared budget. Everything else pauses with the reason.

  /** Resolves exactly one visible control for a curated selector; an absent or ambiguous one pauses. */
  private async uniqueVisible(page: ManagedPage, selector: string, what: string) {
    const matches = page.locator(selector).visible();
    const count = await matches.count().catch(() => 0);
    if (count === 1) return matches.first();
    if (count > 1) throw new BrowserUnavailable('NATIVE_FILTER_UNVERIFIED', `页面上有 ${count} 个可见的${what}（${selector}）；程序不会猜测该操作哪一个。`);
    throw new BrowserUnavailable('NATIVE_FILTER_UNVERIFIED', `页面上找不到可见的${what}（${selector}）；程序不会猜测控件位置，也不会点击位置不明的元素。`);
  }

  /** The city the page's own filter entry shows: the only accepted evidence that a city filter is in effect. */
  private async readCityFilter(page: ManagedPage, profile: RenderedBossProfile) {
    const entry = await this.uniqueVisible(page, profile.surfaceSelectors.cityLabel, '城市筛选当前值');
    return BossBrowser.normalizeText(await entry.innerText({ timeout: 2000 }).catch(() => ''));
  }

  /** The keyword box's current value, re-read after a search; it must still show the submitted keyword. */
  private async readKeyword(page: ManagedPage, profile: RenderedBossProfile) {
    const input = await this.uniqueVisible(page, profile.surfaceSelectors.keyword, `关键词输入框（占位文本「${profile.rendered.keywordPlaceholder}」）`);
    return BossBrowser.normalizeText(await input.evaluate(element => (element as HTMLInputElement).value ?? '').catch(() => ''));
  }

  /** The 薪资待遇 control's own current value. The dropdown is read and never operated: only the broad/unset
   *  state is accepted, because a narrower band silently drops qualifying postings and no band label proves a
   *  posting's own salary range. */
  private async readSalaryFilter(page: ManagedPage, profile: RenderedBossProfile) {
    const selectors = profile.surfaceSelectors;
    const selects = page.locator(selectors.salarySelect).visible();
    const count = await selects.count().catch(() => 0);
    const labels: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const current = selects.nth(index).locator(selectors.salaryCurrent).first();
      labels.push(BossBrowser.normalizeText(await current.innerText({ timeout: 2000 }).catch(() => '')));
    }
    const broad = labels.some(label => label === profile.rendered.salaryControlLabel || label === profile.rendered.broadSalaryBand);
    if (!broad) {
      throw new BrowserUnavailable('NATIVE_FILTER_UNVERIFIED', `没有读到标为「${profile.rendered.salaryControlLabel}」且保持不限的薪资控件（读到：${labels.filter(Boolean).join('、') || '无'}）；程序不会操作薪资下拉，也不会接受被收窄的搜索。`);
    }
    return profile.rendered.broadSalaryBand;
  }

  /** Reads the result list in one fixed DOM pass: the card rows, their own posting links, and the site's own
   *  loading and empty markers. A card without its own posting link cannot be identified at all. */
  private async readRenderedList(page: ManagedPage, profile: RenderedBossProfile): Promise<BossRenderedList> {
    const selectors = profile.surfaceSelectors;
    // Both selectors are already scoped to the observed list container; the card links are looked up inside it,
    // so no anchor elsewhere on the page can stand in for a result card's own link.
    const cardCount = await page.locator(selectors.card).count().catch(() => 0);
    const cardPaths = await page.locator(selectors.cardList).locator(selectors.cardLink)
      .evaluateAll(elements => elements.map(element => (element as HTMLAnchorElement).pathname)).catch(() => [] as string[]);
    const loading = (await page.locator(selectors.loading).count().catch(() => 0)) > 0;
    const empty = (await page.locator(selectors.empty).count().catch(() => 0)) > 0;
    return { cardCount, cardPaths, loading, empty };
  }

  /** Writes the keyword and submits it once through the site's own search control, in one action epoch. */
  private async submitRenderedSearch(page: ManagedPage, profile: RenderedBossProfile, position: string) {
    const selectors = profile.surfaceSelectors;
    // The curated evidence has no city option, so an opened city panel is reported instead of being operated.
    if ((await page.locator(selectors.cityDialog).visible().count().catch(() => 0)) > 0) {
      throw new BrowserUnavailable('NATIVE_FILTER_UNVERIFIED', `页面打开了城市选择面板（标题「${profile.rendered.cityPanelTitle}」）；已观察证据没有城市选项，程序不会在面板里猜测并点击，请人工关闭后显式恢复。`);
    }
    const input = await this.uniqueVisible(page, selectors.keyword, `关键词输入框（占位文本「${profile.rendered.keywordPlaceholder}」）`);
    await this.requireActable(page, 'pre_click');
    await input.fill(position).catch(error => {
      throw new BrowserUnavailable('NATIVE_FILTER_UNVERIFIED', `关键词输入框无法写入「${position}」：${redactError(error)}`);
    });
    const typed = BossBrowser.normalizeText(await input.evaluate(element => (element as HTMLInputElement).value ?? '').catch(() => ''));
    if (typed !== position) throw new BrowserUnavailable('NATIVE_FILTER_UNVERIFIED', `关键词输入框写入后读回「${typed.slice(0, 40) || '空'}」，与目标「${position}」不一致。`);
    const submit = await this.uniqueVisible(page, selectors.submit, `搜索控件「${profile.rendered.submitName}」`);
    await this.requireActable(page, 'pre_click');
    const actionEpoch = this.beginAction();
    this.lastProgramActionAt = Date.now();
    try {
      await submit.click({ timeout: ACTION_TIMEOUT_MS }).catch(async error => this.pageFailure(page, error, 'pre_click'));
    } finally {
      this.endAction();
    }
    return actionEpoch;
  }

  /** Stops a bounded observation that lost its admission instead of reporting a missing response. */
  private observationStopped(): never {
    if (this.pause) throw this.pausedError('post_click');
    throw new BrowserUnavailable('SESSION_OWNERSHIP', '等待站点响应期间失去了浏览器配置目录的租约，已停止观察。');
  }

  /**
   * Applies one city+role search through the page's rendered controls and accepts its result only from the
   * response that answered that submit: the pinned release, the controls re-read after the submit, the request
   * parameters mapped onto those controls, the validated successful data shape, the absent loader and the
   * rendered card identities must all agree. Otherwise the scan pauses and records nothing.
   */
  private async searchRendered(page: ManagedPage, profile: RenderedBossProfile, target: SearchTarget): Promise<SearchBatch> {
    const scan = this.scan;
    if (!scan) throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', '这次搜索不在受管的只读扫描中，未执行。');
    await this.requireActable(page, 'pre_click');
    const release = await this.observeRelease(page);
    if (release.status !== 'recognized') throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', release.detail);
    // The city is verified through the page's own filter entry. No city option was observed, so a city this
    // page does not already show pauses instead of guessing an option selector.
    const currentCity = await this.readCityFilter(page, profile);
    let actionEpoch = 0;
    let capture: BossCapture | null = null;
    if (currentCity === target.city) {
      actionEpoch = await this.submitRenderedSearch(page, profile, target.position);
      const wait = await this.awaitApi(page, 'search', actionEpoch);
      if (wait.status === 'stopped') return this.observationStopped();
      capture = wait.status === 'captured' ? wait.capture : null;
    }
    const observed: AppliedSearch = {
      city: await this.readCityFilter(page, profile),
      position: await this.readKeyword(page, profile),
      salary: await this.readSalaryFilter(page, profile),
    };
    const requested: AppliedSearch = { city: target.city, position: target.position, salary: profile.rendered.broadSalaryBand };
    if (!capture) {
      // A safety or limit page the wait ended on is a session pause, not a missing search response.
      const blocked = await this.pauseEvidence(page);
      if (blocked) throw this.pausedError('post_click');
    }
    const acceptance = acceptSearch({
      release, scope: scan.scope, actionEpoch,
      submitted: { city: target.city, query: target.position, page: 1 },
      controls: { requested, observed },
      capture,
      list: await this.readRenderedList(page, profile),
    });
    if (acceptance.status === 'paused') throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', `${acceptance.reason}: ${acceptance.detail}`);
    return {
      evidence: {
        searchKey: `${target.city}:${target.role}`,
        controls: [
          { label: 'city', selected: observed.city, url: redactUrl(page.url()) },
          { label: 'position', selected: observed.position, url: redactUrl(page.url()) },
          { label: 'salary', selected: observed.salary, url: redactUrl(page.url()) },
          // The accepted response receipt: canonical path plus the body digest of the successful envelope.
          { label: 'search_receipt', selected: `${acceptance.receipt.path}#${acceptance.receipt.bodySha256.slice(0, 32)}`, url: redactUrl(page.url()) },
        ],
      },
      cards: acceptance.cards.map(card => ({ ...card, url: canonicalUrl(profile.postingUrl(card.sitePostingId)), salary: '' })),
    };
  }

  async readSearchResults(limit = 30): Promise<SearchCard[]> {
    const page = await this.ownPage();
    const cards = page.locator(this.options.profile.selectors.resultCard);
    const total = Math.min(await cards.count(), limit);
    const results: SearchCard[] = [];
    const selectors = this.options.profile.selectors;
    for (let index = 0; index < total; index += 1) {
      const card = cards.nth(index);
      const link = card.locator(selectors.resultLink).first();
      const href = await link.getAttribute('href').catch(() => null);
      const url = href ? canonicalUrl(new URL(href, page.url()).toString()) : '';
      results.push({
        sitePostingId: postingIdFromUrl(url),
        url,
        title: (await card.locator(selectors.card.title).first().innerText().catch(() => '')).trim(),
        company: (await card.locator(selectors.card.company).first().innerText().catch(() => '')).trim(),
        location: (await card.locator(selectors.card.location).first().innerText().catch(() => '')).trim(),
        salary: (await card.locator(selectors.card.salary).first().innerText().catch(() => '')).trim(),
      });
    }
    return results;
  }

  /** Trims and collapses whitespace in one rendered text, so a pane field is compared as the reader sees it. */
  private static normalizeText(value: string) {
    return value.replace(/\s+/g, ' ').trim();
  }

  async readPosting(card: SearchCard, evidence: NativeFilterEvidence): Promise<ObservedPosting> {
    const page = await this.ownPage();
    if (this.options.profile.surface !== 'rendered') return this.readPostingPage(page, card, evidence);
    return this.readRenderedPosting(page, this.options.profile, card, evidence);
  }

  /**
   * Opens one reserved card and binds the response that answered that click to the own detail pane. A card the
   * page already loaded reuses its still-valid captured receipt instead of a second click; without one the read
   * pauses rather than re-clicking, navigating or forcing another request. The title link of a card is never
   * clicked: the card container itself is the click target, so no `target=_blank` navigation happens.
   */
  private async readRenderedPosting(page: ManagedPage, profile: RenderedBossProfile, card: SearchCard, evidence: NativeFilterEvidence): Promise<ObservedPosting> {
    const scan = this.scan;
    if (!scan) throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', '这次详情读取不在受管的只读扫描中，未执行。');
    const identity = card.sitePostingId;
    if (!identity) throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', '这张卡片没有可从响应确认的岗位标识，未打开。');
    const reservation = scan.ledger.reservation(identity);
    if (!reservation) throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', `岗位「${identity}」没有先在本任务三十个详情名额内预留，未打开；页面自动加载的详情响应被隔离，不能成为快照。`);
    await this.requireActable(page, 'pre_click');
    const release = await this.observeRelease(page);
    if (release.status !== 'recognized') throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', release.detail);
    const active = await this.readActiveIdentity(page, profile);
    if (!active.ok) throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', `detail_pane_ambiguous: ${active.detail}`);
    // Only the card the page itself has selected may reuse a captured receipt; an active card without one
    // pauses instead of being clicked again, and any other card is opened through its own identity.
    const decision = decideDetailOpening({
      identity,
      activeIdentity: active.identity,
      capture: findReusableDetailCapture(this.observer?.observed() ?? [], { identity, scope: scan.scope, now: Date.now() }),
    });
    if (decision.action === 'pause') throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', `${decision.reason}: ${decision.detail}`);
    let capture = decision.action === 'reuse' ? decision.capture : null;
    if (!capture) {
      const actionEpoch = this.beginAction();
      try {
        await this.openRenderedCard(page, profile, identity);
      } finally {
        this.endAction();
      }
      const wait = await this.awaitApi(page, 'detail', actionEpoch);
      if (wait.status === 'stopped') return this.observationStopped();
      capture = wait.status === 'captured' ? wait.capture : null;
      if (!capture) {
        // A safety or limit page the wait ended on is a session pause, not a missing detail response.
        const blocked = await this.pauseEvidence(page);
        if (blocked) throw this.pausedError('post_click');
      }
    }
    const pane = await this.readOwnPane(page, profile);
    const acceptance = acceptDetail({
      release, scope: scan.scope, reservation, capture, pane,
      // The monotonic detail-arrival sequence: any request or response that arrived after this capture —
      // including one inside the same program action, or one whose body is still pending — invalidates it.
      activity: this.detailActivity,
    });
    if (acceptance.status === 'paused') throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', `${acceptance.reason}: ${acceptance.detail}`);
    const observed = acceptance.observation;
    const receipt = acceptance.receipt;
    return observedPostingSchema.parse({
      site: 'boss',
      sitePostingId: observed.sitePostingId,
      url: canonicalUrl(profile.postingUrl(observed.sitePostingId)),
      title: observed.title,
      company: observed.company,
      location: observed.location,
      salaryRaw: observed.salaryRaw,
      jdText: observed.jdText,
      companyProfileText: observed.companyProfileText,
      // The reserved identity, the response's encryptId and the own pane's posting id are all equal here.
      identitySource: 'detail_link',
      nativeFilterEvidence: {
        searchKey: evidence.searchKey,
        controls: [
          ...evidence.controls,
          // Bounded receipt metadata of the accepted detail: canonical path, body digest and pane digest only.
          { label: 'detail_receipt', selected: `${receipt.path}#${receipt.bodySha256.slice(0, 16)}#${receipt.snapshotSha256.slice(0, 16)}`, url: redactUrl(page.url()) },
        ],
      },
    });
  }

  /** Clicks the one scoped card container that owns this posting's exact canonical link, never its
   *  `target=_blank` title link. The driver resolves the identity-bound locator at click time, so a list
   *  reorder cannot open a card whose identity was not reserved. */
  private async openRenderedCard(page: ManagedPage, profile: RenderedBossProfile, identity: string) {
    const card = page.locator(cardSelectorFor(profile.surfaceSelectors.card, identity)).visible();
    const count = await card.count().catch(() => 0);
    if (count !== 1) throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED', `页面上有 ${count} 个结果卡片容器指向岗位「${identity}」；程序不会按位置、标题或公司选择卡片。`);
    this.lastProgramActionAt = Date.now();
    await card.first().click({ timeout: ACTION_TIMEOUT_MS }).catch(async error => this.pageFailure(page, error, 'pre_click'));
  }

  /** The own detail pane of the selected posting, read in one fixed DOM pass. A bounded wait lets the pane
   *  finish rendering; the wait is never the proof, because the response, the reserved identity and the pane's
   *  own link must still agree. */
  private async readOwnPane(page: ManagedPage, profile: RenderedBossProfile): Promise<BossPaneSnapshot | null> {
    const deadline = Date.now() + PANE_WAIT_MS;
    let snapshot = await this.paneSnapshot(page, profile);
    while (Date.now() < deadline && !(snapshot.paneCount === 1 && snapshot.linkCount === 1 && !snapshot.loading && snapshot.title && snapshot.salary && snapshot.description)) {
      await page.waitForTimeout(100);
      snapshot = await this.paneSnapshot(page, profile);
    }
    return snapshot;
  }

  /** One fixed DOM pass over the own pane. Its text is only present-checked and hashed: the class names are the
   *  curated pane evidence, and a private-use glyph never becomes a JD or a salary value. */
  private async paneSnapshot(page: ManagedPage, profile: RenderedBossProfile): Promise<BossPaneSnapshot> {
    const panes = page.locator(profile.surfaceSelectors.pane);
    const paneCount = await panes.count().catch(() => 0);
    if (paneCount !== 1) return { paneCount, linkCount: 0, moreJobPath: null, loading: false, title: '', salary: '', description: '' };
    return panes.first().evaluate(element => {
      const links = Array.from(element.querySelectorAll('a.more-job-btn')) as HTMLAnchorElement[];
      const text = (selector: string) => (element.querySelector(selector)?.textContent ?? '').trim();
      return {
        paneCount: 1,
        linkCount: links.length,
        moreJobPath: links.length === 1 ? links[0]!.pathname : null,
        loading: Boolean(element.querySelector('.job-detail-loading')),
        title: text('.job-name'),
        salary: text('.job-salary'),
        description: text('.desc'),
      };
    });
  }

  /** Fixture-only detail read: one navigation to the site's own posting link. */
  private async readPostingPage(page: ManagedPage, card: SearchCard, evidence: NativeFilterEvidence): Promise<ObservedPosting> {
    if (!card.url) throw new BrowserUnavailable('SESSION_PAGE_NOT_READY', 'Posting card has no link');
    const url = new URL(card.url);
    if (url.origin !== new URL(this.options.origin).origin) throw new BrowserUnavailable('SESSION_PAGE_NOT_READY', 'Posting link leaves the configured origin');
    this.assertNotPaused('navigation');
    this.lastProgramActionAt = Date.now();
    try {
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
      await this.requireActable(page, 'navigation');
      const selectors = this.options.profile.selectors.detail;
      await page.waitForSelector(selectors.jd, { timeout: RESULT_WAIT_MS });
    } catch (error) {
      // The site can redirect to a safety page after the navigation resolves or while the JD is awaited.
      // That page is re-read here, so the scan stops instead of treating it as one posting's failure.
      await this.pageFailure(page, error, 'navigation');
    }
    const selectors = this.options.profile.selectors.detail;
    const identity = postingIdFromUrl(page.url());
    let companyOverride:string|null=null;
    let companyProfileOverride:string|null=null;
    if (this.options.profile.surface === 'works_dom') {
      if (identity !== card.sitePostingId) throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED','详情页岗位标识不一致，未采纳字段。');
      await page.waitForSelector(`${selectors.company}, .job-boss-info .boss-info-attr`,{timeout:RESULT_WAIT_MS}).catch(()=>{});
      const companies=page.locator(selectors.company).visible();
      if(await companies.count()===1)companyOverride=(await companies.first().innerText()).trim();
      const recruiters=page.locator('.job-boss-info .boss-info-attr').visible();
      const recruiter=await recruiters.count()===1?(await recruiters.first().innerText()).trim():'';
      if(!companyOverride&&recruiter)companyOverride=recruiter.split(/[·\n]/)[0]?.trim()??null;
      if(!companyOverride){
        const companyControls=await page.locator('[class*="company"],[class*="boss"],.job-banner').evaluateAll(elements=>elements.filter(element=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0;}).slice(0,35).map(element=>({tag:element.tagName,className:element.getAttribute('class')??'',text:element.innerText?.trim().slice(0,240)??'',parent:element.parentElement?.getAttribute('class')??''})));
        throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED','未识别到当前招聘主体，已保留公开控件结构。',{companyControls});
      }
      const profile=page.locator(selectors.companyProfile).visible();
      const certification=page.locator('.job-detail-section .company-certification').visible();
      const banner=page.locator('.job-banner').visible();
      companyProfileOverride=[
        await profile.count()===1?await profile.first().innerText():'',
        recruiter?`招聘主体：${recruiter}`:'',
        await certification.count()===1?await certification.first().innerText():'',
        await banner.count()===1?(await banner.first().innerText()).split('\n').find(line=>line.includes('客户公司'))??'':'',
      ].filter(Boolean).join('\n').slice(0,4000);
    }
    const detail = {
      title: (await page.locator(selectors.title).first().innerText().catch(() => card.title)).trim(),
      company: companyOverride ?? (await page.locator(selectors.company).first().innerText().catch(() => card.company)).trim(),
      location: (await page.locator(selectors.location).first().innerText().catch(() => card.location)).trim(),
      salary: (await page.locator(selectors.salary).first().innerText().catch(() => card.salary)).trim(),
      jdText: (await page.locator(selectors.jd).first().innerText().catch(() => '')).trim(),
      companyProfileText: companyProfileOverride ?? (await page.locator(selectors.companyProfile).first().innerText().catch(() => '')).trim().slice(0, 4000),
    };
    const identitySource = !identity ? 'missing' : card.sitePostingId && card.sitePostingId !== identity ? 'conflict' : 'detail_link';
    return observedPostingSchema.parse({
      site: 'boss',
      sitePostingId: identity ?? card.sitePostingId ?? '',
      url: canonicalUrl(page.url()),
      title: detail.title,
      company: detail.company,
      location: detail.location,
      salaryRaw: detail.salary,
      jdText: detail.jdText,
      companyProfileText: detail.companyProfileText,
      identitySource,
      nativeFilterEvidence: { ...evidence },
    });
  }

  // ---------- external effects ----------
  /** Confirms the conversation container belongs to the expected posting before trusting its text. */
  private async recipientMatches(page: ManagedPage, sitePostingId: string) {
    const container = page.locator(this.options.profile.selectors.chatContainer).first();
    if ((await container.count()) === 0) return false;
    const marker = await container.evaluate(element => element.getAttribute('data-posting-id') ?? element.getAttribute('data-job-id')).catch(() => null);
    return Boolean(marker) && marker === sitePostingId;
  }

  /** Site upload receipts: the only evidence that may confirm which bytes the site persisted. */
  private async attachmentReceipts(page: ManagedPage) {
    return page.locator(this.options.profile.selectors.attachmentReceipt).evaluateAll(elements => elements
      .map(element => ({ sha: element.getAttribute('data-resume-sha256'), size: element.getAttribute('data-resume-size') }))
      .filter((receipt): receipt is { sha: string; size: string | null } => Boolean(receipt.sha)))
      .catch(() => [] as Array<{ sha: string; size: string | null }>);
  }

  /** Bounded polling that tolerates a real navigation or an in-page update after an external action. */
  /** In-flight checkpoints stop as soon as ownership is lost, instead of only blocking the next command. */
  private ownedForPolling() {
    if (!this.release || this.ownershipLost) {
      void this.closeBrowser().catch(() => {});
      return false;
    }
    return true;
  }

  private async pollPage(read: () => Promise<boolean>, attempts = 10, delayMs = 250) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (!this.ownedForPolling()) return false;
      if (await read().catch(() => false)) return true;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return false;
  }

  /** Stops the owned actor before a mutating step: it must still own the profile and the durable work
   *  authority, and the page it is about to act on must not be latched or blocked. A block discovered
   *  during an awaited interaction surfaces here as SESSION_PAUSED before the next click or upload. */
  private async admitStep(page: ManagedPage, guard?: EffectGuard, stage: ActionStage = 'pre_click') {
    if (!this.ownedForPolling()) return false;
    await this.requireActable(page, stage);
    if (!guard) return true;
    if (await guard.stillAllowed()) return true;
    await this.closeBrowser().catch(() => {});
    return false;
  }

  /** Only login/verification/restriction blocks an interaction; other pages need no nav marker. */
  private async blockedState(page: ManagedPage) {
    const observed = await this.observePage(page);
    return observed.state === 'login_required' || observed.state === 'verification_required' || observed.state === 'restricted' ? observed : null;
  }

  /** A latched or observed site block is reported as a session pause, never as an unobserved click.
   *  It also converts a driver or Timeout failure that landed on a safety or limit page, because the page
   *  it left behind is the evidence the error itself cannot carry. */
  private async pauseOutcome(page: ManagedPage, error: unknown, observedAt: () => string): Promise<EffectObservation | null> {
    const evidence = await this.pauseEvidence(page);
    const paused = error instanceof BrowserUnavailable && error.code === 'SESSION_PAUSED';
    if (!paused && !evidence) return null;
    const reason = error instanceof BrowserUnavailable && error.detail.pauseReason ? error.detail.pauseReason : this.pauseState();
    const session = evidence ?? (await this.observePage(page).catch(() => null));
    return {
      outcome: 'pause_session', reason,
      evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: redactError(error) }],
      ...(session ? { session } : {}),
    };
  }

  /** Re-reads the page after a blocking wait: a proven block pauses the session instead of the caller
   *  reporting an unobserved or failed effect on a page that is actually a login, challenge or limit page. */
  private async waitPause(page: ManagedPage, observedAt: () => string, summary: string): Promise<EffectObservation | null> {
    const evidence = await this.pauseEvidence(page);
    if (!evidence) return null;
    return { outcome: 'pause_session', reason: this.pauseState(), evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary }], session: evidence };
  }

  /** One native button click only. The platform controls its preset greeting; no input/upload is touched. */
  async clickPresetGreeting(input:{postingUrl:string;sitePostingId:string},guard:EffectGuard):Promise<{state:'confirmed'|'already_contacted'|'failed'|'unknown';reason:string|null;evidence:EffectObservation['evidence'];session?:ObservedSession}>{
    const evidence=(summary:string)=>[{observedAt:new Date().toISOString(),url:redactUrl(input.postingUrl),summary}];
    let attempted=false;
    const page=await this.ownPage();
    try{
      this.assertOwned();
      if(!(await guard.stillAllowed()))return{state:'failed',reason:'authority_lost',evidence:evidence('执行授权已撤回，未点击。')};
      const destination=new URL(input.postingUrl);
      if(destination.origin!==new URL(this.options.origin).origin||postingIdFromUrl(destination.toString())!==input.sitePostingId)return{state:'failed',reason:'posting_identity_unverified',evidence:evidence('批准的岗位链接身份不一致，未点击。')};
      await this.requireActable(page,'navigation');
      this.lastProgramActionAt=Date.now();
      await page.goto(input.postingUrl,{waitUntil:'domcontentloaded',timeout:NAVIGATION_TIMEOUT_MS});
      await this.requireActable(page,'navigation');
      if(postingIdFromUrl(page.url())!==input.sitePostingId)throw new BrowserUnavailable('SITE_PROOF_UNVERIFIED','当前页不是批准的岗位。');
      await page.waitForSelector('.job-banner a, .job-banner button, .job-banner [role="button"]',{timeout:RESULT_WAIT_MS}).catch(()=>{});
      const controls=page.locator('.job-banner a, .job-banner button, .job-banner [role="button"]').visible();
      const candidates:ManagedLocator[]=[];
      for(let index=0;index<await controls.count();index++){
        const control=controls.nth(index);const text=(await control.innerText()).trim();
        if(/^(继续沟通|已沟通|沟通中)$/.test(text))return{state:'already_contacted',reason:'existing_conversation',evidence:evidence('该岗位按钮已显示既有沟通，本次未点击。')};
        if(text==='立即沟通')candidates.push(control);
      }
      if(candidates.length!==1)return{state:'failed',reason:'contact_control_unverified',evidence:evidence('未观察到唯一可见的立即沟通按钮，未点击。')};
      const button=candidates[0];if(!button||await button.isDisabled())return{state:'failed',reason:'contact_disabled',evidence:evidence('立即沟通按钮不可用，未点击。')};
      if(!(await this.admitStep(page,guard,'pre_click')))return{state:'failed',reason:'authority_lost',evidence:evidence('点击前授权已撤回。')};
      attempted=true;this.lastProgramActionAt=Date.now();
      await button.click({timeout:ACTION_TIMEOUT_MS});
      for(let attempt=0;attempt<12;attempt++){
        if(!this.ownedForPolling()||!(await guard.stillAllowed()))break;
        const blocked=await this.blockedState(page);
        if(blocked)return{state:'unknown',reason:'session_paused_after_click',session:blocked,evidence:evidence('点击后出现登录、验证或站点限制，结果保持未知，不重试。')};
        if(postingIdFromUrl(page.url())===input.sitePostingId){
          const current=page.locator('.job-banner a, .job-banner button, .job-banner [role="button"]').visible();
          for(let index=0;index<await current.count();index++)if(/^(继续沟通|已沟通|沟通中)$/.test((await current.nth(index).innerText()).trim()))return{state:'confirmed',reason:null,evidence:evidence('已点击立即沟通；同一岗位按钮变为已沟通状态。站内自动招呼是否送达以 BOSS 消息为准。')};
        }
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      return{state:'unknown',reason:'click_result_unconfirmed',evidence:evidence('已执行一次立即沟通点击，尚未观察到同岗位状态确认；不自动重试。')};
    }catch(error){
      const observed=await this.inspectSession();
      const session=['login_required','verification_required','restricted'].includes(observed.state)?observed:undefined;
      return{state:attempted?'unknown':'failed',reason:error instanceof BrowserUnavailable?error.code:'page_action_failed',session,evidence:evidence(attempted?'点击可能已生效，未确认结果，保持未知。':'页面或身份检查未通过，未点击立即沟通。')};
    }
  }

  async initiateConversation(input: { postingUrl: string; sitePostingId: string; greeting: string; effectId: string }, guard?: EffectGuard): Promise<EffectObservation> {
    const page = await this.ensureBrowser();
    const observedAt = () => new Date().toISOString();
    this.assertOwned();
    try {
      if (!this.mutationsAllowed) return { outcome: 'failed', reason: 'live_mutation_unverified', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '站点控件尚未通过人工观察验证，未发起沟通。' }] };
      this.assertNotPaused('navigation');
      this.lastProgramActionAt = Date.now();
      await page.goto(input.postingUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
      const blocked = await this.blockedState(page);
      if (blocked) return { outcome: 'pause_session', reason: blocked.state, evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: blocked.detail }], session: blocked };
      const contact = page.locator(this.options.profile.selectors.contact).first();
      if ((await contact.count()) === 0) return { outcome: 'failed', reason: 'contact_unavailable', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '页面没有发起沟通入口，未发生外发。' }] };
      if (await contact.isDisabled().catch(() => false)) return { outcome: 'failed', reason: 'contact_disabled', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '沟通入口不可用，未发生外发。' }] };
      if (!(await this.admitStep(page, guard, 'pre_click'))) return { outcome: 'failed', reason: 'authority_lost_before_dispatch', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '持久执行授权已撤回，未点击发起沟通。' }], stopped: true };
      await contact.click({ timeout: 10000 });
      // Wait for the chat surface the site actually opened instead of assuming a fixed delay.
      const flow = await page.waitForFunction((args: { consent: string; input: string }) => {
        if (document.querySelector(args.consent)) return 'consent';
        if (document.querySelector(args.input)) return 'chat';
        return null;
      }, { consent: this.options.profile.selectors.consentNotice, input: this.options.profile.selectors.chatInput }, { timeout: 12000 }).then(handle => handle.jsonValue()).catch(() => null);
      if (flow === 'consent') return { outcome: 'awaiting_consent', reason: 'recipient_consent_required', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '站点提示需要对方同意后才能继续。' }] };
      if (flow !== 'chat') {
        const paused = await this.waitPause(page, observedAt, '等待会话界面期间页面显示登录、验证或频率限制，已停止后续动作且未填写招呼语。');
        if (paused) return paused;
        return { outcome: 'unknown', reason: 'conversation_surface_missing', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '点击沟通后未出现会话输入界面。' }] };
      }
      if (!(await this.recipientMatches(page, input.sitePostingId))) {
        return { outcome: 'unknown', reason: 'recipient_unverified', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '会话容器没有可核对的岗位标识，无法确认收件人。' }] };
      }
      // Last checkpoint before the greeting leaves the actor: a withdrawn authority must not click send.
      if (!(await this.admitStep(page, guard, 'pre_click'))) return { outcome: 'failed', reason: 'authority_lost_before_send', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '持久执行授权已撤回，未填写或点击发送招呼语。' }], stopped: true };
      const approved = BossBrowser.normalizeText(input.greeting);
      const occurrences = async () => {
        const text = BossBrowser.normalizeText(await page.locator(this.options.profile.selectors.chatContainer).first().innerText({ timeout: 1000 }));
        return text.split(approved).length - 1;
      };
      const before = await occurrences();
      // The approved batch text is authored by the candidate; it is sent verbatim and never regenerated here.
      const chatInput = page.locator(this.options.profile.selectors.chatInput).first();
      await chatInput.fill(input.greeting);
      const send = page.locator(this.options.profile.selectors.chatSend).first();
      if ((await send.count()) === 0) return { outcome: 'unknown', reason: 'greeting_send_unavailable', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '会话已打开但找不到发送入口。' }] };
      // Filling can block on an input the site enables late; re-check the authority right before the click.
      if (!(await this.admitStep(page, guard, 'pre_click'))) return { outcome: 'failed', reason: 'authority_lost_after_fill', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '持久执行授权已撤回，招呼语已填入输入框但未点击发送。' }], stopped: true };
      await send.click({ timeout: 10000 });
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      let confirmed = false;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        if (!this.ownedForPolling()) break;
        if ((await occurrences().catch(() => before)) > before && (await this.recipientMatches(page, input.sitePostingId).catch(() => false))) { confirmed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!confirmed) {
        // The wait can end on a safety or limit page; that pauses the session instead of only marking unknown.
        const paused = await this.waitPause(page, observedAt, '等待招呼语回执期间页面显示登录、验证或频率限制，发送结果按未知处理并停止后续动作。');
        if (paused) return paused;
        return { outcome: 'unknown', reason: 'conversation_not_confirmed', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '发送后未在对应岗位的会话中找到完整、与批准文本一致的招呼语。' }] };
      }
      return { outcome: 'confirmed', reason: null, evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: `岗位 ${input.sitePostingId} 的会话中出现完整批准招呼语（${approved.length} 字）。` }] };
    } catch (error) {
      const paused = await this.pauseOutcome(page, error, observedAt);
      if (paused) return paused;
      return { outcome: 'unknown', reason: 'conversation_result_unobserved', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: `点击后无法确认结果：${redactError(error)}` }] };
    }
  }

  async sendOriginalResume(input: { postingUrl: string; sitePostingId: string; filePath: string; originalName: string; sha256: string; byteSize: number }, guard?: EffectGuard): Promise<EffectObservation> {
    const page = await this.ensureBrowser();
    const observedAt = () => new Date().toISOString();
    this.assertOwned();
    try {
      if (!this.mutationsAllowed) return { outcome: 'failed', reason: 'live_mutation_unverified', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '站点控件尚未通过人工观察验证，未上传附件。' }] };
      this.assertNotPaused('navigation');
      this.lastProgramActionAt = Date.now();
      await page.goto(input.postingUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
      const blocked = await this.blockedState(page);
      if (blocked) return { outcome: 'pause_session', reason: blocked.state, evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: blocked.detail }], session: blocked };
      // Only an already existing conversation may be opened here; the apply button is never clicked while sending.
      const link = page.locator(this.options.profile.selectors.conversationLink).filter({ hasNotText: '立即沟通' }).first();
      if ((await link.count()) === 0) return { outcome: 'failed', reason: 'conversation_unavailable', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '没有可进入的既有会话入口，未发生附件外发。' }] };
      await link.click({ timeout: 10000 }).catch(() => {});
      const opened = await this.pollPage(async () => (await page.locator(this.options.profile.selectors.attachmentInput).first().count()) > 0);
      if (!opened) {
        const paused = await this.waitPause(page, observedAt, '等待附件入口期间页面显示登录、验证或频率限制，已停止后续动作且未选择附件文件。');
        if (paused) return paused;
        return { outcome: 'failed', reason: 'attachment_unavailable', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '既有会话中没有可用的原始简历附件入口，未发生发送。' }] };
      }
      if (!(await this.recipientMatches(page, input.sitePostingId))) return { outcome: 'unknown', reason: 'recipient_unverified', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '会话容器没有可核对的岗位标识，无法确认附件收件人。' }] };
      // Hash the exact local bytes immediately before upload; the upload publishes these bytes only.
      const bytes = await readFile(input.filePath);
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== input.sha256) return { outcome: 'failed', reason: 'attachment_hash_mismatch', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '本地原始附件摘要与已批准版本不一致，已停止发送。' }] };
      const before = new Set((await this.attachmentReceipts(page)).map(receipt => receipt.sha));
      // Selecting the file can itself publish the resume to the account, so it needs the authority.
      if (!(await this.admitStep(page, guard, 'pre_click'))) return { outcome: 'failed', reason: 'authority_lost_before_upload', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '持久执行授权已撤回，未选择附件文件。' }], stopped: true };
      const fileInput = page.locator(this.options.profile.selectors.attachmentInput).first();
      // Preserve the candidate-visible original filename: a storage key would leak an opaque id and
      // make the site's receipt impossible to compare with the approved attachment.
      await fileInput.setInputFiles({ name: input.originalName, mimeType: mimeTypeForFile(input.originalName), buffer: bytes });
      const submit = page.locator(this.options.profile.selectors.attachmentSubmit).first();
      if ((await submit.count()) > 0) {
        // The bytes may already be published by the file input, so a stop here is honestly unknown.
        if (!(await this.admitStep(page, guard, 'post_click'))) return { outcome: 'unknown', reason: 'authority_lost_before_submit', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '持久执行授权已撤回，未点击提交附件；文件可能已上传，按未确认处理。' }], stopped: true };
        await submit.click({ timeout: 10000 });
      }
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      let fresh: { sha: string; size: string | null } | null = null;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        if (!this.ownedForPolling()) break;
        const receipts = await this.attachmentReceipts(page);
        fresh = receipts.find(receipt => !before.has(receipt.sha)) ?? null;
        if (fresh && (await this.recipientMatches(page, input.sitePostingId).catch(() => false))) break;
        fresh = null;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!fresh) {
        const paused = await this.waitPause(page, observedAt, '等待附件回执期间页面显示登录、验证或频率限制，上传结果按未知处理并停止后续动作。');
        if (paused) return paused;
        const seen = (await this.attachmentReceipts(page)).map(receipt => `${receipt.sha.slice(0, 12)}…/${receipt.size ?? '?'}B`).join(', ').slice(0, 200);
        return { outcome: 'unknown', reason: 'attachment_receipt_missing', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: `站点没有给出本次上传的可用回执，无法证明附件内容；已见回执：${seen || '无'}` }] };
      }
      if (fresh.sha !== input.sha256 || (fresh.size !== null && fresh.size !== String(input.byteSize))) {
        return { outcome: 'unknown', reason: 'attachment_receipt_mismatch', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: `站点回执（${fresh.sha.slice(0, 16)}…，${fresh.size ?? '?'} 字节）与批准的原始附件（${input.sha256.slice(0, 16)}…，${input.byteSize} 字节）不一致，按未确认处理。` }] };
      }
      return { outcome: 'confirmed', reason: null, evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: `站点回执与批准附件摘要及字节数一致（${fresh.sha.slice(0, 12)}…，${input.byteSize} 字节）。` }] };
    } catch (error) {
      const paused = await this.pauseOutcome(page, error, observedAt);
      if (paused) return paused;
      return { outcome: 'unknown', reason: 'attachment_result_unobserved', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: `提交附件后无法确认结果：${redactError(error)}` }] };
    }
  }

  async reconcileEffect(input: { postingUrl: string; sitePostingId: string; greeting: string; originalName: string; originalSize: number; sha256: string }): Promise<EffectObservation> {
    const page = await this.ensureBrowser();
    const observedAt = () => new Date().toISOString();
    this.assertOwned();
    try {
      this.assertNotPaused('navigation');
      this.lastProgramActionAt = Date.now();
      await page.goto(input.postingUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
      const blocked = await this.blockedState(page);
      if (blocked) return { outcome: 'pause_session', reason: blocked.state, evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: blocked.detail }], session: blocked };
      // Reconciliation is read-only: it may only follow a link the site exposes for an existing
      // conversation and never triggers the apply/contact action.
      const link = page.locator(this.options.profile.selectors.conversationLink).filter({ hasNotText: '立即沟通' }).first();
      if ((await link.count()) === 0) return { outcome: 'unknown', reason: 'pending_evidence', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '没有既有会话入口，无法核对且不会发起新沟通。' }] };
      await link.click({ timeout: 10000 }).catch(() => {});
      const opened = await this.pollPage(async () => (await page.locator(this.options.profile.selectors.chatMessages).first().count()) > 0);
      if (!opened) {
        const paused = await this.waitPause(page, observedAt, '核对会话期间页面显示登录、验证或频率限制，保持未知且不会重发。');
        if (paused) return paused;
        return { outcome: 'unknown', reason: 'pending_evidence', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '会话尚未可读，保持未知。' }] };
      }
      if (!(await this.recipientMatches(page, input.sitePostingId))) return { outcome: 'unknown', reason: 'pending_evidence', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '会话容器没有可核对的岗位标识，保持未知。' }] };
      const text = BossBrowser.normalizeText(await page.locator(this.options.profile.selectors.chatContainer).first().innerText({ timeout: 1000 }));
      if (!text.includes(BossBrowser.normalizeText(input.greeting))) return { outcome: 'unknown', reason: 'pending_evidence', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '会话存在但未读到完整批准招呼语，保持未知。' }] };
      const receipts = await this.attachmentReceipts(page);
      if (receipts.some(receipt => receipt.sha === input.sha256 && (receipt.size === null || receipt.size === String(input.originalSize)))) {
        return { outcome: 'confirmed', reason: 'attachment_visible', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: `站点回执与批准附件摘要及字节数一致（${input.sha256.slice(0, 12)}…，${input.originalSize} 字节）。` }] };
      }
      return { outcome: 'confirmed', reason: 'conversation_only', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: '已核对完整批准招呼语与岗位身份；未见与批准摘要一致的附件回执。' }] };
    } catch (error) {
      const paused = await this.pauseOutcome(page, error, observedAt);
      if (paused) return paused;
      return { outcome: 'unknown', reason: 'reconcile_failed', evidence: [{ observedAt: observedAt(), url: redactUrl(page.url()), summary: redactError(error) }] };
    }
  }
}

export function mimeTypeForFile(name: string) {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === 'md') return 'text/markdown';
  if (extension === 'txt') return 'text/plain';
  return 'application/octet-stream';
}
