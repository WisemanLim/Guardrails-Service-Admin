# `src/db/db.service.ts`

## Header
- 역할 / Role: PG/SQLite 듀얼-드라이버 facade. admin_users, admin_login_history, admin_audit_log, rules 테이블에 대한 모든 CRUD를 한 곳에 모음.
- 진입점에서의 거리: 2 (AuthService/RulesService/AuditService → DbService)
- 라인 수: **460** (block-mode 임계 600 미만 — 일반 모드로 분석하되 메서드별로 구획화)
- 주요 export: `DbService`, `AdminUserRow`, `LoginHistoryRow`, `AuditLogRow`, `RuleRow` (interfaces)
- 의존 모듈 (internal): `../config/runtime`, `./schema.sqlite`
- 사용된 외부 패키지: `@nestjs/common`, `crypto.randomUUID`, `fs.mkdirSync`, `path.dirname`, `pg`, `better-sqlite3` (동적 import)
- 부수효과: PG Pool 생성, SQLite 파일 open + DDL 실행, mkdirSync, log 출력
- 동시성 모델: pg.Pool은 비동기 (max=10), better-sqlite3는 **동기** — 그러나 `DbService` 메서드는 모두 `async`로 노출. SQLite 경로는 `await`가 의미 없는 동기 호출에 불과.
- 테스트 커버리지: 없음

## Line-by-Line Review (Level 2)

### Imports + Interface types

```ts path=src/db/db.service.ts lines=1-66
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
  ...
}
```

**분석 / Analysis (Level 2)**
- L5 `Pool` from `pg` — eager import. SQLite-only 배포에서도 `pg` 모듈은 로드되지만 인스턴스가 생성되지 않음. 메모리·시작시간 영향 미미.
- L11-65 row interfaces가 snake_case 그대로 노출됨 — 도메인 모델과 DB 컬럼 1:1 매핑. NestJS controllers가 이를 JSON으로 직렬화 → API 응답에 snake_case가 일관성 없이 섞임 (예: `last_login_at`). README 응답 예제는 `lastLoginAt`(auth.service.me에서 camel로 변환)과 불일치 — 모든 곳에서 변환이 일관되지 않음. `listUsers`는 snake_case 그대로 반환.
- L42 `payload: unknown` — JSON 객체. 호출부가 `coerceRule`처럼 안전 parse.

### Driver / OnModuleInit

```ts path=src/db/db.service.ts lines=67-117
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
```

**분석 / Analysis (Level 2)**
- L70 `readonly driver` import-time 결정. `health.controller`가 이 값을 노출.
- L73 `private sqlite?: any` — better-sqlite3의 `Database` 타입을 굳이 import하지 않음. `@types/better-sqlite3`가 devDep에 있음에도 활용 안함. 타입 안전성 손실.
- L74 `_available` 플래그 — DB open 성공 여부. `isAvailable()`로만 노출 → 부수효과 없는 read.
- L86 동적 import `better-sqlite3` — postgres 모드에서 native module 로딩 회피. Docker stage 1에서 빌드된 native 바인딩이 없으면 SQLite 모드에서만 실패. 사려 깊은 설계.
- L87 `mkdirSync(dirname(...), {recursive:true})` — `./var/admin.db`의 `./var` 생성. `dirname('foo.db')` = `'.'` (현재 디렉터리) → 안전.
- L89 `journal_mode = WAL` — 동시 읽기 성능. 좋음. 단, WAL 파일이 디스크에 같이 생성됨 (.db-wal, .db-shm). Docker volume 관리 시 주의.
- L90 `foreign_keys = ON` — SQLite 기본 OFF. 좋은 습관. 단, 정작 schema에 FK 정의는 없음(앞 schema 분석 참조).
- L91 `sqlite.exec(SCHEMA)` — 멀티-스테이트먼트 실행. 인덱스 생성 포함.
- L94 catch에서 throw 대신 log + `_available=false`. 운영적으로 health endpoint가 false를 반환하지만 부트는 성공 → silent failure. **개선**: open 실패 시 throw하여 컨테이너가 unhealthy로 재시작되도록.

```ts path=src/db/db.service.ts lines=100-117
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
```

**분석 / Analysis (Level 2)**
- POSTGRES_* env가 `Runtime`이 아니라 여기서 직접 읽힘 — config 일관성 깨짐. Runtime에 흡수 권고.
- default password `'guardrails'` — local dev 편의용. prod에서는 반드시 override. 실수로 default가 prod에 노출되면 위험.
- `max: 10` — 적은 편. burst 트래픽에서 throttle 발생 가능.
- `SELECT 1` 헬스체크 후 `_available=true`. 일시적 DB 다운 후 자동복구는 pg.Pool 내장에 의존. `_available` 플래그는 재시도 시 갱신되지 않음 → 첫 부트 실패면 isAvailable이 영구 false.
- catch에서 throw 대신 log. SQLite와 동일한 silent failure 패턴.

**짚어볼 점**
- ssl 옵션 부재 → 외부 PG 연결 시 평문. `POSTGRES_SSL=true` 같은 env로 옵션화 필요.
- statement_timeout/query_timeout 미설정.

### Users CRUD

```ts path=src/db/db.service.ts lines=120-197
  async findUserByEmail(email: string): Promise<AdminUserRow | null> {
    if (this.driver === 'sqlite') {
      const r = this.sqlite.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);
      return r ? this.coerceUser(r) : null;
    }
    const res = await this.pg!.query<AdminUserRow>('SELECT * FROM admin_users WHERE email = $1', [email]);
    return res.rows[0] ?? null;
  }

  async findUserById(id: string): Promise<AdminUserRow | null> { /* same shape */ }

  async insertUser(email, passwordHash, totpSecret, role='admin'): Promise<AdminUserRow> {
    const id = randomUUID();
    if (this.driver === 'sqlite') {
      this.sqlite.prepare('INSERT INTO admin_users (...) VALUES (?,?,?,?,?)')
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
```

**분석 / Analysis (Level 2)**
- 모든 매개변수가 placeholder 바인딩으로 들어가므로 **SQL injection 안전**. 좋음.
- `findUserByEmail`은 PG에서 `coerceUser`를 호출하지 않음 — PG는 boolean을 native로 반환하니 OK. SQLite는 0/1 → `coerceUser`에서 `!!`. 일관성 OK.
- `insertUser`의 SQLite 분기는 INSERT 후 `findUserById`로 다시 SELECT — 추가 round-trip(동기 prepare/get) 1회. PG는 `RETURNING *` 한 번에 처리. 일관성 ↓. 단, SQLite는 동기라 비용은 마이크로초 단위.
- `randomUUID()` — Node 14.17+ crypto API. v4 UUID. 안전.
- 이메일 정규화(소문자) 부재 — `Foo@example.com`과 `foo@example.com`이 별도 계정으로 등록 가능. CSV의 UNIQUE 제약은 raw string. **개선**: insert/lookup 양쪽에서 `.toLowerCase().trim()`.

### updateUser* / touchUserLastLogin / listUsers

```ts path=src/db/db.service.ts lines=161-197
  async updateUserTotpEnabled(id, enabled): Promise<void> { ... }
  async updateUserPassword(id, passwordHash): Promise<void> { ... }
  async touchUserLastLogin(id): Promise<void> {
    ...UPDATE admin_users SET last_login_at = datetime('now')/ now() WHERE id = ?...
  }
  async listUsers(limit = 200): Promise<AdminUserRow[]> {
    /* SELECT id,email,role,status,totp_enabled,created_at,last_login_at ORDER BY created_at DESC LIMIT ? */
  }
```

**분석 / Analysis (Level 2)**
- `listUsers`가 password_hash와 totp_secret을 **응답 컬럼에서 제외** — 좋음. users.controller가 그대로 응답에 전달.
- 그러나 `findUserByEmail/Id`는 모든 컬럼(password_hash, totp_secret 포함)을 가져옴. 이는 auth flow에서 필요. 단, AuthService.me가 이 row를 직접 노출하지 않고 필요 필드만 추려 응답해 누출 차단. 그러나 향후 `findUserById` 결과를 더 넓게 노출하는 코드가 추가되면 secret 누출 가능 → 권고: `mapUserPublic` 헬퍼.

### Login history

```ts path=src/db/db.service.ts lines=201-239
  async insertLoginHistory(row: Omit<LoginHistoryRow,'id'|'created_at'>): Promise<void> { ... }
  async listLoginHistory(userId: string | null, limit = 100): Promise<LoginHistoryRow[]> {
    if (this.driver === 'sqlite') {
      const sql = userId ? 'SELECT * ... WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
                          : 'SELECT * ... ORDER BY created_at DESC LIMIT ?';
      ...
    }
    if (userId) { ...PG path... }
    ...
  }
```

**분석 / Analysis (Level 2)**
- `insertLoginHistory`는 row 객체를 통째로 받아 매핑. **success를 0/1로 변환** (SQLite). 누락된 컬럼이 있으면 NOT NULL 위반.
- `listLoginHistory(userId=null)` → 모든 사용자 history 반환. audit.controller가 이를 super_admin에게만 제공 (gate). DB 레벨 access control 없음.
- limit 검증 안함 — `Number()`로 변환 후 1000 cap은 audit.controller에서. 본 메서드는 신뢰 input 가정.

### Audit log

```ts path=src/db/db.service.ts lines=243-305
  async insertAuditLog(row): Promise<void> {
    /* SQLite: JSON.stringify(payload). PG: payload object directly. */
  }
  async listAuditLog(opts): Promise<AuditLogRow[]> {
    const limit = opts.limit ?? 200;
    if (this.driver === 'sqlite') {
      const where: string[] = [];
      const args: unknown[] = [];
      if (opts.actorId) { where.push('actor_id = ?'); args.push(opts.actorId); }
      if (opts.action) { where.push('action = ?'); args.push(opts.action); }
      const sql = `SELECT * FROM admin_audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
      args.push(limit);
      const rows = this.sqlite.prepare(sql).all(...args);
      return rows.map((r:any) => ({...r, payload: r.payload ? JSON.parse(r.payload) : null}));
    }
    ...PG: where + $i counter...
  }
```

**분석 / Analysis (Level 2)**
- **SQL injection 안전성**: WHERE 절은 동적이지만 컬럼명은 코드 상수, 값은 placeholder 바인딩. 안전.
- **PG의 $i 카운터 패턴** (L294–301): `let i = 1`, push 시 i++. limit은 마지막에 `$${i}` 사용 — 정확.
- **JSON.parse 실패 처리**: SQLite 분기는 `try`/`catch` 없음. malformed payload면 throw → 전체 list 요청이 500. PG 분기는 native JSONB라 안전. **개선**: parse를 try/catch 또는 `parseJsonMaybe` 헬퍼 재사용.
- payload에 비밀 데이터가 있을 가능성 — interceptor에서 password/totp 등 strip되지만, 다른 경로(예: 향후 컨트롤러에서 record 직접 호출)는 보장 없음. 응답에 그대로 노출되므로 super_admin이 모든 payload를 볼 수 있다.

### Rules CRUD (가장 큰 영역)

```ts path=src/db/db.service.ts lines=309-349
  async listRules(filter): Promise<{ items: RuleRow[]; total: number }> {
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
      const rows = this.sqlite.prepare(`SELECT * FROM rules ${whereClause} ORDER BY ... LIMIT ? OFFSET ?`).all(...args, limit, offset);
      return { items: rows.map((r:any) => this.coerceRule(r)), total };
    }
    const totalRes = await this.pg!.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM rules ${whereClause}`, args);
    const res = await this.pg!.query<RuleRow>(`SELECT * FROM rules ${whereClause} ORDER BY ... LIMIT $${i} OFFSET $${i+1}`, [...args, limit, offset]);
    return { items: res.rows, total: Number(totalRes.rows[0]?.count ?? 0) };
  }
```

**분석 / Analysis (Level 2)**
- **`ph()` 클로저 패턴**이 영리하지만 SQLite/PG에서 `i` 카운터 부수효과가 PG에만 의미 있음. SQLite는 i를 증가시키지 않음 → SQLite 경로에서 마지막 `LIMIT ? OFFSET ?` 자리표시자가 ?로 정상.
- **N+1**: COUNT와 SELECT를 별도 query로 (2 round-trip). 작은 데이터셋에선 OK. PG는 윈도우 함수 `COUNT(*) OVER()`로 1 round-trip 가능.
- `enabled = TRUE` (PG) vs `enabled = 1` (SQLite) — 명시적 분기. 좋음.
- `where`가 비면 `whereClause`가 빈 문자열. SQL injection 표면 없음 (모두 placeholder).
- limit/offset 검증 부재 — 호출부(rules.controller)는 Number() 변환만, NaN/negative 가능. limit 100 default. offset 0 default. 음수 LIMIT은 SQLite에서 모든 행 반환, PG는 에러. **개선**: cap + non-negative 검증.

```ts path=src/db/db.service.ts lines=351-359
  async findRuleById(ruleId: string): Promise<RuleRow | null> { ... }
```
- 단순 SELECT. 안전.

```ts path=src/db/db.service.ts lines=360-415
  async upsertRule(rule: RuleRow): Promise<void> {
    if (this.driver === 'sqlite') {
      this.sqlite.prepare(`INSERT INTO rules (... 17 columns ..., created_at, updated_at)
                            VALUES (?,...,datetime('now'),datetime('now'))
                            ON CONFLICT(rule_id) DO UPDATE SET ...
                            updated_at=datetime('now')`)
        .run(rule.rule_id, ..., JSON.stringify(rule.pattern_bundle ?? {}), ..., rule.enabled ? 1 : 0, ...);
      return;
    }
    await this.pg!.query(`INSERT INTO rules (...) VALUES ($1..$17) ON CONFLICT (rule_id) DO UPDATE SET ...`, [...]);
  }
```

**분석 / Analysis (Level 2)**
- **SQLite 분기**: pattern_bundle/message_template/regulation_tags/examples_*를 `JSON.stringify` — 좋음 (스키마는 TEXT).
- **PG 분기**: 객체를 그대로 pg에 전달. PG는 자동으로 JSONB binding. 단, `regulation_tags`가 PG schema에서 `text[]`(배열)인지 `jsonb`인지 알 수 없음 (외부 init-db.sql 미확인). 만약 `text[]`라면 pg는 JS array를 자동 캐스팅. JSONB라면 객체 그대로. **이 모호성이 코드에서 명시되지 않음 — 실제 PG 스키마와 어긋날 가능성이 있음.**
- `ON CONFLICT (rule_id) DO UPDATE` — atomic upsert. 좋음.
- update 시 SQLite의 SET 절은 `excluded.*`로 17개 컬럼 명시. created_at은 보존됨 (SET에 없음). 정확.
- 단일 record upsert가 명확하지만 **bulk 트랜잭션 없음** — 호출부(`bulkUpsert`)에서 루프 돌면 부분실패 위험.

```ts path=src/db/db.service.ts lines=417-426
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
```

**분석 / Analysis (Level 2)**
- **SQLite 분기**: 동적 placeholder. 안전. 단, `ruleIds`가 매우 크면(10,000개) prepare 문이 거대해짐. SQLite limit on host parameters는 32766 (better-sqlite3 ≥ 3.32). 안전 범위.
- **PG 분기**: `= ANY($1)` 패턴 — 단일 array binding. 우아.
- ruleIds 입력 검증은 DTO `@ArrayMaxSize(10000)`에서만. DTO를 거치지 않는 호출 경로(예: bulkUpsert 같은 내부 호출)는 검증 없음. 본 메서드는 외부 데이터 그대로 IN 절에 들어가지만 placeholder 바인딩이라 SQLi 안전.

### Helpers + onModuleDestroy

```ts path=src/db/db.service.ts lines=428-460
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
    try { return JSON.parse(v); } catch { return fallback; }
  }

  async onModuleDestroy() {
    if (this.pg) await this.pg.end().catch(() => undefined);
    if (this.sqlite) this.sqlite.close();
  }
```

**분석 / Analysis (Level 2)**
- `parseJsonMaybe`가 fallback을 **silently 사용**. malformed JSON이 들어가면 read 시 데이터가 빈 객체/배열로 둔갑 → **silent data corruption**. 운영 로그에라도 warn을 남겨야 함.
- `coerceUser`/`coerceRule`은 SQLite 결과에만 적용. PG는 native 타입이라 통과.
- `onModuleDestroy`의 `pool.end().catch(()=>undefined)` — shutdown 시 에러 무시. 일반적이나 노이즈가 있는 환경에서 디버깅 어려움.
- `sqlite.close()`는 동기. 호출 시 락 해제. catch 없음 — close 에러는 process 종료를 막지 않음.

**짚어볼 점 / Watch-outs**
- async 메서드 안에서 동기 better-sqlite3 호출 → 이벤트 루프 블로킹. listRules에서 COUNT + SELECT 2회 동기 호출은 큰 테이블에서 ms 단위 블로킹 가능. **개선**: SQLite 모드를 단일 호스트 PoC로 명시 제한하고, bulk 작업은 worker_threads로 옮길 것.
- 트랜잭션: SQLite는 `db.transaction(fn)`, PG는 `BEGIN/COMMIT` 명시. **현재 둘 다 사용 안함.** bulkUpsert/deleteMany는 트랜잭션화 권고.
- PG `statement_timeout` 미설정 — 악성 쿼리가 pool을 점유 가능.
- 에러 핸들링: open 실패는 throw하지 않음. health endpoint는 false를 반환하지만 application code는 `pg!`/`sqlite`가 undefined일 때 NullPointer-style crash (TypeError) 가능.

## File-level Verdict

**강점**
- 모든 SQL 파라미터 바인딩 (SQLi 안전).
- 인덱스 활용을 의식한 쿼리 (ORDER BY + LIMIT).
- 듀얼-드라이버 facade 깔끔.
- coerce helper로 boolean/JSON 변환.

**위험**
- 트랜잭션 부재 → 부분 실패 시 일관성 깨짐.
- async 메서드 + 동기 driver의 인지적 불일치 + 이벤트 루프 블로킹.
- JSON parse fallback silently 데이터 손실.
- 부트 실패 시 throw 안함 → process는 살아남고 health만 false (silent failure).
- PG sslmode 미설정. PG default password fallback `'guardrails'`.
- 이메일 normalization 부재.
- listRules limit/offset 비검증.

**개선 권고**
- `withTx` 헬퍼를 추가하고 bulkUpsert/deleteMany/CSV import를 트랜잭션화.
- PG Pool 구성에 `statement_timeout`, `idleTimeoutMillis`, `ssl` 옵션.
- email normalization (`toLowerCase().trim()`).
- open 실패는 throw → 컨테이너 재시작에 위임.
- driver별 PgAdapter/SqliteAdapter 분리, Repository 패턴.
- `parseJsonMaybe` fallback 시 logger.warn.
- TypeScript `Database` 타입 사용 (`import type Database from 'better-sqlite3'`).

**재읽기 권고 레벨: High** — 비즈니스 로직 + 보안의 핵심. 변경 시 매번 정밀 리뷰.
