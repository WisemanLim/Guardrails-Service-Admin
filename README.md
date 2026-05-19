# Guardrails-Service-Admin

Admin API for the MCP Guardrails Service. Provides authenticated **rule CRUD**, **CSV bulk import**, **bulk delete**, **login history**, and **action audit log** so customer-facing operators can manage their own guardrail rules without redeploying Policy Engine.

**Opt-in deployment.** Default compose stacks do not include Admin. Enable via `docker-compose.admin.yml` overlay or run independently on a separate host.

---

## Component responsibility

PRD §3.2 (extension). Independent service that:

1. Auth (email + password + TOTP/Authenticator QR + JWT)
2. Per-user login history + action audit log
3. Per-domain (privacy / manufacturing-food / …) rule CRUD
4. CSV bulk import + bulk delete (multi-row)
5. Calls Policy Engine `/policies/invalidate` after every mutation → bundle refresh

Writes go to the shared `rules` table (Postgres) or local SQLite. Policy Engine `PoliciesService.refresh()` merges file rules + DB rules with DB-overrides-file precedence.

---

## Stack

- Node 20 + TypeScript 5.4
- NestJS 10
- `@nestjs/jwt` + JWT auth
- `bcryptjs` password hashing
- `otplib` TOTP + `qrcode` QR data URL
- `multer` + `papaparse` CSV upload
- `class-validator` DTO validation
- `pg` (Postgres) / `better-sqlite3` (local)
- `axios` Policy Engine client

---

## Directory structure

```
src/
├── main.ts                          # bootstrap + global /admin prefix
├── app.module.ts
├── config/runtime.ts
├── db/
│   ├── db.module.ts
│   ├── db.service.ts                # Postgres + SQLite facade
│   └── schema.sqlite.ts             # admin_users / admin_login_history / admin_audit_log / rules
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts           # /admin/auth/*
│   ├── auth.service.ts              # register / login / TOTP / password
│   ├── jwt.guard.ts                 # APP_GUARD
│   ├── public.decorator.ts          # @Public()
│   └── dto.ts
├── users/
│   ├── users.module.ts
│   └── users.controller.ts          # /admin/users (super_admin)
├── audit/
│   ├── audit.module.ts
│   ├── audit.service.ts
│   ├── audit.controller.ts          # /admin/audit/login-history, /admin/audit/actions
│   └── audit.interceptor.ts         # APP_INTERCEPTOR — auto-records mutating ops
├── rules/
│   ├── rules.module.ts
│   ├── rules.controller.ts          # /admin/rules/*
│   ├── rules.service.ts
│   ├── csv-importer.ts
│   ├── dto.ts
│   └── __tests__/csv-importer.spec.ts
├── clients/policy.client.ts         # POST /policies/invalidate
└── health/health.controller.ts      # /admin/health
```

---

## REST API (prefix `/admin`)

### Auth

| Method | Path | Auth | Description |
| :-- | :-- | :-- | :-- |
| POST | `/admin/auth/register` | public | Email + password registration → TOTP secret + `qrDataUrl` (PNG data URL) |
| POST | `/admin/auth/login` | public | Email + password [+ `totp`] → JWT |
| GET | `/admin/auth/me` | Bearer | Current user profile |
| GET | `/admin/auth/totp/qr` | Bearer | Regenerate QR for current user's TOTP secret |
| POST | `/admin/auth/totp/enable` | Bearer | Verify 6-digit code → enable TOTP gate at login |
| POST | `/admin/auth/password` | Bearer | Change password (current + new) |

Register response shape:

```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "role": "admin",
  "totp": {
    "otpauth": "otpauth://totp/Guardrails-Admin:user@example.com?secret=...&issuer=...",
    "secret": "BASE32SECRET",
    "qrDataUrl": "data:image/png;base64,iVBORw0KGgo...",
    "enabled": false,
    "hint": "Scan in an authenticator app, then POST /admin/auth/totp/enable."
  }
}
```

### Audit

| Method | Path | Auth | Description |
| :-- | :-- | :-- | :-- |
| GET | `/admin/audit/login-history?limit=&userId=` | Bearer | Own history (or `userId=*` for super_admin) |
| GET | `/admin/audit/actions?limit=&action=&actorId=` | Bearer | Own action audit; super_admin sees all |

Every mutating HTTP verb (POST/PUT/DELETE) outside `/admin/auth/*` is recorded automatically by `AuditInterceptor` with `actor_id`, `action`, `target_id`, sanitized `payload` (secrets stripped), `ip`, `user_agent`.

### Users

| Method | Path | Auth | Description |
| :-- | :-- | :-- | :-- |
| GET | `/admin/users` | super_admin | List admin accounts |

### Rules (per-domain CRUD)

| Method | Path | Auth | Description |
| :-- | :-- | :-- | :-- |
| GET | `/admin/rules?domain=&locale=&ioType=&category=&enabledOnly=&limit=&offset=` | Bearer | List, filterable. e.g. `domain=manufacturing-food&category=compliance` |
| GET | `/admin/rules/:ruleId` | Bearer | Single rule |
| POST | `/admin/rules` | admin/super_admin | Create a single rule (full DTO body) |
| POST | `/admin/rules/bulk` | admin/super_admin | Bulk upsert (`{ rules: [...] }`) |
| POST | `/admin/rules/import-csv` | admin/super_admin | multipart/form-data `file` field, CSV body |
| PUT | `/admin/rules/:ruleId` | admin/super_admin | Update existing rule |
| DELETE | `/admin/rules/:ruleId` | admin/super_admin | Single delete |
| DELETE | `/admin/rules` | admin/super_admin | Bulk delete (body `{ ruleIds: [...] }`) |

`viewer` role is read-only and gets `403 viewer_cannot_write` on mutating routes.

### Rule DTO

```typescript
{
  ruleId: string;
  domain: string;          // "global" | "manufacturing-food" | ...
  locale: string;          // "ko-KR" | "en" | "ja-JP" | "*"
  ioType: "input" | "output" | "both";
  category: string;        // "pii" | "compliance" | "ip" | "safety" | ...
  subCategory?: string;
  severity: "low" | "medium" | "high" | "critical";
  priority: number;
  action: "allow" | "warn" | "redact" | "sanitize" | "block"
        | "block_or_redact" | "block_or_pseudonymize"
        | "aggregate_only" | "refuse" | "escalate"
        | "add_disclaimer" | "route";
  patternBundle?: { regex?: string[]; keywords?: string[]; entities?: string[];
                    luhnCheck?: boolean; minContextWindow?: number;
                    requiresPersonLink?: boolean };
  messageTemplate?: { [locale: string]: string };
  regulationTags?: string[];
  examplesPositive?: string[];
  examplesNegative?: string[];
  enabled?: boolean;
  version?: string;
}
```

### CSV format

Header row (case-sensitive, required):

```
ruleId,domain,locale,ioType,category,subCategory,severity,priority,action,patternBundle,messageTemplate,regulationTags,examplesPositive,examplesNegative,enabled,version
```

JSON-shaped columns accept either valid JSON or a pipe-separated list (for arrays). Example row:

```
PRIV_KR_999,global,ko-KR,input,pii,national_id_kr,critical,950,block,{},{"ko-KR":"주민번호 입력 불가"},KR_PIPA|EU_GDPR,예시,반례,1,1.0.0
```

Response:

```json
{ "ok": true, "total": 250, "accepted": 247, "rejected": [{ "row": 12, "reason": "invalid action: explode", "raw": {...} }] }
```

---

## Auth flow

```
1. POST /admin/auth/register {email, password}
   → server stores hash + TOTP secret, returns qrDataUrl
2. Scan QR in Authenticator app
3. POST /admin/auth/totp/enable {totp: "123456"}
   → totp_enabled = true
4. POST /admin/auth/login {email, password, totp}
   → { token, tokenType: "Bearer", expiresIn }
5. Subsequent calls: Authorization: Bearer <token>
```

Bootstrap super_admin (optional, single first-boot only):

```bash
ADMIN_BOOTSTRAP_EMAIL=admin@yourorg.com
ADMIN_BOOTSTRAP_PASSWORD=long-and-secret
```

---

## Environment variables

| 변수 | 기본 | 설명 |
| :-- | :-- | :-- |
| `PORT` | `8084` | |
| `JWT_SECRET` | `change-me-in-prod` | JWT signing key — **rotate before prod** |
| `JWT_EXPIRES_IN` | `12h` | |
| `BCRYPT_ROUNDS` | `10` | |
| `TOTP_ISSUER` | `Guardrails-Admin` | Shown in authenticator app |
| `ADMIN_BOOTSTRAP_EMAIL` | (empty) | First-boot super_admin email |
| `ADMIN_BOOTSTRAP_PASSWORD` | (empty) | First-boot super_admin password |
| `DB_DRIVER` | `postgres` | `postgres` \| `sqlite` |
| `SQLITE_PATH` | `./var/admin.db` | (local mode) |
| `POSTGRES_*` | compose defaults | shared with Policy Engine |
| `POLICY_ENGINE_URL` | `http://127.0.0.1:8082` | Cache invalidation endpoint |

---

## Local development

```bash
npm install
cp .env.example .env

# Postgres
npm run start:dev

# SQLite (no Postgres needed)
DB_DRIVER=sqlite SQLITE_PATH=./var/admin.db npm run start:dev
```

Test:

```bash
npm test
```

---

## Docker

```bash
docker build -t guardrails-admin .
docker run --rm -p 8084:8084 \
  -e JWT_SECRET=local \
  -e POSTGRES_HOST=host.docker.internal \
  -e POLICY_ENGINE_URL=http://host.docker.internal:8082 \
  guardrails-admin
```

Compose overlay (recommended):

```bash
docker compose -f docker-compose.yml \
               -f docker-compose.privacy.yml \
               -f docker-compose.admin.yml up -d
```

Default deployments **omit** this overlay. Admin is opt-in.

---

## Independent server deployment

Admin connects to:
- `POSTGRES_*` (shared with Policy Engine) — for `rules` + admin tables
- `POLICY_ENGINE_URL` — for `/policies/invalidate`

Both can target a remote host. Example: Admin on a hardened ops VPN, Policy Engine in the data plane.

```bash
POSTGRES_HOST=db.internal \
POSTGRES_PASSWORD=*** \
POLICY_ENGINE_URL=https://policy.guardrails.internal \
JWT_SECRET=*** \
node dist/main.js
```

For SQLite-only mode, Admin owns its rules table locally, but rules will not be visible to the Policy Engine unless the same DB file or Postgres back end is shared.

---

## Security posture

- Password hashing: bcrypt with `BCRYPT_ROUNDS=10` (raise in prod)
- TOTP enforced when `totp_enabled=true`; failed `totp` writes a `login_history` row with `reason='bad_totp'`
- JWT bearer with HS256, `JWT_SECRET` rotation requires re-login
- `viewer` cannot mutate
- `super_admin`-only: `/admin/users`, cross-account audit views
- `AuditInterceptor` records every mutation with sanitized body (passwords/tokens stripped)
- Failed logins always written to `admin_login_history` for forensic trace
- Default compose stack excludes Admin — explicit opt-in

---

## Roadmap

- M-Admin-1: SSO/OIDC (Google/Azure AD) federation
- M-Admin-2: WebAuthn / passkey alternative to TOTP
- M-Admin-3: Per-tenant rules scope + RLS (`allowed_domains`)
- M-Admin-4: Rule diff + approval workflow (draft → staged → active)
- M-Admin-5: Web UI (Next.js) — currently API-only
