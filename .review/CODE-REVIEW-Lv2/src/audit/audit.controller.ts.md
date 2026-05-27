# src/audit/audit.controller.ts — 코드 리뷰
> 리뷰 레벨: 2
> [← audit_Abstract.md](audit_Abstract.md) · [← INDEX.md](../../INDEX.md)

**파일 요약**
- 역할: `/admin/audit/login-history`, `/admin/audit/actions` 두 read 엔드포인트.
- 진입점 거리: 1 (직접 컨트롤러)
- LOC: 41
- export: `AuditController`
- 의존 모듈: `AuditService`, `AuthedUser`(jwt.guard), `express` Request 타입
- 외부 패키지: `@nestjs/common`, `express`
- 부수효과: 없음(read only). 단, AuditInterceptor가 GET을 skip하므로 super_admin의 cross-account 조회도 audit 미기록(공백).
- 동시성: NestJS request-scoped per call
- 테스트 커버리지: 0

```ts path=src/audit/audit.controller.ts lines=1-41
import { Controller, ForbiddenException, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from './audit.service';
import { AuthedUser } from '../auth/jwt.guard';

@Controller('/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  // Per-user view: own login history. Super_admin can pass userId=*.
  @Get('login-history')
  async myLoginHistory(
    @Req() req: Request,
    @Query('limit') limitStr?: string,
    @Query('userId') queryUserId?: string,
  ) {
    const user = (req as Request & { user: AuthedUser }).user;
    const limit = Math.min(Number(limitStr ?? 100), 1000);
    if (queryUserId && queryUserId !== user.sub) {
      if (user.role !== 'super_admin') throw new ForbiddenException('super_admin_only');
      return { items: await this.audit.listLogin(queryUserId, limit) };
    }
    return { items: await this.audit.listLogin(user.sub, limit) };
  }

  @Get('actions')
  async actions(
    @Req() req: Request,
    @Query('limit') limitStr?: string,
    @Query('action') action?: string,
    @Query('actorId') actorId?: string,
  ) {
    const user = (req as Request & { user: AuthedUser }).user;
    const limit = Math.min(Number(limitStr ?? 200), 1000);
    if (user.role !== 'super_admin') {
      // Non-super_admin: only own audit
      return { items: await this.audit.listAudit({ actorId: user.sub, action, limit }) };
    }
    return { items: await this.audit.listAudit({ actorId, action, limit }) };
  }
}
```

**분석 / Analysis (Level 2)**
- L1–4 import. `import type { Request }` — emit되지 않는 type-only import. 안전.
- L6 `@Controller('/auth')` 처럼 prefix slash로 시작 — Nest 가 정규화. `/admin/audit` 가 됨.
- L10 코멘트 `Super_admin can pass userId=*` 와 실제 코드: `userId` 쿼리에 `'*'` 특수처리는 없음. 코멘트가 의도와 어긋남(혹은 미구현).
- L11–24 `myLoginHistory`:
  - L17: `req as Request & { user: AuthedUser }` — JwtAuthGuard 가 `req.user`에 payload 주입했음을 가정한 강제 캐스팅. `@Public` 라우트가 아니라 안전하지만 타입 안전성↓.
  - L18: `Math.min(Number(limitStr ?? 100), 1000)` — `Number(undefined)`=NaN ↛ ok(생략 시 100), `Number('abc')`=NaN → `Math.min(NaN,1000)=NaN`. NaN은 DbService에 그대로 전달되어 sqlite/pg가 LIMIT NaN을 어떻게 다루는지 미확인(sqlite는 string `'NaN'` 바인딩 시 에러; pg는 NaN을 numeric으로 cast 실패). **잠재 500 에러**.
  - L19: `queryUserId !== user.sub` 비교. 보통 `user.sub`은 UUID, `queryUserId`는 URL string. 인코딩 차이(공백/대소문자)가 미스매치 유발 가능.
  - L20: super_admin이 아니면 403. 정상.
  - L21–23: `userId='*'` 처리 부재 → super_admin이 ‘모두 보기’ 하려면 `userId` 미지정으로 호출해야 함. 그런데 그 경우 L24 분기(`userId=user.sub`)로 가서 자기 것만 보임. **버그/스펙 모순**: super_admin이 전체 로그인 이력을 조회할 수단 없음(`listLoginHistory(null,…)` DB 메서드는 존재).
- L26–40 `actions`:
  - L34: `Math.min(Number(limitStr ?? 200), 1000)` — 동일 NaN 위험.
  - L35: non-super_admin은 자기 actor_id로 강제(좋음).
  - L39: super_admin은 `actorId` 쿼리 사용. **빈 문자열** 입력 시 `{ actorId: '' }` 가 DbService where 분기를 `actor_id = ''`로 만듦 → 결과 0건. UX 함정.

**짚어볼 점** (CRITICAL for Admin)
- **GET이 AuditInterceptor에서 skip** → super_admin의 cross-account 조회가 흔적 없이 가능. compliance 관점에서 read-on-read audit이 필요할 수 있음(SOC2/ISO27001).
- Limit 파싱: NaN 가드 부재 → user-supplied invalid → 500.
- 페이지네이션 없음(offset/cursor). 1000건 hard cap만으로 DB 부하/응답 시간 spike 가능.
- `queryUserId=*` 의도가 코드에 없음 — 코멘트 vs 행동 괴리.
- `action` 쿼리는 `LIKE` 가 아닌 exact match (`action = ?`). prefix/substring 검색 불가.

**파일 수준 평가**
- **강점**: 권한 분기 명확; limit 상한 두 군데 일관.
- **위험**: NaN limit 미가드; super_admin 전체조회 경로 부재; 코멘트/구현 불일치; read audit 공백.
- **개선 권고**:
  1. `userId === '*'` 또는 미지정 시 super_admin은 전체 조회 가능하도록 분기(`listLoginHistory(null, limit)`).
  2. `const safeLimit = Number.isFinite(parsed) ? Math.min(parsed, 1000) : 100;` 패턴.
  3. read 작업도 audit 기록 — `AuditInterceptor` 옵션 또는 별도 `@Audited()` 데코레이터로 read 로깅.
- **재읽기 권고 레벨**: Level 2 (보안 책임 컨트롤러).
