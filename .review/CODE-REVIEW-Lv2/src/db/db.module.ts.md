# `src/db/db.module.ts`

## Header
- 역할 / Role: DbService를 `@Global()`로 등록.
- 진입점에서의 거리: 1
- 라인 수: 6
- 주요 export: `DbModule`
- 의존 모듈: `./db.service`
- 사용된 외부 패키지: `@nestjs/common`
- 부수효과: 없음 (declarative)
- 동시성 모델: N/A
- 테스트 커버리지: 없음

## Line-by-Line

```ts path=src/db/db.module.ts lines=1-6
import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';

@Global()
@Module({ providers: [DbService], exports: [DbService] })
export class DbModule {}
```

**분석 / Analysis (Level 2)**
- `@Global()` + exports → singleton DbService가 모든 모듈에서 직접 주입 가능. 정상.
- 잠재 함정: 글로벌 모듈을 늘리면 모듈 격리가 약해진다 — DI 그래프가 암묵적 의존을 가짐. 본 서비스 규모에선 허용 범위.

## File-level Verdict
- 강점: 명확.
- 위험: 없음.
- 개선 권고: 향후 driver 별 sub-module (PgDbModule/SqliteDbModule) 로 분리 가능.
- 재읽기 권고 레벨: Low.
