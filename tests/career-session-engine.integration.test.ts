import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CareerService } from '../apps/api/src/career';
import { deliveryAuthorized } from '../packages/career/src/domain';
import { apiConfig } from './fixtures';

const TEST_DATABASE = (process.env.SQLITE_TEST_APP_URL ?? "file:/tmp/interview-tests-app.sqlite");
const suite = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

// Persisted engine enum and session generation at the real SQLite boundary. `006-career-browser-engine.sql`
// widens the check constraint, so a `patchright` write only succeeds on a migrated database; the running
// browser behaviour is covered by the Patchright browser suite.
suite('persisted browser engine and approval generation', () => {
  let api: CareerService;
  let dataDir: string;
  const owner = crypto.randomUUID();

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'career-session-engine-'));
    api = new CareerService({ ...apiConfig(), DATABASE_URL: TEST_DATABASE, CAREER_LOCAL_DATA_DIR: dataDir });
  }, 60000);

  afterAll(async () => {
    if (api) {
      await api.store.pool.query("DELETE FROM app_career_browser_sessions WHERE owner=$1", [owner]);
      await api.close();
    }
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  const pool = () => api.store.pool;
  const store = () => api.store;

  it('persists patchright as the session driver and rejects an unknown driver', async () => {
    const written = await store().writeSession(owner, { state: 'ready', engine: 'patchright', accountMarker: '0123456789abcdef', reason: null });
    expect(written.engine).toBe('patchright');
    const stored = await pool().query("SELECT engine FROM app_career_browser_sessions WHERE owner=$1", [owner]);
    expect(stored.rows[0]?.engine).toBe('patchright');
    await expect(pool().query("UPDATE app_career_browser_sessions SET engine='gecko' WHERE owner=$1", [owner]))
      .rejects.toThrow(/CHECK constraint failed/);
  });

  it('starts a new generation when the driver changes so an older approval cannot act', async () => {
    const initial = await store().writeSession(owner, { state: 'ready', engine: 'moli', accountMarker: '0123456789abcdef', reason: null });
    expect(initial.profile_generation).toBe(0);
    expect(deliveryAuthorized({ sessionGeneration: initial.profile_generation, accountMarker: initial.account_marker }, { profileGeneration: initial.profile_generation, accountMarker: initial.account_marker })).toBe(true);

    const switched = await store().switchSessionEngine(owner, 'patchright');
    expect(switched.engine).toBe('patchright');
    expect(switched.profile_generation).toBe(1);
    expect(switched.state).toBe('absent');
    expect(switched.account_marker).toBeNull();
    expect(switched.reason).toBe('engine_changed');
    // The approval frozen under the Moli generation can no longer authorize a delivery.
    expect(deliveryAuthorized({ sessionGeneration: 0, accountMarker: '0123456789abcdef' }, { profileGeneration: switched.profile_generation, accountMarker: switched.account_marker })).toBe(false);

    const again = await store().switchSessionEngine(owner, 'playwright');
    expect(again.profile_generation).toBe(2);
    expect(again.engine).toBe('playwright');
  });
});
