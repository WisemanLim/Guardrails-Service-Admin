# `src/rules/` — Directory Abstract

규칙 CRUD + CSV 임포트.

- `rules.module.ts` — RulesController + RulesService + PolicyClient provider.
- `rules.controller.ts` — `/rules` GET/POST/PUT/DELETE + `bulk` + `import-csv`.
- `rules.service.ts` — DTO → row 변환, DbService 호출, PolicyClient.invalidate.
- `dto.ts` — RuleDto, BulkUpsertDto, BulkDeleteDto with class-validator.
- `csv-importer.ts` — papaparse 기반 CSV → RuleDto[] (accepted + rejected).
- `__tests__/csv-importer.spec.ts` — 단일 spec, 5 케이스 (happy/enum/missing/pipe/json-array).

## 핵심 위험
- bulkUpsert / importCsv 모두 **트랜잭션 없음** — 부분 실패 시 일관성 깨짐.
- bulkUpsert/CSV import의 N+1 패턴 — 10,000행이면 SQLite event loop blocking, PG 10,000 round-trip.
- CSV header `case-sensitive` (Papa.transformHeader trim만) — `RuleID` 같은 변형 거부.
- `parseObject`는 JSON parse 실패 시 throw — 깔끔하나 CSV에서 흔한 quote escape 실수가 모든 행 reject로 이어짐.
- viewer는 모든 변경 거부 (정상). 단, RBAC 데코레이터화 부재.

## 좋은 부분
- DTO 검증 강함 (`@IsIn` enum, `@ArrayMinSize/MaxSize`, ValidateNested).
- accepted/rejected 보고 형태가 운영 친화적.
- PolicyClient.invalidate는 변경 흐름 블로킹 안함 (3s timeout + swallow).
