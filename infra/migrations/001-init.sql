CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS agent_runtime;
CREATE TABLE IF NOT EXISTS app.interviews (
 id uuid PRIMARY KEY, owner text NOT NULL, state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interviews_owner_created ON app.interviews(owner, created_at DESC);
CREATE TABLE IF NOT EXISTS app.jobs (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES app.interviews(id) ON DELETE CASCADE,
 owner text NOT NULL, revision integer NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL CHECK (status IN ('pending','processing','completed','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_pending ON app.jobs(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active ON app.jobs(session_id) WHERE status IN ('pending','processing');
CREATE TABLE IF NOT EXISTS app.deletions (job_id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agent_runtime.deleted_jobs (job_id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agent_runtime.receipts (
 job_id uuid PRIMARY KEY, input_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
