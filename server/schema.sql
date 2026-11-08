-- Focus Spoofer feedback/usage backend (Cloudflare D1).
-- Apply with: npx wrangler d1 execute focus-spoofer --remote --file=schema.sql
--
-- Privacy notes: no extension table stores an IP address, user agent, URL,
-- domain, or any per-install identifier (link_clicks, at the end, is the
-- website short-link log and is the exception). Usage reports are folded into aggregate counters on
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

-- Visits to the tracked short link https://focus.oddworks.us/opensource (a
-- website link, unrelated to the extension). Unlike the tables above this one
-- does store the visitor's IP, Cloudflare geo lookup, User-Agent and Referer;
-- rows older than 180 days are deleted on the next visit.
CREATE TABLE IF NOT EXISTS link_clicks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,              -- ISO timestamp (UTC)
  day         TEXT NOT NULL,              -- UTC date (YYYY-MM-DD)
  link        TEXT NOT NULL,              -- which short link ('opensource')
  ip          TEXT,
  country     TEXT,                       -- ISO 3166-1 alpha-2
  region      TEXT,
  city        TEXT,
  timezone    TEXT,
  asn         TEXT,
  as_org      TEXT,                       -- ISP / network owner
  colo        TEXT,                       -- Cloudflare data center
  browser     TEXT,
  os          TEXT,
  device      TEXT,                       -- desktop | mobile | tablet | bot
  user_agent  TEXT,                       -- <= 400 chars
  referer     TEXT,                       -- <= 500 chars
  source      TEXT NOT NULL,              -- ?ref= tag, referrer site, in-app browser, or 'direct'
  is_bot      INTEGER NOT NULL DEFAULT 0  -- crawlers and link-preview fetchers
);
CREATE INDEX IF NOT EXISTS idx_clicks_day ON link_clicks(day);
