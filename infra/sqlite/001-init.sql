

CREATE TABLE IF NOT EXISTS app_resume_drafts (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, label TEXT NOT NULL,
 document_json TEXT NOT NULL CHECK(json_valid(document_json)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now'))
);
CREATE INDEX IF NOT EXISTS resume_drafts_owner ON app_resume_drafts(owner, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS app_interviews (
 id text PRIMARY KEY, owner text NOT NULL, state text NOT NULL, created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now'))
);
CREATE INDEX IF NOT EXISTS interviews_owner_created ON app_interviews(owner, created_at DESC);
CREATE TABLE IF NOT EXISTS app_jobs (
 id text PRIMARY KEY, session_id text NOT NULL REFERENCES app_interviews(id) ON DELETE CASCADE,
 owner text NOT NULL, revision integer NOT NULL, payload text NOT NULL,
 status text NOT NULL CHECK (status IN ('pending','processing','completed','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0, lease_until text, request_hash text NOT NULL,
 created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now'))
);
CREATE INDEX IF NOT EXISTS jobs_pending ON app_jobs(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active ON app_jobs(session_id) WHERE status IN ('pending','processing');
CREATE TABLE IF NOT EXISTS app_deletions (job_id text PRIMARY KEY, created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')));
CREATE TABLE IF NOT EXISTS agent_runtime_deleted_jobs (job_id text PRIMARY KEY, created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')));
CREATE TABLE IF NOT EXISTS agent_runtime_receipts (
 job_id text PRIMARY KEY, input_hash text NOT NULL, response text NOT NULL, created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now'))
);

CREATE TABLE IF NOT EXISTS agent_runtime_model_connections (
 id text PRIMARY KEY, owner text NOT NULL, base_url text NOT NULL, model text NOT NULL,
 encrypted_key text NOT NULL, has_key integer NOT NULL, timeout_ms integer NOT NULL,
 remember integer NOT NULL, expires_at text NOT NULL, active integer NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS model_active_owner ON agent_runtime_model_connections(owner) WHERE active=true;

CREATE TABLE IF NOT EXISTS app_bank_questions (
 id text PRIMARY KEY, owner text, source text NOT NULL CHECK(source IN ('builtin','custom','leetcode')),
 source_key text, source_url text, payload text NOT NULL, revision integer NOT NULL DEFAULT 0,
 created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS bank_question_import_unique ON app_bank_questions(owner,source_key) WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS bank_questions_owner ON app_bank_questions(owner,created_at);
CREATE TABLE IF NOT EXISTS app_interview_materials (
 session_id text PRIMARY KEY REFERENCES app_interviews(id) ON DELETE CASCADE,
 questions text NOT NULL
);
CREATE TABLE IF NOT EXISTS app_interview_commands (
 request_id text PRIMARY KEY, session_id text NOT NULL REFERENCES app_interviews(id) ON DELETE CASCADE,
 owner text NOT NULL, request_hash text NOT NULL, accepted_revision integer NOT NULL,
 created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now'))
);
CREATE TABLE IF NOT EXISTS agent_runtime_search_connections (
 id text PRIMARY KEY, owner text NOT NULL, provider text NOT NULL, base_url text NOT NULL,
 encrypted_key text NOT NULL, expires_at text NOT NULL, remember integer NOT NULL,
 active integer NOT NULL DEFAULT true, created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS search_connection_active_owner ON agent_runtime_search_connections(owner) WHERE active=true;

-- Candidate-side local BOSS career workflow (REQ-025..034).
-- Employer recruiting tables are intentionally absent. app_jobs stays interview-only.

CREATE TABLE IF NOT EXISTS app_resume_files (
  id text PRIMARY KEY,
  owner text NOT NULL,
  storage_key text NOT NULL,
  original_name text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  sha256 text NOT NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  UNIQUE (owner, storage_key)
);
CREATE INDEX IF NOT EXISTS resume_files_owner ON app_resume_files(owner, created_at DESC);

CREATE TABLE IF NOT EXISTS app_resume_uploads (
  id text PRIMARY KEY,
  owner text NOT NULL,
  filename text NOT NULL,
  extracted_text text NOT NULL,
  warnings text NOT NULL,
  storage_key text NOT NULL,
  sha256 text NOT NULL,
  byte_size integer NOT NULL,
  content_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('staged','saved','expired')),
  expires_at text NOT NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now'))
);
CREATE INDEX IF NOT EXISTS resume_uploads_owner ON app_resume_uploads(owner, created_at DESC);

CREATE TABLE IF NOT EXISTS app_resume_versions (
  id text PRIMARY KEY,
  owner text NOT NULL,
  file_id text NOT NULL REFERENCES app_resume_files(id) ON DELETE RESTRICT,
  label text NOT NULL,
  text text NOT NULL,
  text_sha256 text NOT NULL,
  attachment_sha256 text NOT NULL,
  warnings text NOT NULL DEFAULT '[]',
  revision integer NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now'))
);
CREATE INDEX IF NOT EXISTS resume_versions_owner ON app_resume_versions(owner, created_at DESC);

CREATE TABLE IF NOT EXISTS app_career_browser_sessions (
  owner text NOT NULL,
  site text NOT NULL CHECK (site = 'boss'),
  state text NOT NULL,
  engine text NOT NULL CHECK (engine IN ('patchright','moli','playwright')),
  profile_generation integer NOT NULL DEFAULT 0,
  account_marker text,
  reason text,
  active_task_id text,
  browser_pid integer,
  browser_started_at text,
  human_window text NOT NULL DEFAULT 'none' CHECK (human_window IN ('none','open')),
  limitation text,
  observed_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  PRIMARY KEY (owner, site)
);

CREATE TABLE IF NOT EXISTS app_career_tasks (
  id text PRIMARY KEY,
  owner text NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  resume_version_id text REFERENCES app_resume_versions(id) ON DELETE RESTRICT,
  resume_text_sha256 text,
  attachment_sha256 text,
  policy text NOT NULL,
  model_source text,
  phase text NOT NULL CHECK (phase IN ('queued','searching','matching','review')),
  status text NOT NULL CHECK (status IN ('active','paused','failed','cancelled')),
  pause_reason text,
  pause_detail text,
  error text,
  read_count integer NOT NULL DEFAULT 0,
  page_failure_count integer NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  CHECK ((resume_version_id IS NULL AND resume_text_sha256 IS NULL AND attachment_sha256 IS NULL AND model_source IS NULL) OR (resume_version_id IS NOT NULL AND resume_text_sha256 IS NOT NULL AND attachment_sha256 IS NOT NULL AND model_source IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS career_tasks_owner ON app_career_tasks(owner, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS app_career_postings (
  id text PRIMARY KEY,
  owner text NOT NULL,
  site text NOT NULL CHECK (site = 'boss'),
  site_posting_id text NOT NULL,
  url text NOT NULL,
  title text NOT NULL,
  company text NOT NULL,
  location text NOT NULL,
  salary_raw text NOT NULL,
  first_seen_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  UNIQUE (owner, site, site_posting_id)
);

CREATE TABLE IF NOT EXISTS app_career_applications (
  owner text NOT NULL,
  site text NOT NULL CHECK (site = 'boss'),
  posting_id text NOT NULL REFERENCES app_career_postings(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('reserved','conversation_confirmed','awaiting_consent','attachment_confirmed','conversation_failed','attachment_failed','unknown')),
  task_id text,
  batch_id text,
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  PRIMARY KEY (owner, site, posting_id)
);

CREATE TABLE IF NOT EXISTS app_career_task_postings (
  id text PRIMARY KEY,
  owner text NOT NULL,
  task_id text NOT NULL REFERENCES app_career_tasks(id) ON DELETE CASCADE,
  posting_id text NOT NULL REFERENCES app_career_postings(id) ON DELETE CASCADE,
  observed text NOT NULL,
  snapshot_hash text NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('eligible','excluded','needs_review')),
  decision text NOT NULL,
  match text,
  greeting text,
  greeting_revision integer NOT NULL DEFAULT 0,
  owner_review text,
  revision integer NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  UNIQUE (task_id, posting_id)
);
CREATE INDEX IF NOT EXISTS career_task_postings_task ON app_career_task_postings(task_id, disposition);

CREATE TABLE IF NOT EXISTS app_career_batches (
  id text PRIMARY KEY,
  owner text NOT NULL,
  task_id text NOT NULL REFERENCES app_career_tasks(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  digest text NOT NULL,
  task_revision integer NOT NULL,
  resume_version_id text NOT NULL,
  resume_text_sha256 text NOT NULL,
  attachment_sha256 text NOT NULL,
  model text NOT NULL,
  session_generation integer NOT NULL DEFAULT 0,
  account_marker text,
  state text NOT NULL CHECK (state IN ('approved','delivering','paused','completed','completed_with_review','cancelled')),
  pause_reason text,
  approved_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  UNIQUE (owner, request_id)
);
CREATE INDEX IF NOT EXISTS career_batches_task ON app_career_batches(task_id, approved_at DESC);

CREATE TABLE IF NOT EXISTS app_career_batch_items (
  id text PRIMARY KEY,
  owner text NOT NULL,
  batch_id text NOT NULL REFERENCES app_career_batches(id) ON DELETE CASCADE,
  task_posting_id text NOT NULL,
  posting_id text NOT NULL,
  snapshot_hash text NOT NULL,
  greeting text NOT NULL,
  greeting_sha256 text NOT NULL,
  greeting_revision integer NOT NULL,
  position integer NOT NULL DEFAULT 0,
  conversation_state text NOT NULL DEFAULT 'not_started',
  attachment_state text NOT NULL DEFAULT 'blocked_by_conversation',
  conversation_reason text,
  attachment_reason text,
  revision integer NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  UNIQUE (batch_id, task_posting_id)
);

CREATE TABLE IF NOT EXISTS app_career_effects (
  id text PRIMARY KEY,
  owner text NOT NULL,
  batch_item_id text NOT NULL REFERENCES app_career_batch_items(id) ON DELETE CASCADE,
  phase text NOT NULL CHECK (phase IN ('conversation','attachment')),
  attempt integer NOT NULL,
  intent_at text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('dispatching','confirmed','awaiting_consent','failed','unknown','pause_session')),
  evidence text NOT NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  UNIQUE (batch_item_id, phase, attempt)
);
CREATE UNIQUE INDEX IF NOT EXISTS career_effects_open ON app_career_effects(batch_item_id, phase) WHERE outcome = 'dispatching';

CREATE TABLE IF NOT EXISTS app_career_preparations (
  id text PRIMARY KEY,
  owner text NOT NULL,
  task_id text NOT NULL REFERENCES app_career_tasks(id) ON DELETE CASCADE,
  task_posting_id text NOT NULL,
  resume_version_id text NOT NULL,
  resume_text_sha256 text NOT NULL,
  jd_snapshot_hash text NOT NULL,
  generation integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('queued','generating','ready','failed','cancelled')),
  original text,
  edited text,
  model text NOT NULL,
  failure text,
  revision integer NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  UNIQUE (task_posting_id)
);

CREATE TABLE IF NOT EXISTS app_career_work (
  id text PRIMARY KEY,
  owner text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('scan','delivery','preparation','purge','session')),
  task_id text,
  batch_id text,
  batch_item_id text,
  preparation_id text,
  request_hash text NOT NULL,
  payload text NOT NULL DEFAULT '{}',
  generation integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  lease_until text,
  lease_generation integer NOT NULL DEFAULT 0,
  failure text,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS career_work_request ON app_career_work(kind, request_hash);
CREATE INDEX IF NOT EXISTS career_work_pending ON app_career_work(status, created_at);

CREATE TABLE IF NOT EXISTS app_career_commands (
  owner text NOT NULL,
  request_id text NOT NULL,
  kind text NOT NULL,
  request_hash text NOT NULL,
  result_id text,
  revision integer,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  PRIMARY KEY (owner, request_id)
);

CREATE TABLE IF NOT EXISTS agent_runtime_career_receipts (
  work_id text PRIMARY KEY,
  input_hash text NOT NULL,
  response text NOT NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now'))
);
CREATE TABLE IF NOT EXISTS agent_runtime_deleted_career_work (
  work_id text PRIMARY KEY,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now'))
);


CREATE TABLE IF NOT EXISTS app_career_contacts (
 id text PRIMARY KEY,owner text NOT NULL,approval_id text NOT NULL,
 task_id text NOT NULL REFERENCES app_career_tasks(id) ON DELETE CASCADE,
 task_posting_id text NOT NULL REFERENCES app_career_task_postings(id) ON DELETE CASCADE,
 posting_id text NOT NULL REFERENCES app_career_postings(id) ON DELETE CASCADE,
 snapshot_hash text NOT NULL,posting_snapshot text NOT NULL,position integer NOT NULL,
 session_generation integer NOT NULL,account_marker text,
 state text NOT NULL CHECK(state IN ('queued','dispatching','confirmed','already_contacted','failed','unknown','cancelled')),
 reason text,evidence text NOT NULL DEFAULT '[]',
 created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
 updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
 UNIQUE(owner,posting_id),UNIQUE(approval_id,position)
);
CREATE INDEX IF NOT EXISTS career_contacts_owner_task ON app_career_contacts(owner,task_id,created_at);
