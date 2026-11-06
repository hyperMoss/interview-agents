import { migrateSqlite } from '../packages/database/src/migrate';
await migrateSqlite((process.env.SQLITE_TEST_APP_URL ?? "file:/tmp/interview-tests-app.sqlite"),'app');
await migrateSqlite((process.env.SQLITE_TEST_AGENT_URL ?? "file:/tmp/interview-tests-agent.sqlite"),'agent_runtime');
