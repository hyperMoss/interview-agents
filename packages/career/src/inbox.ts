import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from '../../database/src/sqlite';
import { bossConversationSchema, bossConversationViewSchema, bossConversationSummarySchema, bossInboxSnapshotSchema, type BossConversation } from '../../contracts/src/boss-inbox';
const rowSchema = z.object({ id: z.uuid(), revision: z.number(), snapshot_hash: z.string(), snapshot_json: z.string(), manual_jd:z.string().nullable() });
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export class BossInboxStore {
  constructor(readonly pool: Pool) {}
  private view(raw: unknown) {
    const row = rowSchema.parse(raw);
    return bossConversationViewSchema.parse({ id: row.id, revision: row.revision, snapshotHash: row.snapshot_hash, manualJd:row.manual_jd, snapshot: JSON.parse(row.snapshot_json) });
  }
  async list(owner: string) {
    const result = await this.pool.query("SELECT id,revision,snapshot_json->>'company' AS company,snapshot_json->>'title' AS title,snapshot_json->>'observedAt' AS observedAt FROM app_boss_conversations WHERE owner=$1 ORDER BY updated_at DESC,id DESC LIMIT 100", [owner]);
    return result.rows.map(row => bossConversationSummarySchema.parse(row));
  }
  async get(owner: string, id: string) {
    const result = await this.pool.query('SELECT * FROM app_boss_conversations WHERE owner=$1 AND id=$2', [owner,id]);
    return result.rows[0] ? this.view(result.rows[0]) : null;
  }
  async save(owner: string, snapshot: BossConversation, work?: { id: string; leaseGeneration: number; sessionGeneration: number }) {
    const parsed = bossConversationSchema.parse(snapshot);
    const source = new URL(parsed.sourceUrl);
    if (source.username || source.password || source.hash) throw new Error('INVALID_CONVERSATION_SOURCE');
    const key = hash(`${parsed.accountKey}\0${parsed.conversationKey}\0${parsed.postingId}`);
    const { observedAt: _observedAt, ...content } = parsed;
    const snapshotHash = hash(JSON.stringify(content));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (work) {
        const active = await client.query("SELECT 1 FROM app_career_work w JOIN app_career_browser_sessions s ON s.owner=w.owner WHERE w.id=$1 AND w.owner=$2 AND w.status='processing' AND w.lease_generation=$3 AND w.lease_until>strftime('%Y-%m-%dT%H:%M:%f000Z','now') AND s.profile_generation=$4 AND s.state='ready'",[work.id,owner,work.leaseGeneration,work.sessionGeneration]);
        if (!active.rows.length) throw new Error('INBOX_SYNC_AUTHORITY_CHANGED');
      }
      const existing = await client.query('SELECT * FROM app_boss_conversations WHERE owner=$1 AND source_key=$2',[owner,key]);
      const prior = existing.rows[0] ? this.view(existing.rows[0]) : null;
      const id = prior?.id ?? crypto.randomUUID();
      if (!prior) await client.query('INSERT INTO app_boss_conversations(id,owner,source_key,snapshot_hash,snapshot_json) VALUES($1,$2,$3,$4,$5)',[id,owner,key,snapshotHash,JSON.stringify(parsed)]);
      else if (prior.snapshotHash !== snapshotHash) await client.query("UPDATE app_boss_conversations SET revision=revision+1,snapshot_hash=$1,snapshot_json=$2,updated_at=strftime('%Y-%m-%dT%H:%M:%f000Z','now') WHERE id=$3 AND owner=$4",[snapshotHash,JSON.stringify(parsed),id,owner]);
      await client.query('INSERT INTO app_boss_conversation_snapshots(conversation_id,snapshot_hash,snapshot_json) VALUES($1,$2,$3) ON CONFLICT(conversation_id,snapshot_hash) DO NOTHING',[id,snapshotHash,JSON.stringify(parsed)]);
      await client.query('COMMIT');
      return this.get(owner,id);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async snapshots(owner: string, id: string) {
    const result = await this.pool.query("SELECT h.snapshot_hash AS hash,h.snapshot_json->>'observedAt' AS observedAt,json_array_length(h.snapshot_json,'$.messages') AS messageCount FROM app_boss_conversation_snapshots h JOIN app_boss_conversations c ON c.id=h.conversation_id WHERE c.owner=$1 AND c.id=$2 ORDER BY h.created_at DESC LIMIT 100",[owner,id]);
    return result.rows.map(raw=>bossInboxSnapshotSchema.parse(raw));
  }
  async snapshot(owner:string,id:string,hash:string){
    const result=await this.pool.query('SELECT h.snapshot_json FROM app_boss_conversation_snapshots h JOIN app_boss_conversations c ON c.id=h.conversation_id WHERE c.owner=$1 AND c.id=$2 AND h.snapshot_hash=$3',[owner,id,hash]);
    if(!result.rows[0])return null;
    return bossConversationSchema.parse(JSON.parse(z.object({snapshot_json:z.string()}).parse(result.rows[0]).snapshot_json));
  }
  async remove(owner: string, id: string, revision: number) {
    const result=await this.pool.query('DELETE FROM app_boss_conversations WHERE owner=$1 AND id=$2 AND revision=$3 RETURNING id',[owner,id,revision]);
    return Boolean(result.rowCount);
  }
  async updateJd(owner:string,id:string,revision:number,jd:string) {
    const result=await this.pool.query('UPDATE app_boss_conversations SET manual_jd=$1,revision=revision+1 WHERE owner=$2 AND id=$3 AND revision=$4 RETURNING id',[jd,owner,id,revision]);
    return result.rowCount ? this.get(owner,id) : null;
  }
}
