# `<root>` — Project-level Abstract

NestJS 10 + TypeScript 5.4 기반 **Admin API**. 단일 모놀리식 HTTP 서비스(`:8084`, prefix `/admin`)로:

- **Auth**: email/password + TOTP 2FA + JWT (HS256) — `@nestjs/jwt`, `bcryptjs`, `otplib`, `qrcode`
- **Audit**: 모든 mutating(POST/PUT/DELETE) 요청 자동 기록 (APP_INTERCEPTOR)
- **Rules CRUD**: 단건/벌크 upsert + CSV(20MB) 임포트 + 벌크 삭제 — 매 변경 후 Policy Engine `/policies/invalidate`
- **Persistence**: Postgres(`pg.Pool`) **또는** SQLite(`better-sqlite3`) — `DB_DRIVER` env로 선택, 동일 facade
- **RBAC**: `admin | super_admin | viewer` (CHECK constraint). `viewer`는 read-only, `super_admin`만 `/users` 및 cross-account audit 열람

## 책임 외 항목
- 정책 평가 엔진 자체 (Policy Engine은 별도 서비스 :8082)
- 정책 캐시 보유 (Admin은 무캐시 — 매번 DB hit)
- SSO/OIDC, WebAuthn, RLS (README 로드맵에 명시)

## 핵심 의존성
@nestjs/{common,core,jwt,platform-express,config}, bcryptjs, otplib, qrcode, pg, better-sqlite3, papaparse, multer, axios, class-validator/transformer.

## 빌드/실행
- 로컬: `npm run start:dev` (nest start --watch)
- 컨테이너: 2-stage `node:20-alpine`, native deps용 `python3 make g++` 추가 후 폐기
- 기본 docker-compose에 **미포함** (opt-in `docker-compose.admin.yml` overlay)

## 보안 자세 (현재)
- 비밀번호 bcryptjs (rounds=10, pure-JS — argon2/native bcrypt 대비 느리지만 native build 없이 동작)
- TOTP enforced when `totp_enabled`
- AuditInterceptor가 mutating body의 `password,newPassword,currentPassword,totp` 키 strip
- 실패 로그인 → `admin_login_history` reason 컬럼에 forensic trail
- **약점**: TOTP secret 평문 저장, JWT secret default-fallback, register endpoint 공개, rate limit 부재 (자세한 분석은 INDEX.md §4.3 참조)

## 코드 품질 단편
- `strict: true` TS
- ESLint config는 없음 (npm script만 존재 — `eslint "src/**/*.ts"`이 실패할 가능성)
- Test: csv-importer 1개 spec만 (5 cases)
- Lockfile 부재 → 빌드 재현성 부재
