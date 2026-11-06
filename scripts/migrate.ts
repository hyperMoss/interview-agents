import { readApiConfig,readAgentConfig } from '../packages/config/src/index';
import { migrateSqlite } from '../packages/database/src/migrate';
const api=readApiConfig(),agent=readAgentConfig();
if(api.DATABASE_URL===agent.AGENT_DATABASE_URL)throw new Error('SQLITE_DATABASES_MUST_BE_SEPARATE');
await migrateSqlite(api.DATABASE_URL,'app');
await migrateSqlite(agent.AGENT_DATABASE_URL,'agent_runtime');
process.stdout.write('SQLite business and runtime migrations complete.\n');
