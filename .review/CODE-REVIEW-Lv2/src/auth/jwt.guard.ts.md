# `src/auth/jwt.guard.ts`

## Header
- 역할 / Role: 글로벌 APP_GUARD. Bearer 토큰 추출 + `JwtService.verifyAsync`로 payload 검증 + `@Public()` 데코레이터 통과.
- 진입점에서의 거리: 1 (모든 라우트의 pre-handler)
- 라인 수: 37
- 주요 export: `JwtAuthGuard`, `AuthedUser`, `PUBLIC_KEY`
- 의존 모듈: `../config/runtime`
- 사용된 외부 패키지: `@nestjs/common`, `@nestjs/jwt`, `@nestjs/core` (Reflector)
- 부수효과: req.user 채우기, token verification (CPU 작업 비동기).
- 동시성 모델: 모든 요청에 대해 1회 호출. 동기 헤더 파싱 + 비동기 verify.
- 테스트 커버리지: 없음

## Line-by-Line Review (Level 2)

```ts path=src/auth/jwt.guard.ts lines=1-37
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Runtime } from '../config/runtime';

export interface AuthedUser {
  sub: string;
  email: string;
  role: string;
}

export const PUBLIC_KEY = 'public_route';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const auth = (req.headers.authorization ?? '').toString();
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) throw new UnauthorizedException('missing_bearer_token');
    try {
      const payload = await this.jwt.verifyAsync<AuthedUser>(m[1], { secret: Runtime.jwtSecret });
      req.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('invalid_token');
    }
  }
}
```

**분석 / Analysis (Level 2)**
- **`AuthedUser` 인터페이스**: sub, email, role. AuthService.login이 채워주는 payload와 일치. 만약 토큰이 외부(서드파티)로부터 위조되어 sub만 있고 email/role이 누락되면 TypeScript는 모름 — runtime에 undefined 가능.
- L11 `PUBLIC_KEY = 'public_route'` — 모듈 import 순환 회피 위해 guard에 상수 보관. `public.decorator.ts`가 이 상수를 import → 의존 방향: decorator → guard. 사실 상수만의 별도 파일이 더 깨끗.
- L19-22 `getAllAndOverride([handler, class])` — handler 데코레이터가 우선. controller에 `@Public()`이 있어도 method 데코레이터로 override 가능.
- L26 `auth.headers.authorization ?? ''` — 헤더 없으면 빈 문자열. `.toString()`은 array-headers를 safe하게 처리.
- L27 정규식 `^Bearer\s+(.+)$` — case insensitive. 토큰에 trailing space가 있어도 match. `(.+)`는 줄바꿈 제외 — JWT는 줄바꿈 없으니 OK.
- L30 **`verifyAsync(m[1], { secret: Runtime.jwtSecret })`** — secret이 module-level Runtime에서 두 번째로 캡처. JwtModule.register와 별개. **만약 두 secret 출처가 미래에 분기되면 verify와 sign이 어긋날 위험**.
- L30 verifyAsync은 algorithm 화이트리스트 없음 — 기본은 HS* 류만 허용 (lib 기본), 그러나 명시적 `algorithms: ['HS256']` 권고 (알고리즘 down-grade 방어).
- L32 `req.user = payload` — Express req 객체 변형. TypeScript declaration merging 없음 → controller에서 `(req as Request & { user: AuthedUser })` 캐스팅 필요.
- L34 catch — verifyAsync의 모든 에러(expired, invalid signature, malformed) → `invalid_token`. 디버깅 어려움. 운영 환경에서는 OK (information leak 최소화).
- 토큰 black list 없음 → 비밀번호 변경/role 변경/계정 정지 후에도 만료 전까지 토큰 유효.

**짚어볼 점**
- algorithms 화이트리스트 명시 권고.
- declaration merging으로 `Express.Request.user` 글로벌 타입 확장 → 캐스팅 제거 가능.
- secret 두 곳 캡처 — 단일 소스화 권고.
- token revocation 메커니즘 부재.

## File-level Verdict

**강점**
- @Public() 데코레이터로 명확한 화이트리스트.
- 정규식 Bearer 파싱 안전.
- async verify로 main thread blocking 최소.

**위험**
- algorithm allowlist 미명시.
- secret 두 곳에서 캡처.
- token revocation 메커니즘 없음.

**개선 권고**
- `verifyAsync(..., { algorithms: ['HS256'], issuer: ..., audience: ... })` 명시.
- declaration merging.
- TokenVersion / pwd_version 클레임 + DB 비교.

**재읽기 권고 레벨: High** — 모든 인증 트래픽이 통과하는 핵심 코드.
