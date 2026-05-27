# src/audit/audit.service.ts — 코드 리뷰
> 리뷰 레벨: 2
> [← audit_Abstract.md](audit_Abstract.md) · [← INDEX.md](../../INDEX.md)

**파일 요약**
- 역할: DbService의 audit 관련 메서드에 대한 얇은 facade.
- 진입점 거리: AuditInterceptor + AuditController 양쪽 사용
- LOC: 37
- export: `AuditService`
- 의존 모듈: `DbService`
- 외부 패키지: `@nestjs/common`
- 부수효과: DB write (`insertAuditLog`)
- 동시성: 각 호출이 DB I/O
- 테스트 커버리지: 0

```ts path=src/audit/audit.service.ts lines=1-37
import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  async record(opts: {
    actorId?: string | null;
    actorEmail?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    payload?: unknown;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await this.db.insertAuditLog({
      actor_id: opts.actorId ?? null,
      actor_email: opts.actorEmail ?? null,
      action: opts.action,
      target_type: opts.targetType ?? null,
      target_id: opts.targetId ?? null,
      payload: opts.payload ?? null,
      ip: opts.ip ?? null,
      user_agent: opts.userAgent ?? null,
    });
  }

  listLogin(userId: string | null, limit = 100) {
    return this.db.listLoginHistory(userId, limit);
  }

  listAudit(opts: { actorId?: string; action?: string; limit?: number }) {
    return this.db.listAuditLog(opts);
  }
}
```

**분석 / Analysis (Level 2)**
- L8–28 `record`: 단순 키 매핑(camelCase→snake_case). 모든 옵션은 nullable로 정규화 → DbService.insertAuditLog의 NOT NULL 컬럼(`action`만 NOT NULL인 SQLite schema) 충족 보장은 호출자 책임.
- L18 `await this.db.insertAuditLog(...)` — 단일 row insert. 트랜잭션 묶음 없음(per-call commit).
- L22 `target_type: opts.targetType ?? null` — DbService 시그니처는 `string | null`. OK.
- L24 `payload: opts.payload ?? null` — DbService에서 sqlite는 `JSON.stringify`, pg는 raw 객체. null이면 둘 다 null insert.
- L30–32 `listLogin(userId, limit=100)`: db pass-through. limit 기본 100, 호출자(컨트롤러)도 100 디폴트 — 두 군데 디폴트 중복.
- L34–36 `listAudit(opts)`: 동일 pass-through. DbService의 limit 기본은 200, AuditService 디폴트 없음. 즉 컨트롤러에서 200 디폴트 → service → db 200 디폴트. 의도 일관.

**짚어볼 점**
- 오로지 thin wrapper — Service layer가 추가 가치 없는 패턴. 단일 책임 원칙 관점에서 OK이지만, 추후 PII 마스킹/샘플링 로직이 추가될 자리.
- `record` 실패 시 호출자(`AuditInterceptor`)가 await 안 함 → silent loss. AuditService 단독 책임 아님.
- 로그가 없음(`Logger` 미사용). DB write 실패가 흡수되면 디버깅 단서 없음.
- `record` 가 promise를 반환하지만 호출 측이 fire-and-forget. 명시적 `void Promise.allSettled` 패턴이 더 안전할 수도.

**파일 수준 평가**
- **강점**: 깔끔한 facade.
- **위험**: 가치 부여 부재; 로그 없음.
- **개선 권고**:
  1. `this.log.warn(...)` 추가로 실패 가시화.
  2. payload 크기 cap + secret deep-mask를 본 서비스에서 책임지면 응집도 ↑.
- **재읽기 권고 레벨**: Level 1.
