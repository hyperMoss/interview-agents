// Test-only synthetic BOSS site for local acceptance runs (never a real-site proxy).
// It serves the same fixture used by the browser/integration suites so the Worker can be pointed at
// BOSS_SITE_ORIGIN=<printed origin>. Synthetic identities only; no real candidate data.
import { startBossFixture } from '../tests/boss-site-fixture';

const fixture = await startBossFixture();
// A synthetic acceptance run starts already logged in; human login/verification behaviour is exercised
// by the dedicated browser suite instead.
fixture.state.loggedIn = process.env.BOSS_FIXTURE_LOGGED_IN !== 'false';
process.stdout.write(`${JSON.stringify({ origin: fixture.origin, loggedIn: fixture.state.loggedIn })}\n`);
const shutdown = async () => {
  await fixture.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
