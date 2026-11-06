import { describe, expect, it } from 'vitest';
import {
  BOSS_DETAIL_RECEIPT_MAX_AGE_MS, BOSS_ENVELOPE_MAX_BYTES, BOSS_MAX_BODY_READS, BossDetailLedger, BossResponseObserver,
  acceptDetail, acceptSearch, activePostingIdentity, awaitBossCapture, bossApiMethods, bossApiRequestKind, bossPostingLinkSelector, cardSelectorFor,
  classifyBossRelease, decideDetailOpening, findReusableDetailCapture, parseBossDetailEnvelope, parseBossSearchEnvelope,
  postingIdFromUrl, projectBossSearchFields, singlePostingIdentity, type BossBodyTicket, type BossCapture, type BossObservationScope,
  type BossPaneSnapshot, type BossSearchEncoding, type BossSuccessSemantics,
} from '../apps/worker/src/boss-response';
import { BrowserUnavailable, declaredBytes, headerValue } from '../apps/worker/src/boss-browser';
import { reactToDetailFailure } from '../apps/worker/src/career-worker';

// Browser-free cases of the response-backed read-only scan. Every case drives the production observation
// lifecycle (`BossResponseObserver`), acceptance or Worker reaction with composed sequences — a deferred body,
// a second request inside the same action, disposal while a body is in flight, a list reorder, an active card
// with and without a receipt, an oversized declared body — instead of a browser mock or a copy of the code.

const release = { status: 'recognized', build: 'v6789' } as const;
const scope: BossObservationScope = { owner: 'owner-1', taskRevision: 4, sessionGeneration: 2 };
const otherScope: BossObservationScope = { owner: 'owner-1', taskRevision: 3, sessionGeneration: 2 };
const encoding: BossSearchEncoding = {
  fields: { city: 'city', query: 'query', page: 'page', pageSize: 'pageSize' },
  cityValues: { 广州: '101280100', 深圳: '101280600' },
};
/** A test-owned explicit profile fact; the production live profile keeps `unknown`. */
const recognizedSuccess: BossSuccessSemantics = { status: 'recognized', discriminator: { field: 'code', equals: '0' } };
const unknownSuccess: BossSuccessSemantics = { status: 'unknown' };

const searchUrl = 'https://www.zhipin.com/wapi/zpgeek/search/joblist.json';
const detailUrl = 'https://www.zhipin.com/wapi/zpgeek/job/detail.json';
const formType = 'application/x-www-form-urlencoded; charset=UTF-8';

const submitted = { city: '广州', query: '全栈', page: 1 };
const controls = {
  requested: { city: '广州', position: '全栈', salary: '不限' },
  observed: { city: '广州', position: '全栈', salary: '不限' },
};

function searchBody(ids: string[], hasMore = false) {
  return JSON.stringify({
    code: 0,
    message: 'success',
    zpData: {
      jobList: ids.map(id => ({ encryptJobId: id, jobName: `岗位 ${id}`, brandName: `公司 ${id}`, cityName: '广州', salaryDesc: '15-25K' })),
      hasMore,
    },
  });
}

function detailBody(identity: string) {
  return JSON.stringify({
    code: 0,
    zpData: {
      securityId: 'SECRET-SECURITY-ID',
      jobInfo: {
        encryptId: identity, lid: 'SECRET-LID', jobName: `岗位 ${identity}`, salaryDesc: '15-25K',
        locationName: '广州·天河', postDescription: '负责全栈功能开发、接口设计与数据建模。',
      },
      brandComInfo: { brandName: `公司 ${identity}`, introduce: '自研产品团队。', encryptUserId: 'SECRET-RECRUITER' },
    },
  });
}

/** One scan's observation lifetime with a controllable clock and action epoch. */
function newScan(options: {
  success?: BossSuccessSemantics; encoding?: BossSearchEncoding | null; scope?: BossObservationScope;
  generation?: number; bodyReads?: Set<BossBodyTicket>;
} = {}) {
  const state = { now: 1000, epoch: 1 };
  const observer = new BossResponseObserver({
    origin: 'https://www.zhipin.com',
    success: options.success ?? recognizedSuccess,
    encoding: options.encoding === undefined ? encoding : options.encoding,
    scope: options.scope ?? scope,
    generation: options.generation ?? 1,
    bodyReads: options.bodyReads ?? new Set<BossBodyTicket>(),
    actionEpoch: () => state.epoch,
    now: () => state.now,
  });
  return { observer, state };
}

function formBody(input: { city?: string; query?: string; page?: number; pageSize?: number } = {}) {
  return new URLSearchParams({
    city: input.city ?? '101280100',
    query: input.query ?? '全栈',
    page: String(input.page ?? 1),
    pageSize: String(input.pageSize ?? 30),
    // A tracking parameter the site adds: it must never survive the ingress projection.
    ka: 'tracking-value',
  }).toString();
}

type Scan = ReturnType<typeof newScan>;

/** Sends the observed search submit and returns its capture (null when no capture was stored). */
function captureSearch(scan: Scan, input: {
  ids?: string[]; hasMore?: boolean; body?: string; status?: number; declared?: number | null;
  contentType?: string | null; method?: string; form?: string; deferBody?: boolean;
} = {}): BossCapture | null {
  const identity = {};
  scan.observer.noteRequest({
    identity, url: searchUrl, method: input.method ?? bossApiMethods.search,
    contentType: input.contentType === undefined ? formType : input.contentType,
    body: input.form ?? formBody(),
  });
  const ticket = scan.observer.noteResponse(identity, input.status ?? 200, input.declared ?? null);
  if (!ticket) return lastCapture(scan, 'search');
  if (input.deferBody) return null;
  scan.observer.noteBody(ticket, input.body ?? searchBody(input.ids ?? ['a1111', 'b2222'], input.hasMore ?? false));
  return lastCapture(scan, 'search');
}

function captureDetail(scan: Scan, input: { identityBody?: string; status?: number; declared?: number | null; deferBody?: boolean; url?: string; method?: string } = {}) {
  const identity = {};
  // The page's own securityId/lid travel in the detail request address; they must never reach a capture.
  scan.observer.noteRequest({
    identity, url: input.url ?? `${detailUrl}?securityId=SECRET-SECURITY-ID&lid=SECRET-LID`,
    method: input.method ?? bossApiMethods.detail, contentType: null, body: null,
  });
  const ticket = scan.observer.noteResponse(identity, input.status ?? 200, input.declared ?? null);
  return { identity, ticket, finish: (body = input.identityBody ?? detailBody('a1111')) => {
    if (ticket) scan.observer.noteBody(ticket, body);
    return lastCapture(scan, 'detail');
  } };
}

function lastCapture(scan: Scan, kind: 'search' | 'detail') {
  return [...scan.observer.observed()].reverse().find(capture => capture.kind === kind) ?? null;
}

function list(paths: string[], extra: { loading?: boolean; empty?: boolean } = {}) {
  return { cardCount: paths.length, cardPaths: paths, loading: extra.loading ?? false, empty: extra.empty ?? false };
}

function pane(identity: string, extra: Partial<BossPaneSnapshot> = {}): BossPaneSnapshot {
  return {
    paneCount: 1, linkCount: 1, moreJobPath: `/job_detail/${identity}.html`, loading: false,
    title: `岗位 ${identity}`, salary: '15-25K', description: '负责全栈功能开发、接口设计与数据建模。', ...extra,
  };
}

describe('observed release, endpoints and methods', () => {
  const scripts = [
    'https://static.zhipin.com/zhipin-geek-spa/web/v6789/static/js/app~2.6a7d5ca6.js',
    'https://static.zhipin.com/zhipin-geek-spa/web/v6789/static/js/job~1.8a98f220.js',
    'https://static.zhipin.com/zhipin-geek-spa/web/v6789/static/js/8026.dda5c0dc.js',
  ];

  it('recognizes only the pinned release and component set', () => {
    expect(classifyBossRelease(scripts)).toEqual({ status: 'recognized', build: 'v6789' });
    const drifted = classifyBossRelease(scripts.map(source => source.replace('v6789', 'v6790')));
    expect(drifted.status).toBe('unrecognized');
    expect(drifted.status === 'unrecognized' && drifted.detail).toContain('v6790');
    const changed = classifyBossRelease(scripts.map(source => source.replace('8026.dda5c0dc.js', '8026.ffffffff.js')));
    expect(changed.status).toBe('unrecognized');
    expect(changed.status === 'unrecognized' && changed.detail).toContain('8026.dda5c0dc.js');
    expect(classifyBossRelease(['https://www.zhipin.com/web/geek/jobs/app.js']).status).toBe('absent');
  });

  it('accepts only the exact HTTPS first-party allowlisted business paths', () => {
    expect(bossApiRequestKind(`${searchUrl}?city=1`, 'https://www.zhipin.com')).toBe('search');
    expect(bossApiRequestKind(detailUrl, 'https://www.zhipin.com')).toBe('detail');
    expect(bossApiRequestKind('http://www.zhipin.com/wapi/zpgeek/job/detail.json', 'https://www.zhipin.com')).toBeNull();
    expect(bossApiRequestKind('https://evil.example/wapi/zpgeek/job/detail.json', 'https://www.zhipin.com')).toBeNull();
    expect(bossApiRequestKind('https://www.zhipin.com/wapi/zpgeek/job/other.json', 'https://www.zhipin.com')).toBeNull();
  });

  it('pins the observed source methods instead of accepting either', () => {
    expect(bossApiMethods).toEqual({ search: 'POST', detail: 'GET' });
    // A search submitted with GET, or a detail requested with POST, is not the observed frontend call.
    const wrongSearch = newScan();
    expect(captureSearch(wrongSearch, { method: 'GET' })).toBeNull();
    const wrongDetail = newScan();
    captureDetail(wrongDetail, { method: 'POST' }).finish();
    expect(wrongDetail.observer.observed()).toHaveLength(0);
  });
});

describe('application success semantics', () => {
  const validSearch = searchBody(['a1111']);

  it('accepts no envelope at all while the success discriminator is unknown', () => {
    const unknown = newScan({ success: unknownSuccess });
    const capture = captureSearch(unknown);
    expect(capture?.envelopeFailure).toBe('success_unrecognized');
    expect(capture?.searchEnvelope).toBeNull();
    // The same well-shaped body is not accepted as data either.
    expect(parseBossSearchEnvelope(validSearch, unknownSuccess)).toMatchObject({ ok: false, failure: 'success_unrecognized' });
    expect(acceptSearch({
      release, scope, actionEpoch: 1, submitted, controls, capture, list: list(['/job_detail/a1111.html']),
    })).toMatchObject({ status: 'paused', reason: 'success_unrecognized' });
  });

  it('rejects a failure or unknown envelope that still carries well-shaped data', () => {
    const failureBody = JSON.stringify({ code: 7, message: '访问过于频繁', zpData: JSON.parse(validSearch).zpData });
    const recognized = newScan();
    const capture = captureSearch(recognized, { body: failureBody });
    expect(capture?.envelopeFailure).toBe('success_unrecognized');
    expect(capture?.searchEnvelope).toBeNull();
    expect(acceptSearch({
      release, scope, actionEpoch: 1, submitted, controls, capture, list: list(['/job_detail/a1111.html']),
    })).toMatchObject({ status: 'paused', reason: 'success_unrecognized' });
    // The detail envelope is held to the same discriminator.
    expect(parseBossDetailEnvelope(JSON.stringify({ code: 1, zpData: JSON.parse(detailBody('a1111')).zpData }), recognizedSuccess))
      .toMatchObject({ ok: false, failure: 'success_unrecognized' });
    expect(parseBossDetailEnvelope(detailBody('a1111'), recognizedSuccess).ok).toBe(true);
  });
});

describe('search request projection and privacy', () => {
  it('projects only the four bounded form fields and drops the rest of the body', () => {
    const scan = newScan();
    const capture = captureSearch(scan);
    expect(capture?.search).toEqual({ city: '广州', query: '全栈', page: 1, pageSize: 30 });
    expect(capture?.requestError).toBeNull();
    // The retained capture keeps only the projected envelope: no tracking parameter, no raw body, no
    // response field that is not whitelisted, and no request address.
    const retained = JSON.stringify(capture);
    expect(retained).not.toContain('tracking-value');
    expect(retained).not.toContain('ka=');
    expect(retained).not.toContain('salaryDesc');
    expect(retained).not.toContain('"message"');
    expect(retained).not.toContain('wapi/zpgeek');
  });

  it('never retains a detail request address or its per-request secrets', () => {
    const scan = newScan();
    const capture = captureDetail(scan).finish();
    const retained = JSON.stringify(capture);
    for (const secret of ['SECRET-SECURITY-ID', 'SECRET-LID', 'SECRET-RECRUITER', 'securityId', 'lid']) {
      expect(retained).not.toContain(secret);
    }
  });

  it('refuses a submit that does not carry the observed form encoding or the observed fields', () => {
    const wrongType = newScan();
    const jsonSubmit = captureSearch(wrongType, { contentType: 'application/json' });
    expect(jsonSubmit?.search).toBeNull();
    expect(jsonSubmit?.requestError).toContain('application/x-www-form-urlencoded');
    const missingField = newScan();
    const partial = captureSearch(missingField, { form: 'city=101280100&query=%E5%85%A8%E6%A0%88&page=1' });
    expect(partial?.search).toBeNull();
    expect(partial?.requestError).toContain('表单字段');
    // Without an observed encoding the live profile has, nothing is projected at all.
    expect(projectBossSearchFields(formBody(), encoding)).toEqual({ ok: true, value: { city: '广州', query: '全栈', page: 1, pageSize: 30 } });
    expect(projectBossSearchFields('city=999&query=%E5%85%A8%E6%A0%88&page=1&pageSize=30', encoding).ok).toBe(false);
  });
});

describe('bounded body acquisition', () => {
  it('checks the declared size before the body is acquired', () => {
    const scan = newScan();
    const capture = captureSearch(scan, { declared: BOSS_ENVELOPE_MAX_BYTES + 1 });
    expect(capture?.envelopeFailure).toBe('oversize');
    expect(scan.observer.bodyReads).toBe(0);
    expect(declaredBytes('4096')).toBe(4096);
    expect(declaredBytes(null)).toBeNull();
    expect(headerValue({ 'Content-Length': '12' }, 'content-length')).toBe('12');
  });

  it('keeps at most BOSS_MAX_BODY_READS outstanding reads, counting reads that never resolve', () => {
    const scan = newScan();
    for (let index = 0; index < BOSS_MAX_BODY_READS; index += 1) {
      captureSearch(scan, { deferBody: true });
    }
    expect(scan.observer.bodyReads).toBe(BOSS_MAX_BODY_READS);
    const overBound = captureSearch(scan, { deferBody: true });
    expect(overBound?.envelopeFailure).toBe('unreadable');
    expect(overBound?.envelopeError).toContain('同时读取');
    expect(scan.observer.bodyReads).toBe(BOSS_MAX_BODY_READS);
  });

  it('retains unresolved reads across disposal and resumed scans until their driver promises settle', () => {
    const bodyReads = new Set<BossBodyTicket>();
    const first = newScan({ bodyReads });
    const pending = Array.from({ length: BOSS_MAX_BODY_READS }, () => captureDetail(first));
    first.observer.dispose();
    const resumed = newScan({ bodyReads, generation: 2 });
    expect(captureSearch(resumed)?.envelopeFailure).toBe('unreadable');
    expect(resumed.observer.bodyReads).toBe(BOSS_MAX_BODY_READS);

    // A timed-out read still occupies a slot until the underlying driver promise settles.
    first.state.now += 10000;
    pending[0]?.finish();
    expect(first.observer.observed()).toHaveLength(0);
    expect(resumed.observer.bodyReads).toBe(BOSS_MAX_BODY_READS - 1);
    expect(captureSearch(resumed)?.searchEnvelope?.zpData.jobList).toHaveLength(2);
    pending.slice(1).forEach(read => read.finish());
    expect(resumed.observer.bodyReads).toBe(0);
    expect(first.observer.observed()).toHaveLength(0);
  });

  it('drops a late body after disposal or a new scan lifetime and after its own deadline', () => {
    const disposed = newScan();
    const first = captureDetail(disposed);
    disposed.observer.dispose();
    first.finish();
    expect(disposed.observer.observed()).toHaveLength(0);

    const bodyReads = new Set<BossBodyTicket>();
    const superseded = newScan({ bodyReads });
    const stale = captureDetail(superseded);
    superseded.observer.dispose();
    const next = newScan({ bodyReads, generation: 2 });
    next.observer.noteRequest({ identity: stale.identity, url: detailUrl, method: 'GET', contentType: null, body: null });
    const fresh = next.observer.noteResponse(stale.identity, 200, null);
    if (!stale.ticket || !fresh) throw new Error('Both driver reads must be admitted');
    next.observer.noteBody(stale.ticket, detailBody('a1111'));
    expect(next.observer.observed()).toHaveLength(0);
    expect(next.observer.bodyReads).toBe(2);
    stale.finish();
    next.observer.noteBody(fresh, detailBody('b2222'));
    expect(lastCapture(next, 'detail')?.detailEnvelope?.zpData.jobInfo.encryptId).toBe('b2222');
    expect(next.observer.bodyReads).toBe(0);

    const late = newScan();
    const pending = captureDetail(late);
    late.state.now += 10000;
    pending.finish();
    expect(late.observer.observed()).toHaveLength(0);
  });
});

describe('detail activity fencing', () => {
  it('rejects an intervening detail arrival inside the same program action', () => {
    const scan = newScan();
    const capture = captureDetail(scan).finish();
    expect(capture?.activity).toBe(2);
    expect(acceptDetail({ release, scope, reservation: { identity: 'a1111', reservedAt: 900 }, capture, pane: pane('a1111'), activity: scan.observer.detailActivity }).status).toBe('accepted');
    // The same action epoch, but the page started another detail request: activity moved, so the snapshot is stale.
    captureDetail(scan, { deferBody: true });
    expect(scan.observer.detailActivity).toBe(4);
    expect(acceptDetail({ release, scope, reservation: { identity: 'a1111', reservedAt: 900 }, capture, pane: pane('a1111'), activity: scan.observer.detailActivity }))
      .toMatchObject({ status: 'paused', reason: 'detail_activity_intervened' });
  });

  it('counts a response whose body is still pending', () => {
    const scan = newScan();
    const capture = captureDetail(scan).finish();
    // A second detail response arrives; its body never resolves inside the observation.
    captureDetail(scan, { deferBody: true });
    expect(acceptDetail({ release, scope, reservation: { identity: 'a1111', reservedAt: 900 }, capture, pane: pane('a1111'), activity: scan.observer.detailActivity }))
      .toMatchObject({ status: 'paused', reason: 'detail_activity_intervened' });
  });

  it('does not count a search response as detail activity', () => {
    const scan = newScan();
    const capture = captureDetail(scan).finish();
    captureSearch(scan);
    expect(acceptDetail({ release, scope, reservation: { identity: 'a1111', reservedAt: 900 }, capture, pane: pane('a1111'), activity: scan.observer.detailActivity }).status).toBe('accepted');
  });
});

describe('identity-bound card resolution', () => {
  it('addresses one card through its own canonical link, never through an index', () => {
    const selector = cardSelectorFor('.rec-job-list .job-card-wrap', 'a1111');
    expect(selector).toBe('.rec-job-list .job-card-wrap:has(a.job-name[href*="/job_detail/a1111.html"])');
    expect(selector).not.toContain('nth');
    // A quote in the identity cannot break out of the attribute selector.
    expect(bossPostingLinkSelector('a"1111')).toContain('%22');
    expect(postingIdFromUrl('/job_detail/a1111.html')).toBe('a1111');
    expect(postingIdFromUrl('https://www.zhipin.com/web/geek/jobs')).toBeNull();
  });

  it('requires exactly one own link for the active card and for a resolved identity', () => {
    expect(singlePostingIdentity(['/job_detail/a1111.html'])).toEqual({ ok: true, identity: 'a1111' });
    expect(singlePostingIdentity([]).ok).toBe(false);
    expect(singlePostingIdentity(['/job_detail/a1111.html', '/job_detail/b2222.html']).ok).toBe(false);
  });

  it('resolves a card by identity, so a reordered list cannot redirect the opening', () => {
    // The selector names exactly the reserved identity; a reorder changes no locator input.
    const before = cardSelectorFor('.rec-job-list .job-card-wrap', 'a1111');
    const after = cardSelectorFor('.rec-job-list .job-card-wrap', 'a1111');
    expect(after).toBe(before);
    expect(before).toContain('/job_detail/a1111.html');
    expect(before).not.toContain('b2222');
    // Reading the same link set in either order yields the same identity, and two cards never yield one.
    expect(singlePostingIdentity(['/job_detail/a1111.html']).ok).toBe(true);
    expect(singlePostingIdentity(['/job_detail/b2222.html', '/job_detail/a1111.html']).ok).toBe(false);
  });
});

describe('already-active card', () => {
  const reservation = { identity: 'a1111', reservedAt: 900 };

  it('distinguishes no active card from missing, ambiguous or unreadable active identity', () => {
    expect(activePostingIdentity({ cardCount: 0, paths: [] })).toEqual({ ok: true, identity: null });
    expect(activePostingIdentity({ cardCount: 1, paths: ['/job_detail/a1111.html'] }))
      .toEqual({ ok: true, identity: 'a1111' });
    expect(activePostingIdentity({ cardCount: 1, paths: [] }).ok).toBe(false);
    expect(activePostingIdentity({ cardCount: 1, paths: ['/web/geek/jobs'] }).ok).toBe(false);
    expect(activePostingIdentity({ cardCount: 1, paths: ['/job_detail/a1111.html', '/job_detail/b2222.html'] }).ok).toBe(false);
    expect(activePostingIdentity({ cardCount: 2, paths: ['/job_detail/a1111.html'] }).ok).toBe(false);
    expect(activePostingIdentity(null).ok).toBe(false);
  });

  it('reuses a still-valid receipt only for the active identity', () => {
    const scan = newScan();
    const active = captureDetail(scan).finish();
    expect(active).not.toBeNull();
    const reusable = findReusableDetailCapture(scan.observer.observed(), { identity: 'a1111', scope, now: 1000 });
    expect(reusable).toBe(active);
    expect(decideDetailOpening({ identity: 'a1111', activeIdentity: 'a1111', capture: reusable })).toEqual({ action: 'reuse', capture: active });
    // A cached receipt for another posting never decides how this card is reached.
    expect(decideDetailOpening({ identity: 'b2222', activeIdentity: 'b2222', capture: reusable })).toMatchObject({ action: 'pause', reason: 'detail_already_active' });
    // A non-active card is opened through its own identity even when a receipt for it exists.
    expect(decideDetailOpening({ identity: 'a1111', activeIdentity: 'b2222', capture: reusable })).toEqual({ action: 'open' });
    // Without an observed active card nothing is reused.
    expect(decideDetailOpening({ identity: 'a1111', activeIdentity: null, capture: reusable })).toEqual({ action: 'open' });
  });

  it('pauses without a click when the reserved card is already active but has no valid receipt', () => {
    const decision = decideDetailOpening({ identity: 'a1111', activeIdentity: 'a1111', capture: null });
    expect(decision.action).toBe('pause');
    expect(decision).toMatchObject({ reason: 'detail_already_active' });
    // A receipt outside the freshness window is no receipt: the active card still pauses.
    const scan = newScan();
    captureDetail(scan).finish();
    expect(findReusableDetailCapture(scan.observer.observed(), { identity: 'a1111', scope, now: 1000 + BOSS_DETAIL_RECEIPT_MAX_AGE_MS + 1 })).toBeNull();
    expect(findReusableDetailCapture(scan.observer.observed(), { identity: 'a1111', scope: otherScope, now: 1000 })).toBeNull();
    expect(acceptDetail({ release, scope, reservation, capture: null, pane: pane('a1111'), activity: 0 }))
      .toMatchObject({ status: 'paused', reason: 'response_missing' });
  });
});

describe('Worker detail-failure control flow', () => {
  it('stops the scan at the first proof failure without reading another card', async () => {
    const ledger = new BossDetailLedger(30);
    expect(ledger.reserve('a1111', 1000).ok).toBe(true);
    const cards = ['a1111', 'b2222'];
    const read: string[] = [];
    const proofPauses: string[] = [];
    let sessionPauses = 0;
    let counted = 0;
    for (const identity of cards) {
      read.push(identity);
      const reaction = await reactToDetailFailure({
        error: new BrowserUnavailable('SITE_PROOF_UNVERIFIED', 'detail_activity_intervened: 快照不再可信'),
        pauseSession: async () => {
          sessionPauses += 1;
        },
        pauseProof: async detail => {
          proofPauses.push(detail);
        },
        countPageFailure: async () => {
          counted += 1;
          return false;
        },
      });
      if (reaction === 'stop') break;
    }
    // No second card was read, the explicit reason was persisted once, and no page-failure streak was touched.
    expect(read).toEqual(['a1111']);
    expect(proofPauses).toHaveLength(1);
    expect(proofPauses[0]).toContain('detail_activity_intervened');
    expect(sessionPauses).toBe(0);
    expect(counted).toBe(0);
    // The reservation is retained: a proof failure never refunds the shared thirty-posting budget.
    expect(ledger.count).toBe(1);
    expect(ledger.reservation('a1111')).not.toBeNull();
  });

  it('keeps a site block as a session pause and counts only ordinary page failures', async () => {
    const sessionBlocks: string[] = [];
    const blocked = await reactToDetailFailure({
      error: new BrowserUnavailable('SESSION_PAUSED', '页面显示人机校验', { pauseReason: 'verification_required' }),
      pauseSession: async () => {
        sessionBlocks.push('session');
      },
      pauseProof: async () => {
        throw new Error('a site block is not a proof pause');
      },
      countPageFailure: async () => {
        throw new Error('a site block is not a page failure');
      },
    });
    expect(blocked).toBe('stop');
    expect(sessionBlocks).toEqual(['session']);

    let counted = 0;
    const ordinary = await reactToDetailFailure({
      error: new Error('driver timed out'),
      pauseSession: async () => {
        throw new Error('an ordinary failure is not a session pause');
      },
      pauseProof: async () => {
        throw new Error('an ordinary failure is not a proof pause');
      },
      countPageFailure: async () => {
        counted += 1;
        return false;
      },
    });
    expect(ordinary).toBe('continue');
    expect(counted).toBe(1);

    const streak = await reactToDetailFailure({
      error: new Error('driver timed out'),
      pauseSession: async () => undefined,
      pauseProof: async () => undefined,
      countPageFailure: async () => true,
    });
    expect(streak).toBe('stop');
  });
});

describe('search acceptance', () => {
  it('accepts the response of this action and keeps whitelisted public fields plus a body digest', () => {
    const scan = newScan();
    const capture = captureSearch(scan, { ids: ['a1111', 'b2222'], hasMore: true });
    const acceptance = acceptSearch({ release, scope, actionEpoch: 1, submitted, controls, capture, list: list(['/job_detail/a1111.html', '/job_detail/b2222.html']) });
    expect(acceptance.status).toBe('accepted');
    if (acceptance.status !== 'accepted') return;
    expect(acceptance.cards).toEqual([
      { sitePostingId: 'a1111', title: '岗位 a1111', company: '公司 a1111', location: '广州' },
      { sitePostingId: 'b2222', title: '岗位 b2222', company: '公司 b2222', location: '广州' },
    ]);
    expect(acceptance.receipt).toMatchObject({ path: '/wapi/zpgeek/search/joblist.json', httpStatus: 200, hasMore: true, submitted: { city: '广州', query: '全栈', page: 1, pageSize: 30 } });
    expect(JSON.stringify(acceptance)).not.toContain('zpData');
  });

  it("rejects an older action's response and the page's own earlier render", () => {
    const scan = newScan();
    const capture = captureSearch(scan);
    // The next program action started: the previous capture no longer belongs to it.
    expect(acceptSearch({ release, scope, actionEpoch: 2, submitted, controls, capture, list: list(['/job_detail/a1111.html', '/job_detail/b2222.html']) }))
      .toMatchObject({ status: 'paused', reason: 'response_stale' });
  });

  it('rejects a response whose submit maps to another city or keyword', () => {
    const otherCity = newScan();
    expect(acceptSearch({
      release, scope, actionEpoch: 1, submitted, controls,
      capture: captureSearch(otherCity, { form: formBody({ city: '101280600' }) }),
      list: list(['/job_detail/a1111.html', '/job_detail/b2222.html']),
    })).toMatchObject({ status: 'paused', reason: 'query_mismatch' });
    const otherKeyword = newScan();
    expect(acceptSearch({
      release, scope, actionEpoch: 1, submitted, controls,
      capture: captureSearch(otherKeyword, { form: formBody({ query: 'Java' }) }),
      list: list(['/job_detail/a1111.html', '/job_detail/b2222.html']),
    })).toMatchObject({ status: 'paused', reason: 'query_mismatch' });
  });

  it('never reads an in-flight submit as a completed search', async () => {
    let now = 1000;
    let polls = 0;
    const wait = await awaitBossCapture({
      poll: () => {
        polls += 1;
        return null;
      },
      admit: () => true,
      now: () => now,
      sleep: async ms => {
        now += ms;
      },
      deadlineMs: 400,
      intervalMs: 100,
    });
    expect(wait.status).toBe('timeout');
    expect(polls).toBeGreaterThan(1);
    expect(acceptSearch({ release, scope, actionEpoch: 1, submitted, controls, capture: null, list: list(['/job_detail/a1111.html']) }))
      .toMatchObject({ status: 'paused', reason: 'response_missing' });
  });

  it('distinguishes a transient empty list from an accepted empty result', () => {
    const transient = newScan();
    expect(acceptSearch({
      release, scope, actionEpoch: 1, submitted, controls,
      capture: captureSearch(transient, { ids: [] }),
      list: list(['/job_detail/a1111.html']),
    })).toMatchObject({ status: 'paused', reason: 'empty_unrecognized' });
    const empty = newScan();
    expect(acceptSearch({
      release, scope, actionEpoch: 1, submitted, controls,
      capture: captureSearch(empty, { ids: [] }),
      list: list([], { empty: true }),
    })).toMatchObject({ status: 'accepted', empty: true, cards: [] });
  });

  it('requires the rendered card identities to be the successful ids in the successful order', () => {
    const sameTitleOtherId = newScan();
    expect(acceptSearch({
      release, scope, actionEpoch: 1, submitted, controls,
      capture: captureSearch(sameTitleOtherId),
      list: list(['/job_detail/a1111.html', '/job_detail/c3333.html']),
    })).toMatchObject({ status: 'paused', reason: 'list_mismatch' });
    const extraCard = newScan();
    expect(acceptSearch({
      release, scope, actionEpoch: 1, submitted, controls,
      capture: captureSearch(extraCard, { ids: ['a1111'] }),
      list: list(['/job_detail/a1111.html', '/job_detail/b2222.html']),
    })).toMatchObject({ status: 'paused', reason: 'list_mismatch' });
    const noLink = newScan();
    expect(acceptSearch({
      release, scope, actionEpoch: 1, submitted, controls,
      capture: captureSearch(noLink, { ids: ['a1111'] }),
      list: { cardCount: 2, cardPaths: ['/job_detail/a1111.html'], loading: false, empty: false },
    })).toMatchObject({ status: 'paused', reason: 'list_mismatch' });
  });

  it('pauses while the site still shows its own loading placeholder', () => {
    const scan = newScan();
    expect(acceptSearch({
      release, scope, actionEpoch: 1, submitted, controls,
      capture: captureSearch(scan),
      list: list(['/job_detail/a1111.html', '/job_detail/b2222.html'], { loading: true }),
    })).toMatchObject({ status: 'paused', reason: 'list_loading' });
  });

  it('rejects a non-200 status, an unrecognized shape and an oversized body', () => {
    const failed = newScan();
    expect(acceptSearch({ release, scope, actionEpoch: 1, submitted, controls, capture: captureSearch(failed, { status: 429, body: searchBody(['a1111']) }), list: list(['/job_detail/a1111.html']) }))
      .toMatchObject({ status: 'paused', reason: 'http_status' });
    const shape = newScan();
    expect(acceptSearch({ release, scope, actionEpoch: 1, submitted, controls, capture: captureSearch(shape, { body: JSON.stringify({ code: 0, zpData: { jobList: [], hasMore: 'yes' } }) }), list: list([]) }))
      .toMatchObject({ status: 'paused', reason: 'envelope_unrecognized' });
    const oversized = newScan();
    expect(acceptSearch({ release, scope, actionEpoch: 1, submitted, controls, capture: captureSearch(oversized, { body: `{"code":0,"zpData":{"jobList":[],"hasMore":false},"pad":"${'x'.repeat(BOSS_ENVELOPE_MAX_BYTES)}"}` }), list: list([]) }))
      .toMatchObject({ status: 'paused', reason: 'envelope_unrecognized' });
  });

  it('rejects an observation from another task revision or session generation', () => {
    const foreign = newScan({ scope: otherScope });
    expect(acceptSearch({
      release, scope, actionEpoch: 1, submitted, controls,
      capture: captureSearch(foreign),
      list: list(['/job_detail/a1111.html', '/job_detail/b2222.html']),
    })).toMatchObject({ status: 'paused', reason: 'response_stale' });
  });

  it('pauses on release drift and on controls the page no longer shows', () => {
    expect(acceptSearch({
      release: { status: 'unrecognized', detail: '页面前端版本读到「v6790」' },
      scope, actionEpoch: 1, submitted, controls,
      capture: captureSearch(newScan()),
      list: list(['/job_detail/a1111.html', '/job_detail/b2222.html']),
    })).toMatchObject({ status: 'paused', reason: 'release_unrecognized' });
    expect(acceptSearch({
      release, scope, actionEpoch: 1, submitted,
      controls: { requested: controls.requested, observed: { city: '深圳', position: '全栈', salary: '不限' } },
      capture: null,
      list: list(['/job_detail/a1111.html']),
    })).toMatchObject({ status: 'paused', reason: 'controls_mismatch' });
  });
});

describe('detail acceptance', () => {
  const reservation = { identity: 'a1111', reservedAt: 900 };

  it('binds the reserved identity, the response and the own pane, and keeps only public fields', () => {
    const scan = newScan();
    const capture = captureDetail(scan).finish();
    const acceptance = acceptDetail({ release, scope, reservation, capture, pane: pane('a1111'), activity: scan.observer.detailActivity });
    expect(acceptance.status).toBe('accepted');
    if (acceptance.status !== 'accepted') return;
    expect(acceptance.observation).toEqual({
      sitePostingId: 'a1111', title: '岗位 a1111', company: '公司 a1111', location: '广州·天河',
      salaryRaw: '15-25K', jdText: '负责全栈功能开发、接口设计与数据建模。', companyProfileText: '自研产品团队。',
    });
    const retained = JSON.stringify(acceptance);
    for (const secret of ['SECRET-SECURITY-ID', 'SECRET-LID', 'SECRET-RECRUITER', 'securityId', 'lid']) expect(retained).not.toContain(secret);
    expect(acceptance.receipt.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects another posting's response and another posting's pane link", () => {
    const scan = newScan();
    const aCapture = captureDetail(scan).finish();
    expect(acceptDetail({ release, scope, reservation: { identity: 'b2222', reservedAt: 900 }, capture: aCapture, pane: pane('b2222'), activity: scan.observer.detailActivity }))
      .toMatchObject({ status: 'paused', reason: 'detail_identity_mismatch' });
    const bScan = newScan();
    const bCapture = captureDetail(bScan, { identityBody: detailBody('b2222') }).finish();
    expect(acceptDetail({ release, scope, reservation: { identity: 'b2222', reservedAt: 900 }, capture: bCapture, pane: pane('a1111'), activity: bScan.observer.detailActivity }))
      .toMatchObject({ status: 'paused', reason: 'detail_pane_mismatch' });
  });

  it('rejects an ambiguous, still-loading or incomplete pane', () => {
    const scan = newScan();
    const capture = captureDetail(scan).finish();
    const activity = scan.observer.detailActivity;
    expect(acceptDetail({ release, scope, reservation, capture, pane: pane('a1111', { paneCount: 2 }), activity })).toMatchObject({ status: 'paused', reason: 'detail_pane_ambiguous' });
    expect(acceptDetail({ release, scope, reservation, capture, pane: null, activity })).toMatchObject({ status: 'paused', reason: 'detail_pane_ambiguous' });
    expect(acceptDetail({ release, scope, reservation, capture, pane: pane('a1111', { loading: true }), activity })).toMatchObject({ status: 'paused', reason: 'detail_loading' });
    expect(acceptDetail({ release, scope, reservation, capture, pane: pane('a1111', { description: '' }), activity })).toMatchObject({ status: 'paused', reason: 'detail_pane_incomplete' });
    expect(acceptDetail({ release, scope, reservation, capture, pane: pane('a1111', { linkCount: 2 }), activity })).toMatchObject({ status: 'paused', reason: 'detail_pane_mismatch' });
  });

  it("keeps the page's own initial detail load quarantined until the identity is reserved", () => {
    const scan = newScan();
    const initial = captureDetail(scan).finish();
    expect(acceptDetail({ release, scope, reservation: null, capture: initial, pane: pane('a1111'), activity: scan.observer.detailActivity }))
      .toMatchObject({ status: 'paused', reason: 'detail_not_reserved' });
    const ledger = new BossDetailLedger(30);
    const reserved = ledger.reserve('a1111', 1000);
    expect(reserved.ok).toBe(true);
    const reusable = findReusableDetailCapture(scan.observer.observed(), { identity: 'a1111', scope, now: 1000 });
    expect(acceptDetail({
      release, scope, reservation: reserved.ok ? reserved.reservation : null, capture: reusable, pane: pane('a1111'), activity: scan.observer.detailActivity,
    }).status).toBe('accepted');
  });

  it('never accepts a detail response that belongs to another session generation', () => {
    const scan = newScan({ scope: otherScope });
    const capture = captureDetail(scan).finish();
    expect(acceptDetail({ release, scope, reservation, capture, pane: pane('a1111'), activity: scan.observer.detailActivity }))
      .toMatchObject({ status: 'paused', reason: 'response_stale' });
  });
});

describe('detail reservations', () => {
  it('never exceeds the shared cap under concurrent reservations and never refunds', async () => {
    const ledger = new BossDetailLedger(30);
    const attempts = Array.from({ length: 31 }, (_, index) => `id-${String(index).padStart(4, '0')}`);
    const outcomes = await Promise.all(attempts.map(async (identity, index) => {
      await Promise.resolve();
      return { identity, outcome: ledger.reserve(identity, 1000 + index) };
    }));
    expect(outcomes.filter(item => item.outcome.ok)).toHaveLength(30);
    expect(outcomes.filter(item => !item.outcome.ok && item.outcome.reason === 'cap_reached')).toHaveLength(1);
    expect(ledger.count).toBe(30);
    expect(ledger.reserve('id-0000', 2000)).toEqual({ ok: false, reason: 'already_reserved' });
    expect(ledger.count).toBe(30);
    expect(ledger.reservation('id-0000')).toMatchObject({ identity: 'id-0000' });
  });
});

describe('bounded waits', () => {
  it('stops as soon as admission is withdrawn during the wait', async () => {
    let now = 1000;
    let admits = 0;
    const result = await awaitBossCapture({
      poll: () => null,
      admit: () => {
        admits += 1;
        return admits < 2;
      },
      now: () => now,
      sleep: async ms => {
        now += ms;
      },
      deadlineMs: 5000,
      intervalMs: 100,
    });
    expect(result).toEqual({ status: 'stopped' });
    expect(admits).toBe(2);
  });

  it('returns the capture that arrives inside the window', async () => {
    const scan = newScan();
    const capture = captureSearch(scan);
    let now = 1000;
    let polls = 0;
    const result = await awaitBossCapture({
      poll: () => {
        polls += 1;
        return polls >= 3 ? scan.observer.find('search', 1) : null;
      },
      admit: () => true,
      now: () => now,
      sleep: async ms => {
        now += ms;
      },
      deadlineMs: 1000,
      intervalMs: 100,
    });
    expect(result).toEqual({ status: 'captured', capture });
  });
});
