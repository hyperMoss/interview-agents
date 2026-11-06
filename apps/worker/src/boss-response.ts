import { createHash } from 'node:crypto';
import { z } from 'zod';

// Response evidence for the read-only BOSS scan.
//
// The curated v6789 evidence (`protocol-evidence.json` plus its DOM/filter/pane files) publishes the
// frontend's own request methods (search `POST` as `application/x-www-form-urlencoded`, detail `GET`), the
// search/detail data flow, the whitelisted public response fields and the active-card/list structure. It
// publishes no live application-success semantics, no request field names, no city codes and no timing. So a
// search or a detail is accepted here only from a response that correlates to the request this actor's own
// action issued, validates an explicitly recognized success discriminator and the published data shape
// through Zod, and agrees with the rendered list or the own detail pane. Everything else pauses: an address
// change, an arrival of HTTP 200, a disappearing loader, a matching title/company or two equal samples are
// never accepted as proof, and no success code, city code, id or field is ever inferred.

/** Largest JSON body this adapter will use; a declared size above it is not read at all. */
export const BOSS_ENVELOPE_MAX_BYTES = 512 * 1024;
/** Bounded waits for one observed response after a program action. */
export const BOSS_SEARCH_RESPONSE_TIMEOUT_MS = 15000;
export const BOSS_DETAIL_RESPONSE_TIMEOUT_MS = 15000;
/** Bound on one response body read; a driver read that never resolves keeps its concurrency slot. */
export const BOSS_BODY_READ_TIMEOUT_MS = 5000;
/** Bound on how many response bodies are read at the same time (a hung driver read still holds its slot). */
export const BOSS_MAX_BODY_READS = 4;
/** Bound on correlated requests waiting for their response. */
export const BOSS_MAX_PENDING = 8;
/** A captured detail receipt is only reusable for an already-active card inside this window. */
export const BOSS_DETAIL_RECEIPT_MAX_AGE_MS = 120000;
/** Bound on responses kept in transient memory for one owned page. */
export const BOSS_CAPTURE_LIMIT = 16;

/** The release whose behavior the curated evidence describes. A different build is drift, not a fallback. */
export const bossRelease = {
  build: 'v6789',
  components: ['app~2.6a7d5ca6.js', 'job~1.8a98f220.js', '8026.dda5c0dc.js'],
} as const;

/** Signed owner, durable task revision and database session generation an observation is scoped to. */
export type BossObservationScope = {
  owner: string;
  taskRevision: number;
  sessionGeneration: number;
};

export type BossReleaseObservation =
  | { status: 'recognized'; build: string }
  | { status: 'absent' | 'unrecognized'; detail: string };

function scriptPath(source: string) {
  try {
    return new URL(source).pathname;
  } catch {
    return '';
  }
}

/**
 * Recognizes the pinned frontend release from the scripts the page actually loaded. `absent` means no
 * observed component bundle is on the page at all; `unrecognized` means a different build or a changed
 * component, i.e. release drift. Neither is a reason to fall back to page-state heuristics.
 */
export function classifyBossRelease(scriptSources: readonly string[]): BossReleaseObservation {
  const spaPaths = scriptSources.map(scriptPath).filter(path => path.includes('/zhipin-geek-spa/'));
  if (!spaPaths.length) {
    return { status: 'absent', detail: '页面没有加载已观察的 BOSS 前端组件（/zhipin-geek-spa/ 脚本缺失），无法确认搜索与详情协议版本。' };
  }
  const builds = spaPaths.map(path => /\/(v\d+)\//.exec(path)?.[1] ?? '').filter(Boolean);
  const build = [...new Set(builds)].join('/') || '未读到';
  const missing = bossRelease.components.filter(component => !spaPaths.some(path => path.endsWith(`/${component}`)));
  if (build === bossRelease.build && !missing.length) return { status: 'recognized', build: bossRelease.build };
  return {
    status: 'unrecognized',
    detail: `页面前端版本读到「${build}」，缺少已观察组件「${missing.join('、') || '无'}」；已观察版本是 ${bossRelease.build}，版本变化按暂停处理，不按地址或页面稳定性推测结果。`,
  };
}

/** The two published application endpoints. Nothing else on the site is ever read as a business response. */
export const bossApiPaths = { search: '/wapi/zpgeek/search/joblist.json', detail: '/wapi/zpgeek/job/detail.json' } as const;
export type BossApiKind = keyof typeof bossApiPaths;

/** The methods the observed frontend itself uses, and the search body encoding it declares. */
export const bossApiMethods: Record<BossApiKind, 'POST' | 'GET'> = { search: 'POST', detail: 'GET' };
export const bossSearchContentType = 'application/x-www-form-urlencoded';

/** An observed request is a business response candidate only on the exact HTTPS first-party allowlisted path. */
export function bossApiRequestKind(rawUrl: string, origin: string): BossApiKind | null {
  let request: URL;
  let configured: URL;
  try {
    request = new URL(rawUrl);
    configured = new URL(origin);
  } catch {
    return null;
  }
  if (request.protocol !== 'https:' || request.host !== configured.host) return null;
  const match = (Object.keys(bossApiPaths) as BossApiKind[]).find(kind => bossApiPaths[kind] === request.pathname);
  return match ?? null;
}

/**
 * Application-level success is a profile fact, not an inference. `unknown` is the default: no envelope is
 * accepted, so a body with any code that happens to carry a well-shaped `zpData` cannot pass. A recognized
 * fact names the one top-level discriminator field and the exact scalar value that the observed client treats
 * as success; the same discriminator is then validated through Zod before any field is projected.
 */
export type BossSuccessSemantics =
  | { status: 'unknown' }
  | { status: 'recognized'; discriminator: { field: string; equals: string } };

export const bossSuccessUnknown: BossSuccessSemantics = { status: 'unknown' };

const successHeadSchema = (semantics: Extract<BossSuccessSemantics, { status: 'recognized' }>) => z.object({
  [semantics.discriminator.field]: z.union([z.string(), z.number(), z.boolean()])
    .refine(value => String(value) === semantics.discriminator.equals, { message: '不满足已确认的应用层成功判定' }),
});

/**
 * The observed search encoding. The field names and the submitted city's encoded value are facts of the live
 * form body, so the live profile carries none until a real request establishes them; a value this table does
 * not contain is an unrecognized encoding, never a guessed city code.
 */
export type BossSearchEncoding = {
  /** Field names the observed frontend submits in the form body. */
  fields: { city: string; query: string; page: string; pageSize: string };
  /** Submitted city label -> the exact value the frontend encodes for it. */
  cityValues: Readonly<Record<string, string>>;
};

export type BossSearchQuery = { city: string; query: string; page: number; pageSize: number };
export type BossSearchFieldsParse = { ok: true; value: BossSearchQuery } | { ok: false; detail: string };

/**
 * Projects the four bounded search fields out of the observed form-encoded request body. This is the only
 * place a request carries data into the actor: the complete body and every other form field are dropped when
 * this function returns, and no caller ever sees them again.
 */
export function projectBossSearchFields(body: string | null, encoding: BossSearchEncoding): BossSearchFieldsParse {
  if (body === null) return { ok: false, detail: '搜索提交没有可读的表单正文，无法把响应映射到提交的筛选。' };
  const params = new URLSearchParams(body);
  const single = (name: string) => {
    const values = params.getAll(name);
    return values.length === 1 ? values[0] ?? '' : null;
  };
  const encodedCity = single(encoding.fields.city);
  const encodedQuery = single(encoding.fields.query);
  const encodedPage = single(encoding.fields.page);
  const encodedPageSize = single(encoding.fields.pageSize);
  if (encodedCity === null || encodedQuery === null || encodedPage === null || encodedPageSize === null) {
    return { ok: false, detail: '搜索提交缺少已观察的表单字段（城市/关键词/页码/每页数量各需出现一次），无法把响应映射到提交的筛选。' };
  }
  const city = Object.entries(encoding.cityValues).find(([, value]) => value === encodedCity)?.[0];
  if (!city) return { ok: false, detail: '搜索提交的城市字段不是已观察到的编码值，程序不会推断城市编码。' };
  const page = Number(encodedPage);
  if (!Number.isInteger(page) || page < 1 || page > 50) return { ok: false, detail: '搜索提交的页码不是 1-50 的整数，无法按已观察语义解析。' };
  const pageSize = Number(encodedPageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return { ok: false, detail: '搜索提交的每页数量不是 1-100 的整数，无法按已观察语义解析。' };
  const query = encodedQuery.trim();
  if (!query || query.length > 60) return { ok: false, detail: '搜索提交的关键词为空或超长，无法映射到提交的关键词。' };
  return { ok: true, value: { city, query, page, pageSize } };
}

// The published public data shapes. Zod projects only the whitelisted fields, so any other response field —
// signature, recruiter, candidate or per-request secret — is dropped instead of being retained.
const bossSearchRowSchema = z.object({
  encryptJobId: z.string().min(4).max(120),
  jobName: z.string().min(1).max(200),
  brandName: z.string().min(1).max(200),
  cityName: z.string().max(120),
});
export type BossSearchRow = z.infer<typeof bossSearchRowSchema>;

export const bossSearchEnvelopeSchema = z.object({
  zpData: z.object({ jobList: z.array(bossSearchRowSchema).max(100), hasMore: z.boolean() }),
});
export type BossSearchEnvelope = z.infer<typeof bossSearchEnvelopeSchema>;

const bossDetailInfoSchema = z.object({
  encryptId: z.string().min(4).max(120),
  jobName: z.string().min(1).max(200),
  salaryDesc: z.string().min(1).max(120),
  locationName: z.string().max(120),
  postDescription: z.string().max(20000),
});
export const bossDetailEnvelopeSchema = z.object({
  zpData: z.object({
    jobInfo: bossDetailInfoSchema,
    brandComInfo: z.object({ brandName: z.string().min(1).max(200), introduce: z.string().max(4000) }),
  }),
});
export type BossDetailEnvelope = z.infer<typeof bossDetailEnvelopeSchema>;

/** Why one response body is not a recognized successful envelope. */
export type BossEnvelopeFailure = 'unreadable' | 'http_status' | 'oversize' | 'success_unrecognized' | 'malformed' | 'shape';

export type BossEnvelopeParse<T> = { ok: true; value: T } | { ok: false; failure: BossEnvelopeFailure; detail: string };

function issueDetail(error: z.ZodError) {
  const fields = [...new Set(error.issues.map(issue => issue.path.join('.') || '(root)'))].slice(0, 4);
  return `响应结构不符合已观察的公开字段（${fields.join('、')}），未接受。`;
}

function parseEnvelope<T>(text: string, schema: z.ZodType<T>, success: BossSuccessSemantics): BossEnvelopeParse<T> {
  if (Buffer.byteLength(text, 'utf8') > BOSS_ENVELOPE_MAX_BYTES) {
    return { ok: false, failure: 'oversize', detail: `响应正文超过 ${BOSS_ENVELOPE_MAX_BYTES} 字节上限，未解析。` };
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, failure: 'malformed', detail: '响应正文不是可解析的 JSON，未接受。' };
  }
  // The success discriminator is validated before any public field is projected: a failure or unknown
  // envelope that happens to carry a well-shaped zpData cannot pass.
  if (success.status !== 'recognized') {
    return { ok: false, failure: 'success_unrecognized', detail: '站点应用层成功语义尚未被真实响应确认；即使响应带有形状正确的业务数据，也不接受。' };
  }
  const head = successHeadSchema(success).safeParse(body);
  if (!head.success) {
    return { ok: false, failure: 'success_unrecognized', detail: `响应不满足已确认的成功判定（${head.error.issues.map(issue => issue.path.join('.') || '(root)').slice(0, 2).join('、')}），按失败或未知处理。` };
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, failure: 'shape', detail: issueDetail(parsed.error) };
}

export const parseBossSearchEnvelope = (text: string, success: BossSuccessSemantics) => parseEnvelope(text, bossSearchEnvelopeSchema, success);
export const parseBossDetailEnvelope = (text: string, success: BossSuccessSemantics) => parseEnvelope(text, bossDetailEnvelopeSchema, success);

/** One correlated request/response pair reduced to the whitelisted fields. Never a raw body or request text. */
export type BossCapture = {
  kind: BossApiKind;
  scope: BossObservationScope;
  /** The serialized program action this request was issued in. */
  actionEpoch: number;
  /** Monotonic detail-arrival sequence at the moment this response arrived; independent of the action epoch. */
  activity: number;
  method: string;
  status: number;
  bytes: number;
  bodySha256: string;
  observedAt: number;
  /** The four bounded search fields projected from the submit body, or null when the projection failed. */
  search: BossSearchQuery | null;
  /** Why the request itself could not be mapped onto the submitted controls. */
  requestError: string | null;
  searchEnvelope: BossSearchEnvelope | null;
  detailEnvelope: BossDetailEnvelope | null;
  envelopeFailure: BossEnvelopeFailure | null;
  envelopeError: string | null;
};

export function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function sameBossScope(left: BossObservationScope, right: BossObservationScope) {
  return left.owner === right.owner && left.taskRevision === right.taskRevision && left.sessionGeneration === right.sessionGeneration;
}

/** What one observed request carried into the observer. The request object is only an opaque map key. */
export type BossRequestSeen = {
  identity: object;
  url: string;
  method: string;
  /** Declared content type of the request body; a search body must be the observed form encoding. */
  contentType: string | null;
  /** Raw form body of a search submit; projected immediately and never retained. */
  body: string | null;
};

type BossPendingRequest = {
  kind: BossApiKind;
  actionEpoch: number;
  activity: number;
  method: string;
  search: BossSearchQuery | null;
  requestError: string | null;
  /** The status of the response that answered this request; the body is judged against it. */
  status: number | null;
};

/** A response whose body may still be in flight. Passing it back is the only way a body enters a capture. */
export type BossBodyTicket = { identity: object; generation: number; deadline: number };

export type BossObserverOptions = {
  origin: string;
  success: BossSuccessSemantics;
  encoding: BossSearchEncoding | null;
  scope: BossObservationScope;
  /** Monotonic id of this observer's lifetime; a disposed or superseded observer stores no late body. */
  generation: number;
  /** Controller-owned reads, retained across scan disposal until each driver promise settles. */
  bodyReads: Set<BossBodyTicket>;
  /** The owning actor's current serialized action epoch. */
  actionEpoch: () => number;
  now?: () => number;
};

/**
 * The production observation lifecycle of one owned page: request correlation, ingress projection of the four
 * bounded search fields, bounded body acquisition, the monotonic detail-arrival sequence and disposal fencing.
 *
 * Driver limitation, stated rather than papered over: the standard driver API hands out the whole body through
 * `response.text()` with no streaming, cancellation or preallocation control. So the bound here is on what this
 * adapter starts and accepts — at most `BOSS_MAX_BODY_READS` concurrent reads, a declared `content-length`
 * checked before the read starts, the decoded size rejected afterwards, a per-read deadline, and a late body
 * from a disposed or superseded observer dropped. A single body larger than the bound can still be allocated by
 * the driver before it is rejected.
 */
export class BossResponseObserver {
  private readonly pending = new Map<object, BossPendingRequest>();
  private captures: BossCapture[] = [];
  private detailArrivals = 0;
  private disposed = false;
  private readonly now: () => number;

  constructor(readonly options: BossObserverOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Monotonic detail activity: every detail request arrival and every detail response arrival. */
  get detailActivity() {
    return this.detailArrivals;
  }

  /** Bodies whose driver read is still outstanding; a hung driver read keeps its slot. */
  get bodyReads() {
    return this.options.bodyReads.size;
  }

  get isDisposed() {
    return this.disposed;
  }

  observed(): readonly BossCapture[] {
    return this.captures;
  }

  find(kind: BossApiKind, actionEpoch: number): BossCapture | null {
    return this.captures.find(capture => capture.kind === kind && capture.actionEpoch === actionEpoch) ?? null;
  }

  dispose() {
    this.disposed = true;
    this.pending.clear();
    this.captures = [];
  }

  noteRequest(seen: BossRequestSeen) {
    if (this.disposed) return;
    const kind = bossApiRequestKind(seen.url, this.options.origin);
    if (!kind) return;
    // Only the method the observed frontend itself uses is a candidate: no GET-or-POST guessing.
    if (seen.method !== bossApiMethods[kind]) return;
    // A detail request is activity even when its record is dropped below: a pending body is never invisible.
    if (kind === 'detail') this.detailArrivals += 1;
    if (this.pending.size >= BOSS_MAX_PENDING) return;
    let search: BossSearchQuery | null = null;
    let requestError: string | null = null;
    if (kind === 'search') {
      const encoded = (seen.contentType ?? '').toLowerCase().includes(bossSearchContentType);
      const encoding = this.options.encoding;
      const projected = encoded && encoding
        ? projectBossSearchFields(seen.body, encoding)
        : { ok: false as const, detail: encoded ? '站点搜索表单的字段名与提交城市的编码值尚未从真实请求确认，程序不会推断。' : '搜索提交的表单编码不是已观察的 application/x-www-form-urlencoded，未接受。' };
      if (projected.ok) search = projected.value;
      else requestError = projected.detail;
    }
    this.pending.set(seen.identity, {
      kind, actionEpoch: this.options.actionEpoch(), activity: this.detailArrivals, method: seen.method, search, requestError,
      status: null,
    });
  }

  /**
   * Registers a response arrival. The correlated request stays pending while its body is acquired, so a
   * pending body is visible activity. Returns the ticket the body must come back through, or null when no body
   * may be read (uncorrelated, already too large by its declared size, or too many reads in flight).
   */
  noteResponse(identity: object, status: number, declaredBytes: number | null): BossBodyTicket | null {
    if (this.disposed) return null;
    const record = this.pending.get(identity);
    if (!record) return null;
    record.status = status;
    if (record.kind === 'detail') {
      this.detailArrivals += 1;
      // The capture is bound to the arrival sequence of its own response, so a request or response that
      // arrives afterwards — inside the same program action or not — can never be mistaken for it.
      record.activity = this.detailArrivals;
    }
    if (declaredBytes !== null && declaredBytes > BOSS_ENVELOPE_MAX_BYTES) {
      this.pending.delete(identity);
      this.store(this.failed(record, status, declaredBytes, 'oversize', '响应声明的长度超过上限，未读取正文。'));
      return null;
    }
    if (this.options.bodyReads.size >= BOSS_MAX_BODY_READS) {
      this.pending.delete(identity);
      this.store(this.failed(record, status, declaredBytes ?? 0, 'unreadable', '同时读取的响应正文数量超过上限，未读取该正文。'));
      return null;
    }
    const ticket = { identity, generation: this.options.generation, deadline: this.now() + BOSS_BODY_READ_TIMEOUT_MS };
    this.options.bodyReads.add(ticket);
    return ticket;
  }

  /** Completes one body read. A late body from a disposed or superseded observer, or one past its deadline, is dropped. */
  noteBody(ticket: BossBodyTicket, text: string | null) {
    if (ticket.generation !== this.options.generation || !this.options.bodyReads.delete(ticket)) return;
    const record = this.pending.get(ticket.identity);
    this.pending.delete(ticket.identity);
    if (this.disposed || !record) return;
    if (this.now() > ticket.deadline) return;
    const status = record.status ?? 0;
    if (text !== null && Buffer.byteLength(text, 'utf8') > BOSS_ENVELOPE_MAX_BYTES) {
      this.store(this.failed(record, status, Buffer.byteLength(text, 'utf8'), 'oversize', '响应正文超过上限，未解析。'));
      return;
    }
    this.store(this.capture(record, status, text));
  }

  private failed(record: BossPendingRequest, status: number, bytes: number, failure: BossEnvelopeFailure, detail: string): BossCapture {
    return {
      ...this.head(record, status, bytes), bodySha256: '', observedAt: this.now(),
      searchEnvelope: null, detailEnvelope: null, envelopeFailure: failure, envelopeError: detail,
    };
  }

  private capture(record: BossPendingRequest, status: number, text: string | null): BossCapture {
    if (text === null) return this.failed(record, status, 0, 'unreadable', '响应正文无法读取，未接受。');
    const bytes = Buffer.byteLength(text, 'utf8');
    const base = { ...this.head(record, status, bytes), bodySha256: sha256Hex(text), observedAt: this.now() };
    if (status !== 200) return { ...base, searchEnvelope: null, detailEnvelope: null, envelopeFailure: 'http_status', envelopeError: `响应 HTTP ${status}，未接受。` };
    const parsed = record.kind === 'search'
      ? parseBossSearchEnvelope(text, this.options.success)
      : parseBossDetailEnvelope(text, this.options.success);
    if (!parsed.ok) return { ...base, searchEnvelope: null, detailEnvelope: null, envelopeFailure: parsed.failure, envelopeError: parsed.detail };
    return record.kind === 'search'
      ? { ...base, searchEnvelope: parsed.value as BossSearchEnvelope, detailEnvelope: null, envelopeFailure: null, envelopeError: null }
      : { ...base, searchEnvelope: null, detailEnvelope: parsed.value as BossDetailEnvelope, envelopeFailure: null, envelopeError: null };
  }

  private head(record: BossPendingRequest, status: number, bytes: number) {
    return {
      kind: record.kind, scope: this.options.scope, actionEpoch: record.actionEpoch, activity: record.activity,
      method: record.method, status, bytes, search: record.search, requestError: record.requestError,
    };
  }

  private store(capture: BossCapture) {
    this.captures.push(capture);
    if (this.captures.length > BOSS_CAPTURE_LIMIT) this.captures.splice(0, this.captures.length - BOSS_CAPTURE_LIMIT);
  }
}

/** The canonical posting id of a `/job_detail/<id>.html` path or address; never of a bare address. */
export function postingIdFromUrl(url: string) {
  const match = url.match(/\/job_detail\/([A-Za-z0-9_-]{4,120})\.html/) ?? url.match(/\/job\/([A-Za-z0-9_-]{4,120})/);
  return match?.[1] ?? null;
}

/**
 * A card's own posting link: the only identity a card may be matched by. Without an identity it is the lookup
 * of every card link; with one it addresses the single card that links to that posting. The identity is
 * percent-encoded, so it cannot break out of the attribute selector.
 */
export function bossPostingLinkSelector(identity?: string) {
  return identity ? `a.job-name[href*="/job_detail/${encodeURIComponent(identity)}.html"]` : 'a.job-name[href*="/job_detail/"]';
}

/** The one card container that owns this posting's exact canonical link, resolved by identity, never by index. */
export function cardSelectorFor(cardSelector: string, identity: string) {
  return `${cardSelector}:has(${bossPostingLinkSelector(identity)})`;
}

/** Exactly one canonical posting identity from a set of own-card links. */
export function singlePostingIdentity(paths: readonly string[]): { ok: true; identity: string } | { ok: false; detail: string } {
  const identities = paths.map(path => postingIdFromUrl(path));
  if (identities.length !== 1 || !identities[0]) {
    return { ok: false, detail: `期望恰好一个岗位链接，读到 ${identities.length} 个（${identities.filter(Boolean).join('、') || '无'}）；不按位置、标题或公司推断岗位。` };
  }
  return { ok: true, identity: identities[0] };
}

/** Active wrappers and their own links, collected together in one DOM pass. Null means observation failed. */
export function activePostingIdentity(snapshot: { cardCount: number; paths: readonly string[] } | null):
  { ok: true; identity: string | null } | { ok: false; detail: string } {
  if (snapshot === null) return { ok: false, detail: '当前选中卡片读取失败，无法确认是否已有岗位打开。' };
  if (snapshot.cardCount === 0) return { ok: true, identity: null };
  if (snapshot.cardCount !== 1) return { ok: false, detail: `当前有 ${snapshot.cardCount} 个选中卡片，无法唯一确认已打开岗位。` };
  const single = singlePostingIdentity(snapshot.paths);
  return single.ok ? single : { ok: false, detail: `当前打开卡片无法唯一确认：${single.detail}` };
}

/** The three controls a search submits, and the same three re-read from the page afterwards. */
export const BOSS_SEARCH_CONTROL_FIELDS = ['city', 'position', 'salary'] as const;
export type BossSearchControls = { city: string; position: string; salary: string };

export function bossControlMismatches(requested: BossSearchControls, observed: BossSearchControls) {
  return BOSS_SEARCH_CONTROL_FIELDS.filter(field => requested[field] !== observed[field]);
}

export type BossSubmittedSearch = { city: string; query: string; page: number };

/** One rendered result list, read in a single fixed DOM pass. */
export type BossRenderedList = {
  /** How many card containers the scoped list pass matched. */
  cardCount: number;
  /** Canonical `/job_detail/<id>.html` path of each rendered card's own link, in rendered order. */
  cardPaths: readonly string[];
  /** Whether the site's own loading placeholder is rendered. */
  loading: boolean;
  /** Whether the site's own empty-result marker is rendered. */
  empty: boolean;
};

export type BossSearchReceipt = {
  kind: 'search';
  scope: BossObservationScope;
  actionEpoch: number;
  path: string;
  httpStatus: number;
  submitted: BossSubmittedSearch & { pageSize: number };
  hasMore: boolean;
  bodySha256: string;
  observedAt: string;
};

export type BossSearchCard = { sitePostingId: string; title: string; company: string; location: string };

export type BossProofReason =
  | 'release_unrecognized'
  | 'controls_mismatch'
  | 'encoding_unrecognized'
  | 'response_missing'
  | 'response_stale'
  | 'query_mismatch'
  | 'http_status'
  | 'success_unrecognized'
  | 'envelope_unrecognized'
  | 'list_loading'
  | 'list_mismatch'
  | 'empty_unrecognized'
  | 'detail_not_reserved'
  | 'detail_already_active'
  | 'detail_identity_mismatch'
  | 'detail_pane_ambiguous'
  | 'detail_loading'
  | 'detail_pane_incomplete'
  | 'detail_pane_mismatch'
  | 'detail_activity_intervened';

export type BossSearchAcceptance =
  | { status: 'accepted'; receipt: BossSearchReceipt; cards: BossSearchCard[]; empty: boolean }
  | { status: 'paused'; reason: BossProofReason; detail: string };

function paused(reason: BossProofReason, detail: string): { status: 'paused'; reason: BossProofReason; detail: string } {
  return { status: 'paused', reason, detail };
}

/**
 * Decides one submitted search from the response that answered it plus the rendered list. The receipt is only
 * produced when the release is the observed one, the page still shows the submitted controls, the request's
 * four projected fields map onto those controls, the response carries the recognized success discriminator and
 * the published data shape, no loader is rendered, and the rendered card identities are exactly the successful
 * `jobList` identities in the successful order.
 */
export function acceptSearch(input: {
  release: BossReleaseObservation;
  scope: BossObservationScope;
  actionEpoch: number;
  submitted: BossSubmittedSearch;
  controls: { requested: BossSearchControls; observed: BossSearchControls };
  capture: BossCapture | null;
  list: BossRenderedList;
}): BossSearchAcceptance {
  if (input.release.status !== 'recognized') return paused('release_unrecognized', input.release.detail);
  const mismatched = bossControlMismatches(input.controls.requested, input.controls.observed);
  if (mismatched.length) {
    return paused('controls_mismatch', `提交后页面读回的筛选与请求不一致（${mismatched.join('、')}）：城市「${input.controls.observed.city || '未读到'}」、关键词「${input.controls.observed.position || '未读到'}」、薪资「${input.controls.observed.salary || '未读到'}」。`);
  }
  const capture = input.capture;
  if (!capture) return paused('response_missing', `提交搜索后没有观察到与本次动作对应的 ${bossApiPaths.search} 响应；地址变化、加载提示消失或页面上的卡片都不构成搜索已完成的证据。`);
  if (capture.actionEpoch !== input.actionEpoch) return paused('response_stale', '观察到的搜索响应不属于本次动作（旧动作或页面自身的请求），未接受。');
  if (!sameBossScope(capture.scope, input.scope)) return paused('response_stale', '观察到的搜索响应属于其它所有人、任务修订或会话代次，未接受。');
  if (capture.requestError) return paused('encoding_unrecognized', capture.requestError);
  if (capture.status !== 200) return paused('http_status', `搜索响应 HTTP ${capture.status}，未接受。`);
  if (capture.envelopeFailure === 'success_unrecognized') return paused('success_unrecognized', capture.envelopeError ?? '站点应用层成功语义未被确认，未接受。');
  if (capture.envelopeFailure || !capture.searchEnvelope) return paused('envelope_unrecognized', capture.envelopeError ?? '搜索响应不是已观察的成功数据结构，未接受。');
  const query = capture.search;
  if (!query) return paused('encoding_unrecognized', '搜索提交的字段没有被投影出来，无法把响应映射到提交的筛选。');
  if (query.city !== input.submitted.city || query.query !== input.submitted.query || query.page !== input.submitted.page) {
    return paused('query_mismatch', `搜索提交映射为城市「${query.city}」、关键词「${query.query}」、页码 ${query.page}，与提交的城市「${input.submitted.city}」、关键词「${input.submitted.query}」、页码 ${input.submitted.page} 不一致。`);
  }
  if (input.list.loading) return paused('list_loading', `响应已到达，但页面仍显示站点自己的加载提示（${bossApiPaths.search} 之外的状态），结果列表可能仍会被替换。`);
  const rows = capture.searchEnvelope.zpData.jobList;
  const hasMore = capture.searchEnvelope.zpData.hasMore;
  if (input.list.cardCount !== input.list.cardPaths.length) {
    return paused('list_mismatch', `页面有 ${input.list.cardCount} 张结果卡片，但只有 ${input.list.cardPaths.length} 张带有自己的岗位详情链接；缺少链接的卡片不能按位置或标题识别。`);
  }
  const renderedIds = input.list.cardPaths.map(path => postingIdFromUrl(path));
  if (!rows.length) {
    if (renderedIds.length || !input.list.empty) {
      return paused('empty_unrecognized', '成功响应中的岗位为空，但页面既不是空列表、也没有显示站点自己的空结果标记；不把空结果当成成功。');
    }
    return {
      status: 'accepted',
      empty: true,
      cards: [],
      receipt: { kind: 'search', scope: input.scope, actionEpoch: input.actionEpoch, path: bossApiPaths.search, httpStatus: capture.status, submitted: { ...input.submitted, pageSize: query.pageSize }, hasMore, bodySha256: capture.bodySha256, observedAt: new Date(capture.observedAt).toISOString() },
    };
  }
  const rowIds = rows.map(row => row.encryptJobId);
  const sameList = rowIds.length === renderedIds.length && rowIds.every((id, index) => renderedIds[index] === id);
  if (!sameList) {
    return paused('list_mismatch', `成功响应返回 ${rowIds.length} 个岗位，页面渲染的卡片身份是 ${renderedIds.length} 个且顺序/身份不同；卡片的位置、标题或公司都不足以把响应与其对应起来。`);
  }
  return {
    status: 'accepted',
    empty: false,
    cards: rows.map(row => ({ sitePostingId: row.encryptJobId, title: row.jobName, company: row.brandName, location: row.cityName })),
    receipt: { kind: 'search', scope: input.scope, actionEpoch: input.actionEpoch, path: bossApiPaths.search, httpStatus: capture.status, submitted: { ...input.submitted, pageSize: query.pageSize }, hasMore, bodySha256: capture.bodySha256, observedAt: new Date(capture.observedAt).toISOString() },
  };
}

/** The own detail pane, read in one fixed DOM pass. Text is only checked for presence and hashed. */
export type BossPaneSnapshot = {
  /** How many own panes the fixed pass matched; exactly one is required. */
  paneCount: number;
  /** How many own-pane "more jobs" links that pane contains; exactly one is required. */
  linkCount: number;
  moreJobPath: string | null;
  loading: boolean;
  title: string;
  salary: string;
  description: string;
};

export type BossDetailReservation = { identity: string; reservedAt: number };

export type BossDetailReceipt = {
  kind: 'detail';
  scope: BossObservationScope;
  actionEpoch: number;
  path: string;
  httpStatus: number;
  sitePostingId: string;
  bodySha256: string;
  snapshotSha256: string;
  observedAt: string;
};

export type BossDetailAcceptance =
  | {
    status: 'accepted';
    receipt: BossDetailReceipt;
    observation: { sitePostingId: string; title: string; company: string; location: string; salaryRaw: string; jdText: string; companyProfileText: string };
  }
  | { status: 'paused'; reason: BossProofReason; detail: string };

/**
 * Decides one reserved detail read. The reserved identity, the response's `jobInfo.encryptId` and the own
 * pane's posting id must all be the same posting; the pane must not be loading and must show its own title,
 * salary and description. The response fields are authoritative for the JD and salary: pane text is only
 * present-checked and hashed, so a transformed or private-use glyph never becomes a value.
 *
 * `activity` is the owner's monotonic detail-arrival sequence at the moment of the fixed snapshot. Any arrival
 * after the capture — including one inside the same program action, or one whose body is still pending —
 * invalidates the snapshot, because the pane may already show another posting.
 */
export function acceptDetail(input: {
  release: BossReleaseObservation;
  scope: BossObservationScope;
  reservation: BossDetailReservation | null;
  capture: BossCapture | null;
  pane: BossPaneSnapshot | null;
  activity: number;
}): BossDetailAcceptance {
  if (input.release.status !== 'recognized') return paused('release_unrecognized', input.release.detail);
  const reservation = input.reservation;
  if (!reservation) return paused('detail_not_reserved', '这个岗位身份没有先在本任务三十个详情名额内预留，页面自动加载的详情响应被隔离，不能成为快照。');
  const capture = input.capture;
  if (!capture) return paused('response_missing', `没有观察到与预留岗位对应的 ${bossApiPaths.detail} 响应。`);
  if (!sameBossScope(capture.scope, input.scope)) return paused('response_stale', '观察到的详情响应属于其它所有人、任务修订或会话代次，未接受。');
  if (capture.status !== 200) return paused('http_status', `详情响应 HTTP ${capture.status}，未接受。`);
  if (capture.envelopeFailure === 'success_unrecognized') return paused('success_unrecognized', capture.envelopeError ?? '站点应用层成功语义未被确认，未接受。');
  if (capture.envelopeFailure || !capture.detailEnvelope) return paused('envelope_unrecognized', capture.envelopeError ?? '详情响应不是已观察的成功数据结构，未接受。');
  const info = capture.detailEnvelope.zpData.jobInfo;
  const brand = capture.detailEnvelope.zpData.brandComInfo;
  if (info.encryptId !== reservation.identity) return paused('detail_identity_mismatch', `详情响应属于岗位「${info.encryptId}」，与已预留并选中的岗位「${reservation.identity}」不是同一个，未接受。`);
  if (capture.activity !== input.activity) return paused('detail_activity_intervened', '读取详情面板期间页面又发生了详情请求或响应（同一动作内也算），快照不再可信，请重新观察后再读。');
  const pane = input.pane;
  if (!pane || pane.paneCount !== 1) return paused('detail_pane_ambiguous', `页面上的详情面板数量为 ${pane?.paneCount ?? 0}，无法确认哪一个是所选岗位自己的面板，未读取。`);
  if (pane.loading) return paused('detail_loading', '所选岗位的详情面板仍显示站点自己的加载状态，未读取。');
  const paneId = pane.moreJobPath ? postingIdFromUrl(pane.moreJobPath) : null;
  if (pane.linkCount !== 1 || !paneId) return paused('detail_pane_mismatch', `详情面板内「查看全部职位」链接数量为 ${pane.linkCount} 或不是岗位详情路径，无法核对面板身份。`);
  if (paneId !== reservation.identity) return paused('detail_pane_mismatch', `详情面板自己的岗位链接指向「${paneId}」，与已预留岗位「${reservation.identity}」不同，未接受。`);
  const title = pane.title.trim();
  const salary = pane.salary.trim();
  const description = pane.description.trim();
  if (!title || !salary || !description) return paused('detail_pane_incomplete', '详情面板缺少自己的标题、薪资或职位描述字段，未接受。');
  const snapshotSha256 = sha256Hex(JSON.stringify({ path: pane.moreJobPath, title, salary, description }));
  return {
    status: 'accepted',
    observation: {
      sitePostingId: info.encryptId,
      title: info.jobName,
      company: brand.brandName,
      location: info.locationName,
      salaryRaw: info.salaryDesc,
      jdText: info.postDescription,
      companyProfileText: brand.introduce,
    },
    receipt: { kind: 'detail', scope: input.scope, actionEpoch: capture.actionEpoch, path: bossApiPaths.detail, httpStatus: capture.status, sitePostingId: info.encryptId, bodySha256: capture.bodySha256, snapshotSha256, observedAt: new Date(capture.observedAt).toISOString() },
  };
}

/** A still-usable captured detail receipt for one identity inside one scope; never a reason to click again. */
export function findReusableDetailCapture(captures: readonly BossCapture[], want: { identity: string; scope: BossObservationScope; now: number; maxAgeMs?: number }) {
  const maxAge = want.maxAgeMs ?? BOSS_DETAIL_RECEIPT_MAX_AGE_MS;
  return captures
    .filter(capture => capture.kind === 'detail'
      && capture.status === 200
      && capture.envelopeFailure === null
      && capture.detailEnvelope?.zpData.jobInfo.encryptId === want.identity
      && sameBossScope(capture.scope, want.scope)
      && want.now - capture.observedAt >= 0
      && want.now - capture.observedAt <= maxAge)
    .sort((left, right) => right.observedAt - left.observedAt)[0] ?? null;
}

/**
 * How one reserved posting may be reached. The active card is established from the scoped active container and
 * its own link first: only the active identity may reuse a captured receipt, an active identity without a
 * still-valid receipt pauses instead of re-clicking (the observed frontend does not re-request an already
 * selected posting), and any other card is reached through its own identity-bound opening.
 */
export type BossOpenDecision =
  | { action: 'reuse'; capture: BossCapture }
  | { action: 'open' }
  | { action: 'pause'; reason: BossProofReason; detail: string };

export function decideDetailOpening(input: { identity: string; activeIdentity: string | null; capture: BossCapture | null }): BossOpenDecision {
  if (input.activeIdentity !== input.identity) return { action: 'open' };
  const capture = input.capture;
  if (capture && capture.detailEnvelope?.zpData.jobInfo.encryptId === input.identity) return { action: 'reuse', capture };
  return {
    action: 'pause',
    reason: 'detail_already_active',
    detail: `岗位「${input.identity}」已经是页面当前打开的卡片，但没有仍有效的响应回执；已观察的前端对已选中的岗位不会重新请求，程序不会为了制造响应再点一次或重新导航。`,
  };
}

/** Distinct detail identities reserved for opening in one scan. Slots are never refunded. */
export class BossDetailLedger {
  private readonly reserved = new Map<string, BossDetailReservation>();

  constructor(readonly cap: number) {}

  reserve(identity: string, now: number): { ok: true; reservation: BossDetailReservation } | { ok: false; reason: 'cap_reached' | 'already_reserved' } {
    if (this.reserved.has(identity)) return { ok: false, reason: 'already_reserved' };
    if (this.reserved.size >= this.cap) return { ok: false, reason: 'cap_reached' };
    const reservation = { identity, reservedAt: now };
    this.reserved.set(identity, reservation);
    return { ok: true, reservation };
  }

  reservation(identity: string) {
    return this.reserved.get(identity) ?? null;
  }

  get count() {
    return this.reserved.size;
  }
}

export type BossCaptureWait = { status: 'captured'; capture: BossCapture } | { status: 'timeout' } | { status: 'stopped' };

/**
 * Waits a bounded time for one correlated capture. Every poll re-checks admission first, so a withdrawn
 * authority, a lost profile lease or a latched pause stops the wait instead of accepting a late response.
 */
export async function awaitBossCapture(input: {
  poll: () => BossCapture | null;
  admit: () => Promise<boolean> | boolean;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  deadlineMs: number;
  intervalMs?: number;
}): Promise<BossCaptureWait> {
  const deadline = input.now() + input.deadlineMs;
  const interval = input.intervalMs ?? 100;
  for (;;) {
    if (!(await input.admit())) return { status: 'stopped' };
    const capture = input.poll();
    if (capture) return { status: 'captured', capture };
    if (input.now() >= deadline) return { status: 'timeout' };
    await input.sleep(interval);
  }
}
