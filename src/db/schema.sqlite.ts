/**
 * SQLite schema for Admin service tables. Bootstrapped on first boot when
 * DB_DRIVER=sqlite. Mirrors Postgres tables in init-db.sql.
 *
 * Includes the `rules` table so Admin can CRUD rules in SQLite-only deployments
 * (single-host PoC). When DB_DRIVER=postgres, the table is shared with Policy
 * Engine via the existing Postgres schema in `scripts/init-db.sql`.
 */
export const ADMIN_SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS admin_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  totp_secret   TEXT,
  totp_enabled  INTEGER NOT NULL DEFAULT 0,
  role          TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','super_admin','viewer')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_login_history (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  email      TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  success    INTEGER NOT NULL,
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_login_user_time ON admin_login_history(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  actor_email TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  payload     TEXT,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor_time ON admin_audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action_time ON admin_audit_log(action, created_at DESC);

CREATE TABLE IF NOT EXISTS rules (
  rule_id           TEXT PRIMARY KEY,
  domain            TEXT NOT NULL,
  locale            TEXT NOT NULL,
  io_type           TEXT NOT NULL CHECK (io_type IN ('input','output','both')),
  category          TEXT NOT NULL,
  sub_category      TEXT,
  severity          TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  priority          INTEGER NOT NULL DEFAULT 100,
  action            TEXT NOT NULL,
  pattern_bundle    TEXT NOT NULL DEFAULT '{}',
  message_template  TEXT NOT NULL DEFAULT '{}',
  regulation_tags   TEXT NOT NULL DEFAULT '[]',
  examples_positive TEXT NOT NULL DEFAULT '[]',
  examples_negative TEXT NOT NULL DEFAULT '[]',
  enabled           INTEGER NOT NULL DEFAULT 1,
  version           TEXT NOT NULL DEFAULT '1.0.0',
  source            TEXT NOT NULL DEFAULT 'admin'
                     CHECK (source IN ('file','admin','csv')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rules_domain_locale_io ON rules(domain, locale, io_type) WHERE enabled = 1;
`;
