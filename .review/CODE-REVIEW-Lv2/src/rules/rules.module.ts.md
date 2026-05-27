# `src/rules/rules.module.ts`

## Header
- 역할 / Role: RulesController + RulesService + PolicyClient 등록.
- 진입점에서의 거리: 1
- 라인 수: 11
- 주요 export: `RulesModule`
- 의존 모듈: `./rules.controller`, `./rules.service`, `../clients/policy.client`
- 사용된 외부 패키지: `@nestjs/common`
- 부수효과: 없음
- 동시성 모델: N/A
- 테스트 커버리지: 없음

## Line-by-Line Review (Level 2)

```ts path=src/rules/rules.module.ts lines=1-11
import { Module } from '@nestjs/common';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';
import { PolicyClient } from '../clients/policy.client';

@Module({
  controllers: [RulesController],
  providers: [RulesService, PolicyClient],
  exports: [RulesService],
})
export class RulesModule {}
```

**분석 / Analysis (Level 2)**
- `@Global()` 미사용 — 깔끔한 격리.
- `PolicyClient`는 이 모듈 안에서만 인스턴스화. 다른 모듈에서 import 시 별도 등록 필요.
- `RulesService` export는 호출자(향후) 위한 안전책 — 현재는 unused.

## File-level Verdict
- 강점: 격리.
- 위험: 없음.
- 재읽기 권고 레벨: Low.
