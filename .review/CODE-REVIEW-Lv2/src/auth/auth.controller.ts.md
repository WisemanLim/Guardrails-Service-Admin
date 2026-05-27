# `src/auth/auth.controller.ts`

## Header
- 역할 / Role: `/auth/*` HTTP 라우트. Public(register/login) + Bearer(me/totp/qr/totp/enable/password).
- 진입점에서의 거리: 1
- 라인 수: 55
- 주요 export: `AuthController`
- 의존 모듈: `./auth.service`, `./dto`, `./jwt.guard`, `./public.decorator`
- 사용된 외부 패키지: `@nestjs/common`, `express` (Request 타입)
- 부수효과: AuthService 호출 (DB write / JWT sign / TOTP gen)
- 동시성 모델: 컨트롤러 핸들러는 비동기 함수. NestJS가 promise resolution을 response에 매핑.
- 테스트 커버리지: 없음

## Line-by-Line Review (Level 2)

```ts path=src/auth/auth.controller.ts lines=1-13
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto, EnableTotpDto, LoginDto, RegisterDto } from './dto';
import { JwtAuthGuard, AuthedUser } from './jwt.guard';
import { Public } from './public.decorator';

function clientCtx(req: Request) {
  const xff = (req.headers['x-forwarded-for'] as string) ?? '';
  const ip = xff.split(',')[0]?.trim() || req.ip || undefined;
  const userAgent = (req.headers['user-agent'] as string) ?? undefined;
  return { ip, userAgent };
}
```

**분석 / Analysis (Level 2)**
- L9 `clientCtx`: **`x-forwarded-for` 헤더의 첫 IP를 무조건 신뢰**. 프록시 신뢰 화이트리스트(`trust proxy` Express 설정) 없음 → 클라이언트가 임의 헤더로 ip 위조 가능 (audit log 위조).
  - 권고: Express `app.set('trust proxy', '<known-proxies>')` + `req.ip`만 사용.
- `req.ip`는 fallback. 단, `trust proxy` 미설정이면 `req.ip`는 직접 연결 소켓 ip — 컨테이너 환경에선 reverse proxy ip가 들어옴.
- `string[]` xff(여러 IP)는 `.toString()`이 콤마 join이라 split 처리 OK.
- userAgent는 그대로. 길이 검증 없음 — DB에 너무 긴 UA가 들어가도 TEXT 허용.

**짚어볼 점**
- IP spoofing 위험 (audit/login_history 신뢰성 저하).

```ts path=src/auth/auth.controller.ts lines=15-30
@Controller('/auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.password, dto.role);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, dto.totp, clientCtx(req));
  }
```

**분석 / Analysis (Level 2)**
- L16 `@UseGuards(JwtAuthGuard)` — 컨트롤러 레벨. 글로벌 APP_GUARD가 이미 적용되어 있어 사실상 중복. 두 번 거치지는 않음 (NestJS는 동일 guard를 중복 호출하지 않음 — guard 인스턴스가 같으면).
- L20-24 **`@Public() POST /register`** — 본 서비스 가장 큰 보안 이슈. PRD가 super_admin/admin 모델이라면 register는 super_admin 권한 또는 invite-token 모델이어야 함.
- L22 `register(dto.email, dto.password, dto.role)` — dto.role을 그대로 전달. **클라이언트가 super_admin 지정 가능** → 누구나 super_admin self-register. 운영 환경에서 노출 시 즉시 root 권한.
- L26-30 `login` — DTO 검증 후 service 호출. clientCtx로 IP/UA 추출. rate limit 없음.

**짚어볼 점**
- register endpoint를 super_admin Bearer로 보호하거나 disable 권고.
- role 화이트리스트를 서버에서 강제: viewer만 self-register 허용, admin/super_admin은 server-side가 강제.
- login에 throttler 적용.

```ts path=src/auth/auth.controller.ts lines=32-54
  @Get('me')
  me(@Req() req: Request) {
    const user = (req as Request & { user: AuthedUser }).user;
    return this.auth.me(user.sub);
  }

  @Get('totp/qr')
  totpQr(@Req() req: Request) {
    const user = (req as Request & { user: AuthedUser }).user;
    return this.auth.totpQr(user.sub);
  }

  @Post('totp/enable')
  enableTotp(@Body() dto: EnableTotpDto, @Req() req: Request) {
    const user = (req as Request & { user: AuthedUser }).user;
    return this.auth.enableTotp(user.sub, dto.totp);
  }

  @Post('password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request) {
    const user = (req as Request & { user: AuthedUser }).user;
    return this.auth.changePassword(user.sub, dto.currentPassword, dto.newPassword);
  }
}
```

**분석 / Analysis (Level 2)**
- `(req as Request & { user: AuthedUser }).user` — 4회 반복. NestJS에서는 `@Req()` 대신 커스텀 `@CurrentUser()` 파라미터 데코레이터로 깔끔하게 추출 가능. 보일러플레이트 + 캐스팅 안전성 ↑.
- `req.user`는 `JwtAuthGuard`가 채워주는 것이므로 글로벌 guard 통과 후만 정의. 만약 `@Public()` 라우트에서 이 패턴을 잘못 쓰면 undefined.sub crash.
- `enableTotp`: 입력 코드 검증만, 이미 enabled 상태에서도 다시 enable 호출 가능 → idempotent하나 audit 트래픽 발생.
- `changePassword`: 이전 비밀번호 + 새 비밀번호. AuditInterceptor가 payload에서 두 키 모두 strip하므로 안전.
- **누락**: 비밀번호 변경 후 기존 JWT 무효화 부재 — 비밀번호 바뀌어도 기존 토큰은 만료 전까지 유효. 토큰 블랙리스트 또는 `password_changed_at` 시각 클레임 비교 필요.

**짚어볼 점**
- `req.user` 캐스팅 보일러플레이트.
- 비밀번호 변경 후 토큰 revocation 부재.
- TOTP disable/리셋 API 부재 — 잃어버린 경우 super_admin 도구 없음.

## File-level Verdict
- 강점: NestJS 컨벤션 준수. DTO 검증.
- 위험: register 공개 (Critical), IP spoof, 토큰 revocation 부재.
- 개선 권고: register 보호, throttler, `@CurrentUser()`, password 변경 시 token version bump.
- 재읽기 권고 레벨: **High**.
