-- Rendevo initial schema
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent_enabled boolean NOT NULL DEFAULT false,
  calendar_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  booking_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id)
);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  provider text NOT NULL,
  account_type text NOT NULL DEFAULT 'free',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  status_detail text,
  next_action_at timestamptz,
  last_sync_at timestamptz,
  sync_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  goal text NOT NULL DEFAULT 'meeting',
  offer text NOT NULL DEFAULT '',
  icp jsonb NOT NULL DEFAULT '{}'::jsonb,
  sequence jsonb NOT NULL DEFAULT '[]'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  headline text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  industry text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  linkedin_url text,
  provider_id text,
  email text,
  phone text,
  language text,
  source text NOT NULL DEFAULT 'manual',
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  fit_score integer,
  heat text NOT NULL DEFAULT 'cold',
  fit_reasoning text,
  status text NOT NULL DEFAULT 'new',
  stage text NOT NULL DEFAULT 'nouveau',
  tags text[] NOT NULL DEFAULT '{}',
  step_index integer NOT NULL DEFAULT 0,
  next_action_at timestamptz,
  invited_at timestamptz,
  connected_at timestamptz,
  last_contact_at timestamptz,
  last_reply_at timestamptz,
  callback_at timestamptz,
  callback_note text,
  chat_id text,
  needs_human boolean NOT NULL DEFAULT false,
  human_reason text,
  setter_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX prospects_ws_url ON prospects (workspace_id, lower(linkedin_url)) WHERE linkedin_url IS NOT NULL;
CREATE INDEX prospects_ws_status ON prospects (workspace_id, status);
CREATE INDEX prospects_next_action ON prospects (next_action_at) WHERE next_action_at IS NOT NULL;
CREATE INDEX prospects_campaign ON prospects (campaign_id);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  direction text NOT NULL,
  kind text NOT NULL,
  body text NOT NULL DEFAULT '',
  status text NOT NULL,
  scheduled_at timestamptz,
  sent_at timestamptz,
  error text,
  provider_message_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_queue ON messages (status, scheduled_at) WHERE status IN ('queued', 'pending_approval');
CREATE INDEX messages_prospect ON messages (prospect_id, created_at);
CREATE INDEX messages_ws ON messages (workspace_id, created_at);

CREATE TABLE meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  prospect_id uuid REFERENCES prospects(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  meeting_url text,
  notes text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'setter',
  token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meetings_ws_time ON meetings (workspace_id, starts_at);

CREATE TABLE usage (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day date NOT NULL,
  invites integer NOT NULL DEFAULT 0,
  messages integer NOT NULL DEFAULT 0,
  views integer NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, day)
);

CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'video',
  title text NOT NULL,
  filename text NOT NULL,
  stored_name text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL DEFAULT 0,
  share_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',
  secret text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  active boolean NOT NULL DEFAULT true,
  last_status integer,
  last_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  prospect_id uuid REFERENCES prospects(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_ws_time ON events (workspace_id, created_at DESC);
CREATE INDEX events_ws_type ON events (workspace_id, type, created_at);
