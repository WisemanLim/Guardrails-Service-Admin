import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { Pool } from 'pg';
import { Runtime } from '../config/runtime';
import { ADMIN_SQLITE_SCHEMA } from './schema.sqlite';

type Driver = 'postgres' | 'sqlite';

export interface AdminUserRow {
  id: string;
  email: string;
  password_hash: string;
  totp_secret: string | null;
  totp_enabled: boolean;
  role: string;
  status: string;
  created_at: string;
  last_login_at: string | null;
}

export interface LoginHistoryRow {
  id: string;
  user_id: string | null;
  email: string;
  ip: string | null;
  user_agent: string | null;
  success: boolean;
  reason: string | null;
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: unknown;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface RuleRow {
  rule_id: string;
  domain: string;
  locale: string;
  io_type: 'input' | 'output' | 'both';
  category: string;
  sub_category: string | null;
  severity: string;
  priority: number;
  action: string;
  pattern_bundle: unknown;
  message_template: unknown;
  regulation_tags: string[];
  examples_positive: string[];
  examples_negative: string[];
  enabled: boolean;
  version: string;
  source: string;
}

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DbService.name);
  readonly driver: Driver = Runtime.dbDriver;
  private pg?: Pool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sqlite?: any;
  private _available = false;

  async onModuleInit() {
    if (this.driver === 'sqlite') await this.openSqlite();
    else await this.openPg();
  }

  isAvailable() {
    return this._available;
  }

  private async openSqlite() {
    try {
      const Database = (await import('better-sqlite3')).default;
      mkdirSync(dirname(Runtime.sqlitePath), { recursive: true });
      this.sqlite = new Database(Runtime.sqlitePath);
      this.sqlite.pragma('journal_mode = WAL');
      this.sqlite.pragma('foreign_keys = ON');
      this.sqlite.exec(ADMIN_SQLITE_SCHEMA);
      this._available = true;
      this.log.log(`SQLite ready at ${Runtime.sqlitePath}`);
    } catch (e) {
      this.log.error(`SQLite open failed: ${(e as Error).message}`);
    }
  }

  private async openPg() {
    this.pg = new Pool({
      host: process.env.POSTGRES_HOST ?? '127.0.0.1',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      database: process.env.POSTGRES_DB ?? 'guardrails',
      user: process.env.POSTGRES_USER ?? 'guardrails',
      password: process.env.POSTGRES_PASSWORD ?? 'guardrails',
      max: 10,
    });
    try {
      await this.pg.query('SELECT 1');
      this._available = true;
      this.log.log('Postgres connected');
    } catch (e) {
      this.log.error(`Postgres unavailable: ${(e as Error).message}`);
    }
  }

  // -------------------- admin_users --------------------

  async findUserByEmail(email: string): Promise<AdminUserRow | null> {
    if (this.driver === 'sqlite') {
      const r = this.sqlite.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);
      return r ? this.coerceUser(r) : null;
    }
    const res = await this.pg!.query<AdminUserRow>('SELECT * FROM admin_users WHERE email = $1', [email]);
    return res.rows[0] ?? null;
  }

  async findUserById(id: string): Promise<AdminUserRow | null> {
    if (this.driver === 'sqlite') {
      const r = this.sqlite.prepare('SELECT * FROM admin_users WHERE id = ?').get(id);
      return r ? this.coerceUser(r) : null;
    }
    const res = await this.pg!.query<AdminUserRow>('SELECT * FROM admin_users WHERE id = $1', [id]);
    return res.rows[0] ?? null;
  }

  async insertUser(
    email: string,
    passwordHash: string,
    totpSecret: string | null,
    role = 'admin',
  ): Promise<AdminUserRow> {
    const id = randomUUID();
    if (this.driver === 'sqlite') {
      this.sqlite
        .prepare(
          'INSERT INTO admin_users (id, email, password_hash, totp_secret, role) VALUES (?,?,?,?,?)',
        )
        .run(id, email, passwordHash, totpSecret, role);
      return (await this.findUserById(id))!;
    }
    const res = await this.pg!.query<AdminUserRow>(
      `INSERT INTO admin_users (id, email, password_hash, totp_secret, role)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, email, passwordHash, totpSecret, role],
    );
    return res.rows[0];
  }

  async updateUserTotpEnabled(id: string, enabled: boolean): Promise<void> {
    if (this.driver === 'sqlite') {
      this.sqlite.prepare('UPDATE admin_users SET totp_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
      return;
    }
    await this.pg!.query('UPDATE admin_users SET totp_enabled = $1 WHERE id = $2', [enabled, id]);
  }

  async updateUserPassword(id: string, passwordHash: string): Promise<void> {
    if (this.driver === 'sqlite') {
      this.sqlite.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
      return;
    }
    await this.pg!.query('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
  }

  async touchUserLastLogin(id: string): Promise<void> {
    if (this.driver === 'sqlite') {
      this.sqlite.prepare("UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?").run(id);
      return;
    }
    await this.pg!.query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [id]);
  }

  async listUsers(limit = 200): Promise<AdminUserRow[]> {
    if (this.driver === 'sqlite') {
      const rows = this.sqlite
        .prepare('SELECT id,email,role,status,totp_enabled,created_at,last_login_at FROM admin_users ORDER BY created_at DESC LIMIT ?')
        .all(limit);
      return rows.map((r: any) => this.coerceUser(r));
    }
    const res = await this.pg!.query<AdminUserRow>(
      'SELECT id,email,role,status,totp_enabled,created_at,last_login_at FROM admin_users ORDER BY created_at DESC LIMIT $1',
      [limit],
    );
    return res.rows;
  }

  // -------------------- admin_login_history --------------------

  async insertLoginHistory(row: Omit<LoginHistoryRow, 'id' | 'created_at'>): Promise<void> {
    const id = randomUUID();
    if (this.driver === 'sqlite') {
      this.sqlite
        .prepare(
          'INSERT INTO admin_login_history (id,user_id,email,ip,user_agent,success,reason) VALUES (?,?,?,?,?,?,?)',
        )
        .run(id, row.user_id, row.email, row.ip, row.user_agent, row.success ? 1 : 0, row.reason);
      return;
    }
    await this.pg!.query(
      `INSERT INTO admin_login_history (id,user_id,email,ip,user_agent,success,reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, row.user_id, row.email, row.ip, row.user_agent, row.success, row.reason],
    );
  }

  async listLoginHistory(userId: string | null, limit = 100): Promise<LoginHistoryRow[]> {
    if (this.driver === 'sqlite') {
      const sql = userId
        ? 'SELECT * FROM admin_login_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
        : 'SELECT * FROM admin_login_history ORDER BY created_at DESC LIMIT ?';
      const args = userId ? [userId, limit] : [limit];
      const rows = this.sqlite.prepare(sql).all(...args);
      return rows.map((r: any) => ({ ...r, success: !!r.success }));
    }
    if (userId) {
      const res = await this.pg!.query<LoginHistoryRow>(
        'SELECT * FROM admin_login_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
        [userId, limit],
      );
      return res.rows;
    }
    const res = await this.pg!.query<LoginHistoryRow>(
      'SELECT * FROM admin_login_history ORDER BY created_at DESC LIMIT $1',
      [limit],
    );
    return res.rows;
  }

  // -------------------- admin_audit_log --------------------

  async insertAuditLog(row: Omit<AuditLogRow, 'id' | 'created_at'>): Promise<void> {
    const id = randomUUID();
    if (this.driver === 'sqlite') {
      this.sqlite
        .prepare(
          'INSERT INTO admin_audit_log (id,actor_id,actor_email,action,target_type,target_id,payload,ip,user_agent) VALUES (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          row.actor_id,
          row.actor_email,
          row.action,
          row.target_type,
          row.target_id,
          row.payload ? JSON.stringify(row.payload) : null,
          row.ip,
          row.user_agent,
        );
      return;
    }
    await this.pg!.query(
      `INSERT INTO admin_audit_log (id,actor_id,actor_email,action,target_type,target_id,payload,ip,user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        row.actor_id,
        row.actor_email,
        row.action,
        row.target_type,
        row.target_id,
        row.payload ?? null,
        row.ip,
        row.user_agent,
      ],
    );
  }

  async listAuditLog(
    opts: { actorId?: string; action?: string; limit?: number } = {},
  ): Promise<AuditLogRow[]> {
    const limit = opts.limit ?? 200;
    if (this.driver === 'sqlite') {
      const where: string[] = [];
      const args: unknown[] = [];
      if (opts.actorId) { where.push('actor_id = ?'); args.push(opts.actorId); }
      if (opts.action) { where.push('action = ?'); args.push(opts.action); }
      const sql = `SELECT * FROM admin_audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
      args.push(limit);
      const rows = this.sqlite.prepare(sql).all(...args);
      return rows.map((r: any) => ({ ...r, payload: r.payload ? JSON.parse(r.payload) : null }));
    }
    const where: string[] = [];
    const args: unknown[] = [];
    let i = 1;
    if (opts.actorId) { where.push(`actor_id = $${i++}`); args.push(opts.actorId); }
    if (opts.action) { where.push(`action = $${i++}`); args.push(opts.action); }
    args.push(limit);
    const res = await this.pg!.query<AuditLogRow>(
      `SELECT * FROM admin_audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT $${i}`,
      args,
    );
    return res.rows;
  }

  // -------------------- rules --------------------

  async listRules(filter: {
    domain?: string;
    locale?: string;
    ioType?: string;
    category?: string;
    enabledOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ items: RuleRow[]; total: number }> {
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    const where: string[] = [];
    const args: unknown[] = [];
    let i = 1;
    const ph = () => (this.driver === 'sqlite' ? '?' : `$${i++}`);

    if (filter.domain) { where.push(`domain = ${ph()}`); args.push(filter.domain); }
    if (filter.locale) { where.push(`locale = ${ph()}`); args.push(filter.locale); }
    if (filter.ioType) { where.push(`io_type = ${ph()}`); args.push(filter.ioType); }
    if (filter.category) { where.push(`category = ${ph()}`); args.push(filter.category); }
    if (filter.enabledOnly) { where.push(this.driver === 'sqlite' ? 'enabled = 1' : 'enabled = TRUE'); }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    if (this.driver === 'sqlite') {
      const total = (this.sqlite.prepare(`SELECT COUNT(*) AS c FROM rules ${whereClause}`).get(...args) as { c: number }).c;
      const rows = this.sqlite
        .prepare(`SELECT * FROM rules ${whereClause} ORDER BY domain, locale, io_type, priority DESC LIMIT ? OFFSET ?`)
        .all(...args, limit, offset);
      return { items: rows.map((r: any) => this.coerceRule(r)), total };
    }
    const totalRes = await this.pg!.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM rules ${whereClause}`,
      args,
    );
    const res = await this.pg!.query<RuleRow>(
      `SELECT * FROM rules ${whereClause} ORDER BY domain, locale, io_type, priority DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...args, limit, offset],
    );
    return { items: res.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
  }

  async findRuleById(ruleId: string): Promise<RuleRow | null> {
    if (this.driver === 'sqlite') {
      const r = this.sqlite.prepare('SELECT * FROM rules WHERE rule_id = ?').get(ruleId);
      return r ? this.coerceRule(r) : null;
    }
    const res = await this.pg!.query<RuleRow>('SELECT * FROM rules WHERE rule_id = $1', [ruleId]);
    return res.rows[0] ?? null;
  }

  async upsertRule(rule: RuleRow): Promise<void> {
    if (this.driver === 'sqlite') {
      this.sqlite
        .prepare(
          `INSERT INTO rules (
              rule_id, domain, locale, io_type, category, sub_category,
              severity, priority, action,
              pattern_bundle, message_template, regulation_tags,
              examples_positive, examples_negative, enabled, version, source,
              created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
           ON CONFLICT(rule_id) DO UPDATE SET
              domain=excluded.domain, locale=excluded.locale, io_type=excluded.io_type,
              category=excluded.category, sub_category=excluded.sub_category,
              severity=excluded.severity, priority=excluded.priority, action=excluded.action,
              pattern_bundle=excluded.pattern_bundle, message_template=excluded.message_template,
              regulation_tags=excluded.regulation_tags,
              examples_positive=excluded.examples_positive, examples_negative=excluded.examples_negative,
              enabled=excluded.enabled, version=excluded.version, source=excluded.source,
              updated_at=datetime('now')`,
        )
        .run(
          rule.rule_id, rule.domain, rule.locale, rule.io_type, rule.category, rule.sub_category,
          rule.severity, rule.priority, rule.action,
          JSON.stringify(rule.pattern_bundle ?? {}),
          JSON.stringify(rule.message_template ?? {}),
          JSON.stringify(rule.regulation_tags ?? []),
          JSON.stringify(rule.examples_positive ?? []),
          JSON.stringify(rule.examples_negative ?? []),
          rule.enabled ? 1 : 0, rule.version, rule.source,
        );
      return;
    }
    await this.pg!.query(
      `INSERT INTO rules (
         rule_id, domain, locale, io_type, category, sub_category,
         severity, priority, action,
         pattern_bundle, message_template, regulation_tags,
         examples_positive, examples_negative, enabled, version, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (rule_id) DO UPDATE SET
         domain=$2, locale=$3, io_type=$4, category=$5, sub_category=$6,
         severity=$7, priority=$8, action=$9, pattern_bundle=$10,
         message_template=$11, regulation_tags=$12,
         examples_positive=$13, examples_negative=$14, enabled=$15,
         version=$16, source=$17, updated_at = now()`,
      [
        rule.rule_id, rule.domain, rule.locale, rule.io_type, rule.category, rule.sub_category,
        rule.severity, rule.priority, rule.action,
        rule.pattern_bundle ?? {}, rule.message_template ?? {},
        rule.regulation_tags ?? [],
        rule.examples_positive ?? [], rule.examples_negative ?? [],
        rule.enabled, rule.version, rule.source,
      ],
    );
  }

  async deleteRules(ruleIds: string[]): Promise<number> {
    if (ruleIds.length === 0) return 0;
    if (this.driver === 'sqlite') {
      const placeholders = ruleIds.map(() => '?').join(',');
      const info = this.sqlite.prepare(`DELETE FROM rules WHERE rule_id IN (${placeholders})`).run(...ruleIds);
      return info.changes as number;
    }
    const res = await this.pg!.query('DELETE FROM rules WHERE rule_id = ANY($1)', [ruleIds]);
    return res.rowCount ?? 0;
  }

  // -------------------- helpers --------------------

  private coerceUser(r: any): AdminUserRow {
    return { ...r, totp_enabled: !!r.totp_enabled };
  }

  private coerceRule(r: any): RuleRow {
    return {
      ...r,
      enabled: !!r.enabled,
      pattern_bundle: this.parseJsonMaybe(r.pattern_bundle, {}),
      message_template: this.parseJsonMaybe(r.message_template, {}),
      regulation_tags: this.parseJsonMaybe(r.regulation_tags, []),
      examples_positive: this.parseJsonMaybe(r.examples_positive, []),
      examples_negative: this.parseJsonMaybe(r.examples_negative, []),
    };
  }

  private parseJsonMaybe(v: unknown, fallback: unknown): unknown {
    if (v == null) return fallback;
    if (typeof v !== 'string') return v;
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  }

  async onModuleDestroy() {
    if (this.pg) await this.pg.end().catch(() => undefined);
    if (this.sqlite) this.sqlite.close();
  }
}
