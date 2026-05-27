# src/health/health.controller.ts — 코드 리뷰
> 리뷰 레벨: 2
> [← health_Abstract.md](health_Abstract.md) · [← INDEX.md](../../INDEX.md)

**파일 요약**
- 역할: `/admin/health` Public 헬스체크.
- 진입점 거리: 1
- LOC: 19
- export: `HealthController`
- 의존 모듈: `DbService`, `Runtime`, `Public`
- 외부 패키지: `@nestjs/common`
- 부수효과: 없음
- 동시성: stateless
- 테스트 커버리지: 0

```ts path=src/health/health.controller.ts lines=1-19
import { Controller, Get } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Runtime } from '../config/runtime';
import { Public } from '../auth/public.decorator';

@Controller('/health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get()
  health() {
    return {
      status: 'ok',
      db: { driver: this.db.driver, available: this.db.isAvailable() },
      downstream: { policy: Runtime.policyEngineUrl },
    };
  }
}
```

**분석 / Analysis (Level 2)**
- L4 `Public` import — JwtAuthGuard 우회.
- L6 `@Controller('/health')` → `/admin/health`.
- L11 `@Get()` → `GET /admin/health`.
- L12–17 응답:
  - L13 `status: 'ok'` — **항상 'ok'**. DB unavailable이어도 ok 반환. 로드밸런서가 200을 healthy로 해석하면 죽은 인스턴스에 트래픽 보냄.
  - L14 `db.driver`, `db.isAvailable()` — DbService에서 노출. `_available`은 onModuleInit에서 connect 성공 시만 true.
  - L15 `downstream.policy: Runtime.policyEngineUrl` — URL 문자열만. ping 안 함.
- DbService.driver는 readonly Runtime.dbDriver 기반.
- 응답에 timestamp/uptime/version 미포함.

**짚어볼 점** (CRITICAL for Admin)
- **DB unavailable 시 200 응답**: liveness/readiness 분리 필요. K8s readinessProbe가 200을 healthy로 받으면 traffic 받고 즉시 500 발생. 권고: `if (!this.db.isAvailable()) res.status(503)`.
- **downstream Policy Engine 실제 도달성 미점검** — URL만 echo. healthcheck로서 가치 낮음.
- **버전/빌드 SHA 없음** → 배포 검증 불가.
- **timestamp 없음** → 캐시(특히 CDN)가 응답 캐싱 시 stale.
- **인증 미요구는 OK**(헬스체크 패턴)이지만 응답에 driver 이름이 노출되어 reconnaissance leak. 권고: 인증된 환경에서만 상세 노출.

**파일 수준 평가**
- **강점**: 단순; Public 명시.
- **위험**: 항상 200(가용성 미반영); ping-only-by-name downstream; 버전/timestamp 부재.
- **개선 권고**:
  1. `@Res()`로 응답 코드 분기: `(this.db.isAvailable() ? 200 : 503)`.
  2. `version: process.env.GIT_SHA ?? 'dev'`, `timestamp: new Date().toISOString()` 추가.
  3. Policy Engine은 별도 `/health/ready`에서 가벼운 ping(`HEAD /policies/invalidate`나 `/health`)으로 확인 + timeout 500ms.
  4. liveness(/health/live)와 readiness(/health/ready) 분리.
- **재읽기 권고 레벨**: Level 1.
