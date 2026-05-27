# `src/app.module.ts`

## Header
- 역할 / Role: 루트 NestJS 모듈. 모든 feature 모듈 + Health 컨트롤러 + 글로벌 AuditInterceptor 등록.
- 진입점에서의 거리: 1
- 라인 수: 26
- 주요 export: `AppModule`
- 의존 모듈 (internal): DbModule, AuthModule, UsersModule, AuditModule, RulesModule, HealthController, AuditInterceptor
- 사용된 외부 패키지: `@nestjs/common`, `@nestjs/config`, `@nestjs/core` (APP_INTERCEPTOR)
- 부수효과: ConfigModule.forRoot는 `.env` 로딩 시도. APP_INTERCEPTOR 등록은 글로벌 후크 부착.
- 동시성 모델: N/A (선언만)
- 테스트 커버리지 흔적: 없음

## Line-by-Line Review (Level 2)

```ts path=src/app.module.ts lines=1-26
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AuditModule } from './audit/audit.module';
import { RulesModule } from './rules/rules.module';
import { HealthController } from './health/health.controller';
import { AuditInterceptor } from './audit/audit.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    AuthModule,
    UsersModule,
    AuditModule,
    RulesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
```

**분석 / Analysis (Level 2)**
- L13–20 imports 순서: Config → Db → Auth → Users → Audit → Rules. NestJS는 module dependency graph로 init 순서를 결정. `@Global()` 모듈(Db, Auth, Audit)은 어디서나 주입 가능. `RulesModule`은 DbModule(@Global)과 자체 PolicyClient에 의존.
- L14: `ConfigModule.forRoot({ isGlobal: true })`. 그러나 코드 어디서도 `ConfigService`를 주입하지 않고 `Runtime` 객체에서 `process.env`를 직접 읽음 → ConfigModule이 사실상 dead import (단지 .env 파일 로딩 부수효과만 유효). `.env` 파일 검색 경로는 기본 process.cwd().
- L21: `HealthController`를 AppModule에 직접 등록 — feature 모듈로 분리할 수도 있으나 단일 라우트라 OK.
- L23: `APP_INTERCEPTOR`로 글로벌 인터셉터 등록. 주의: `AuditInterceptor`가 `AuditService`를 주입받는데 `AuditModule`이 `@Global()` + exports에 AuditService가 있어 동작. AppModule providers 컨텍스트로도 풀림.
- L23의 useClass — AppModule 컨텍스트에서 새 인스턴스가 만들어지지만 `AuditService` 의존은 글로벌 module의 export로 풀리므로 singleton 의미를 유지.

**짚어볼 점 / Watch-outs**
- 글로벌 인터셉터가 ConfigModule 로딩보다 늦게 attach되지 않음 — NestJS는 모든 provider 인스턴스화 후 인터셉터 등록. 단, 초기 요청이 도착하기 전에 모든 onModuleInit 완료가 보장.
- ConfigModule.forRoot는 `isGlobal:true`이지만 미사용 → 향후 ConfigService로 마이그레이션 권고.

## File-level Verdict
- 강점: 단순, 명확한 글로벌 등록.
- 위험: ConfigService 미사용 → env 검증/주입 일관성 부족.
- 개선 권고: ConfigModule.forRoot에 `validate` 함수 (zod) 또는 `validationSchema` 사용. 인터셉터 등록 위치 적합.
- 재읽기 권고 레벨: Low.
