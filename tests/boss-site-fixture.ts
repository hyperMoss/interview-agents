import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { BossSiteProfile } from '../apps/worker/src/boss-browser';

// Synthetic BOSS-like site for local acceptance. It renders native city/position/salary controls,
// stable posting links, login/verification states, conversation and consent pages, and a real file
// input whose server records the received byte digest. It proves software behavior only; it is not
// evidence of real BOSS compatibility.

export type FixturePosting = {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  city: '广州' | '深圳';
  role: '全栈' | 'Agent 开发';
  salaryLowerK: number;
  salaryUpperK: number;
  jd: string;
  companyProfile: string;
  consentRequired?: boolean;
  contactDisabled?: boolean;
  unknownAfterSend?: boolean;
  failDetail?: boolean;
  wrongAttachmentSize?: boolean;
  corruptAttachment?: boolean;
};

export const fixturePostings: FixturePosting[] = [
  { id: 'fixture-qualified-fullstack', title: '全栈工程师（AI 应用）', company: '示例自研科技', location: '广州·天河', salary: '15-25K·13薪', city: '广州', role: '全栈', salaryLowerK: 15, salaryUpperK: 25, companyProfile: '示例自研科技，自有研发团队，公司直招。', jd: '负责全栈应用开发：React 前端与 NestJS 后端，PostgreSQL 数据建模，编写自动化测试。使用大模型 API 构建 AI 应用，关注可观测性与性能。' },
  { id: 'fixture-agent-shenzhen', title: 'Agent 开发工程师', company: '示例智能体公司', location: '深圳·南山', salary: '18-18K', city: '深圳', role: 'Agent 开发', salaryLowerK: 18, salaryUpperK: 18, companyProfile: '示例智能体公司，公司直招。', jd: '研发智能体编排与工具调用，负责 Agent 平台后端开发，需要 TypeScript 与 LLM 应用经验，编写评测与回归测试。' },
  { id: 'fixture-low-salary', title: '全栈开发工程师', company: '示例低薪公司', location: '广州·海珠', salary: '10-15K', city: '广州', role: '全栈', salaryLowerK: 10, salaryUpperK: 15, companyProfile: '示例低薪公司。', jd: '负责前后端业务开发，维护内部管理系统，使用 TypeScript 与 Node.js。' },
  { id: 'fixture-outsourcing', title: '全栈开发（外派）', company: '示例外包服务', location: '深圳·福田', salary: '20-30K', city: '深圳', role: '全栈', salaryLowerK: 20, salaryUpperK: 30, companyProfile: '示例外包服务，长期驻场人力外包。', jd: '外派至客户现场驻场开发，负责前端页面与接口联调。' },
  { id: 'fixture-blacklisted', title: '全栈工程师', company: '某某人才服务公司', location: '广州·越秀', salary: '20-30K', city: '广州', role: '全栈', salaryLowerK: 20, salaryUpperK: 30, companyProfile: '某某人才服务公司。', jd: '负责全栈功能开发与测试，使用 React 与 Node.js。' },
  { id: 'fixture-unknown-employment', title: '全栈工程师', company: '示例未知关系公司', location: '广州·番禺', salary: '20-30K', city: '广州', role: '全栈', salaryLowerK: 20, salaryUpperK: 30, companyProfile: '示例未知关系公司，未说明雇佣关系。', jd: '负责全栈功能开发，参与需求评审与接口设计，使用 React 与 NestJS。' },
  { id: 'fixture-sales-agent', title: 'AI Agent 销售顾问', company: '示例销售公司', location: '广州·天河', salary: '20-30K', city: '广州', role: '全栈', salaryLowerK: 20, salaryUpperK: 30, companyProfile: '示例销售公司。', jd: '负责智能体产品的大客户销售，完成销售目标。' },
  { id: 'fixture-consent', title: '全栈工程师', company: '示例自研软件', location: '广州·黄埔', salary: '18-25K', city: '广州', role: '全栈', salaryLowerK: 18, salaryUpperK: 25, companyProfile: '示例自研软件，自有团队。', jd: '负责全栈应用开发，React 与 NestJS，编写测试，使用 LLM 能力构建助手。', consentRequired: true },
  { id: 'fixture-unknown-send', title: 'Agent 平台工程师', company: '示例自研平台', location: '深圳·宝安', salary: '22-35K', city: '深圳', role: 'Agent 开发', salaryLowerK: 22, salaryUpperK: 35, companyProfile: '示例自研平台，公司直招。', jd: '负责 Agent 平台开发，工具调用与评测，使用 TypeScript 与 PostgreSQL。', unknownAfterSend: true },
  { id: 'fixture-wrong-attachment', title: '全栈工程师', company: '示例附件公司', location: '深圳·龙岗', salary: '20-28K', city: '深圳', role: '全栈', salaryLowerK: 20, salaryUpperK: 28, companyProfile: '示例附件公司，公司直招。', jd: '负责全栈开发，React 与 Node.js，编写自动化测试，具备 LLM 应用经验优先。', wrongAttachmentSize: true },
  { id: 'fixture-corrupt-receipt', title: '全栈工程师', company: '示例回执公司', location: '深圳·盐田', salary: '20-28K', city: '深圳', role: '全栈', salaryLowerK: 20, salaryUpperK: 28, companyProfile: '示例回执公司，公司直招。', jd: '负责全栈开发，React 与 Node.js，编写自动化测试，具备 LLM 应用经验优先。', corruptAttachment: true },
  { id: 'fixture-detail-failure', title: '全栈工程师', company: '示例故障公司', location: '广州·白云', salary: '20-30K', city: '广州', role: '全栈', salaryLowerK: 20, salaryUpperK: 30, companyProfile: '示例故障公司。', jd: '负责全栈开发，React 与 Node.js。', failDetail: true },
  // Owner-scoped postings of the authority interleaving suite; each test owns its own synthetic posting.
  { id: 'fixture-clear-during-chat', title: '全栈工程师（数据平台）', company: '示例授权清理公司', location: '广州·天河', salary: '18-26K', city: '广州', role: '全栈', salaryLowerK: 18, salaryUpperK: 26, companyProfile: '示例授权清理公司，自有研发团队，公司直招。', jd: '负责数据平台全栈开发：React 前端与 NestJS 后端，PostgreSQL 数据建模，编写自动化测试。' },
  { id: 'fixture-fill-blocked', title: '全栈工程师（工作台）', company: '示例授权填表公司', location: '深圳·南山', salary: '20-30K', city: '深圳', role: '全栈', salaryLowerK: 20, salaryUpperK: 30, companyProfile: '示例授权填表公司，自有研发团队，公司直招。', jd: '负责工作台全栈开发：React 前端与 NestJS 后端，PostgreSQL 数据建模，编写自动化测试。' },
  { id: 'fixture-reservation-handover', title: '全栈工程师（业务中台）', company: '示例授权交接公司', location: '深圳·福田', salary: '22-32K', city: '深圳', role: '全栈', salaryLowerK: 22, salaryUpperK: 32, companyProfile: '示例授权交接公司，自有研发团队，公司直招。', jd: '负责业务中台全栈开发：React 前端与 NestJS 后端，PostgreSQL 数据建模，编写自动化测试。' },
];

export type FixtureState = {
  loggedIn: boolean;
  verification: boolean;
  restricted: boolean;
  ignoreFilters: boolean;
  failSearch: boolean;
  /** Synthetic-only: delays the chat input so a test can cancel between two browser actions. */
  chatInputDelayMs: number;
  /** Synthetic-only: keeps the chat input non-editable for a bounded window so a test can withdraw
   *  authority while `fill` is still blocked. */
  chatInputSealedMs: number;
  /** Synthetic-only: marks one posting's contact entry disabled, a proven-not-sent conversation failure. */
  contactDisabledFor: string | null;
  requestedFilters: Array<{ city: string; position: string; salary: string }>;
  messages: Array<{ postingId: string; text: string }>;
  attachments: Array<{ postingId: string; name: string; sha256: string; byteSize: number }>;
  contactClicks: string[];
  chatOpens: string[];
  /** Every pathname the browser requested, so a test can prove a check caused no navigation. */
  requests: string[];
  /** Synthetic-only: the container class of the rendered frequency notice, so a new class is still read. */
  restrictionContainer: string;
  /** Synthetic-only: render a hidden first challenge match alongside a visible later one, plus the signed-in
   *  navigation, so a first-match visibility check would wrongly report the page usable. */
  hiddenFirstChallenge: boolean;
  /** Synthetic-only: a posting detail that navigates itself to the security page while the JD is awaited. */
  detailRedirectToSecurity: boolean;
  /** Synthetic-only: a chat page whose own script reaches the limit page before the attachment input shows. */
  chatRedirectToLimit: boolean;
  /** Synthetic-only: the entry page loads but matches none of the live profile's indicators. */
  bareEntryPage: boolean;
  /** Synthetic-only: the entry commits its HTML and never finishes the response, so the document URL is set
   *  while DOMContentLoaded never fires. */
  slowEntry: boolean;
};

export function fixtureProfile(origin: string): BossSiteProfile {
  return {
    name: 'boss-fixture',
    verified: true,
    note: '本地合成站点，仅用于验证软件行为，不代表真实 BOSS 兼容性。',
    // The fixture's own entry is its root; the live profile opens a known BOSS job listing instead.
    entryUrl: `${origin}/`,
    // The fixture renders plain HTML, so the legacy `<select>` adapter drives its controls and its own
    // result route; the live profile never uses this surface.
    surface: 'synthetic',
    listingUrl: `${origin}/web/geek/job`,
    postingUrl: id => `${origin}/job_detail/${encodeURIComponent(id)}.html`,
    selectors: {
      loginIndicator: '.login-form',
      verificationIndicator: '.captcha',
      readyIndicator: '.user-nav',
      accountMarker: '[data-uid]',
      resultCard: 'li.job-card-wrapper',
      resultLink: 'a.job-card-left',
      card: { title: '.job-name', company: '.company-name', location: '.job-area', salary: '.salary' },
      detail: { title: '.job-banner .name', company: '.company-info .name', location: '.job-banner .text-city', salary: '.job-banner .salary', jd: '.job-sec-text', companyProfile: '.company-info' },
      contact: 'a.btn-startchat',
      chatInput: '#chat-input',
      chatSend: '.btn-send',
      chatMessages: '.chat-message-list',
      chatContainer: '.chat-message-list',
      conversationLink: 'a.chat-entry',
      consentNotice: '.consent-notice',
      attachmentInput: 'input[type=file]',
      attachmentSubmit: '.send-resume button',
      attachmentMessage: '.message-card',
      attachmentReceipt: '.message-card',
    },
    filters: { city: '#city-filter', salary: '#salary-filter', position: '#position-filter' },
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}

function html(body: string, extraHead = '') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>合成 BOSS 站点</title>${extraHead}</head><body>${body}</body></html>`;
}

/** Real BOSS error and limit pages keep the signed-in site header; the fixture mirrors that chrome so a
 *  page with a site-level message stays recognizable while a page without any site chrome stays unreadable. */
function siteHeader(uid: string) {
  return `<div class="user-nav" data-uid="${escapeHtml(uid)}">求职者账号</div>`;
}

function selectedAttribute(current: string, option: string) {
  return current === option ? ' selected' : '';
}

function readCookies(request: { headers: { cookie?: string } }) {
  return (request.headers.cookie ?? '').split(';').map(value => value.trim());
}

/** Per-profile synthetic account id: the cookie lives in one private browser profile only. */
function accountUid(request: { headers: { cookie?: string } }) {
  const value = readCookies(request).find(cookie => cookie.startsWith('fixture_uid='));
  const uid = value?.slice('fixture_uid='.length) ?? '';
  return /^[A-Za-z0-9_-]{1,40}$/.test(uid) ? uid : 'fixture-uid';
}

function chatForms(postingId: string, sealedMs = 0) {
  return `<form method="POST" action="/chat/${postingId}/send"><textarea id="chat-input" name="text"${sealedMs > 0 ? ' disabled' : ''}></textarea><button class="btn-send" type="submit">发送</button></form>
        <form class="send-resume" method="POST" action="/chat/${postingId}/resume" enctype="multipart/form-data"><input id="attachment-input" type="file" name="resume"><button type="submit">发送附件简历</button></form>`;
}

function multipartFile(body: Buffer, contentType: string) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.slice(1).find(Boolean);
  if (!boundary) return null;
  const filenameMatch = /filename="([^"]*)"/.exec(body.toString('latin1'));
  const headerEnd = body.indexOf('\r\n\r\n');
  if (headerEnd < 0) return null;
  const end = body.indexOf(Buffer.from(`\r\n--${boundary}`), headerEnd + 4);
  if (end < 0) return null;
  return { name: filenameMatch?.[1] ?? 'resume', bytes: body.subarray(headerEnd + 4, end) };
}

export async function startBossFixture() {
  const state: FixtureState = { loggedIn: false, verification: false, restricted: false, ignoreFilters: false, failSearch: false, chatInputDelayMs: 0, chatInputSealedMs: 0, contactDisabledFor: null, requestedFilters: [], messages: [], attachments: [], contactClicks: [], chatOpens: [], requests: [], restrictionContainer: 'error-page', hiddenFirstChallenge: false, detailRedirectToSecurity: false, chatRedirectToLimit: false, bareEntryPage: false, slowEntry: false };
  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    state.requests.push(url.pathname);
    const authed = state.loggedIn || readCookies(request).includes('fixture_auth=ok');
    const uid = accountUid(request);
    const send = (status: number, body: string, headers: Record<string, string | string[]> = {}) => {
      response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
      response.end(body);
    };
    if (url.pathname === '/login') {
      const requested = url.searchParams.get('as');
      // `?as=` signs one private browser profile in as a specific synthetic account without
      // authenticating every profile, so two owner sessions can be compared.
      const account = requested && /^[A-Za-z0-9_-]{1,40}$/.test(requested) ? requested : null;
      if (account) {
        send(302, '', { location: '/', 'set-cookie': [`fixture_auth=ok; Path=/; HttpOnly; SameSite=Strict`, `fixture_uid=${account}; Path=/; HttpOnly; SameSite=Strict`] });
        return;
      }
      state.loggedIn = true;
      send(302, '', { location: '/', 'set-cookie': 'fixture_auth=ok; Path=/; HttpOnly; SameSite=Strict' });
      return;
    }
    if (url.pathname === '/limit-notice') {
      // A standalone limit page reached by the page's own navigation; only the sentence is the evidence.
      send(200, html(`${siteHeader(uid)}<div class="${escapeHtml(state.restrictionContainer)}">访问过于频繁，请稍后再试</div>`));
      return;
    }
    if (url.pathname === '/web/passport/zp/security' || url.pathname.startsWith('/web/passport/zp/security/')) {
      // The real site moves an account to this passport path for an extra check; it is never a login form.
      send(200, html('<div class="captcha">请完成安全验证</div>'));
      return;
    }
    if (url.pathname === '/loop/a' || url.pathname === '/loop/b') {
      // A page whose own script keeps re-navigating the main frame; the detector is local diagnostics only.
      const other = url.pathname === '/loop/a' ? '/loop/b' : '/loop/a';
      send(200, html(`<div class="user-nav" data-uid="${escapeHtml(uid)}">求职者账号</div><script>setTimeout(function(){location.href='${other}';},120);</script>`));
      return;
    }
    if (!authed && url.pathname !== '/') {
      send(302, '', { location: '/' });
      return;
    }
    if (state.restricted) {
      // The notice sentence is the evidence; its container class is deliberately not part of detection.
      send(200, html(`${siteHeader(uid)}<div class="${escapeHtml(state.restrictionContainer)}">访问过于频繁，请稍后再试</div>`));
      return;
    }
    if (!authed) {
      send(200, html('<form class="login-form" method="POST" action="/login"><input name="user" value="fixture-user"><button id="login-submit" type="submit">登录</button></form>'));
      return;
    }
    if (state.verification) {
      if (state.hiddenFirstChallenge) {
        // The first .captcha match is hidden and a later one is visible, next to the signed-in navigation.
        send(200, html(`${siteHeader(uid)}<div class="captcha" style="display:none">旧容器</div><div class="captcha">请完成人机验证</div>`));
        return;
      }
      send(200, html('<div class="captcha">请完成人机验证</div><button id="verify-done" onclick="fetch(\'/verify-done\',{method:\'POST\'}).then(()=>location.reload())">我已完成</button>'));
      return;
    }
    if (url.pathname === '/verify-done') {
      state.verification = false;
      send(200, 'ok');
      return;
    }
    if (state.bareEntryPage) {
      // A loaded page that matches none of the live profile's indicators: classified as unknown, never ready.
      send(200, html('<div class="page-shell"><p>未知内容</p></div>'));
      return;
    }
    if (url.pathname === '/') {
      send(200, html(`<div class="user-nav" data-uid="${escapeHtml(uid)}">求职者账号</div><a href="/web/geek/job?query=全栈&city=广州">搜索</a>`));
      return;
    }
    if (url.pathname === '/web/geek/jobs' || url.pathname === '/web/geek/job') {
      if (state.slowEntry) {
        // Headers and part of the document are committed, but the response never ends: the browser sets the
        // URL while `domcontentloaded` never fires, which is exactly the initial-navigation failure under test.
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.write('<!doctype html><html><head><meta charset="utf-8"><title>合成 BOSS 站点</title></head><body><div class="user-nav" data-uid="slow-entry">求职者账号</div>');
        return;
      }
      if (state.failSearch) {
        send(500, html(`${siteHeader(uid)}<div class="error-page">搜索服务暂时不可用</div>`));
        return;
      }
      const city = url.searchParams.get('city') ?? '广州';
      const position = url.searchParams.get('query') ?? '全栈';
      const salary = url.searchParams.get('salary') ?? '';
      state.requestedFilters.push({ city, position, salary });
      const band = salary.match(/(\d+)-(\d+)K/);
      const lower = band?.[1] ? Number(band[1]) * 1000 : 0;
      const upper = band?.[2] ? Number(band[2]) * 1000 : Number.MAX_SAFE_INTEGER;
      const postings = state.ignoreFilters ? fixturePostings : fixturePostings.filter(posting =>
        posting.city === city && posting.role === position
        && posting.salaryUpperK * 1000 >= lower && posting.salaryLowerK * 1000 <= upper);
      const cards = postings.map(posting => `<li class="job-card-wrapper">
        <a class="job-card-left" href="/job_detail/${posting.id}.html">
          <span class="job-name">${escapeHtml(posting.title)}</span>
          <span class="company-name">${escapeHtml(posting.company)}</span>
          <span class="job-area">${escapeHtml(posting.location)}</span>
          <span class="salary">${escapeHtml(posting.salary)}</span>
        </a></li>`).join('');
      send(200, html(`<div class="user-nav" data-uid="${escapeHtml(uid)}">求职者账号</div><form id="search-form" method="GET" action="/web/geek/job">
        <select id="city-filter" class="city-filter" name="city" onchange="this.form.submit()">
          <option value="广州"${selectedAttribute(city, '广州')}>广州</option><option value="深圳"${selectedAttribute(city, '深圳')}>深圳</option>
        </select>
        <select id="position-filter" class="position-filter" name="query" onchange="this.form.submit()">
          <option value="全栈"${selectedAttribute(position, '全栈')}>全栈</option><option value="Agent 开发"${selectedAttribute(position, 'Agent 开发')}>Agent 开发</option>
        </select>
        <select id="salary-filter" class="salary-filter" name="salary" onchange="this.form.submit()">
          <option value="">不限</option>
          <option value="10-20K"${selectedAttribute(salary, '10-20K')}>10-20K</option>
          <option value="20-30K"${selectedAttribute(salary, '20-30K')}>20-30K</option>
          <option value="30-50K"${selectedAttribute(salary, '30-50K')}>30-50K</option>
        </select>
        <button type="submit">搜索</button>
      </form><ul class="job-list-box">${cards}</ul>`));
      return;
    }
    const postingMatch = url.pathname.match(/^\/job_detail\/([^/]+)\.html$/);
    if (postingMatch?.[1]) {
      const posting = fixturePostings.find(item => item.id === decodeURIComponent(postingMatch[1] ?? ''));
      if (!posting || posting.failDetail) {
        send(500, html(`${siteHeader(uid)}<div class="error-page">岗位详情加载失败</div>`));
        return;
      }
      if (state.detailRedirectToSecurity) {
        // The JD block never appears: the page reaches the passport security path on its own while the
        // detail read is still pending.
        send(200, html(`${siteHeader(uid)}<div class="job-banner"><span class="name">${escapeHtml(posting.title)}</span></div><script>setTimeout(function(){location.href='/web/passport/zp/security';},300);</script>`));
        return;
      }
      send(200, html(`<div class="user-nav" data-uid="${escapeHtml(uid)}">求职者账号</div><div class="job-banner"><span class="name">${escapeHtml(posting.title)}</span><span class="text-city">${escapeHtml(posting.location)}</span><span class="salary">${escapeHtml(posting.salary)}</span></div>
        <div class="company-info"><span class="name">${escapeHtml(posting.company)}</span><p class="company-profile">${escapeHtml(posting.companyProfile)}</p></div>
        <div class="job-sec-text">${escapeHtml(posting.jd)}</div>
        <a class="btn-startchat"${state.contactDisabledFor === posting.id ? ' aria-disabled="true"' : ''} href="/chat/${posting.id}">立即沟通</a>
        ${state.messages.some(message => message.postingId === posting.id) || state.attachments.some(item => item.postingId === posting.id) ? `<a class="chat-entry" href="/chat/${posting.id}">继续沟通</a>` : ''}`));
      return;
    }
    const chatMatch = url.pathname.match(/^\/chat\/([^/]+)$/);
    if (chatMatch?.[1]) {
      const posting = fixturePostings.find(item => item.id === decodeURIComponent(chatMatch[1] ?? ''));
      if (!posting) { send(404, html('not found')); return; }
      const messages = state.messages.filter(message => message.postingId === posting.id);
      const attachments = state.attachments.filter(item => item.postingId === posting.id);
      const messageHtml = [
        ...messages.map(message => `<div class="message">${escapeHtml(message.text)}</div>`),
        ...attachments.map(item => `<div class="message-card" data-resume-sha256="${escapeHtml(item.sha256)}" data-resume-size="${item.byteSize}"><span class="file-name">${escapeHtml(item.name)}</span><span class="file-size">${item.byteSize} 字节</span></div>`),
      ].join('');
      state.chatOpens.push(posting.id);
      if (state.chatRedirectToLimit) {
        // No attachment input is offered: while the actor waits for it, the page reaches the limit notice.
        send(200, html(`${siteHeader(uid)}<div class="chat-message-list" data-posting-id="${escapeHtml(posting.id)}">${messageHtml}</div><script>setTimeout(function(){location.href='/limit-notice';},300);</script>`));
        return;
      }
      if (posting.consentRequired) {
        send(200, html(`<div class="user-nav" data-uid="${escapeHtml(uid)}">求职者账号</div><div class="consent-notice">对方需要确认后才能继续沟通</div><div class="chat-message-list">${messageHtml}</div>`));
        return;
      }
      // An optional delay keeps the input absent for a bounded window, so a test can withdraw the
      // work authority after the contact click and prove the greeting is never sent.
      const forms = state.chatInputDelayMs > 0
        ? `<div id="chat-slot"></div><script>setTimeout(function(){document.getElementById('chat-slot').innerHTML=${JSON.stringify(chatForms(posting.id))};},${state.chatInputDelayMs});</script>`
        : `${chatForms(posting.id, state.chatInputSealedMs)}${state.chatInputSealedMs > 0 ? `<script>setTimeout(function(){document.getElementById('chat-input').removeAttribute('disabled');},${state.chatInputSealedMs});</script>` : ''}`;
      send(200, html(`<div class="user-nav" data-uid="${escapeHtml(uid)}">求职者账号</div><div class="chat-message-list" data-posting-id="${escapeHtml(posting.id)}">${messageHtml}</div>${forms}`));
      return;
    }
    const sendMatch = url.pathname.match(/^\/chat\/([^/]+)\/send$/);
    if (sendMatch?.[1] && request.method === 'POST') {
      const posting = fixturePostings.find(item => item.id === decodeURIComponent(sendMatch[1] ?? ''));
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const text = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('text') ?? '';
      if (posting) state.messages.push({ postingId: posting.id, text });
      if (posting?.unknownAfterSend) { send(500, html(`${siteHeader(uid)}<div class="error-page">网络异常</div>`)); return; }
      send(302, '', { location: `/chat/${posting?.id ?? ''}` });
      return;
    }
    const resumeMatch = url.pathname.match(/^\/chat\/([^/]+)\/resume$/);
    if (resumeMatch?.[1] && request.method === 'POST') {
      const posting = fixturePostings.find(item => item.id === decodeURIComponent(resumeMatch[1] ?? ''));
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const file = multipartFile(Buffer.concat(chunks), String(request.headers['content-type'] ?? ''));
      if (!posting || !file) { send(400, html('<div class="error-page">附件无效</div>')); return; }
      const storedSha = posting.corruptAttachment
        ? createHash('sha256').update(Buffer.concat([file.bytes, Buffer.from('x')])).digest('hex')
        : createHash('sha256').update(file.bytes).digest('hex');
      state.attachments.push({ postingId: posting.id, name: file.name, sha256: storedSha, byteSize: posting.wrongAttachmentSize ? file.bytes.length + 1 : file.bytes.length });
      send(302, '', { location: `/chat/${posting.id}` });
      return;
    }
    send(404, html('<div class="error-page">not found</div>'));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    state,
    profile: fixtureProfile(origin),
    counts: () => ({ conversations: state.messages.length, attachments: state.attachments.length }),
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close(error => (error ? reject(error) : resolve()));
    }),
  };
}
