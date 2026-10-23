-- A hidden campaign keeps all its prospects, conversations, meetings and audit history.
-- Never hard-delete a campaign or rely on foreign-key cascading to remove data.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
