// Maintained local command: open the production Patchright BOSS session once, keep the single controller
// while a human logs in or clears a verification, observe it without navigating, and close on a signal.
// It never sends, never navigates after the first open, never prints URLs with query strings, cookies or
// profile contents, and never writes business tables: the Worker remains the only writer of app rows.
//
//   pnpm boss:login                          # newest owner profile recorded in app.career_browser_sessions
//   pnpm boss:login -- --owner <id>           # explicit owner (the interview_identity cookie value)
import { openDatabase } from '../packages/database/src/client';
import { careerDataDir, BrowserProfileStore } from '../packages/career/src/storage';
import { readWorkerConfig } from '../packages/config/src/index';
import { BossBrowser, BrowserUnavailable, liveBossProfile, redactError, redactUrl, type ObservedSession } from '../apps/worker/src/boss-browser';

const config = readWorkerConfig();
if(config.BOSS_AUTOMATION==='paused')throw new Error('BOSS_AUTOMATION_PAUSED: human recovery required; no browser was opened.');
const engine = config.BOSS_BROWSER_ENGINE;
const profileStore = new BrowserProfileStore(careerDataDir(config));
const profile = liveBossProfile(config.BOSS_SITE_ORIGIN);
const database = openDatabase(config.DATABASE_URL);

function ownerArgument() {
  const index = process.argv.indexOf('--owner');
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** The profile path is derived from an owner id, so an existing session row names the profile to reuse. */
async function newestOwner() {
  const result = await database.pool.query("SELECT owner FROM app_career_browser_sessions WHERE site='boss' ORDER BY observed_at DESC LIMIT 1");
  const owner = result.rows[0]?.owner;
  return typeof owner === 'string' ? owner : null;
}

/** Redacted session line: state, driver, window and the fixed limitation text only. */
function describe(observed: ObservedSession) {
  return {
    state: observed.state,
    engine: observed.engine,
    humanWindow: observed.humanWindow,
    accountObserved: observed.accountMarker !== null,
    detail: observed.detail,
    limitation: observed.limitation,
  };
}

const owner = ownerArgument() ?? await newestOwner();
if (!owner) {
  process.stderr.write('boss_login_no_owner: open the app once so a BOSS session row exists, or pass --owner <id>\n');
  await database.pool.end();
  process.exit(1);
}

let browser: BossBrowser | null = null;
let closing = false;
let timer: NodeJS.Timeout | undefined;
async function shutdown(signal: string, code = 0) {
  if (closing) return;
  closing = true;
  if (timer) clearInterval(timer);
  process.stdout.write(`boss_login_closing ${JSON.stringify({ signal })}\n`);
  // Closing releases the persistent context and the profile lock, so no second controller stays behind.
  await browser?.close().catch(() => {});
  await database.pool.end().catch(() => {});
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void shutdown(signal));

let startupStage: 'startup' | 'opened' = 'startup';
try {
  // The private per-owner profile is prepared before the browser so a storage failure is a real startup
  // failure, not a page that merely cannot be classified.
  browser = new BossBrowser({
    engine,
    origin: config.BOSS_SITE_ORIGIN,
    profile,
    profileDirectory: await profileStore.prepare(owner, engine),
    moliExecutable: config.BOSS_MOLI_EXECUTABLE,
    headedFallback: config.BOSS_HEADED_FALLBACK === 'on',
  });
  const opened = await browser.openSession();
  // The open decision uses the lifecycle result recorded by the open itself, never the page URL: a
  // navigation can commit and still fail its DOMContentLoaded wait, and that is a startup failure.
  // No recorded lifecycle means the open never completed, so it can never be reported as opened.
  const lifecycle = browser.openLifecycle ?? { status: 'failed' as const, initialNavigation: 'not_required' as const, detail: null };
  if (lifecycle.status === 'failed') {
    process.stderr.write(`boss_login_failed ${JSON.stringify({ ...describe(opened), code: 'BROWSER_UNAVAILABLE', stage: 'startup', initialNavigation: lifecycle.initialNavigation })}\n`);
    await shutdown('startup_failure', 1);
  }
  startupStage = 'opened';
  process.stdout.write(`boss_login_opened ${JSON.stringify({ ...describe(opened), initialNavigation: lifecycle.initialNavigation, loadedPage: browser.managedPageLoaded, entry: redactUrl(profile.entryUrl), mutationsAllowed: browser.mutationsAllowed })}\n`);
  if (opened.state === 'unavailable') {
    process.stderr.write(`boss_login_unclassified ${JSON.stringify({ ...describe(opened), note: '页面已打开但选择器未能分类，保留窗口供人工处理；这不表示已登录或可操作。' })}\n`);
  }
  if (browser.mutationsAllowed) {
    process.stderr.write('boss_login_unverified_profile_changed: the live site profile must stay unverified\n');
    await shutdown('profile_mismatch', 1);
  }

  // Login and any verification happen in the held window. Repeated observations are read-only and never
  // lift a latched pause: only the app's explicit session check may do that. A state change prints once.
  let previous = opened.state;
  let observing = false;
  const controller = browser;
  timer = setInterval(() => {
    if (observing) return;
    observing = true;
    void controller.inspectSession().then(observed => {
      if (observed.state !== previous) {
        previous = observed.state;
        process.stdout.write(`boss_login_state ${JSON.stringify(describe(observed))}\n`);
      }
    }).catch(() => {}).finally(() => { observing = false; });
  }, 10000);
} catch (error) {
  // Profile preparation or the open itself threw: a lifecycle failure, so nothing is claimed as opened.
  process.stderr.write(`boss_login_failed ${JSON.stringify({ ...describe({
    state: 'unavailable', detail: redactError(error), accountMarker: null, engine, humanWindow: 'none', limitation: null,
  }), code: error instanceof BrowserUnavailable ? error.code : 'UNEXPECTED', stage: startupStage, initialNavigation: browser?.openLifecycle?.initialNavigation ?? 'not_required' })}\n`);
  await shutdown('startup_failure', 1);
}
