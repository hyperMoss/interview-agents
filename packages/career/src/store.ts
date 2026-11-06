import type { Pool, PoolClient } from "../../database/src/sqlite";
import { z } from 'zod';
import { careerContactRetrySchema, careerContactStateSchema, careerEffectEvidenceSchema, careerContactApprovalSchema, careerManualModelSourceSchema, careerDeliveryAttributionSchema, careerBatchStateSchema, careerConversationStateSchema, careerAttachmentStateSchema, careerDecisionSchema, careerGreetingSchema, careerMatchSchema, careerPauseReasonSchema, careerPolicySchema, careerTaskPhaseSchema, bossSessionStateSchema, bossEngineSchema, observedPostingSchema, type BossAutomationMode } from '../../contracts/src/career';
import { personalizedPreparationSchema } from '../../contracts/src/preparation';
import { approvalDigest, digest, matchReceiptWorkId, textSha256 } from './domain';

// Single business writer for career `app` tables. API and Worker both use this module;
// the Agent never writes these tables and only owns agent_runtime.

export const resumeRowSchema = z.object({
  id: z.uuid(), owner: z.string(), label: z.string(), text: z.string(), text_sha256: z.string(),
  attachment_sha256: z.string(), warnings: z.array(z.string()), revision: z.number(), created_at: z.date(),
  file_id: z.uuid(), storage_key: z.string(), original_name: z.string(), content_type: z.string(), byte_size: z.number(),
});
export type ResumeRow = z.infer<typeof resumeRowSchema>;

const taskRowBaseSchema = z.object({
  id: z.uuid(), owner: z.string(), revision: z.number(), resume_version_id: z.uuid(), resume_text_sha256: z.string(),
  attachment_sha256: z.string(), policy: careerPolicySchema, model_source: z.object({ connectionId: z.uuid(), label: z.string() }),
  phase: careerTaskPhaseSchema, status: z.enum(['active', 'paused', 'failed', 'cancelled']), pause_reason: careerPauseReasonSchema.nullable(),
  pause_detail: z.string().nullable(), error: z.string().nullable(), read_count: z.number(), page_failure_count: z.number(),
  created_at: z.date(), updated_at: z.date(),
});
const taskRowSchema = z.union([
  taskRowBaseSchema,
  taskRowBaseSchema.extend({ model_source: careerManualModelSourceSchema }),
  taskRowBaseSchema.extend({ resume_version_id: z.null(), resume_text_sha256: z.null(), attachment_sha256: z.null(), model_source: z.null() }),
]);
export type TaskRow = z.infer<typeof taskRowSchema>;

const taskPostingRowSchema = z.object({
  id: z.uuid(), owner: z.string(), task_id: z.uuid(), posting_id: z.uuid(), observed: observedPostingSchema,
  snapshot_hash: z.string(), disposition: z.enum(['eligible', 'excluded', 'needs_review']), decision: careerDecisionSchema,
  match: careerMatchSchema.nullable(), greeting: careerGreetingSchema.nullable(), greeting_revision: z.number(),
  owner_review: z.object({ decision: z.enum(['confirmed_direct', 'excluded', 'unresolved']), note: z.string(), source: z.string() }).nullable(),
  revision: z.number(), created_at: z.date(), updated_at: z.date(),
  salary_raw: z.string().optional(), title: z.string().optional(), company: z.string().optional(), location: z.string().optional(),
});
export type TaskPostingRow = z.infer<typeof taskPostingRowSchema>;

const batchRowSchema = z.object({
  id: z.uuid(), owner: z.string(), task_id: z.uuid(), request_id: z.uuid(), digest: z.string(), task_revision: z.number(),
  resume_version_id: z.uuid(), resume_text_sha256: z.string(), attachment_sha256: z.string(),
  model: careerDeliveryAttributionSchema,
  state: careerBatchStateSchema, pause_reason: careerPauseReasonSchema.nullable(), approved_at: z.date(), updated_at: z.date(),
  resume_label: z.string().optional(), original_name: z.string().optional(), session_generation: z.number().int().nonnegative(), account_marker: z.string().nullable(),
});
export type BatchRow = z.infer<typeof batchRowSchema>;

const batchItemRowSchema = z.object({
  id: z.uuid(), owner: z.string(), batch_id: z.uuid(), task_posting_id: z.uuid(), posting_id: z.uuid(), snapshot_hash: z.string(),
  greeting: z.string(), greeting_sha256: z.string(), greeting_revision: z.number(),
  position: z.number(), conversation_state: careerConversationStateSchema, attachment_state: careerAttachmentStateSchema,
  conversation_reason: z.string().nullable(), attachment_reason: z.string().nullable(), revision: z.number(),
  company: z.string().optional(), title: z.string().optional(), location: z.string().optional(), salary_raw: z.string().optional(), url: z.string().optional(),
});
export type BatchItemRow = z.infer<typeof batchItemRowSchema>;

const sessionRowSchema = z.object({
  owner: z.string(), site: z.literal('boss'), state: bossSessionStateSchema, engine: bossEngineSchema,
  profile_generation: z.number(), account_marker: z.string().nullable(), reason: z.string().nullable(),
  active_task_id: z.uuid().nullable(), browser_pid: z.number().nullable(), browser_started_at: z.date().nullable(),
  human_window: z.enum(['none', 'open']), limitation: z.string().nullable(), observed_at: z.date(),
});
export type SessionRow = z.infer<typeof sessionRowSchema>;

const preparationRowSchema = z.object({
  id: z.uuid(), owner: z.string(), task_id: z.uuid(), task_posting_id: z.uuid(), resume_version_id: z.uuid(),
  resume_text_sha256: z.string(), jd_snapshot_hash: z.string(), generation: z.number(),
  status: z.enum(['queued', 'generating', 'ready', 'failed', 'cancelled']), original: personalizedPreparationSchema.nullable(),
  edited: personalizedPreparationSchema.nullable(), model: z.object({ connectionId: z.uuid(), label: z.string() }),
  failure: z.string().nullable(), revision: z.number(), created_at: z.date(), updated_at: z.date(),
});
export type PreparationRow = z.infer<typeof preparationRowSchema>;

const workRowSchema = z.object({
  id: z.uuid(), owner: z.string(), kind: z.enum(['scan', 'delivery', 'preparation', 'purge', 'session']),
  task_id: z.uuid().nullable(), batch_id: z.uuid().nullable(), batch_item_id: z.uuid().nullable(), preparation_id: z.uuid().nullable(),
  request_hash: z.string(), payload: z.record(z.string(), z.unknown()), generation: z.number(), status: z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']),
  attempts: z.number(), lease_until: z.date().nullable(), lease_generation: z.number(), failure: z.string().nullable(),
});
export type WorkRow = z.infer<typeof workRowSchema>;

/** One attempted Agent match, written into the scan work payload before the provider call so the
 *  deleting transaction can purge its receipt even when no posting snapshot ever committed. */
const matchAttemptSchema = z.object({ receiptWorkId: z.uuid(), sitePostingId: z.string().min(1).max(200) });
const matchAttemptsSchema = z.array(matchAttemptSchema);
export type MatchAttempt = z.infer<typeof matchAttemptSchema>;

/** Pre-dispatch intent for one external effect of one batch item. */
export type EffectIntent = {
  owner: string; batchId: string; itemId: string; phase: 'conversation' | 'attachment';
  expectedRevision: number; from: string; to: string; batchGeneration: number;
};

export class CareerConflict extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}
export class CareerNotFound extends Error {
  constructor(message: string) {
    super(message);
  }
}

function count(result: { rowCount: number | null }) {
  return result.rowCount ?? 0;
}

const contactRowSchema=z.object({
 id:z.uuid(),owner:z.string(),approval_id:z.uuid(),task_id:z.uuid(),task_posting_id:z.uuid(),posting_id:z.uuid(),
 snapshot_hash:z.string(),posting_snapshot:observedPostingSchema,position:z.number(),session_generation:z.number(),account_marker:z.string().nullable(),
 state:careerContactStateSchema,reason:z.string().nullable(),evidence:z.array(careerEffectEvidenceSchema),created_at:z.date(),updated_at:z.date(),
});
export type ContactRow=z.infer<typeof contactRowSchema>;

export class CareerStore {
  constructor(readonly pool: Pool) {}

  private async tx<T>(action: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ---------- resume uploads and immutable versions ----------
  async createUpload(owner: string, input: { filename: string; text: string; warnings: string[]; storageKey: string; sha256: string; byteSize: number; contentType: string }) {
    const result = await this.pool.query(
      "INSERT INTO app_resume_uploads(id,owner,filename,extracted_text,warnings,storage_key,sha256,byte_size,content_type,status,expires_at)\n       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'staged',strftime('%Y-%m-%dT%H:%M:%f000Z','now','+24 hours'))\n       RETURNING id,filename,extracted_text,warnings,storage_key,sha256,byte_size,content_type,expires_at",
      [crypto.randomUUID(), owner, input.filename, input.text, JSON.stringify(input.warnings), input.storageKey, input.sha256, input.byteSize, input.contentType],
    );
    return z.object({ id: z.uuid(), filename: z.string(), extracted_text: z.string(), warnings: z.array(z.string()), storage_key: z.string(), sha256: z.string(), byte_size: z.number(), content_type: z.string(), expires_at: z.date() }).parse(result.rows[0]);
  }

  async stagingFor(owner: string, stagingId: string) {
    const result = await this.pool.query("SELECT * FROM app_resume_uploads WHERE id=$1 AND owner=$2 AND status='staged' AND expires_at>(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))", [stagingId, owner]);
    return result.rows[0] ? z.object({ id: z.uuid(), filename: z.string(), extracted_text: z.string(), warnings: z.array(z.string()), storage_key: z.string(), sha256: z.string(), byte_size: z.number(), content_type: z.string(), expires_at: z.date() }).parse(result.rows[0]) : null;
  }

  /** Claims staged originals that were never saved after 24 hours and queues their durable purge in
   *  one transaction, in chunks no larger than one purge payload. Nothing becomes expired without the
   *  cleanup that owns it, so a failed enqueue retries instead of losing the private bytes, and a
   *  bounded sweep that is not tied to another upload still drains more than 50 expired originals. */
  async expireStagedUploads(input: { owner?: string; limit?: number } = {}) {
    return this.tx(async client => {
      const claimed = await client.query(
        "SELECT id, owner, storage_key FROM app_resume_uploads\n          WHERE status='staged' AND expires_at<=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) AND ($2 IS NULL OR owner=$2)\n          ORDER BY expires_at, id LIMIT $1",
        [input.limit ?? 20, input.owner ?? null],
      );
      const rows = z.array(z.object({ id: z.uuid(), owner: z.string(), storage_key: z.string() })).parse(claimed.rows);
      if (!rows.length) return 0;
      await client.query("UPDATE app_resume_uploads SET status='expired' WHERE id IN (SELECT value FROM json_each($1))", [rows.map(row => row.id)]);
      const byOwner = new Map<string, typeof rows>();
      for (const row of rows) byOwner.set(row.owner, [...(byOwner.get(row.owner) ?? []), row]);
      for (const [owner, group] of byOwner) {
        for (let index = 0; index < group.length; index += 50) {
          const chunk = group.slice(index, index + 50);
          await this.enqueueWorkIn(client, {
            id: crypto.randomUUID(), owner, kind: 'purge', requestHash: `purge:staging:${chunk[0]!.id}`,
            payload: { storageKeys: chunk.map(row => row.storage_key), uploadIds: chunk.map(row => row.id) },
          });
        }
      }
      return rows.length;
    });
  }

  /** Only a confirmed cleanup drops the extracted personal text and filename that an expired staging
   *  row still held; the row itself stays as the record that this upload was never saved. */
  async clearExpiredUploads(ids: string[]) {
    if (!ids.length) return 0;
    const result = await this.pool.query(
      "UPDATE app_resume_uploads SET extracted_text='', warnings='[]', filename='' WHERE id IN (SELECT value FROM json_each($1)) AND status='expired'",
      [ids],
    );
    return count(result);
  }

  /** A private key that saved or staged personal data still references must never be deleted. */
  async storageKeyInUse(owner: string, storageKey: string) {
    const result = await this.pool.query(
      "SELECT 1 FROM app_resume_files WHERE owner=$1 AND storage_key=$2\n       UNION ALL SELECT 1 FROM app_resume_uploads WHERE owner=$1 AND storage_key=$2 AND status='staged' LIMIT 1",
      [owner, storageKey],
    );
    return Boolean(result.rows[0]);
  }

  async saveResumeVersion(owner: string, input: { requestId: string; requestHash: string; stagingId: string; label: string; text: string; attachmentSha256: string; byteSize: number; contentType: string; originalName: string; storageKey: string; warnings: string[]; textSha256: string }) {
    return this.tx(async client => {
      const existing = await client.query("SELECT * FROM app_career_commands WHERE owner=$1 AND request_id=$2", [owner, input.requestId]);
      if (existing.rows[0]) {
        const row = z.object({ kind: z.string(), request_hash: z.string(), result_id: z.uuid().nullable(), revision: z.number().nullable() }).parse(existing.rows[0]);
        if (row.kind !== 'save-resume-version' || row.request_hash !== input.requestHash) throw new CareerConflict('IDEMPOTENCY_CONFLICT', 'CONFLICT');
        const saved = await client.query(
          "SELECT v.*, f.storage_key, f.original_name, f.content_type, f.byte_size FROM app_resume_versions v JOIN app_resume_files f ON f.id=v.file_id WHERE v.id=$1 AND v.owner=$2",
          [row.result_id, owner],
        );
        if (!saved.rows[0]) throw new CareerConflict('IDEMPOTENCY_CONFLICT', 'CONFLICT');
        return this.resumeRow(saved.rows[0]);
      }
      const fileId = crypto.randomUUID();
      await client.query(
        "INSERT INTO app_resume_files(id,owner,storage_key,original_name,content_type,byte_size,sha256) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [fileId, owner, input.storageKey, input.originalName, input.contentType, input.byteSize, input.attachmentSha256],
      );
      const inserted = await client.query(
        "INSERT INTO app_resume_versions(id,owner,file_id,label,text,text_sha256,attachment_sha256,warnings) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
        [input.requestId, owner, fileId, input.label, input.text, input.textSha256, input.attachmentSha256, JSON.stringify(input.warnings)],
      );
      const staged = await client.query("UPDATE app_resume_uploads SET status='saved' WHERE id=$1 AND owner=$2 AND status='staged' RETURNING id", [input.stagingId, owner]);
      if (!staged.rows[0]) throw new CareerConflict('STAGING_EXPIRED', 'STAGING_EXPIRED');
      await client.query("INSERT INTO app_career_commands(owner,request_id,kind,request_hash,result_id,revision) VALUES($1,$2,$3,$4,$5,$6)", [owner, input.requestId, 'save-resume-version', input.requestHash, input.requestId, 0]);
      const saved = await client.query(
        "SELECT v.*, f.storage_key, f.original_name, f.content_type, f.byte_size FROM app_resume_versions v JOIN app_resume_files f ON f.id=v.file_id WHERE v.id=$1 AND v.owner=$2",
        [inserted.rows[0]?.id, owner],
      );
      return this.resumeRow(saved.rows[0]);
    });
  }

  private resumeRow(raw: unknown) {
    return resumeRowSchema.parse(raw);
  }

  async listResumeVersions(owner: string) {
    const result = await this.pool.query(
      "SELECT v.*, f.storage_key, f.original_name, f.content_type, f.byte_size FROM app_resume_versions v JOIN app_resume_files f ON f.id=v.file_id\n       WHERE v.owner=$1 ORDER BY v.created_at DESC, v.id DESC LIMIT 50",
      [owner],
    );
    return result.rows.map(row => this.resumeRow(row));
  }

  async getResumeVersion(owner: string, id: string) {
    const result = await this.pool.query(
      "SELECT v.*, f.storage_key, f.original_name, f.content_type, f.byte_size FROM app_resume_versions v JOIN app_resume_files f ON f.id=v.file_id WHERE v.id=$1 AND v.owner=$2",
      [id, owner],
    );
    return result.rows[0] ? this.resumeRow(result.rows[0]) : null;
  }

  /** Deleting a version removes its referencing tasks and every derived personal record atomically.
   *  The durable purge is written before the source rows go away, so private bytes and Agent
   *  receipts are still removed when this process stops right after the commit. Posting identity and
   *  effect tombstones stay owner-scoped for dedup; unstarted external effects are cancelled. */
  async deleteResumeVersion(owner: string, id: string) {
    return this.tx(async client => {
      const version = await client.query("SELECT v.*, f.id AS file_id, f.storage_key FROM app_resume_versions v JOIN app_resume_files f ON f.id=v.file_id WHERE v.id=$1 AND v.owner=$2", [id, owner]);
      const row = version.rows[0];
      if (!row) return null;
      const parsed = z.object({ file_id: z.uuid(), storage_key: z.string(), attachment_sha256: z.string() }).parse(row);
      const tasks = await client.query("SELECT id FROM app_career_tasks WHERE owner=$1 AND resume_version_id=$2", [owner, id]);
      const taskIds = tasks.rows.map(item => z.object({ id: z.uuid() }).parse(item).id);
      const workIds = await this.receiptWorkIdsIn(client, taskIds);
      const shared = await client.query("SELECT 1 FROM app_resume_files WHERE owner=$1 AND storage_key=$2 AND id<>$3 LIMIT 1", [owner, parsed.storage_key, parsed.file_id]);
      const storageKeys = shared.rows.length ? [] : [parsed.storage_key];
      await this.enqueuePurgeIn(client, { owner, requestKey: `purge:resume:${id}`, storageKeys, workIds });
      if (taskIds.length) {
        const contacts=await client.query("UPDATE app_career_contacts SET state=CASE WHEN state='dispatching' THEN 'unknown' ELSE 'cancelled' END,reason='resume_deleted' WHERE owner=$1 AND task_id IN (SELECT value FROM json_each($2)) AND state IN ('queued','dispatching') RETURNING posting_id,state",[owner,taskIds]);
        for(const raw of contacts.rows){const contact=z.object({posting_id:z.uuid(),state:z.string()}).parse(raw);await client.query('UPDATE app_career_applications SET state=$3 WHERE owner=$1 AND posting_id=$2',[owner,contact.posting_id,contact.state==='unknown'?'unknown':'conversation_failed']);}
        await client.query("UPDATE app_career_batches SET state='cancelled', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE task_id IN (SELECT value FROM json_each($1)) AND state IN ('approved','delivering','paused')", [taskIds]);
        await client.query("UPDATE app_career_work SET status='cancelled', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE task_id IN (SELECT value FROM json_each($1)) AND status IN ('queued','processing')", [taskIds]);
        await client.query("UPDATE app_career_applications SET task_id=NULL, batch_id=NULL, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE task_id IN (SELECT value FROM json_each($1))", [taskIds]);
        await client.query("DELETE FROM app_career_work WHERE task_id IN (SELECT value FROM json_each($1))", [taskIds]);
        await client.query("DELETE FROM app_career_tasks WHERE id IN (SELECT value FROM json_each($1))", [taskIds]);
      }
      await client.query("DELETE FROM app_resume_versions WHERE id=$1 AND owner=$2", [id, owner]);
      // The staging row repeats the extracted personal text and points at the same private original.
      await client.query("DELETE FROM app_resume_uploads WHERE owner=$1 AND storage_key=$2", [owner, parsed.storage_key]);
      await client.query("DELETE FROM app_resume_files WHERE id=$1 AND owner=$2", [parsed.file_id, owner]);
      return { taskIds, workIds };
    });
  }

  // ---------- browser session ----------
  async session(owner: string) {
    const result = await this.pool.query("SELECT * FROM app_career_browser_sessions WHERE owner=$1 AND site='boss'", [owner]);
    return result.rows[0] ? sessionRowSchema.parse(result.rows[0]) : null;
  }

  async writeSession(owner: string, patch: Partial<{ state: SessionRow['state']; engine: SessionRow['engine']; reason: string | null; accountMarker: string | null; activeTaskId: string | null; browserPid: number | null; humanWindow: 'none' | 'open'; limitation: string | null; profileGeneration: number }>) {
    const current = await this.session(owner);
    const next = {
      state: patch.state ?? current?.state ?? 'absent', engine: patch.engine ?? current?.engine ?? 'patchright',
      reason: patch.reason !== undefined ? patch.reason : current?.reason ?? null,
      accountMarker: patch.accountMarker !== undefined ? patch.accountMarker : current?.account_marker ?? null,
      activeTaskId: patch.activeTaskId !== undefined ? patch.activeTaskId : current?.active_task_id ?? null,
      browserPid: patch.browserPid !== undefined ? patch.browserPid : current?.browser_pid ?? null,
      humanWindow: patch.humanWindow ?? current?.human_window ?? 'none',
      limitation: patch.limitation !== undefined ? patch.limitation : current?.limitation ?? null,
      profileGeneration: patch.profileGeneration ?? current?.profile_generation ?? 0,
    };
    const saved = await this.pool.query(
      "INSERT INTO app_career_browser_sessions(owner,site,state,engine,profile_generation,account_marker,reason,active_task_id,browser_pid,human_window,limitation,observed_at)\n       VALUES($1,'boss',$2,$3,$4,$5,$6,$7,$8,$9,$10,(strftime('%Y-%m-%dT%H:%M:%f000Z','now')))\n       ON CONFLICT(owner,site) DO UPDATE SET state=EXCLUDED.state, engine=EXCLUDED.engine, profile_generation=EXCLUDED.profile_generation,\n         account_marker=EXCLUDED.account_marker, reason=EXCLUDED.reason, active_task_id=EXCLUDED.active_task_id,\n         browser_pid=EXCLUDED.browser_pid, human_window=EXCLUDED.human_window, limitation=EXCLUDED.limitation, observed_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))\n       RETURNING *",
      [owner, next.state, next.engine, next.profileGeneration, next.accountMarker, next.reason, next.activeTaskId, next.browserPid, next.humanWindow, next.limitation],
    );
    return sessionRowSchema.parse(saved.rows[0]);
  }

  /** Moves the session to a different driver. The new generation revokes every unstarted external
   *  action, so an approval frozen under the previous engine cannot act through this one. */
  async switchSessionEngine(owner: string, engine: SessionRow['engine']) {
    return this.tx(async client => {
      const result = await client.query(
        "INSERT INTO app_career_browser_sessions(owner,site,state,engine,profile_generation,reason,observed_at)\n         VALUES($1,'boss','absent',$2,1,'engine_changed',(strftime('%Y-%m-%dT%H:%M:%f000Z','now')))\n         ON CONFLICT(owner,site) DO UPDATE SET profile_generation=app_career_browser_sessions.profile_generation+1, engine=EXCLUDED.engine,\n           state='absent', reason='engine_changed', account_marker=NULL, active_task_id=NULL, browser_pid=NULL, human_window='none', observed_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))\n         RETURNING *",
        [owner, engine],
      );
      await this.revokeOwnerDelivery(client, owner);
      return sessionRowSchema.parse(result.rows[0]);
    });
  }

  /** Clears the session identity and revokes every unstarted external action in one transaction, so
   *  an old approval can never run under a different browser generation or account. Item and effect
   *  rows that were already dispatched keep their observed outcome. */
  async bumpSessionGeneration(owner: string) {
    return this.tx(async client => {
      const result = await client.query(
        "INSERT INTO app_career_browser_sessions(owner,site,state,engine,profile_generation,reason,observed_at)\n         VALUES($1,'boss','absent','patchright',1,'cleared',(strftime('%Y-%m-%dT%H:%M:%f000Z','now')))\n         ON CONFLICT(owner,site) DO UPDATE SET profile_generation=app_career_browser_sessions.profile_generation+1, state='absent', reason='cleared',\n           account_marker=NULL, active_task_id=NULL, browser_pid=NULL, human_window='none', observed_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))\n         RETURNING *",
        [owner],
      );
      await this.revokeOwnerDelivery(client, owner);
      return sessionRowSchema.parse(result.rows[0]);
    });
  }

  /** Accepting a clear withdraws delivery authority in the same transaction. The serial worker may be
   *  busy with an in-flight delivery, so waiting for its cleanup would leave the old approval able to
   *  take the next external step under a session the owner already asked to destroy. */
  async beginSessionClear(owner: string) {
    return this.tx(async client => {
      const result = await client.query(
        "INSERT INTO app_career_browser_sessions(owner,site,state,engine,profile_generation,reason,observed_at)\n         VALUES($1,'boss','clearing','patchright',0,'正在停止本机浏览器并清理私有会话目录。',(strftime('%Y-%m-%dT%H:%M:%f000Z','now')))\n         ON CONFLICT(owner,site) DO UPDATE SET state='clearing', reason='正在停止本机浏览器并清理私有会话目录。', observed_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))\n         RETURNING *",
        [owner],
      );
      await this.revokeOwnerDelivery(client, owner);
      return sessionRowSchema.parse(result.rows[0]);
    });
  }

  /** Stops every unstarted delivery of one owner and settles dispatched-but-unobserved intents as unknown. */
  private async revokeOwnerDelivery(client: PoolClient, owner: string) {
    const batches = await client.query("UPDATE app_career_batches SET state='cancelled', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE owner=$1 AND state IN ('approved','delivering','paused') RETURNING id", [owner]);
    for (const batch of batches.rows) await this.settleDispatchedEffects(client, owner, z.object({ id: z.uuid() }).parse(batch).id);
    await client.query("UPDATE app_career_work SET status='cancelled', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE owner=$1 AND kind='delivery' AND status IN ('queued','processing')", [owner]);
  }

  /** Revokes one batch's execution authority (account change or reset) without erasing what was
   *  already dispatched. Returns false when the batch was already cancelled or absent. */
  async revokeBatchDelivery(owner: string, batchId: string) {
    return this.tx(async client => {
      const batch = await client.query("UPDATE app_career_batches SET state='cancelled', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND owner=$2 AND state IN ('approved','delivering','paused') RETURNING id", [batchId, owner]);
      if (!batch.rows[0]) return false;
      await this.cancelBatchWork(client, owner, batchId);
      return true;
    });
  }

  /** Idempotent explicit cancellation: revoke queued work and settle in-flight intents as unknown. */
  async cancelBatch(owner: string, batchId: string) {
    return this.tx(async client => {
      const batch = await client.query("UPDATE app_career_batches SET state='cancelled', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND owner=$2 AND state<>'cancelled' RETURNING id", [batchId, owner]);
      if (!batch.rows[0]) {
        const existing = await client.query("SELECT 1 FROM app_career_batches WHERE id=$1 AND owner=$2", [batchId, owner]);
        if (!existing.rows[0]) throw new CareerNotFound('BATCH_NOT_FOUND');
        return false;
      }
      await this.cancelBatchWork(client, owner, batchId);
      return true;
    });
  }

  /** Stops admission for one batch and reports its in-flight intents honestly: a dispatched but
   *  unobserved effect becomes unknown, a never-dispatched item keeps its state. */
  private async cancelBatchWork(client: PoolClient, owner: string, batchId: string) {
    await this.settleDispatchedEffects(client, owner, batchId);
    await client.query("UPDATE app_career_work SET status='cancelled', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE owner=$1 AND batch_id=$2 AND kind='delivery' AND status IN ('queued','processing')", [owner, batchId]);
  }

  private async settleDispatchedEffects(client: PoolClient, owner: string, batchId: string) {
    const settled = await client.query(
      "UPDATE app_career_batch_items SET\n         conversation_state = CASE WHEN conversation_state='dispatching' THEN 'unknown' ELSE conversation_state END,\n         conversation_reason = CASE WHEN conversation_state='dispatching' THEN 'cancelled_during_dispatch' ELSE conversation_reason END,\n         attachment_state = CASE WHEN attachment_state='dispatching' THEN 'unknown' ELSE attachment_state END,\n         attachment_reason = CASE WHEN attachment_state='dispatching' THEN 'cancelled_during_dispatch' ELSE attachment_reason END,\n         updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))\n       WHERE batch_id=$1 AND owner=$2 AND (conversation_state='dispatching' OR attachment_state='dispatching')\n       RETURNING id",
      [batchId, owner],
    );
    if (settled.rows.length) {
      await client.query(
        "UPDATE app_career_effects SET outcome='unknown', evidence = json_patch(evidence, $2)\n         WHERE outcome='dispatching' AND batch_item_id IN (SELECT value FROM json_each($1))",
        [settled.rows.map(row => z.object({ id: z.uuid() }).parse(row).id), JSON.stringify([{ observedAt: new Date().toISOString(), url: '', summary: '取消时该动作已发出，结果未观察到，不做自动重试。' }])],
      );
    }
  }

  // ---------- commands for idempotency ----------
  async command(owner: string, requestId: string, kind: string, requestHash: string, resultId: string | null, revision: number | null) {
    const existing = await this.pool.query("SELECT * FROM app_career_commands WHERE owner=$1 AND request_id=$2", [owner, requestId]);
    if (existing.rows[0]) {
      const row = z.object({ kind: z.string(), request_hash: z.string(), result_id: z.uuid().nullable(), revision: z.number().nullable() }).parse(existing.rows[0]);
      if (row.kind !== kind || row.request_hash !== requestHash) throw new CareerConflict('IDEMPOTENCY_CONFLICT', 'CONFLICT');
      return { replay: true, resultId: row.result_id, revision: row.revision };
    }
    await this.pool.query("INSERT INTO app_career_commands(owner,request_id,kind,request_hash,result_id,revision) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [owner, requestId, kind, requestHash, resultId, revision]);
    const stored = await this.pool.query("SELECT * FROM app_career_commands WHERE owner=$1 AND request_id=$2", [owner, requestId]);
    const row = z.object({ kind: z.string(), request_hash: z.string(), result_id: z.uuid().nullable(), revision: z.number().nullable() }).parse(stored.rows[0]);
    if (row.kind !== kind || row.request_hash !== requestHash) throw new CareerConflict('IDEMPOTENCY_CONFLICT', 'CONFLICT');
    return { replay: row.result_id !== null, resultId: row.result_id, revision: row.revision };
  }

  async findCommand(owner: string, requestId: string) {
    const existing = await this.pool.query("SELECT * FROM app_career_commands WHERE owner=$1 AND request_id=$2", [owner, requestId]);
    return existing.rows[0] ? z.object({ kind: z.string(), request_hash: z.string(), result_id: z.uuid().nullable(), revision: z.number().nullable() }).parse(existing.rows[0]) : null;
  }

  async approveContacts(owner:string,taskId:string,input:z.infer<typeof careerContactApprovalSchema>){
    const requestHash=digest({kind:'approve-site-contacts',taskId,input});
    return this.tx(async client=>{
      const previous=await client.query('SELECT kind,request_hash,result_id FROM app_career_commands WHERE owner=$1 AND request_id=$2',[owner,input.requestId]);
      if(previous.rows[0]){
        const command=z.object({kind:z.string(),request_hash:z.string(),result_id:z.uuid()}).parse(previous.rows[0]);
        if(command.kind!=='approve-site-contacts'||command.request_hash!==requestHash)throw new CareerConflict('IDEMPOTENCY_CONFLICT','审批请求编号已用于其他内容。');
        return command.result_id;
      }
      const row=await client.query('SELECT * FROM app_career_tasks WHERE id=$1 AND owner=$2',[taskId,owner]);
      if(!row.rows[0])throw new CareerNotFound('TASK_NOT_FOUND');
      const task=this.taskRow(row.rows[0]);
      if(task.revision!==input.expectedTaskRevision)throw new CareerConflict('TASK_CHANGED','任务已更新，请重新读取。');
      if(task.status!=='active'||task.phase!=='review')throw new CareerConflict('TASK_NOT_REVIEWABLE','任务尚未进入复核阶段。');
      const sessionResult=await client.query("SELECT * FROM app_career_browser_sessions WHERE owner=$1 AND site='boss'",[owner]);
      const session=sessionResult.rows[0]?sessionRowSchema.parse(sessionResult.rows[0]):null;
      if(!session||session.state!=='ready')throw new CareerConflict('SESSION_NOT_READY','请先在系统检查 BOSS 会话。');
      const approvalId=crypto.randomUUID();
      for(const [position,item] of input.items.entries()){
        const result=await client.query('SELECT * FROM app_career_task_postings WHERE id=$1 AND owner=$2 AND task_id=$3',[item.taskPostingId,owner,taskId]);
        if(!result.rows[0])throw new CareerNotFound('POSTING_NOT_FOUND');
        const posting=taskPostingRowSchema.parse(result.rows[0]);
        if(posting.snapshot_hash!==item.snapshotHash)throw new CareerConflict('POSTING_CHANGED','岗位快照已更新，请重新确认。');
        if(posting.disposition!=='eligible')throw new CareerConflict('NOT_ELIGIBLE','仅已通过筛选的岗位可以沟通，待复核岗位不能放行。');
        const prior=await client.query('SELECT id FROM app_career_contacts WHERE owner=$1 AND posting_id=$2',[owner,posting.posting_id]);
        if(prior.rows.length)throw new CareerConflict('ALREADY_RESERVED','该岗位已有沟通记录，请先核对原记录。');
        await this.reserveApplication(client,{owner,postingId:posting.posting_id,taskId,batchId:null});
        const id=crypto.randomUUID();
        await client.query("INSERT INTO app_career_contacts(id,owner,approval_id,task_id,task_posting_id,posting_id,snapshot_hash,posting_snapshot,position,session_generation,account_marker,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'queued')",[id,owner,approvalId,taskId,posting.id,posting.posting_id,posting.snapshot_hash,JSON.stringify(posting.observed),position,session.profile_generation,session.account_marker]);
        await this.enqueueWorkIn(client,{id:crypto.randomUUID(),owner,kind:'delivery',taskId,requestHash:`site-contact:${id}`,payload:{action:'site_preset',contactId:id}});
      }
      await client.query('INSERT INTO app_career_commands(owner,request_id,kind,request_hash,result_id,revision) VALUES($1,$2,$3,$4,$5,$6)',[owner,input.requestId,'approve-site-contacts',requestHash,approvalId,task.revision]);
      return approvalId;
    });
  }

  async retryContact(owner:string,taskId:string,contactId:string,input:z.infer<typeof careerContactRetrySchema>){
    const requestHash=digest({kind:'retry-site-contact',taskId,contactId,input});
    return this.tx(async client=>{
      const previous=await client.query('SELECT kind,request_hash,result_id FROM app_career_commands WHERE owner=$1 AND request_id=$2',[owner,input.requestId]);
      if(previous.rows[0]){const command=z.object({kind:z.string(),request_hash:z.string(),result_id:z.uuid()}).parse(previous.rows[0]);if(command.kind!=='retry-site-contact'||command.request_hash!==requestHash||command.result_id!==contactId)throw new CareerConflict('IDEMPOTENCY_CONFLICT','重试请求编号已用于其他内容。');return;}
      const result=await client.query('SELECT * FROM app_career_contacts WHERE owner=$1 AND id=$2 AND task_id=$3',[owner,contactId,taskId]);
      if(!result.rows[0])throw new CareerNotFound('CONTACT_NOT_FOUND');
      const contact=contactRowSchema.parse(result.rows[0]);
      if(contact.state!=='failed')throw new CareerConflict('CONTACT_NOT_RETRYABLE','只有确认未点击的失败记录可以重试；结果未知不能重试。');
      if(contact.updated_at.getTime()!==new Date(input.expectedUpdatedAt).getTime())throw new CareerConflict('CONTACT_CHANGED','记录已更新，请重新读取。');
      const authority=await client.query("SELECT t.id FROM app_career_tasks t JOIN app_career_browser_sessions s ON s.owner=t.owner AND s.site='boss' WHERE t.id=$1 AND t.owner=$2 AND t.status='active' AND s.state='ready' AND s.profile_generation=$3 AND s.account_marker IS $4",[taskId,owner,contact.session_generation,contact.account_marker]);
      if(!authority.rows.length)throw new CareerConflict('APPROVAL_SESSION_CHANGED','原批准的会话已改变或未就绪，请先核对会话。');
      await client.query("UPDATE app_career_work SET failure=$3 WHERE owner=$1 AND task_id=$2 AND payload->>'contactId'=$4 AND failure IS NULL",[owner,taskId,contact.reason,contactId]);
      await client.query("UPDATE app_career_contacts SET state='queued',reason=NULL,evidence='[]',updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND owner=$2",[contactId,owner]);
      await client.query("UPDATE app_career_applications SET state='reserved' WHERE owner=$1 AND posting_id=$2",[owner,contact.posting_id]);
      await this.enqueueWorkIn(client,{id:crypto.randomUUID(),owner,kind:'delivery',taskId,requestHash:`site-contact-retry:${contactId}:${input.requestId}`,payload:{action:'site_preset',contactId}});
      await client.query('INSERT INTO app_career_commands(owner,request_id,kind,request_hash,result_id,revision) VALUES($1,$2,$3,$4,$5,$6)',[owner,input.requestId,'retry-site-contact',requestHash,contactId,0]);
    });
  }

  async contacts(owner:string,taskId:string){
    const result=await this.pool.query('SELECT * FROM app_career_contacts WHERE owner=$1 AND task_id=$2 ORDER BY created_at,position',[owner,taskId]);
    return result.rows.map(row=>contactRowSchema.parse(row));
  }
  async contact(owner:string,id:string){
    const result=await this.pool.query('SELECT * FROM app_career_contacts WHERE owner=$1 AND id=$2',[owner,id]);
    return result.rows[0]?contactRowSchema.parse(result.rows[0]):null;
  }
  async beginContact(work:WorkRow,contact:ContactRow){
    return this.tx(async client=>{
      const authority=await client.query("SELECT w.id FROM app_career_work w JOIN app_career_tasks t ON t.id=w.task_id JOIN app_career_browser_sessions s ON s.owner=w.owner AND s.site='boss' WHERE w.id=$1 AND w.owner=$2 AND w.lease_generation=$3 AND w.status='processing' AND t.status='active' AND s.state='ready' AND s.profile_generation=$4 AND s.account_marker IS $5",[work.id,work.owner,work.lease_generation,contact.session_generation,contact.account_marker]);
      if(!authority.rows.length)return false;
      const changed=await client.query("UPDATE app_career_contacts SET state='dispatching',updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND owner=$2 AND state='queued' RETURNING id",[contact.id,work.owner]);
      return Boolean(changed.rows.length);
    });
  }
  async settleContact(work:WorkRow,contact:ContactRow,outcome:{state:'confirmed'|'already_contacted'|'failed'|'unknown';reason:string|null;evidence:z.infer<typeof careerEffectEvidenceSchema>[]}){
    return this.tx(async client=>{
      const authority=await client.query("SELECT id FROM app_career_work WHERE id=$1 AND owner=$2 AND lease_generation=$3 AND status='processing'",[work.id,work.owner,work.lease_generation]);
      if(!authority.rows.length)return false;
      const result=await client.query("UPDATE app_career_contacts SET state=$3,reason=$4,evidence=$5,updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND owner=$2 AND state IN ('queued','dispatching') RETURNING id",[contact.id,work.owner,outcome.state,outcome.reason,JSON.stringify(outcome.evidence)]);
      if(!result.rows.length)return false;
      const applicationState=outcome.state==='confirmed'||outcome.state==='already_contacted'?'conversation_confirmed':outcome.state==='failed'?'conversation_failed':'unknown';
      await client.query("UPDATE app_career_applications SET state=$3,updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE owner=$1 AND posting_id=$2",[work.owner,contact.posting_id,applicationState]);
      return true;
    });
  }

  // ---------- tasks and postings ----------
  private taskRow(raw: unknown) {
    return taskRowSchema.parse(raw);
  }

  async createTask(owner: string, input: { id: string; resume: ResumeRow | null; policy: unknown; model: { connectionId: string; label: string } | null; requestId: string; requestHash: string }) {
    return this.tx(async client => {
      const existing = await client.query("SELECT * FROM app_career_commands WHERE owner=$1 AND request_id=$2", [owner, input.requestId]);
      if (existing.rows[0]) {
        const row = z.object({ kind: z.string(), request_hash: z.string(), result_id: z.uuid().nullable(), revision: z.number().nullable() }).parse(existing.rows[0]);
        if (row.kind !== 'create-career-task' || row.request_hash !== input.requestHash) throw new CareerConflict('IDEMPOTENCY_CONFLICT', 'CONFLICT');
        const task = await client.query("SELECT * FROM app_career_tasks WHERE id=$1 AND owner=$2", [row.result_id, owner]);
        if (!task.rows[0]) throw new CareerConflict('IDEMPOTENCY_CONFLICT', 'CONFLICT');
        return this.taskRow(task.rows[0]);
      }
      const result = await client.query(
        "INSERT INTO app_career_tasks(id,owner,resume_version_id,resume_text_sha256,attachment_sha256,policy,model_source,phase,status)\n         VALUES($1,$2,$3,$4,$5,$6,$7,'queued','active') RETURNING *",
        [input.id, owner, input.resume?.id ?? null, input.resume?.text_sha256 ?? null, input.resume?.attachment_sha256 ?? null, JSON.stringify(input.policy), input.model ? JSON.stringify(input.model) : null],
      );
      const task = this.taskRow(result.rows[0]);
      await client.query("INSERT INTO app_career_commands(owner,request_id,kind,request_hash,result_id,revision) VALUES($1,$2,$3,$4,$5,$6)", [owner, input.requestId, 'create-career-task', input.requestHash, task.id, 0]);
      await this.enqueueWorkIn(client, { id: crypto.randomUUID(), owner, kind: 'scan', taskId: task.id, requestHash: `scan:${task.id}:${task.revision}` });
      return task;
    });
  }

  async bindPreviewResume(owner: string, input: { taskId: string; requestId: string; requestHash: string; expectedRevision: number; resumeVersionId: string }) {
    return this.tx(async client => {
      const command = await client.query('SELECT kind,request_hash,result_id FROM app_career_commands WHERE owner=$1 AND request_id=$2', [owner,input.requestId]);
      if (command.rows[0]) {
        const prior = z.object({kind:z.string(),request_hash:z.string(),result_id:z.string()}).parse(command.rows[0]);
        if (prior.kind !== 'bind-preview-resume' || prior.request_hash !== input.requestHash || prior.result_id !== input.taskId) throw new CareerConflict('IDEMPOTENCY_CONFLICT','IDEMPOTENCY_CONFLICT');
        const result = await client.query('SELECT * FROM app_career_tasks WHERE id=$1 AND owner=$2',[input.taskId,owner]);
        if (!result.rows[0]) throw new CareerNotFound('TASK_NOT_FOUND');
        return this.taskRow(result.rows[0]);
      }
      const result = await client.query('SELECT * FROM app_career_tasks WHERE id=$1 AND owner=$2',[input.taskId,owner]);
      if (!result.rows[0]) throw new CareerNotFound('TASK_NOT_FOUND');
      const task = this.taskRow(result.rows[0]);
      if (task.revision !== input.expectedRevision) throw new CareerConflict('TASK_CHANGED','任务已更新，请重新读取。');
      if (task.model_source || task.status !== 'active' || task.phase !== 'review') throw new CareerConflict('PREVIEW_NOT_REVIEWABLE','只有已完成且未绑定简历的预览可以转换。');
      const active = await client.query("SELECT id FROM app_career_work WHERE task_id=$1 AND status IN ('queued','processing')",[task.id]);
      if (active.rows.length) throw new CareerConflict('TASK_BUSY','任务仍在执行，请稍后再试。');
      const resume = await client.query('SELECT id,text_sha256,attachment_sha256 FROM app_resume_versions WHERE owner=$1 AND id=$2',[owner,input.resumeVersionId]);
      if (!resume.rows[0]) throw new CareerNotFound('RESUME_NOT_FOUND');
      const source = z.object({id:z.uuid(),text_sha256:z.string(),attachment_sha256:z.string()}).parse(resume.rows[0]);
      const updated = await client.query("UPDATE app_career_tasks SET resume_version_id=$3,resume_text_sha256=$4,attachment_sha256=$5,model_source=$6,revision=revision+1,updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND owner=$2 RETURNING *",[task.id,owner,source.id,source.text_sha256,source.attachment_sha256,JSON.stringify({connectionId:null,label:'手动确认'})]);
      const bound = this.taskRow(updated.rows[0]);
      await client.query('INSERT INTO app_career_commands(owner,request_id,kind,request_hash,result_id,revision) VALUES($1,$2,$3,$4,$5,$6)',[owner,input.requestId,'bind-preview-resume',input.requestHash,task.id,bound.revision]);
      return bound;
    });
  }

  async listTasks(owner: string, limit = 20) {
    const result = await this.pool.query("SELECT * FROM app_career_tasks WHERE owner=$1 ORDER BY created_at DESC, id DESC LIMIT $2", [owner, limit]);
    return result.rows.map(row => this.taskRow(row));
  }

  async getTask(owner: string, id: string) {
    const result = await this.pool.query("SELECT * FROM app_career_tasks WHERE id=$1 AND owner=$2", [id, owner]);
    return result.rows[0] ? this.taskRow(result.rows[0]) : null;
  }

  async taskForWork(taskId: string) {
    const result = await this.pool.query("SELECT * FROM app_career_tasks WHERE id=$1", [taskId]);
    return result.rows[0] ? this.taskRow(result.rows[0]) : null;
  }

  async setTaskState(taskId: string, patch: { phase?: TaskRow['phase']; status?: TaskRow['status']; pauseReason?: TaskRow['pause_reason']; pauseDetail?: string | null; error?: string | null; incrementRevision?: boolean }) {
    const result = await this.pool.query(
      "UPDATE app_career_tasks SET phase=COALESCE($2,phase), status=COALESCE($3,status), pause_reason=$4, pause_detail=$5, error=$6,\n        revision=revision + CASE WHEN $7 THEN 1 ELSE 0 END, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND status<>'cancelled' RETURNING *",
      [taskId, patch.phase ?? null, patch.status ?? null, patch.pauseReason ?? null, patch.pauseDetail ?? null, patch.error ?? null, patch.incrementRevision ?? false],
    );
    return result.rows[0] ? this.taskRow(result.rows[0]) : null;
  }

  async recordPageFailure(taskId: string, successful: boolean) {
    const result = await this.pool.query(
      "UPDATE app_career_tasks SET page_failure_count = CASE WHEN $2 THEN 0 ELSE page_failure_count+1 END, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 RETURNING page_failure_count",
      [taskId, successful],
    );
    return z.object({ page_failure_count: z.number() }).parse(result.rows[0]).page_failure_count;
  }

  async cancelTask(owner: string, taskId: string) {
    return this.tx(async client => {
      const task = await client.query("UPDATE app_career_tasks SET status='cancelled', revision=revision+1, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND owner=$2 AND status<>'cancelled' RETURNING *", [taskId, owner]);
      if (!task.rows[0]) {
        const existing = await client.query("SELECT * FROM app_career_tasks WHERE id=$1 AND owner=$2", [taskId, owner]);
        if (!existing.rows[0]) throw new CareerNotFound('TASK_NOT_FOUND');
        return this.taskRow(existing.rows[0]);
      }
      const contacts=await client.query("UPDATE app_career_contacts SET state=CASE WHEN state='dispatching' THEN 'unknown' ELSE 'cancelled' END,reason='task_cancelled',updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE task_id=$1 AND owner=$2 AND state IN ('queued','dispatching') RETURNING posting_id,state",[taskId,owner]);
      for(const raw of contacts.rows){const contact=z.object({posting_id:z.uuid(),state:z.string()}).parse(raw);await client.query('UPDATE app_career_applications SET state=$3 WHERE owner=$1 AND posting_id=$2',[owner,contact.posting_id,contact.state==='unknown'?'unknown':'conversation_failed']);}
      const batches = await client.query("UPDATE app_career_batches SET state='cancelled', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE task_id=$1 AND state IN ('approved','delivering','paused') RETURNING id", [taskId]);
      for (const batch of batches.rows) await this.cancelBatchWork(client, owner, z.object({ id: z.uuid() }).parse(batch).id);
      await client.query("UPDATE app_career_work SET status='cancelled', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE task_id=$1 AND status IN ('queued','processing')", [taskId]);
      return this.taskRow(task.rows[0]);
    });
  }

  async deleteTask(owner: string, taskId: string) {
    return this.tx(async client => {
      const task = await client.query("SELECT * FROM app_career_tasks WHERE id=$1 AND owner=$2", [taskId, owner]);
      if (!task.rows[0]) throw new CareerNotFound('TASK_NOT_FOUND');
      await client.query("UPDATE app_career_tasks SET status='cancelled' WHERE id=$1", [taskId]);
      const workIds = await this.receiptWorkIdsIn(client, [taskId]);
      await this.enqueuePurgeIn(client, { owner, requestKey: `purge:task:${taskId}`, workIds });
      const batchIds = await client.query("SELECT id FROM app_career_batches WHERE task_id=$1", [taskId]);
      await client.query("DELETE FROM app_career_work WHERE task_id=$1", [taskId]);
      // Owner-scoped posting identity and effect tombstones stay for cross-task dedup; personal snapshots do not.
      await client.query("UPDATE app_career_applications SET task_id=NULL, batch_id=NULL, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE task_id=$1", [taskId]);
      await client.query("DELETE FROM app_career_tasks WHERE id=$1", [taskId]);
      return { batchIds: batchIds.rows.map(row => z.object({ id: z.uuid() }).parse(row).id), workIds };
    });
  }

  /** Agent receipt keys owned by these tasks: every career work id, the receipt of each attempted
   *  scan match, plus the receipt of each already committed match. Collected inside the deleting
   *  transaction while the work rows are locked, before the source rows are removed, so a concurrent
   *  registration either lands in this list or finds the source gone and never calls the provider. */
  private async receiptWorkIdsIn(client: Pick<PoolClient, 'query'>, taskIds: string[]) {
    if (!taskIds.length) return [];
    const work = await client.query("SELECT id, payload FROM app_career_work WHERE task_id IN (SELECT value FROM json_each($1))", [taskIds]);
    const matched = await client.query(
      "SELECT w.id AS work_id, p.site_posting_id FROM app_career_work w\n         JOIN app_career_task_postings tp ON tp.task_id = w.task_id AND tp.match IS NOT NULL\n         JOIN app_career_postings p ON p.id = tp.posting_id\n        WHERE w.task_id IN (SELECT value FROM json_each($1)) AND w.kind='scan'",
      [taskIds],
    );
    const ids = work.rows.map(row => z.object({ id: z.uuid() }).parse(row).id);
    for (const row of work.rows) {
      const payload = z.object({ matchAttempts: matchAttemptsSchema.default([]) }).parse(row.payload ?? {});
      for (const attempt of payload.matchAttempts) ids.push(attempt.receiptWorkId);
    }
    // Matches committed before attempts were recorded still resolve through their posting snapshot.
    for (const row of matched.rows) {
      const scan = z.object({ work_id: z.uuid(), site_posting_id: z.string() }).parse(row);
      ids.push(matchReceiptWorkId(scan.work_id, scan.site_posting_id));
    }
    return [...new Set(ids)];
  }

  /** Durable cleanup written before the owning rows disappear. The purge work row is not linked to
   *  the deleted task, so the same transaction can still remove that task's other work rows. */
  private async enqueuePurgeIn(client: Pick<PoolClient, 'query'>, input: { owner: string; requestKey: string; storageKeys?: string[]; workIds?: string[] }) {
    const workIds = input.workIds ?? [];
    const chunks = workIds.length === 0 ? [[]] : Array.from({ length: Math.ceil(workIds.length / 100) }, (_, index) => workIds.slice(index * 100, index * 100 + 100));
    for (const [index, chunk] of chunks.entries()) {
      await this.enqueueWorkIn(client, {
        id: crypto.randomUUID(), owner: input.owner, kind: 'purge', requestHash: `${input.requestKey}:${index}`,
        payload: { storageKeys: input.storageKeys ?? [], workIds: chunk, quiesce: (input.storageKeys ?? []).length > 0 },
      });
    }
  }

  // ---------- personal derivatives outside the career tables ----------
  /** Career preparations reached by these sources; their bank payloads carry the personal provenance. */
  async preparationIdsForResumeVersion(owner: string, resumeVersionId: string) {
    const result = await this.pool.query("SELECT id FROM app_career_preparations WHERE owner=$1 AND resume_version_id=$2", [owner, resumeVersionId]);
    return result.rows.map(row => z.object({ id: z.uuid() }).parse(row).id);
  }

  async preparationIdsForTask(owner: string, taskId: string) {
    const result = await this.pool.query("SELECT id FROM app_career_preparations WHERE owner=$1 AND task_id=$2", [owner, taskId]);
    return result.rows.map(row => z.object({ id: z.uuid() }).parse(row).id);
  }

  /** Personal records derived from the given career sources: owner bank questions that kept the
   *  resume/preparation provenance, and the strict interviews whose frozen materials carry it. The
   *  frozen provenance is searched directly, so deleting the bank question first, or retrying after a
   *  partial cleanup, still finds the interview instead of leaving its personal copy behind. */
  async derivedPersonalData(owner: string, input: { resumeVersionId?: string; preparationIds: string[] }) {
    const questions = await this.pool.query(
      "SELECT id FROM app_bank_questions WHERE owner=$1 AND (\n         ($2 IS NOT NULL AND payload->'career'->>'resumeVersionId' = $2)\n         OR (json_array_length($3) > 0 AND payload->'career'->>'preparationId' IN (SELECT value FROM json_each($3))))",
      [owner, input.resumeVersionId ?? null, input.preparationIds],
    );
    const bankQuestionIds = questions.rows.map(row => z.object({ id: z.uuid() }).parse(row).id);
    const sessions = await this.pool.query(
      "SELECT m.session_id FROM app_interview_materials m JOIN app_interviews i ON i.id=m.session_id\n        WHERE i.owner=$1 AND (\n          EXISTS (SELECT 1 FROM json_each(m.questions) q WHERE q.value->>'id' IN (SELECT value FROM json_each($2)))\n          OR EXISTS (SELECT 1 FROM json_each(m.questions) q WHERE\n               ($3 IS NOT NULL AND q.value->'career'->>'resumeVersionId' = $3)\n            OR (json_array_length($4) > 0 AND q.value->'career'->>'preparationId' IN (SELECT value FROM json_each($4)))))",
      [owner, bankQuestionIds, input.resumeVersionId ?? null, input.preparationIds],
    );
    return { bankQuestionIds, interviewSessionIds: sessions.rows.map(row => z.object({ session_id: z.uuid() }).parse(row).session_id) };
  }

  async upsertPosting(owner: string, posting: z.infer<typeof observedPostingSchema>) {
    const result = await this.pool.query(
      "INSERT INTO app_career_postings(id,owner,site,site_posting_id,url,title,company,location,salary_raw)\n       VALUES($1,$2,'boss',$3,$4,$5,$6,$7,$8)\n       ON CONFLICT(owner,site,site_posting_id) DO UPDATE SET url=EXCLUDED.url,title=EXCLUDED.title,company=EXCLUDED.company,location=EXCLUDED.location,salary_raw=EXCLUDED.salary_raw,updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))\n       RETURNING id",
      [crypto.randomUUID(), owner, posting.sitePostingId, posting.url, posting.title, posting.company, posting.location, posting.salaryRaw],
    );
    return z.object({ id: z.uuid() }).parse(result.rows[0]).id;
  }

  async applicationState(owner: string, postingId: string) {
    const result = await this.pool.query("SELECT state FROM app_career_applications WHERE owner=$1 AND site='boss' AND posting_id=$2", [owner, postingId]);
    return result.rows[0] ? z.object({ state: z.string() }).parse(result.rows[0]).state : null;
  }

  /** Records the Agent receipt identity of one attempted match before the provider call. The update
   *  takes the work row lock, so it serializes with the deleting transaction: once the source is
   *  already being deleted this returns false and the caller must not dispatch. */
  async registerMatchAttempt(input: { workId: string; leaseGeneration: number; receiptWorkId: string; sitePostingId: string }) {
    const attempt: MatchAttempt = { receiptWorkId: input.receiptWorkId, sitePostingId: input.sitePostingId };
    const result = await this.pool.query(
      "UPDATE app_career_work AS w\n          SET payload = json_insert(w.payload, '$.matchAttempts[#]', json($3)->'$[0]'), updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))\n         FROM app_career_tasks t\n        WHERE w.id=$1 AND w.lease_generation=$2 AND w.kind='scan' AND w.status='processing'\n          AND t.id=w.task_id AND t.owner=w.owner AND t.status<>'cancelled'\n        RETURNING id",
      [input.workId, input.leaseGeneration, JSON.stringify([attempt])],
    );
    return Boolean(result.rows[0]);
  }

  async upsertTaskPosting(owner: string, input: { id: string; taskId: string; postingId: string; observed: unknown; snapshotHash: string; disposition: string; decision: unknown; match: unknown; greeting: unknown; existingRevision: number | null }) {
    if (input.existingRevision === null) {
      // A late scan result never recreates a snapshot for a task that was deleted or cancelled meanwhile.
      const result = await this.pool.query(
        "INSERT INTO app_career_task_postings(id,owner,task_id,posting_id,observed,snapshot_hash,disposition,decision,match,greeting)\n         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 FROM app_career_tasks t WHERE t.id=$3 AND t.owner=$2 AND t.status<>'cancelled'\n         RETURNING revision",
        [input.id, owner, input.taskId, input.postingId, JSON.stringify(input.observed), input.snapshotHash, input.disposition, JSON.stringify(input.decision), input.match === null ? null : JSON.stringify(input.match), input.greeting === null ? null : JSON.stringify(input.greeting)],
      );
      return result.rows[0] ? z.object({ revision: z.number() }).parse(result.rows[0]).revision : null;
    }
    const result = await this.pool.query(
      "UPDATE app_career_task_postings AS tp SET observed=$3,snapshot_hash=$4,disposition=$5,decision=$6,match=$7,greeting=COALESCE(tp.greeting,$8),revision=tp.revision+1,updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))\n       FROM app_career_tasks t\n       WHERE tp.id=$1 AND tp.owner=$2 AND tp.revision=$9 AND t.id=tp.task_id AND t.status<>'cancelled' RETURNING revision",
      [input.id, owner, JSON.stringify(input.observed), input.snapshotHash, input.disposition, JSON.stringify(input.decision), input.match === null ? null : JSON.stringify(input.match), input.greeting === null ? null : JSON.stringify(input.greeting), input.existingRevision],
    );
    if (!result.rows[0]) throw new CareerConflict('POSTING_CHANGED', 'POSTING_CHANGED');
    return z.object({ revision: z.number() }).parse(result.rows[0]).revision;
  }

  async replacePreviewObservation(owner:string,input:{workId:string;leaseGeneration:number;taskId:string;postingId:string;expectedRevision:number;observed:z.infer<typeof observedPostingSchema>;decision:z.infer<typeof careerDecisionSchema>}){
    return this.tx(async client=>{
      const lease=await client.query("SELECT id FROM app_career_work WHERE id=$1 AND owner=$2 AND task_id=$3 AND lease_generation=$4 AND status='processing'",[input.workId,owner,input.taskId,input.leaseGeneration]);
      if(!lease.rows.length)throw new CareerConflict('WORK_LEASE_LOST','核对任务已失去租约。');
      const taskResult=await client.query('SELECT * FROM app_career_tasks WHERE owner=$1 AND id=$2',[owner,input.taskId]);
      if(!taskResult.rows[0])throw new CareerNotFound('TASK_NOT_FOUND');
      const task=this.taskRow(taskResult.rows[0]);
      if(task.model_source||task.status!=='active'||task.phase!=='review')throw new CareerConflict('PREVIEW_NOT_REVIEWABLE','只能更新未绑定的已完成预览。');
      const prior=await client.query('SELECT * FROM app_career_task_postings WHERE owner=$1 AND id=$2 AND task_id=$3',[owner,input.postingId,input.taskId]);
      if(!prior.rows[0])throw new CareerNotFound('POSTING_NOT_FOUND');
      const posting=taskPostingRowSchema.parse(prior.rows[0]);
      if(posting.revision!==input.expectedRevision||posting.owner_review)throw new CareerConflict('POSTING_CHANGED','岗位已被复核或更新，未覆盖。');
      if(posting.observed.sitePostingId!==input.observed.sitePostingId||input.observed.identitySource!=='detail_link')throw new CareerConflict('POSTING_CHANGED','岗位身份不一致。');
      const approved=await client.query('SELECT id FROM app_career_batch_items WHERE task_posting_id=$1 UNION ALL SELECT id FROM app_career_contacts WHERE task_posting_id=$1 LIMIT 1',[posting.id]);
      if(approved.rows.length)throw new CareerConflict('POSTING_APPROVED','已批准的快照不能重读覆盖。');
      await client.query("UPDATE app_career_postings SET title=$3,company=$4,location=$5,salary_raw=$6,updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND owner=$2",[posting.posting_id,owner,input.observed.title,input.observed.company,input.observed.location,input.observed.salaryRaw]);
      await client.query("UPDATE app_career_task_postings SET observed=$3,snapshot_hash=$4,decision=$5,disposition=$6,match=NULL,greeting=NULL,revision=revision+1,updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND owner=$2",[posting.id,owner,JSON.stringify(input.observed),digest(input.observed),JSON.stringify(input.decision),input.decision.disposition]);
      await client.query("UPDATE app_career_tasks SET revision=revision+1,updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND owner=$2",[task.id,owner]);
    });
  }

  async taskPostingByTaskAndPosting(taskId: string, postingId: string) {
    const result = await this.pool.query("SELECT id, revision FROM app_career_task_postings WHERE task_id=$1 AND posting_id=$2", [taskId, postingId]);
    return result.rows[0] ? z.object({ id: z.uuid(), revision: z.number() }).parse(result.rows[0]) : null;
  }

  async addReadSlot(taskId: string) {
    const result = await this.pool.query("UPDATE app_career_tasks SET read_count=read_count+1, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND read_count < 30 RETURNING read_count", [taskId]);
    return result.rows[0] ? z.object({ read_count: z.number() }).parse(result.rows[0]).read_count : null;
  }

  async listTaskPostings(owner: string, taskId: string) {
    const result = await this.pool.query(
      "SELECT tp.*, p.title, p.company, p.location, p.salary_raw,\n        (SELECT json_object('id', pr.id, 'status', pr.status, 'revision', pr.revision) FROM app_career_preparations pr WHERE pr.task_posting_id=tp.id) AS preparation\n       FROM app_career_task_postings tp JOIN app_career_postings p ON p.id=tp.posting_id\n       WHERE tp.owner=$1 AND tp.task_id=$2 ORDER BY tp.created_at, tp.id",
      [owner, taskId],
    );
    return result.rows.map(row => ({ ...taskPostingRowSchema.parse(row), preparation: preparationSummary(row) }));
  }

  async getTaskPosting(owner: string, id: string) {
    const result = await this.pool.query(
      "SELECT tp.*, p.title, p.company, p.location, p.salary_raw,\n        (SELECT json_object('id', pr.id, 'status', pr.status, 'revision', pr.revision) FROM app_career_preparations pr WHERE pr.task_posting_id=tp.id) AS preparation\n       FROM app_career_task_postings tp JOIN app_career_postings p ON p.id=tp.posting_id WHERE tp.id=$1 AND tp.owner=$2",
      [id, owner],
    );
    return result.rows[0] ? { ...taskPostingRowSchema.parse(result.rows[0]), preparation: preparationSummary(result.rows[0]) } : null;
  }

  async updateTaskPosting(owner: string, id: string, expectedRevision: number, patch: { greeting?: { text: string; factualClaims: unknown[]; uncertainties: string[]; modelAttribution: unknown }; ownerReview?: { decision: 'confirmed_direct' | 'excluded' | 'unresolved'; note: string; source: string } }) {
    const result = await this.pool.query(
      "UPDATE app_career_task_postings SET\n        greeting = CASE WHEN $4 IS NULL THEN greeting ELSE $4 END,\n        greeting_revision = CASE WHEN $4 IS NULL THEN greeting_revision ELSE greeting_revision+1 END,\n        owner_review = COALESCE($5, owner_review),\n        revision = revision+1, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))\n       WHERE id=$1 AND owner=$2 AND revision=$3 AND NOT EXISTS (SELECT 1 FROM app_career_contacts c WHERE c.task_posting_id=app_career_task_postings.id) AND NOT EXISTS (SELECT 1 FROM app_career_batch_items b WHERE b.task_posting_id=app_career_task_postings.id) RETURNING revision",
      [id, owner, expectedRevision, patch.greeting ? JSON.stringify(patch.greeting) : null, patch.ownerReview ? JSON.stringify(patch.ownerReview) : null],
    );
    if (!result.rows[0]) throw new CareerConflict('POSTING_CHANGED', 'POSTING_CHANGED');
    return z.object({ revision: z.number() }).parse(result.rows[0]).revision;
  }

  async countTaskPostings(taskId: string) {
    const result = await this.pool.query("SELECT count(*) AS total FROM app_career_task_postings WHERE task_id=$1", [taskId]);
    return z.object({ total: z.number() }).parse(result.rows[0]).total;
  }

  async dispositionCounts(taskId: string) {
    const result = await this.pool.query("SELECT disposition, count(*) AS total FROM app_career_task_postings WHERE task_id=$1 GROUP BY disposition", [taskId]);
    const counts = { eligible: 0, excluded: 0, needs_review: 0 };
    for (const row of result.rows) {
      const parsed = z.object({ disposition: z.enum(['eligible', 'excluded', 'needs_review']), total: z.number() }).parse(row);
      counts[parsed.disposition] = parsed.total;
    }
    return counts;
  }

  // ---------- approval and batches ----------
  async approve(owner: string, input: {
    id: string; requestId: string; taskId: string; expectedTaskRevision: number; resumeVersionId: string;
    items: Array<{ id: string; taskPostingId: string; postingSnapshotHash: string; greetingDraftRevision: number; finalGreeting: string; position: number }>;
  }) {
    return this.tx(async client => {
      // Lock the authoritative rows up front so replay, digest, item state and reservations are
      // all checked against the same frozen state instead of a pre-transaction snapshot.
      const task = await client.query("SELECT * FROM app_career_tasks WHERE id=$1 AND owner=$2", [input.taskId, owner]);
      if (!task.rows[0]) throw new CareerNotFound('TASK_NOT_FOUND');
      const taskRow = this.taskRow(task.rows[0]);
      if (taskRow.revision !== input.expectedTaskRevision) throw new CareerConflict('TASK_CHANGED', 'TASK_CHANGED');
      if (taskRow.status !== 'active' || taskRow.phase !== 'review') throw new CareerConflict('TASK_NOT_REVIEWABLE', 'TASK_NOT_REVIEWABLE');
      if (!taskRow.model_source) throw new CareerConflict('PREVIEW_NOT_DELIVERABLE', '预览任务未绑定简历与模型，不能投递。');
      if (input.resumeVersionId !== taskRow.resume_version_id) throw new CareerConflict('RESUME_CHANGED', 'RESUME_CHANGED');
      const resume = await client.query("SELECT id, text_sha256, attachment_sha256 FROM app_resume_versions WHERE id=$1 AND owner=$2", [taskRow.resume_version_id, owner]);
      if (!resume.rows[0]) throw new CareerConflict('RESUME_CHANGED', 'RESUME_CHANGED');
      const resumeRow = z.object({ id: z.uuid(), text_sha256: z.string(), attachment_sha256: z.string() }).parse(resume.rows[0]);
      const session = await client.query("SELECT state, profile_generation, account_marker FROM app_career_browser_sessions WHERE owner=$1 AND site='boss'", [owner]);
      const sessionRow = session.rows[0] ? z.object({ state: bossSessionStateSchema, profile_generation: z.number(), account_marker: z.string().nullable() }).parse(session.rows[0]) : null;
      // The approval binds to the account and session generation observed right now. Without a
      // ready local session the frozen batch could only be fenced by a reset, never by an account change.
      if (sessionRow?.state !== 'ready') throw new CareerConflict('SESSION_NOT_READY', 'SESSION_NOT_READY');
      const sessionGeneration = sessionRow.profile_generation;
      const accountMarker = sessionRow.account_marker;
      const digest = approvalDigest({
        taskId: input.taskId, taskRevision: taskRow.revision, resumeVersionId: resumeRow.id, resumeTextSha256: resumeRow.text_sha256,
        attachmentSha256: resumeRow.attachment_sha256, modelConnectionId: taskRow.model_source.connectionId,
        sessionGeneration, accountMarker,
        items: input.items.map(item => ({ taskPostingId: item.taskPostingId, postingSnapshotHash: item.postingSnapshotHash, greetingDraftRevision: item.greetingDraftRevision, finalGreeting: item.finalGreeting })),
      });
      const existing = await client.query("SELECT * FROM app_career_commands WHERE owner=$1 AND request_id=$2", [owner, input.requestId]);
      if (existing.rows[0]) {
        const command = z.object({ kind: z.string(), request_hash: z.string(), result_id: z.uuid().nullable(), revision: z.number().nullable() }).parse(existing.rows[0]);
        if (command.kind !== 'approve-batch' || command.request_hash !== digest) throw new CareerConflict('IDEMPOTENCY_CONFLICT', 'CONFLICT');
        const stored = await client.query("SELECT * FROM app_career_batches WHERE id=$1 AND owner=$2", [command.result_id, owner]);
        if (!stored.rows[0]) throw new CareerConflict('IDEMPOTENCY_CONFLICT', 'CONFLICT');
        return { batch: batchRowSchema.parse(stored.rows[0]), replay: true };
      }
      if (input.items.length === 0 || input.items.length > 10) throw new CareerConflict('BATCH_SIZE', 'BATCH_SIZE');
      const resolved = [];
      for (const item of input.items) {
        const posting = await client.query("SELECT * FROM app_career_task_postings WHERE id=$1 AND owner=$2 AND task_id=$3", [item.taskPostingId, owner, input.taskId]);
        if (!posting.rows[0]) throw new CareerNotFound('POSTING_NOT_FOUND');
        const postingRow = taskPostingRowSchema.parse(posting.rows[0]);
        if (postingRow.disposition !== 'eligible') throw new CareerConflict('NOT_ELIGIBLE', 'NOT_ELIGIBLE');
        if (postingRow.snapshot_hash !== item.postingSnapshotHash) throw new CareerConflict('POSTING_CHANGED', 'POSTING_CHANGED');
        if (postingRow.greeting_revision !== item.greetingDraftRevision) throw new CareerConflict('GREETING_CHANGED', 'GREETING_CHANGED');
        resolved.push({
          id: item.id, taskPostingId: postingRow.id, postingId: postingRow.posting_id, snapshotHash: postingRow.snapshot_hash,
          greeting: item.finalGreeting, greetingSha256: textSha256(item.finalGreeting), greetingRevision: postingRow.greeting_revision, position: item.position,
        });
      }
      const model = taskRow.model_source.connectionId
        ? { kind: 'connection' as const, connectionId: taskRow.model_source.connectionId, model: taskRow.model_source.label }
        : { kind: 'manual' as const, connectionId: null, model: '手动确认' as const };
      // The preparation row keeps the same `{connectionId,label}` snapshot as a manual preparation.
      const preparationModel = { connectionId: taskRow.model_source.connectionId, label: taskRow.model_source.label };
      const batch = await client.query(
        "INSERT INTO app_career_batches(id,owner,task_id,request_id,digest,task_revision,resume_version_id,resume_text_sha256,attachment_sha256,model,state,session_generation,account_marker)\n         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved',$11,$12) RETURNING *",
        [input.id, owner, input.taskId, input.requestId, digest, input.expectedTaskRevision, resumeRow.id, resumeRow.text_sha256, resumeRow.attachment_sha256, JSON.stringify(model), sessionGeneration, accountMarker],
      );
      for (const item of resolved) {
        await client.query(
          "INSERT INTO app_career_batch_items(id,owner,batch_id,task_posting_id,posting_id,snapshot_hash,greeting,greeting_sha256,greeting_revision,position)\n           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [item.id, owner, input.id, item.taskPostingId, item.postingId, item.snapshotHash, item.greeting, item.greetingSha256, item.greetingRevision, item.position],
        );
        await this.reserveApplication(client, { owner, postingId: item.postingId, taskId: input.taskId, batchId: input.id });
        await this.enqueueWorkIn(client, { id: crypto.randomUUID(), owner, kind: 'delivery', taskId: input.taskId, batchId: input.id, batchItemId: item.id, requestHash: `delivery:${item.id}` });
        if (taskRow.model_source.connectionId) {
        const preparation = await client.query(
          "INSERT INTO app_career_preparations(id,owner,task_id,task_posting_id,resume_version_id,resume_text_sha256,jd_snapshot_hash,status,model,generation)\n           VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8,0) ON CONFLICT(task_posting_id) DO UPDATE SET updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) RETURNING id,generation",
          [crypto.randomUUID(), owner, input.taskId, item.taskPostingId, resumeRow.id, resumeRow.text_sha256, item.snapshotHash, JSON.stringify(preparationModel)],
        );
        const preparationRow = z.object({ id: z.uuid(), generation: z.number() }).parse(preparation.rows[0]);
        await this.enqueueWorkIn(client, { id: crypto.randomUUID(), owner, kind: 'preparation', taskId: input.taskId, batchId: input.id, preparationId: preparationRow.id, requestHash: `preparation:${item.taskPostingId}:${preparationRow.generation}` });
        }
      }
      await client.query("INSERT INTO app_career_commands(owner,request_id,kind,request_hash,result_id,revision) VALUES($1,$2,$3,$4,$5,$6)", [owner, input.requestId, 'approve-batch', digest, input.id, input.expectedTaskRevision]);
      return { batch: batchRowSchema.parse(batch.rows[0]), replay: false };
    });
  }

  /** Cross-task posting reservation. The insert is the atomic gate, so two approvals that target
   *  the same posting cannot both own it; only a proven no-conversation failure may be reserved again.
   *  A confirmed conversation (even with a failed attachment) is already an external effect. */
  private async reserveApplication(client: PoolClient, input: { owner: string; postingId: string; taskId: string; batchId: string | null }) {
    const inserted = await client.query(
      "INSERT INTO app_career_applications(owner,site,posting_id,state,task_id,batch_id) VALUES($1,'boss',$2,'reserved',$3,$4)\n       ON CONFLICT(owner,site,posting_id) DO NOTHING RETURNING state",
      [input.owner, input.postingId, input.taskId, input.batchId],
    );
    if (inserted.rows[0]) return;
    const existing = await client.query("SELECT state FROM app_career_applications WHERE owner=$1 AND site='boss' AND posting_id=$2", [input.owner, input.postingId]);
    const state = existing.rows[0] ? z.object({ state: z.string() }).parse(existing.rows[0]).state : null;
    if (state !== 'conversation_failed') throw new CareerConflict('ALREADY_RESERVED', 'ALREADY_RESERVED');
    await client.query(
      "UPDATE app_career_applications SET state='reserved', task_id=$3, batch_id=$4, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE owner=$1 AND site='boss' AND posting_id=$2",
      [input.owner, input.postingId, input.taskId, input.batchId],
    );
  }

  async batch(owner: string, id: string) {
    const result = await this.pool.query(
      "SELECT b.*, v.label AS resume_label, f.original_name FROM app_career_batches b\n       JOIN app_resume_versions v ON v.id=b.resume_version_id JOIN app_resume_files f ON f.id=v.file_id WHERE b.id=$1 AND b.owner=$2",
      [id, owner],
    );
    return result.rows[0] ? batchRowSchema.parse(result.rows[0]) : null;
  }

  async batchesForTask(taskId: string) {
    const result = await this.pool.query("SELECT * FROM app_career_batches WHERE task_id=$1 ORDER BY approved_at DESC", [taskId]);
    return result.rows.map(row => batchRowSchema.parse(row));
  }

  async batchItems(owner: string, batchId: string) {
    const result = await this.pool.query(
      "SELECT bi.*, p.company, p.title, p.location, p.salary_raw,\n        (SELECT json_object('id', pr.id, 'status', pr.status, 'revision', pr.revision) FROM app_career_preparations pr WHERE pr.task_posting_id=bi.task_posting_id) AS preparation\n       FROM app_career_batch_items bi JOIN app_career_postings p ON p.id=bi.posting_id\n       WHERE bi.batch_id=$1 AND bi.owner=$2 ORDER BY bi.position, bi.id",
      [batchId, owner],
    );
    return result.rows.map(row => ({ ...batchItemRowSchema.parse(row), preparation: preparationSummary(row) }));
  }

  async batchItem(owner: string, batchId: string, itemId: string) {
    const result = await this.pool.query(
      "SELECT bi.*, p.company, p.title, p.location, p.salary_raw, p.url FROM app_career_batch_items bi JOIN app_career_postings p ON p.id=bi.posting_id\n       WHERE bi.id=$1 AND bi.batch_id=$2 AND bi.owner=$3",
      [itemId, batchId, owner],
    );
    return result.rows[0] ? { ...batchItemRowSchema.parse(result.rows[0]), preparation: preparationSummary(result.rows[0]) } : null;
  }

  async effects(batchItemId: string) {
    const result = await this.pool.query("SELECT * FROM app_career_effects WHERE batch_item_id=$1 ORDER BY attempt", [batchItemId]);
    return result.rows.map(row => z.object({ id: z.uuid(), phase: z.enum(['conversation', 'attachment']), attempt: z.number(), outcome: z.string(), evidence: z.unknown() }).parse(row));
  }

  async setBatchState(batchId: string, state: z.infer<typeof careerBatchStateSchema>, pauseReason: z.infer<typeof careerPauseReasonSchema> | null = null) {
    await this.pool.query("UPDATE app_career_batches SET state=$2, pause_reason=$3, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1", [batchId, state, pauseReason]);
  }

  /** The posting reservation is the cross-batch ownership gate of every external effect. A batch
   *  only acts while `app.career_applications.batch_id` still names it. */
  private async assertReservationOwned(client: PoolClient, input: { owner: string; postingId: string; batchId: string }) {
    const reservation = await client.query("SELECT batch_id FROM app_career_applications WHERE owner=$1 AND site='boss' AND posting_id=$2", [input.owner, input.postingId]);
    const reservedBy = reservation.rows[0] ? z.object({ batch_id: z.uuid().nullable() }).parse(reservation.rows[0]).batch_id : null;
    if (reservedBy !== input.batchId) throw new CareerConflict('RESERVATION_REPLACED', 'RESERVATION_REPLACED');
  }

  /** Pre-dispatch intent: the single admission point that prevents duplicate external effects. */
  async beginEffect(input: EffectIntent) {
    return this.tx(async client => {
      const batch = await client.query("SELECT state, pause_reason FROM app_career_batches WHERE id=$1 AND owner=$2", [input.batchId, input.owner]);
      const batchRow = batch.rows[0] ? z.object({ state: careerBatchStateSchema, pause_reason: careerPauseReasonSchema.nullable() }).parse(batch.rows[0]) : null;
      if (!batchRow) throw new CareerNotFound('BATCH_NOT_FOUND');
      if (batchRow.state === 'cancelled') throw new CareerConflict('BATCH_CANCELLED', 'BATCH_CANCELLED');
      if (batchRow.state === 'paused') throw new CareerConflict('BATCH_PAUSED', 'BATCH_PAUSED');
      const item = await client.query("SELECT * FROM app_career_batch_items WHERE id=$1 AND batch_id=$2 AND owner=$3", [input.itemId, input.batchId, input.owner]);
      const itemRow = item.rows[0] ? batchItemRowSchema.parse(item.rows[0]) : null;
      if (!itemRow) throw new CareerNotFound('ITEM_NOT_FOUND');
      if (itemRow.revision !== input.expectedRevision) throw new CareerConflict('ITEM_CHANGED', 'ITEM_CHANGED');
      await this.assertReservationOwned(client, { owner: input.owner, postingId: itemRow.posting_id, batchId: input.batchId });
      if (batchRow.state === 'approved') await client.query("UPDATE app_career_batches SET state='delivering', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1", [input.batchId]);
      const attempt = await client.query("SELECT COALESCE(max(attempt),0)+1 AS next FROM app_career_effects WHERE batch_item_id=$1 AND phase=$2", [input.itemId, input.phase]);
      const nextAttempt = z.object({ next: z.number() }).parse(attempt.rows[0]).next;
      await client.query(
        "INSERT INTO app_career_effects(id,owner,batch_item_id,phase,attempt,intent_at,outcome,evidence) VALUES($1,$2,$3,$4,$5,(strftime('%Y-%m-%dT%H:%M:%f000Z','now')),'dispatching',$6)",
        [crypto.randomUUID(), input.owner, input.itemId, input.phase, nextAttempt, JSON.stringify({ generation: input.batchGeneration })],
      );
      const column = input.phase === 'conversation' ? 'conversation_state' : 'attachment_state';
      await client.query(`UPDATE app_career_batch_items SET ${column}='dispatching', revision=revision+1, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1`, [input.itemId]);
      return { attempt: nextAttempt, generation: input.batchGeneration };
    });
  }

  /** Explicit retry of a proven-not-sent effect. The same transaction proves this batch still owns the
   *  posting reservation, so a batch that was replaced by a fresh approval can never re-arm itself.
   *  It also consumes the transferable `conversation_failed` state: the posting stays `reserved` to this
   *  batch while the retry is queued or running and only a new proven no-effect failure releases it. */
  async retryDeliveryItem(input: { owner: string; batchId: string; taskId: string; itemId: string; phase: 'conversation' | 'attachment'; expectedRevision: number }) {
    return this.tx(async client => {
      const item = await client.query("SELECT * FROM app_career_batch_items WHERE id=$1 AND batch_id=$2 AND owner=$3", [input.itemId, input.batchId, input.owner]);
      const itemRow = item.rows[0] ? batchItemRowSchema.parse(item.rows[0]) : null;
      if (!itemRow) throw new CareerNotFound('ITEM_NOT_FOUND');
      if (itemRow.revision !== input.expectedRevision) throw new CareerConflict('ITEM_CHANGED', 'ITEM_CHANGED');
      const state = input.phase === 'conversation' ? itemRow.conversation_state : itemRow.attachment_state;
      if (state !== 'failed') throw new CareerConflict('ITEM_NOT_FAILED', 'ITEM_NOT_FAILED');
      if (input.phase === 'attachment' && itemRow.conversation_state !== 'confirmed') throw new CareerConflict('CONVERSATION_NOT_CONFIRMED', 'CONVERSATION_NOT_CONFIRMED');
      await this.assertReservationOwned(client, { owner: input.owner, postingId: itemRow.posting_id, batchId: input.batchId });
      if (input.phase === 'conversation') {
        await client.query(
          "UPDATE app_career_applications SET state='reserved', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE owner=$1 AND site='boss' AND posting_id=$2 AND batch_id=$3",
          [input.owner, itemRow.posting_id, input.batchId],
        );
      }
      const column = input.phase === 'conversation' ? 'conversation_state' : 'attachment_state';
      const updated = await client.query(`UPDATE app_career_batch_items SET ${column}='not_started', revision=revision+1, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 RETURNING revision`, [input.itemId]);
      const revision = z.object({ revision: z.number() }).parse(updated.rows[0]).revision;
      const workId = crypto.randomUUID();
      await this.enqueueWorkIn(client, { id: workId, owner: input.owner, kind: 'delivery', taskId: input.taskId, batchId: input.batchId, batchItemId: input.itemId, requestHash: `delivery:${input.itemId}:${revision}` });
      return { workId };
    });
  }

  async recordEffect(input: { owner: string; batchId: string; itemId: string; phase: 'conversation' | 'attachment'; attempt: number; outcome: 'confirmed' | 'awaiting_consent' | 'failed' | 'unknown'; reason: string | null; evidence: unknown[]; expectedRevision: number }) {
    return this.tx(async client => {
      const effect = await client.query("SELECT 1 FROM app_career_effects WHERE batch_item_id=$1 AND phase=$2 AND attempt=$3 AND outcome='dispatching'", [input.itemId, input.phase, input.attempt]);
      if (!effect.rows[0]) throw new CareerConflict('EFFECT_NOT_OPEN', 'EFFECT_NOT_OPEN');
      await client.query("UPDATE app_career_effects SET outcome=$4, evidence=$5 WHERE batch_item_id=$1 AND phase=$2 AND attempt=$3", [input.itemId, input.phase, input.attempt, input.outcome, JSON.stringify(input.evidence)]);
      const column = input.phase === 'conversation' ? 'conversation_state' : 'attachment_state';
      const reasonColumn = input.phase === 'conversation' ? 'conversation_reason' : 'attachment_reason';
      const updated = await client.query(
        `UPDATE app_career_batch_items SET ${column}=$2, ${reasonColumn}=$3, revision=revision+1, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))
         WHERE id=$1 AND batch_id=$4 AND owner=$5 AND revision=$6 RETURNING revision`,
        [input.itemId, input.outcome, input.reason, input.batchId, input.owner, input.expectedRevision],
      );
      if (!updated.rows[0]) throw new CareerConflict('ITEM_CHANGED', 'ITEM_CHANGED');
      if (input.phase === 'conversation' && input.outcome === 'confirmed') {
        await client.query("UPDATE app_career_batch_items SET attachment_state='not_started', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND attachment_state='blocked_by_conversation'", [input.itemId]);
      }
      return z.object({ revision: z.number() }).parse(updated.rows[0]).revision;
    });
  }

  /** Read-only reconciliation may promote an unknown effect using durable site evidence. It never sends. */
  async promoteEffect(input: { owner: string; batchId: string; itemId: string; phase: 'conversation' | 'attachment'; outcome: 'confirmed' | 'failed'; reason: string | null; evidence: unknown[] }) {
    return this.tx(async client => {
      const latest = await client.query("SELECT attempt, outcome FROM app_career_effects WHERE batch_item_id=$1 AND phase=$2 ORDER BY attempt DESC LIMIT 1", [input.itemId, input.phase]);
      if (!latest.rows[0]) throw new CareerConflict('EFFECT_MISSING', 'EFFECT_MISSING');
      const effect = z.object({ attempt: z.number(), outcome: z.string() }).parse(latest.rows[0]);
      if (effect.outcome !== 'unknown') throw new CareerConflict('EFFECT_NOT_UNKNOWN', 'EFFECT_NOT_UNKNOWN');
      await client.query("UPDATE app_career_effects SET outcome=$3, evidence=$4 WHERE batch_item_id=$1 AND phase=$2 AND attempt=$5", [input.itemId, input.phase, input.outcome, JSON.stringify(input.evidence), effect.attempt]);
      const column = input.phase === 'conversation' ? 'conversation_state' : 'attachment_state';
      const reasonColumn = input.phase === 'conversation' ? 'conversation_reason' : 'attachment_reason';
      const item = await client.query(
        `UPDATE app_career_batch_items SET ${column}=$2, ${reasonColumn}=$3, revision=revision+1, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND batch_id=$4 AND owner=$5 RETURNING revision`,
        [input.itemId, input.outcome, input.reason, input.batchId, input.owner],
      );
      if (!item.rows[0]) throw new CareerConflict('ITEM_CHANGED', 'ITEM_CHANGED');
      if (input.phase === 'conversation' && input.outcome === 'confirmed') {
        await client.query("UPDATE app_career_batch_items SET attachment_state='not_started', updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND attachment_state='blocked_by_conversation'", [input.itemId]);
      }
      return z.object({ revision: z.number() }).parse(item.rows[0]).revision;
    });
  }

  async setApplicationState(owner: string, postingId: string, state: 'conversation_confirmed' | 'awaiting_consent' | 'attachment_confirmed' | 'conversation_failed' | 'attachment_failed' | 'unknown') {
    await this.pool.query(
      "UPDATE app_career_applications SET state=$3, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE owner=$1 AND site='boss' AND posting_id=$2",
      [owner, postingId, state],
    );
  }

  async setItemStates(owner: string, itemId: string, states: { conversation?: string; attachment?: string }) {
    await this.pool.query(
      "UPDATE app_career_batch_items SET conversation_state=COALESCE($3,conversation_state), attachment_state=COALESCE($4,attachment_state), revision=revision+1, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))\n       WHERE id=$1 AND owner=$2",
      [itemId, owner, states.conversation ?? null, states.attachment ?? null],
    );
  }

  // ---------- preparations ----------
  async preparationsForTask(taskId: string) {
    const result = await this.pool.query("SELECT * FROM app_career_preparations WHERE task_id=$1 ORDER BY created_at", [taskId]);
    return result.rows.map(row => preparationRowSchema.parse(row));
  }

  async preparation(owner: string, id: string) {
    const result = await this.pool.query("SELECT * FROM app_career_preparations WHERE id=$1 AND owner=$2", [id, owner]);
    return result.rows[0] ? preparationRowSchema.parse(result.rows[0]) : null;
  }

  async preparationForPosting(taskPostingId: string) {
    const result = await this.pool.query("SELECT * FROM app_career_preparations WHERE task_posting_id=$1", [taskPostingId]);
    return result.rows[0] ? preparationRowSchema.parse(result.rows[0]) : null;
  }

  async ensurePreparation(owner: string, input: { id: string; taskId: string; taskPostingId: string; resumeVersionId: string; resumeTextSha256: string; jdSnapshotHash: string; model: { connectionId: string; label: string } }) {
    return this.tx(async client => {
      await client.query(
        "INSERT INTO app_career_preparations(id,owner,task_id,task_posting_id,resume_version_id,resume_text_sha256,jd_snapshot_hash,status,model,generation)\n         VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8,0) ON CONFLICT(task_posting_id) DO NOTHING",
        [input.id, owner, input.taskId, input.taskPostingId, input.resumeVersionId, input.resumeTextSha256, input.jdSnapshotHash, JSON.stringify(input.model)],
      );
      const row = await client.query("SELECT * FROM app_career_preparations WHERE task_posting_id=$1", [input.taskPostingId]);
      const preparation = preparationRowSchema.parse(row.rows[0]);
      await this.enqueueWorkIn(client, { id: crypto.randomUUID(), owner, kind: 'preparation', taskId: input.taskId, preparationId: preparation.id, requestHash: `preparation:${input.taskPostingId}:${preparation.generation}` });
      return preparation;
    });
  }

  async setPreparationStatus(id: string, status: PreparationRow['status'], failure: string | null = null) {
    await this.pool.query("UPDATE app_career_preparations SET status=$2, failure=$3, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1", [id, status, failure]);
  }

  async savePreparation(id: string, generation: number, original: unknown, edited: unknown) {
    // A late generation never commits onto a deleted preparation or a cancelled task.
    const result = await this.pool.query(
      "UPDATE app_career_preparations AS p SET status='ready', original=$3, edited=$4, revision=p.revision+1, failure=NULL, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))\n       FROM app_career_tasks t WHERE p.id=$1 AND p.generation=$2 AND p.status='generating' AND t.id=p.task_id AND t.status<>'cancelled' RETURNING revision",
      [id, generation, JSON.stringify(original), JSON.stringify(edited)],
    );
    if (!result.rows[0]) throw new CareerConflict('PREPARATION_CHANGED', 'PREPARATION_CHANGED');
  }

  async updatePreparationEdits(owner: string, id: string, expectedRevision: number, edited: unknown) {
    const result = await this.pool.query(
      "UPDATE app_career_preparations SET edited=$4, revision=revision+1, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND owner=$2 AND revision=$3 RETURNING revision",
      [id, owner, expectedRevision, JSON.stringify(edited)],
    );
    if (!result.rows[0]) throw new CareerConflict('PREPARATION_CHANGED', 'PREPARATION_CHANGED');
    return z.object({ revision: z.number() }).parse(result.rows[0]).revision;
  }

  async retryPreparation(owner: string, id: string, model?: { connectionId: string; label: string }) {
    return this.tx(async client => {
      const existing = await client.query("SELECT * FROM app_career_preparations WHERE id=$1 AND owner=$2", [id, owner]);
      if (!existing.rows[0]) throw new CareerNotFound('PREPARATION_NOT_FOUND');
      const preparation = preparationRowSchema.parse(existing.rows[0]);
      if (preparation.status !== 'failed') throw new CareerConflict('PREPARATION_NOT_FAILED', 'PREPARATION_NOT_FAILED');
      const updated = await client.query(
        "UPDATE app_career_preparations SET status='queued', generation=generation+1, failure=NULL, model=COALESCE($3,model), updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND owner=$2 RETURNING *",
        [id, owner, model ? JSON.stringify(model) : null],
      );
      const next = preparationRowSchema.parse(updated.rows[0]);
      await this.enqueueWorkIn(client, { id: crypto.randomUUID(), owner, kind: 'preparation', taskId: next.task_id, preparationId: next.id, requestHash: `preparation:${next.task_posting_id}:${next.generation}` });
      return next;
    });
  }

  // ---------- work queue ----------
  private async enqueueWorkIn(client: Pick<PoolClient, 'query'>, input: { id: string; owner: string; kind: WorkRow['kind']; taskId?: string | null; batchId?: string | null; batchItemId?: string | null; preparationId?: string | null; requestHash: string; payload?: Record<string, unknown> }) {
    await client.query(
      "INSERT INTO app_career_work(id,owner,kind,task_id,batch_id,batch_item_id,preparation_id,request_hash,payload,status)\n       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued') ON CONFLICT(kind,request_hash) DO NOTHING",
      [input.id, input.owner, input.kind, input.taskId ?? null, input.batchId ?? null, input.batchItemId ?? null, input.preparationId ?? null, input.requestHash, JSON.stringify(input.payload ?? {})],
    );
  }

  async enqueueWork(input: { id: string; owner: string; kind: WorkRow['kind']; taskId?: string | null; batchId?: string | null; batchItemId?: string | null; preparationId?: string | null; requestHash: string; payload?: Record<string, unknown> }) {
    await this.enqueueWorkIn(this.pool, input);
  }

  async claimWork(kinds: WorkRow['kind'][], leaseSeconds = 120, mode: BossAutomationMode = 'enabled') {
    const result = await this.pool.query(
      "UPDATE app_career_work SET status='processing', attempts=attempts+1, lease_generation=lease_generation+1,\n         lease_until=strftime('%Y-%m-%dT%H:%M:%f000Z','now',$2 || ' seconds'), updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now'))\n       WHERE id=(SELECT id FROM app_career_work WHERE ((status='queued' AND (lease_until IS NULL OR lease_until<=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')))) OR (status='processing' AND lease_until<(strftime('%Y-%m-%dT%H:%M:%f000Z','now')))) AND kind IN (SELECT value FROM json_each($1)) AND ($3='enabled' OR kind IN ('preparation','purge') OR (kind='scan' AND $3 IN ('search','contact')) OR (kind='delivery' AND $3='contact' AND payload->>'action'='site_preset') OR (kind='session' AND (payload->>'action'='clear' OR ($3 IN ('manual','search','contact') AND payload->>'action' IN ('open','check')))))\n         ORDER BY created_at LIMIT 1) RETURNING *",
      [kinds, String(leaseSeconds), mode],
    );
    return result.rows[0] ? workRowSchema.parse(result.rows[0]) : null;
  }

  async finishWork(id: string, leaseGeneration: number, status: 'completed' | 'failed' | 'cancelled', failure: string | null = null) {
    const result = await this.pool.query(
      "UPDATE app_career_work SET status=$3, failure=$4, lease_until=NULL, updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND lease_generation=$2 AND status='processing' RETURNING id",
      [id, leaseGeneration, status, failure],
    );
    return Boolean(result.rows[0]);
  }

  /** Returns owned work to the queue. A positive delay keeps a failing cleanup from starving the
   *  rest of the queue; claimWork skips queued rows until their lease time passes. */
  async holdWork(id: string, leaseGeneration: number, failure: string, retryDelaySeconds = 0) {
    const result = await this.pool.query(
      "UPDATE app_career_work SET status='queued', failure=$3, lease_until=strftime('%Y-%m-%dT%H:%M:%f000Z','now',$4 || ' seconds'), updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND lease_generation=$2 AND status='processing' RETURNING id",
      [id, leaseGeneration, failure, String(retryDelaySeconds)],
    );
    return Boolean(result.rows[0]);
  }

  /** Extends an owned lease for a long browser operation. False means another actor took the work. */
  async renewLease(id: string, leaseGeneration: number, leaseSeconds: number) {
    const result = await this.pool.query(
      "UPDATE app_career_work SET lease_until=strftime('%Y-%m-%dT%H:%M:%f000Z','now',$3 || ' seconds'), updated_at=(strftime('%Y-%m-%dT%H:%M:%f000Z','now')) WHERE id=$1 AND lease_generation=$2 AND status='processing' RETURNING id",
      [id, leaseGeneration, String(leaseSeconds)],
    );
    return Boolean(result.rows[0]);
  }

  async workStillOwned(id: string, leaseGeneration: number) {
    const result = await this.pool.query("SELECT 1 FROM app_career_work WHERE id=$1 AND lease_generation=$2 AND status='processing'", [id, leaseGeneration]);
    return Boolean(result.rows[0]);
  }

  async work(id: string) {
    const result = await this.pool.query("SELECT * FROM app_career_work WHERE id=$1", [id]);
    return result.rows[0] ? workRowSchema.parse(result.rows[0]) : null;
  }

  async queuedDeliveryWork(batchId: string) {
    const result = await this.pool.query("SELECT * FROM app_career_work WHERE batch_id=$1 AND kind='delivery' AND status IN ('queued','processing') ORDER BY created_at", [batchId]);
    return result.rows.map(row => workRowSchema.parse(row));
  }
}

function preparationSummary(raw: unknown) {
  const value = z.object({ preparation: z.object({ id: z.uuid(), status: z.enum(['queued', 'generating', 'ready', 'failed', 'cancelled']), revision: z.number() }).nullable() }).safeParse(raw);
  return value.success ? value.data.preparation : null;
}
