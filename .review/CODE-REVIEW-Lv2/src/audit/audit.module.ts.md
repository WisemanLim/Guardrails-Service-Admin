# src/audit/audit.module.ts — 코드 리뷰
> 리뷰 레벨: 2
> [← audit_Abstract.md](audit_Abstract.md) · [← INDEX.md](../../INDEX.md)

**파일 요약**
- 역할: AuditModule 정의. `@Global()`로 등록되어 AuditService를 다른 모듈에서 주입 가능.
- 진입점 거리: 모듈 정의
- LOC: 11
- export: `AuditModule`, exports `AuditService`
- 의존 모듈: `AuditController`, `AuditService`
- 외부 패키지: `@nestjs/common`
- 부수효과: NestJS DI 트리에 등록
- 동시성: N/A
- 테스트 커버리지: 0

```ts path=src/audit/audit.module.ts lines=1-11
import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

**분석 / Analysis (Level 2)**
- L5 `@Global()` — `AuditService`를 import 없이 어디서나 inject. NestJS 권고는 보통 도메인 service만 global; controller 노출은 부수 효과 없음(controller는 module별 routing이지 DI 노드가 아님).
- L7 controllers — AuditController. global 모듈이라도 controller는 자체 모듈 routing scope에만 등록됨(NestJS 동작).
- L8 providers — AuditService만. AuditInterceptor는 `app.module.ts`에서 APP_INTERCEPTOR로 등록되어 별도 (여기서 등록하지 않음. AuditService를 inject 받을 수 있는 이유는 @Global()).
- L9 exports — AuditService. 명시적 export.

**짚어볼 점**
- AuditInterceptor가 본 모듈에 provider로 들어있지 않은데 app.module.ts의 `{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }`가 동작하려면 NestJS가 AuditInterceptor 인스턴스화 시 AuditService 의존성을 `@Global()` 덕에 resolve. 의존 자체는 동작하지만, 응집도 관점에서 AuditInterceptor도 AuditModule에 두는 게 깔끔.
- `@Global` 남용 — DbModule, AuthModule, AuditModule 모두 global → "어디서나 가져올 수 있다"는 편리함이 의존성 추적을 어렵게 함. 트리거: 테스트 환경 mock module 작성 시 어떤 모듈을 override 해야 할지 모호.

**파일 수준 평가**
- **강점**: 명확하고 짧음.
- **위험**: 글로벌 남용 패턴; AuditInterceptor의 provider 위치 응집도 약함.
- **개선 권고**:
  1. AuditInterceptor를 본 모듈 providers + APP_INTERCEPTOR 등록을 함께 옮겨 응집도 강화.
  2. `@Global()` 사용 정당화 주석.
- **재읽기 권고 레벨**: Level 1.
