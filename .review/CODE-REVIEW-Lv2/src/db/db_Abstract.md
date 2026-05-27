# `src/db/` — Directory Abstract

3 파일.

- `db.module.ts` — `@Global()` 모듈, `DbService`만 export.
- `db.service.ts` — **이 디렉터리의 본체.** 460 LOC, PG/SQLite 듀얼-드라이버 facade. 모든 SQL이 메서드에 직매핑. JSON 컬럼 coerce 헬퍼.
- `schema.sqlite.ts` — SQLite 부트스트랩 DDL 문자열 (`CREATE TABLE IF NOT EXISTS ...`). PG는 외부 `init-db.sql`에 의존(이 repo에 없음).

핵심 위험:
- async 메서드 안에 동기 `better-sqlite3` 사용 → bulk 루프 시 event loop blocking.
- 트랜잭션 미사용 (bulk upsert, deleteMany 모두).
- 잘못 형식의 JSON 컬럼 fallback이 silently `{}` / `[]` → 데이터 손실 가능.
- TOTP secret 컬럼이 평문 base32.
