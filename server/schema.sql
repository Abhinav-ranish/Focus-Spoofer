-- Focus Spoofer feedback/usage backend (Cloudflare D1).
-- Apply with: npx wrangler d1 execute focus-spoofer --remote --file=schema.sql
--
-- Privacy notes: no table stores an IP address, user agent, URL, domain, or any
-- per-install identifier. Usage reports are folded into aggregate counters on
-- arrival; the individual report is never stored.

CREATE TABLE IF NOT EXISTS uninstall_feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day         TEXT NOT NULL,              -- UTC date the response arrived (YYYY-MM-DD)
  reason      TEXT NOT NULL,              -- one of the fixed reason codes
  site        TEXT,                       -- optional "which website?" answer, host only, <= 200 chars
  details     TEXT,                       -- optional free text, <= 1000 chars
  version     TEXT                        -- extension version from the uninstall URL
);
CREATE INDEX IF NOT EXISTS idx_feedback_day ON uninstall_feedback(day);

-- One row per (activity day, extension version). `reports` counts opted-in
-- installs that sent a report for that day (each install sends at most one per
-- day, enforced client-side).
CREATE TABLE IF NOT EXISTS usage_daily (
  day               TEXT NOT NULL,
  version           TEXT NOT NULL,
  reports           INTEGER NOT NULL DEFAULT 0,
  active_reports    INTEGER NOT NULL DEFAULT 0, -- reports with >= 1 activation that day
  activations       INTEGER NOT NULL DEFAULT 0,
  deactivations     INTEGER NOT NULL DEFAULT 0,
  always_on_added   INTEGER NOT NULL DEFAULT 0,
  always_on_removed INTEGER NOT NULL DEFAULT 0,
  first_activations INTEGER NOT NULL DEFAULT 0, -- installs whose first-ever activation was that day
  always_on_reports INTEGER NOT NULL DEFAULT 0, -- reports from installs with >= 1 Always-On site
  PRIMARY KEY (day, version)
);

-- One row per (ISO week, version): opted-in installs reporting at least once
-- that week (client flags only its first report of each ISO week).
CREATE TABLE IF NOT EXISTS usage_weekly (
  week     TEXT NOT NULL,   -- e.g. 2026-W41
  version  TEXT NOT NULL,
  reports  INTEGER NOT NULL DEFAULT 0,
  active_reports INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (week, version)
);

CREATE TABLE IF NOT EXISTS errors_daily (
  day      TEXT NOT NULL,
  version  TEXT NOT NULL,
  category TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, version, category)
);
