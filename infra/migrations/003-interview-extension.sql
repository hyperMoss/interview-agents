CREATE TABLE IF NOT EXISTS app.bank_questions (
 id uuid PRIMARY KEY, owner text, source text NOT NULL CHECK(source IN ('builtin','custom','leetcode')),
 source_key text, source_url text, payload jsonb NOT NULL, revision integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bank_question_import_unique ON app.bank_questions(owner,source_key) WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS bank_questions_owner ON app.bank_questions(owner,created_at);
CREATE TABLE IF NOT EXISTS app.interview_materials (
 session_id uuid PRIMARY KEY REFERENCES app.interviews(id) ON DELETE CASCADE,
 questions jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS app.interview_commands (
 request_id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES app.interviews(id) ON DELETE CASCADE,
 owner text NOT NULL, request_hash text NOT NULL, accepted_revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_runtime.search_connections (
 id uuid PRIMARY KEY, owner uuid NOT NULL, provider text NOT NULL, base_url text NOT NULL,
 encrypted_key text NOT NULL, expires_at timestamptz NOT NULL, remember boolean NOT NULL,
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS search_connection_active_owner ON agent_runtime.search_connections(owner) WHERE active=true;
