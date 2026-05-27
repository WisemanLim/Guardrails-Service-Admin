# `src/auth/auth.service.ts`

## Header
- 역할 / Role: 인증/계정 비즈니스 로직 — bcrypt, otplib, qrcode, JwtService.signAsync. 부트스트랩 super_admin 생성.
- 진입점에서의 거리: 2
- 라인 수: 141
- 주요 export: `AuthService`
- 의존 모듈: `../db/db.service`, `../config/runtime`
- 사용된 외부 패키지: `bcryptjs`, `otplib`, `qrcode`, `@nestjs/jwt`, `@nestjs/common`
- 부수효과: DB write (insertUser, insertLoginHistory, updateUser*, touchUserLastLogin), JWT sign, TOTP secret 생성, QR data URL 생성, console log
- 동시성 모델: async 메서드 직선 구조. 동일 user에 대한 concurrent login은 DB 인덱스 + bcrypt 비교가 thread-safe (Node single-thread).
- 테스트 커버리지: 없음

## Line-by-Line Review (Level 2)

### Imports + class declaration

```ts path=src/auth/auth.service.ts lines=1-18
import { BadRequestException, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { DbService } from '../db/db.service';
import { Runtime } from '../config/runtime';

interface LoginContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger(AuthService.name);

  constructor(private readonly db: DbService, private readonly jwt: JwtService) {}
```

**분석 / Analysis (Level 2)**
- `bcryptjs`는 pure-JS. native `bcrypt`보다 느리고 CPU bound 작업이 Node main thread에서 실행 → 동시 로그인 100건이면 bcrypt가 직렬화되어 latency 폭증. argon2 또는 native bcrypt + worker pool 권고.
- `otplib.authenticator` 기본 옵션: SHA1, 30s step, 6 digits, ±1 window. 표준이지만 SHA1 deprecated — SHA256 옵션 가능 (RFC 6238).
- `import * as QRCode from 'qrcode'` — CJS 호환 import. `QRCode.toDataURL`은 PNG base64 dataURL을 반환 (~1-2KB).

### onModuleInit (Bootstrap super_admin)

```ts path=src/auth/auth.service.ts lines=20-28
  async onModuleInit() {
    if (!Runtime.bootstrapEmail || !Runtime.bootstrapPassword) return;
    const existing = await this.db.findUserByEmail(Runtime.bootstrapEmail);
    if (existing) return;
    const hash = await bcrypt.hash(Runtime.bootstrapPassword, Runtime.bcryptRounds);
    const secret = authenticator.generateSecret();
    await this.db.insertUser(Runtime.bootstrapEmail, hash, secret, 'super_admin');
    this.log.warn(`Bootstrap super_admin created: ${Runtime.bootstrapEmail} (TOTP secret stored, enroll via /auth/totp/qr).`);
  }
```

**분석 / Analysis (Level 2)**
- L21: 두 env가 모두 있어야 시드. 안전한 short-circuit.
- L22 `findUserByEmail` — 멱등성 보장. **race condition**: 동시에 두 워커가 startup 시 둘 다 existing=null이면 두 번 insert? — admin_users.email UNIQUE 제약이 두 번째를 throw → 두 번째 워커가 crash. 단일 인스턴스 가정이라 사실상 미발생. 다중 인스턴스 배포면 startup race 가능.
- L24 `bcrypt.hash(...rounds)` — `bcryptRounds`가 NaN/0/100이면? bcryptjs는 rounds<4면 throw, rounds>31이면 거의 무한 시간. Runtime에서 검증 없으므로 risky.
- L25 `authenticator.generateSecret()` — 32-char base32 (~160 bit). OK.
- L26 `insertUser(... secret, 'super_admin')` — TOTP secret이 **평문으로 DB**. 부트스트랩 단계에서 운영자는 enroll 안된 상태. `/auth/totp/qr`로 QR 받아 enroll. totp_enabled=false 초기값. 즉, **부트스트랩 super_admin은 처음에 TOTP 없이 로그인 가능** (`user.totp_enabled`가 false). 운영자가 즉시 enroll하지 않으면 패스워드만으로 root 접근.
- L27 log.warn — 좋음 (audit trail).

**짚어볼 점**
- 부트스트랩 직후 TOTP enroll 강제 부재.
- bcryptRounds 검증 부재.

### register

```ts path=src/auth/auth.service.ts lines=30-51
  async register(email: string, password: string, role: 'admin'|'super_admin'|'viewer' = 'admin') {
    if (await this.db.findUserByEmail(email)) {
      throw new BadRequestException('email_already_registered');
    }
    const hash = await bcrypt.hash(password, Runtime.bcryptRounds);
    const totpSecret = authenticator.generateSecret();
    const user = await this.db.insertUser(email, hash, totpSecret, role);
    const otpauth = authenticator.keyuri(email, Runtime.totpIssuer, totpSecret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      totp: {
        otpauth,
        secret: totpSecret,
        qrDataUrl,
        enabled: false,
        hint: '...',
      },
    };
  }
```

**분석 / Analysis (Level 2)**
- L30 `role` default 'admin'. **클라이언트가 dto.role을 전달하면 그대로 사용**. `RegisterDto.role`은 `@IsOptional() @IsString()`만 — enum 검증 없음 (`@IsIn(['admin','super_admin','viewer'])` 누락). **결과**: 임의 문자열 가능 → DB CHECK 제약(admin|super_admin|viewer)에 의해 insert 실패. 그러나 'super_admin'은 valid → **누구나 self-register로 super_admin 가능**.
- L31 `findUserByEmail` + 이후 `insertUser`는 race condition 표면이지만 UNIQUE 제약이 backstop.
- L34-35 bcrypt + TOTP gen — onModuleInit과 같은 패턴.
- L36 `insertUser` — totp_enabled=false 초기. login 시 TOTP gate 자동 비활성.
- L37-38 `otpauth` URI: `otpauth://totp/<issuer>:<email>?secret=...&issuer=...`. QR 인코딩.
- L43-49 응답에 **`secret: totpSecret` 평문 노출** — 운영자가 secret 백업/재입력 가능하게 한 설계. 그러나 self-register라면 secret이 외부로 그대로 떨어짐.
- 응답에 password hash는 미포함 (좋음). user.id, email, role만 안전.

**짚어볼 점**
- role enum 화이트리스트 부재.
- self-register 비공개화.

### totpQr / enableTotp

```ts path=src/auth/auth.service.ts lines=53-69
  async totpQr(userId: string) {
    const user = await this.db.findUserById(userId);
    if (!user || !user.totp_secret) throw new BadRequestException('totp_not_enrolled');
    const otpauth = authenticator.keyuri(user.email, Runtime.totpIssuer, user.totp_secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    return { otpauth, qrDataUrl, enabled: user.totp_enabled };
  }

  async enableTotp(userId: string, code: string) {
    const user = await this.db.findUserById(userId);
    if (!user || !user.totp_secret) throw new BadRequestException('totp_not_enrolled');
    if (!authenticator.check(code, user.totp_secret)) {
      throw new UnauthorizedException('invalid_totp');
    }
    await this.db.updateUserTotpEnabled(userId, true);
    return { enabled: true };
  }
```

**분석 / Analysis (Level 2)**
- `totpQr`은 인증된 사용자가 자기 secret을 다시 가져옴. **언제든 호출 가능** → 토큰 도용된 공격자가 secret을 추출. 정상적인 운영자가 한 번 enroll한 뒤에는 호출 차단해야 보안 강화.
- `authenticator.check(code, secret)` — otplib 기본 window±1. timing-safe 비교를 라이브러리가 내부적으로 함.
- `enableTotp`은 이미 enabled여도 갱신 작동 — idempotent.
- 재시도 제한 없음 → 패스워드는 알지만 secret을 모르는 공격자가 brute-force 가능 (6-digit, 10^6).

**짚어볼 점**
- TOTP code brute force 방어 (rate limit 또는 incremental backoff) 부재.
- 이미 enabled된 secret을 재공개하는 totpQr 경로.

### login (핵심)

```ts path=src/auth/auth.service.ts lines=71-119
  async login(email, password, totp, ctx: LoginContext) {
    const user = await this.db.findUserByEmail(email);
    if (!user) {
      await this.db.insertLoginHistory({ user_id:null, email, ip:..., user_agent:..., success:false, reason:'no_such_user' });
      throw new UnauthorizedException('invalid_credentials');
    }
    if (user.status !== 'active') {
      await this.db.insertLoginHistory({...success:false, reason:'disabled'});
      throw new UnauthorizedException('account_disabled');
    }
    if (!(await bcrypt.compare(password, user.password_hash))) {
      await this.db.insertLoginHistory({...reason:'bad_password'});
      throw new UnauthorizedException('invalid_credentials');
    }
    if (user.totp_enabled) {
      if (!totp) throw new UnauthorizedException('totp_required');
      if (!user.totp_secret || !authenticator.check(totp, user.totp_secret)) {
        await this.db.insertLoginHistory({...reason:'bad_totp'});
        throw new UnauthorizedException('invalid_totp');
      }
    }
    const token = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { secret: Runtime.jwtSecret, expiresIn: Runtime.jwtExpiresIn },
    );
    await this.db.touchUserLastLogin(user.id);
    await this.db.insertLoginHistory({...success:true});
    return { token, tokenType:'Bearer', expiresIn: Runtime.jwtExpiresIn, user: {...} };
  }
```

**분석 / Analysis (Level 2)**
- **Timing attack**: `findUserByEmail`이 null이면 bcrypt.compare를 skip → user enumeration 가능 (response time 차). 일반적 완화: 항상 bcrypt.compare(password, DUMMY_HASH) 실행해 시간을 균일화.
- **TOTP required, no totp 입력**: history 미기록 (L86 skip → 바로 throw). reason 누락 → forensic blind spot. 권고: `reason:'totp_required'` 기록 후 throw.
- **`authenticator.check`가 null secret면 위 `||`로 skip** — 안전.
- **`jwt.signAsync`가 secret을 다시 전달**: `auth.module.ts`에서 이미 register한 secret과 동일한 값을 또 명시. JwtModule의 등록 신뢰가 약해짐 + 두 곳에서 secret을 읽음 (rotation 시 양쪽 변경 필요는 없지만 코드 일관성 ↓).
- **JWT 클레임**: `sub, email, role`만. `iat`은 lib가 자동 추가. `iss, aud, jti`는 없음. token revocation/replay 추적 안됨.
- **`expiresIn: Runtime.jwtExpiresIn`이 응답에 그대로** — '12h' 문자열 그대로 클라이언트로. 일관적인 정수(초) 또는 RFC 7521 expires_at(unix) 권고. SDK 호환 ↓.
- **`touchUserLastLogin` + `insertLoginHistory`가 별개 query** — 트랜잭션 아님. 둘 중 하나 실패 시 일관성 ↓.
- bcrypt.compare는 timing-safe 비교를 라이브러리가 처리.

**짚어볼 점**
- timing attack mitigations 부재.
- jti/iss/aud 클레임 부재.
- expiresIn 문자열 응답.
- login history 'totp_required' 케이스 누락.
- rate limit 부재.

### changePassword / me

```ts path=src/auth/auth.service.ts lines=121-140
  async changePassword(userId, currentPassword, newPassword) {
    const user = await this.db.findUserById(userId);
    if (!user) throw new UnauthorizedException('invalid_token');
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      throw new UnauthorizedException('invalid_credentials');
    }
    const newHash = await bcrypt.hash(newPassword, Runtime.bcryptRounds);
    await this.db.updateUserPassword(userId, newHash);
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.db.findUserById(userId);
    if (!user) throw new UnauthorizedException('invalid_token');
    return {
      id: user.id, email: user.email, role: user.role,
      totpEnabled: user.totp_enabled, status: user.status,
      lastLoginAt: user.last_login_at, createdAt: user.created_at,
    };
  }
```

**분석 / Analysis (Level 2)**
- `changePassword` — 새 비밀번호 강도 검증은 DTO의 `MinLength(8)`이 유일. 1234abcd 통과. 사전 비교/공통 패스워드 차단 부재.
- 비밀번호 변경 후 기존 토큰은 expiresIn까지 유효. 토큰 strategy에 `pwd_version` 클레임 추가 + verify 시 비교 권고.
- `me`는 password_hash/totp_secret 등 민감 필드 제외하고 camelCase로 매핑. **이 매핑이 일관되지 않은 곳**(listUsers 등 snake_case 응답)과 비교.

## File-level Verdict

**강점**
- 실패 경로마다 login_history 기록 (대부분 케이스 커버).
- bcrypt + TOTP 결합 2FA.
- 비밀번호/TOTP는 응답에서 strip.

**위험**
- TOTP secret 평문 DB 저장 + register 응답에 평문 노출 (Critical).
- self-register가 super_admin role을 자유 지정 (Critical).
- timing attack로 user enumeration.
- bcryptRounds 검증 부재.
- 토큰 jti/iss/aud 부재, 비밀번호 변경 후 revocation 없음.
- rate limit 부재.
- xff IP 신뢰 (audit 신뢰성 ↓).

**개선 권고**
- TOTP secret을 application-layer AES-GCM으로 wrapping.
- register 보호 (super_admin Bearer 또는 invite-token).
- role 화이트리스트를 서버에서 강제.
- bcrypt.compare with dummy hash for user enumeration mitigation.
- `@nestjs/throttler` 적용.
- JWT 클레임 확장 + revocation 전략.
- token expiresIn 정수(초)로 응답.
- 'totp_required' 케이스도 login_history 기록.

**재읽기 권고 레벨: Critical** — 단일 보안 핫스팟. PR마다 정밀 리뷰 필수.
