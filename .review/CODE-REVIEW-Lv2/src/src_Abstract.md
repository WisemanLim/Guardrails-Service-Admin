# `src/` — Directory Abstract

NestJS 모듈 구성. **루트 모듈** = `AppModule`(./app.module.ts). 전역 등록:

- `ConfigModule.forRoot({ isGlobal: true })` — 실제로는 `Runtime` 정적 객체가 process.env를 직참조하므로 ConfigService는 미사용.
- `DbModule` (`@Global`)
- `AuthModule` (`@Global`) + `APP_GUARD: JwtAuthGuard`
- `UsersModule`
- `AuditModule` (`@Global`) + `APP_INTERCEPTOR: AuditInterceptor`
- `RulesModule`
- `HealthController` (모듈 외 직접 등록, Public)

`main.ts`가 bootstrap을 담당하며 `/admin` global prefix, CORS, ValidationPipe(whitelist+transform)을 설정.

## 모듈 책임 한 줄
| 모듈 | 책임 |
| :-- | :-- |
| `auth/` | 인증·인가의 모든 책임 (DTO, Guard, Controller, Service) |
| `audit/` | 로그인 이력 + 액션 감사 + 글로벌 변경 인터셉터 |
| `clients/` | 외부 서비스(Policy Engine) HTTP 클라이언트 |
| `config/` | 환경변수 정적 스냅샷 |
| `db/` | 듀얼-드라이버 데이터 액세스 facade |
| `health/` | `/admin/health` (Public) |
| `rules/` | 규칙 CRUD + CSV 임포트 |
| `users/` | 관리자 계정 목록(super_admin 전용) |

## 디렉터리 횡단 관찰
- `JwtAuthGuard`는 `APP_GUARD`로 등록되어 controller 단의 `@UseGuards(JwtAuthGuard)`는 사실상 중복. `@Public()` 데코레이터 또한 reflector lookup으로 작동.
- `AuditInterceptor`는 GET/HEAD/OPTIONS skip + `/admin/auth/` skip(중복 기록 방지) — 단, super_admin이 다른 사용자의 audit을 조회하는 sensitive GET은 audit되지 않음.
- `DbService` JSON 컬럼이 SQLite에서는 TEXT, PG에서는 JSONB 가정 → `coerceRule`이 typeof string인 경우만 parse, 그 외는 객체로 가정. 안전 fallback 있음.
