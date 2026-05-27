# `src/config/runtime.ts`

## Header
- 역할 / Role: 환경변수를 import-time에 한 번 읽어 정적 `Runtime` 객체로 노출.
- 진입점에서의 거리: 2 (main.ts → app.module → runtime)
- 라인 수: 14
- 주요 export: `Runtime` (const object)
- 의존 모듈 (internal): 없음
- 사용된 외부 패키지: 없음
- 부수효과: import 시 `process.env` 읽기 1회.
- 동시성 모델: N/A (read-only snapshot).
- 테스트 커버리지 흔적: 없음.

## Line-by-Line Review (Level 2)

```ts path=src/config/runtime.ts lines=1-14
export const Runtime = {
  port: Number(process.env.PORT ?? 8084),
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-prod',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 10),
  totpIssuer: process.env.TOTP_ISSUER ?? 'Guardrails-Admin',
  bootstrapEmail: process.env.ADMIN_BOOTSTRAP_EMAIL ?? '',
  bootstrapPassword: process.env.ADMIN_BOOTSTRAP_PASSWORD ?? '',
  dbDriver: ((process.env.DB_DRIVER ?? 'postgres').toLowerCase() === 'sqlite' ? 'sqlite' : 'postgres') as
    | 'postgres'
    | 'sqlite',
  sqlitePath: process.env.SQLITE_PATH ?? './var/admin.db',
  policyEngineUrl: process.env.POLICY_ENGINE_URL ?? 'http://127.0.0.1:8082',
};
```

**분석 / Analysis (Level 2)**
- L2 `port`: `Number(process.env.PORT ?? 8084)`. ENV가 빈 문자열이면 `Number('')=0` → `app.listen(0)`은 임의 포트 할당. `??`는 빈 문자열을 잡지 못함. **흔한 실수**: env에는 `||` 또는 명시적 length 체크가 더 안전.
- L3 `jwtSecret`: **default `'change-me-in-prod'`**. NestJS는 부트 성공 + 토큰 서명 가능 → prod 실수 시 모든 토큰 forge 가능. **권고: 부재/기본값이면 throw**.
- L4 `jwtExpiresIn`: `'12h'`. `@nestjs/jwt`는 zeit/ms 포맷 또는 초(number)를 허용. 문자열 OK.
- L5 `bcryptRounds`: `Number(... ?? 10)`. ENV가 'abc'면 NaN → bcrypt rounds=NaN. bcryptjs는 NaN을 거부하고 throw할 가능성. 검증 부재.
- L6 `totpIssuer`: 사용자에게 보이는 인증기 앱 라벨. OK.
- L7–8 bootstrap*: 빈 문자열이면 AuthService가 시드 스킵. 둘 중 하나만 있으면 둘 다 truthy 체크에서 skip되어 silent 무시 — 운영자가 의도 파악 어려울 수 있음.
- L9–11 `dbDriver`: `'sqlite' | 'postgres'`로 강제. lowercase 정규화. 안전.
- L12 `sqlitePath`: 상대경로 → cwd 기준. Docker `WORKDIR /app`에 `/app/var/admin.db`로 해석. README/Dockerfile은 `mkdir -p /app/var`로 디렉터리 준비.
- L13 `policyEngineUrl`: localhost default. compose에서는 `http://policy-engine:8082`로 override.

**짚어볼 점 / Watch-outs**
- **JWT_SECRET fail-fast 부재 (Critical).**
- env 입력값 검증 부재 (NaN, 빈 문자열).
- `Runtime`이 import-time 스냅샷이라 Jest에서 `process.env.X='...'`를 테스트 케이스마다 바꿔도 반영 안됨 — `jest.isolateModules` 필요.

## File-level Verdict
- 강점: 한 곳에 환경값 집계 → 발견성 양호.
- 위험: Critical — JWT 기본값 + 검증 부재.
- 개선 권고: zod 스키마로 검증 + 누락 시 throw. ConfigService.forRoot 의 validate 옵션 활용. 비밀값은 file:// secret 또는 Docker secret 적용 권고.
- 재읽기 권고 레벨: **High** — 보안에 직결되는 fallback 정책 변경 시 항상 점검.
