# 비교분석 REPORT: Guardrails-Service-Admin

## 1. 개요 (기준 ref app → 적용대상, 2026-06-02)

- 기준(ref, 개선·최신): `DocuGuard-AI-Admin/apps/api/` (NestJS Admin API, 모노레포)
- 적용대상(current): `Guardrails-Service-Admin/` (NestJS Admin API, 독립 프로젝트)
- 매핑: ref `apps/api/` → current 루트
- 작업일: 2026-06-02
- QA 관점: 기능 개선만 포팅하고 current의 식별자/네이밍("Guardrails-Service-*")은 보존. ref의 브랜드 네이밍("DocuGuard-AI-*", `docuguard` DB 기본값)은 가져오지 않음.

## 2. 구조 비교 (디렉토리/파일 차이)

`diff -rq`(node_modules/dist/.git 제외) 결과 — **추가/삭제된 파일 없음**. 내용이 다른 파일만 3건:

| 파일 | 상태 | 성격 |
|------|------|------|
| `package.json` | 내용 차이 | 네이밍 전용 (name/description) |
| `src/db/db.service.ts` | 내용 차이 | 네이밍 전용 (DB 기본값) |
| `src/main.ts` | 내용 차이 | **기능 개선 (CORS)** |

- `src/db/schema.sqlite.ts`: ref와 **바이트 동일** (2914B). 커밋 "update database"의 스키마 순증분은 current 대비 없음. `db.service.ts`의 DB 기본 이름 변경만이 잔여 차이이며 네이밍에 해당.
- `.env.example`, `README.md`, `nest-cli.json`, `tsconfig.json`, `Dockerfile`, `.dockerignore`, `.gitignore`: **동일**

## 3. 의존성 변경 (package.json diff)

- `dependencies` / `devDependencies` / `scripts`: **변경 없음 (완전 동일)**
- 차이는 메타데이터 2줄뿐:
  - `name`: current `guardrails-admin` ↔ ref `docuguard-ai-admin-api`
  - `description`: current "Admin API for the MCP Guardrails Service…" ↔ ref "DocuGuard AI — Admin API (NestJS)…"
- 신규 추가 의존성 없음.

## 4. 개선/추가/수정 항목 (설명 / ref 위치 / 영향도 / QA 리스크)

### [개선] CORS 기본 정책: 고정 localhost 허용목록 → 요청 Origin 반영
- 설명: `ADMIN_CORS_ORIGINS` 미설정 시, 기존에는 고정 목록(`localhost:3001`, `127.0.0.1:3001`, `localhost:3000`)만 허용. 개선본은 요청 Origin을 그대로 반영(`return true`)하도록 변경. 원격/LAN IP 배포에서 Admin Web 호스트를 사전에 알 수 없어 발생하던 CORS 실패("Failed to fetch")를 해소.
- ref 위치: `apps/api/src/main.ts` `parseOrigins()`
- 영향도: 중. 내부망/원격 배포 연결성 직접 개선.
- QA 리스크: CORS 와일드카드화. 단, 인증이 Bearer 토큰(`credentials:false`)이라 쿠키/CSRF 표면 없음. 프로덕션은 `ADMIN_CORS_ORIGINS`로 명시 핀 권장(주석 명시).

### [네이밍-전용, 미적용] DB 기본값 `guardrails` → `docuguard`
- 설명: `db.service.ts`의 Postgres `database/user/password` 폴백 기본값이 ref에서 `docuguard`. current는 `guardrails`.
- ref 위치: `apps/api/src/db/db.service.ts` (line 104–106)
- 영향도: 식별자/브랜딩. 기능 동등.
- QA 리스크: ref값 도입 시 current 서비스 식별자와 불일치 → 보존이 정답. 미적용.

## 5. 적용 내역 (Applied) (파일별 변경 + 이유)

### `src/main.ts`
- `parseOrigins()`의 빈 허용목록 분기를 고정 localhost 배열 반환 → `return true as unknown as string[]`(Origin 반영)로 교체. 개선 주석 동반.
- 이유: 원격 배포 CORS 실패 해소(실사용 버그 픽스). 토큰 기반 인증이라 보안상 안전. current 호스트명/포트를 하드코딩하지 않음(브랜드 호스트네임 미도입).

## 6. 미적용/보류 (Deferred) (이유)

- `package.json` `name`/`description`: current 네이밍("Guardrails-Service") 보존 정책에 따라 미적용.
- `src/db/db.service.ts` DB 기본값(`docuguard`): current 식별자(`guardrails`) 보존. ref 브랜드 기본값 미도입.
- 위 두 건은 **네이밍 한정 분기**로 기능 차이 아님.

## 7. 검증 결과 (build/typecheck)

- 빌드 명령: `npm run build` (`nest build`)
- 결과: **성공 (exit 0)**. `dist/main.js` 정상 산출 — 수정한 `main.ts` 컴파일 확인.
- 비고(환경): 런타임 Node v26. `better-sqlite3@11` 네이티브 빌드(node-gyp)가 Node 26에서 실패하여 일반 `npm install`은 원자적 롤백됨. TS 타입체크/`nest build`는 네이티브 바인딩 불필요하므로 `npm install --ignore-scripts`로 툴체인 설치 후 빌드 검증 통과. 이 이슈는 **본 변경과 무관한 환경 이슈**(런타임 실행 시 `better-sqlite3` 재빌드 또는 Node LTS 필요).

## 8. QA 체크리스트 & 회귀테스트 권고

- [ ] `ADMIN_CORS_ORIGINS` 미설정: 원격 IP/도메인에서 Admin Web → API 호출 CORS 통과 확인.
- [ ] `ADMIN_CORS_ORIGINS="*"`: 기존과 동일 전체 허용 동작 확인.
- [ ] `ADMIN_CORS_ORIGINS="https://a.com,https://b.com"`: 명시 핀 시 해당 Origin만 허용/그 외 차단(회귀).
- [ ] 프리플라이트(OPTIONS) 응답에 `Authorization`, `x-admin-token` 헤더 허용 유지 확인.
- [ ] 인증 흐름(email/pw + TOTP) 정상 — `credentials:false`(쿠키 미사용) 전제 유지 확인.
- [ ] 런타임 기동(`node dist/main.js`) — `better-sqlite3` 가용 환경에서 부팅/DB 연결 확인.
- [ ] 프로덕션 권고: `ADMIN_CORS_ORIGINS` 명시 핀으로 와일드카드 비활성화.
