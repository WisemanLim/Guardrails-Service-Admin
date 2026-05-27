# `src/clients/` — Directory Abstract

외부 서비스에 대한 HTTP 클라이언트 슬롯.

## 파일
| 파일 | LOC | 역할 |
| :-- | :-- | :-- |
| policy.client.ts | 21 | Policy Engine `/policies/invalidate` POST (timeout 3s, 실패 swallow + warn) |

## 관찰
- 단일 클라이언트만 존재. 향후 외부 서비스(Detection Engine 등)와 통신할 경우 본 디렉터리로 격리.
- `PolicyClient`는 RulesModule의 provider로만 등록. global이 아님.
- baseURL = `Runtime.policyEngineUrl` (`process.env.POLICY_ENGINE_URL`, default `http://localhost:8082`).
- 인증 헤더 없음 — Policy Engine은 내부망 신뢰 가정.
- retry/circuit breaker 없음. 실패는 일회 warn 후 무시.
