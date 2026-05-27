# `src/auth/auth.module.ts`

## Header
- 역할 / Role: `@Global()` 인증 모듈. JwtModule.register로 비밀키/만료를 설정. APP_GUARD로 글로벌 JwtAuthGuard 등록.
- 진입점에서의 거리: 1
- 라인 수: 25
- 주요 export: `AuthModule`
- 의존 모듈: `../config/runtime`, `./auth.service`, `./auth.controller`, `./jwt.guard`
- 사용된 외부 패키지: `@nestjs/common`, `@nestjs/jwt`, `@nestjs/core` (APP_GUARD)
- 부수효과: import-time에 `Runtime.jwtSecret` 캡처 → JwtModule 인스턴스가 그 값으로 sign/verify.
- 동시성 모델: N/A
- 테스트 커버리지: 없음

## Line-by-Line Review (Level 2)

```ts path=src/auth/auth.module.ts lines=1-25
import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { Runtime } from '../config/runtime';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt.guard';

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: Runtime.jwtSecret,
      signOptions: { expiresIn: Runtime.jwtExpiresIn },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
```

**분석 / Analysis (Level 2)**
- L9 `@Global()` — AuthService를 모든 모듈에서 직접 주입 가능. UsersController/AuditController가 AuthedUser를 req에서 꺼내쓰는 패턴이므로 사실 AuthService 자체는 외부에서 거의 미사용. JwtModule re-export는 가치 있음.
- L12-15 `JwtModule.register` — 동기 register. `Runtime.jwtSecret`을 즉시 캡처. **만약 ENV 누락 시 `'change-me-in-prod'`이 사용됨**.
  - **권고**: `JwtModule.registerAsync({ useFactory: () => { if (!process.env.JWT_SECRET) throw ...; return {secret, signOptions}; }})`.
- L19-20 `APP_GUARD: JwtAuthGuard` — 글로벌 guard. controller에서 `@UseGuards(JwtAuthGuard)`는 사실상 중복(no-op이지만 명시적 의도). `@Public()` 데코레이터가 bypass 키.
- L22 `exports: [AuthService, JwtModule]` — JwtModule 재노출 덕분에 JwtAuthGuard가 다른 모듈 컨텍스트에서도 JwtService 주입 가능. 다만 APP_GUARD는 자동 컨텍스트라 굳이 필요한 export는 아님.

**짚어볼 점**
- secret이 import-time 캡처라 env hot-reload 불가 (intended).
- algorithm 미지정 → @nestjs/jwt 기본 HS256. 미래에 algorithm down-grade 공격 방지를 위해 `verifyOptions.algorithms: ['HS256']`을 명시 권고.

## File-level Verdict
- 강점: 단순. 명확한 글로벌 등록.
- 위험: secret fail-fast 부재 (Critical).
- 개선 권고: `registerAsync` + zod 검증 + algorithms allowlist.
- 재읽기 권고 레벨: **High**.
