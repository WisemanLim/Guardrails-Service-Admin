# `src/audit/` — Directory Abstract

세 책임:
1. **자동 변경 감사(`AuditInterceptor`)** — APP_INTERCEPTOR으로 전역 적용, mutating verbs(POST/PUT/DELETE)만 기록, body의 비밀 필드 strip.
2. **로그인 이력 조회(`/audit/login-history`)** — 자기 자신 또는 super_admin이 타인 조회 가능.
3. **액션 감사 조회(`/audit/actions`)** — non-super_admin은 자기 actor_id만 가능.

## 파일
| 파일 | LOC | 역할 |
| :-- | :-- | :-- |
| audit.module.ts | 11 | `@Global()` 등록 (controller + service) |
| audit.controller.ts | 41 | `/audit/login-history`, `/audit/actions` GET |
| audit.service.ts | 37 | DbService 얇은 래퍼 |
| audit.interceptor.ts | 53 | 변경요청 자동 감사, body sanitization |

## 횡단 관찰
- `path.startsWith('/admin/auth/')` 매칭이 main.ts의 `setGlobalPrefix('/admin')` 변경에 결합되어 있음. global prefix 변경 시 audit 누락 위험.
- `safeBody` 가 `password|newPassword|currentPassword|totp` 4 키만 strip. `secret`, `token`, `apiKey` 같은 추가 비밀 필드는 그대로 기록될 수 있음.
- 모든 read 경로(GET)는 audit되지 않음 → super_admin이 다른 admin의 audit/login-history를 조회해도 흔적 0. 보안 감사에 공백.
- AuditInterceptor가 `next.handle().pipe(tap(...))` 안에서 async 함수를 호출하지만 await 되지 않음. fire-and-forget으로 동작 → 감사 실패가 response에 영향 주지 않지만 unhandled rejection 위험.

## 외부 의존
- `DbService`(via `@Global() DbModule`), `rxjs.tap`, NestJS `@Req`/`@Query` 데코레이터.
