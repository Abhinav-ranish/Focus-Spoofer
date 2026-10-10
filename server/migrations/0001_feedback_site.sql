-- Adds the "which website?" answer to existing databases (schema.sql already
-- has it for new ones). Apply once:
--   npx wrangler d1 execute focus-spoofer --remote --file=migrations/0001_feedback_site.sql
ALTER TABLE uninstall_feedback ADD COLUMN site TEXT;
