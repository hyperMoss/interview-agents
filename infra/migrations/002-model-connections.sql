CREATE TABLE IF NOT EXISTS agent_runtime.model_connections (
 id uuid PRIMARY KEY, owner uuid NOT NULL, base_url text NOT NULL, model text NOT NULL,
 encrypted_key text NOT NULL, has_key boolean NOT NULL, timeout_ms integer NOT NULL,
 remember boolean NOT NULL, expires_at timestamptz NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS model_active_owner ON agent_runtime.model_connections(owner) WHERE active=true;
