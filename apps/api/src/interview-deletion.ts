import type { Pool } from "../../../packages/database/src/sqlite";
import { z } from 'zod';

/** The single interview deletion boundary. Deleting an interview in the same transaction queues
 *  every runtime job id in app.deletions, so the worker purges the Agent receipts instead of
 *  orphaning them. Career cleanup deletes resumes, tasks and derived interviews through here. */
export async function deleteInterviewSessions(pool: Pool, owner: string, sessionIds: string[]) {
  if (!sessionIds.length) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query("SELECT id FROM app_interviews WHERE owner=$1 AND id IN (SELECT value FROM json_each($2))", [owner, sessionIds]);
    const ids = locked.rows.map(row => z.object({ id: z.uuid() }).parse(row).id);
    if (!ids.length) {
      await client.query('COMMIT');
      return 0;
    }
    await client.query("INSERT INTO app_deletions(job_id) SELECT id FROM app_jobs WHERE session_id IN (SELECT value FROM json_each($1)) ON CONFLICT DO NOTHING", [ids]);
    await client.query("DELETE FROM app_interviews WHERE owner=$1 AND id IN (SELECT value FROM json_each($2))", [owner, ids]);
    await client.query('COMMIT');
    return ids.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
