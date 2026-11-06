import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { sqliteClient } from './sqlite';
export async function migrateSqlite(url:string, role:'app'|'agent_runtime') {
  const client=sqliteClient(url);
  try {
    client.exec('PRAGMA journal_mode=WAL');
    client.exec('PRAGMA foreign_keys=ON');
    const text=await readFile(new URL('../../../infra/sqlite/001-init.sql',import.meta.url),'utf8');
    const statements=text.replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean);
    const selected=statements.filter(s=>new RegExp(`\\b${role}_\\w+`).test(s));
    // Rebuild only the old NOT NULL task table; preserve IDs, children and indexes atomically.
    // foreign_keys must be disabled before BEGIN so DROP does not cascade child rows.
    const taskDefinition = selected.find(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS app_career_tasks ('));
    if (role === 'app' && taskDefinition) {
      client.exec('PRAGMA foreign_keys=OFF');
      client.exec('BEGIN IMMEDIATE');
      try {
        const columns = z.array(z.object({ name: z.string(), notnull: z.number() })).parse(client.prepare('PRAGMA table_info(app_career_tasks)').all());
        if (columns.some(column => column.name === 'resume_version_id' && column.notnull === 1)) {
          client.exec(taskDefinition.replace('IF NOT EXISTS app_career_tasks', 'app_career_tasks_preview_upgrade'));
          const names = columns.map(column => `"${column.name}"`).join(',');
          client.exec(`INSERT INTO app_career_tasks_preview_upgrade (${names}) SELECT ${names} FROM app_career_tasks`);
          client.exec('DROP TABLE app_career_tasks');
          client.exec('ALTER TABLE app_career_tasks_preview_upgrade RENAME TO app_career_tasks');
          client.exec('CREATE INDEX career_tasks_owner ON app_career_tasks(owner, created_at DESC, id DESC)');
          if (client.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLITE_PREVIEW_MIGRATION_FOREIGN_KEY_FAILURE');
        }
        client.exec('COMMIT');
      } catch (error) { client.exec('ROLLBACK'); throw error; }
      finally { client.exec('PRAGMA foreign_keys=ON'); }
    }
    client.exec('BEGIN IMMEDIATE');
    try{for(const sql of selected)client.exec(sql);client.exec('COMMIT');}catch(error){client.exec('ROLLBACK');throw error;}
  }finally {client.close();}
}
