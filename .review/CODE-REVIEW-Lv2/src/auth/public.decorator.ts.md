# `src/auth/public.decorator.ts`

## Header
- 역할 / Role: `@Public()` 데코레이터. 라우트 또는 컨트롤러에 `PUBLIC_KEY` 메타데이터 부착 → JwtAuthGuard에서 bypass.
- 진입점에서의 거리: 2
- 라인 수: 3
- 주요 export: `Public`
- 의존 모듈: `./jwt.guard` (PUBLIC_KEY)
- 사용된 외부 패키지: `@nestjs/common` (SetMetadata)
- 부수효과: 데코레이터 적용 시 메타데이터 부착.
- 동시성 모델: N/A
- 테스트 커버리지: 없음

## Line-by-Line Review (Level 2)

```ts path=src/auth/public.decorator.ts lines=1-3
import { SetMetadata } from '@nestjs/common';
import { PUBLIC_KEY } from './jwt.guard';
export const Public = () => SetMetadata(PUBLIC_KEY, true);
```

**분석 / Analysis (Level 2)**
- `SetMetadata(PUBLIC_KEY, true)` — Reflector가 `getAllAndOverride`로 추출.
- **순환 가능성**: decorator는 guard 모듈에서 `PUBLIC_KEY`만 import. guard는 decorator를 import하지 않음 → 단방향. 안전.
- 그러나 향후 guard 파일이 decorator를 import하면 circular import 발생. 권고: `auth.constants.ts`에 상수 분리.
- 데코레이터 factory 형태(`() => SetMetadata(...)`)는 NestJS 컨벤션. metadata key를 사용 시 더 유연성을 위해 `Reflector.createDecorator`(@nestjs/core)도 가능하지만 현 형태로 충분.

**짚어볼 점**
- 향후 코드 확장 시 순환 import 위험 → 상수 분리.

## File-level Verdict
- 강점: 단순.
- 위험: 없음.
- 개선 권고: PUBLIC_KEY 상수 별도 파일로.
- 재읽기 권고 레벨: Low.
