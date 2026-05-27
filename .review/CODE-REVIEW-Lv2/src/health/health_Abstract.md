# `src/health/` — Directory Abstract

`GET /admin/health` — 단일 Public 엔드포인트.

## 파일
| 파일 | LOC | 역할 |
| :-- | :-- | :-- |
| health.controller.ts | 19 | DB driver/availability + downstream(Policy Engine) URL 반환 |

## 관찰
- `HealthController`는 AppModule의 `controllers:` 배열에 직접 등록(별도 HealthModule 없음). NestJS는 controllers를 모듈 단위로 모으는 게 관행이지만 1-라우트라면 무방.
- `@Public()` 데코로 JWT 우회 → 로드밸런서/오케스트레이터 헬스체크가 가능.
- 별도 readiness/liveness 분리 없음. 의존성 DB만 노출, Policy Engine 도달 가능성은 정적 URL 보고만.
- HTTP 응답 코드는 항상 200(`isAvailable=false`인 경우에도). 진정한 fail-on-not-ready가 필요하면 422/503 분기 필요.
