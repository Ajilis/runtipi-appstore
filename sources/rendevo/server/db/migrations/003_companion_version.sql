-- Version reported by the installed browser extension. Legacy devices remain valid,
-- with a NULL version until a V21+ Companion checks in.
ALTER TABLE companion_devices ADD COLUMN IF NOT EXISTS extension_version text;
