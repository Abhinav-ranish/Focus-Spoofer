-- Adds survey page-view counts to existing databases (schema.sql already has
-- the table for new ones). Apply once:
--   npx wrangler d1 execute focus-spoofer --remote --file=migrations/0002_uninstall_visits.sql
CREATE TABLE IF NOT EXISTS uninstall_visits (
  day      TEXT NOT NULL,
  version  TEXT NOT NULL,
  visits   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, version)
);
