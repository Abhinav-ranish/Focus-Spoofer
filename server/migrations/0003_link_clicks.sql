-- Adds the /opensource short-link log to existing databases (schema.sql has it
-- for new ones). Apply once:
--   npx wrangler d1 execute focus-spoofer --remote --file=migrations/0003_link_clicks.sql

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
