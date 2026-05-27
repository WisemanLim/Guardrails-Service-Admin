# `src/users/users.module.ts`

## Header
- 역할 / Role: UsersController 등록.
- 진입점에서의 거리: 1
- 라인 수: 5
- 주요 export: `UsersModule`
- 의존 모듈: `./users.controller`
- 사용된 외부 패키지: `@nestjs/common`
- 부수효과: 없음
- 동시성 모델: N/A
- 테스트 커버리지: 없음

## Line-by-Line Review (Level 2)

```ts path=src/users/users.module.ts lines=1-5
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';

@Module({ controllers: [UsersController] })
export class UsersModule {}
```

**분석 / Analysis (Level 2)**
- `providers: []` 생략. UsersController가 의존하는 DbService는 글로벌 DbModule에서 주입.
- 단일 컨트롤러라 service 추출이 과한 추상화. OK.

## File-level Verdict
- 강점: 미니멀.
- 위험: 없음.
- 재읽기 권고 레벨: Low.
