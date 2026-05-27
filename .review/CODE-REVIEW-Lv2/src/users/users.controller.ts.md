# `src/users/users.controller.ts`

## Header
- 역할 / Role: `GET /admin/users` — super_admin만 admin 계정 리스트 조회.
- 진입점에서의 거리: 1
- 라인 수: 18
- 주요 export: `UsersController`
- 의존 모듈: `../db/db.service`, `../auth/jwt.guard`
- 사용된 외부 패키지: `@nestjs/common`, `express`
- 부수효과: DB read
- 동시성 모델: 단일 async 핸들러
- 테스트 커버리지: 없음

## Line-by-Line Review (Level 2)

```ts path=src/users/users.controller.ts lines=1-18
import { Controller, ForbiddenException, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DbService } from '../db/db.service';
import { AuthedUser } from '../auth/jwt.guard';

@Controller('/users')
export class UsersController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@Req() req: Request) {
    const user = (req as Request & { user: AuthedUser }).user;
    if (user.role !== 'super_admin') {
      throw new ForbiddenException('super_admin_only');
    }
    return { items: await this.db.listUsers() };
  }
}
```

**분석 / Analysis (Level 2)**
- L11 `async list` — 글로벌 JwtAuthGuard 통과 후 호출. req.user 정의 보장.
- L12 캐스팅 보일러플레이트 — auth/audit/rules controllers와 동일 패턴.
- L13 **인가 체크가 컨트롤러 내부에서 if문으로** — 데코레이터/가드로 분리 권고. e.g. `@Roles('super_admin')` + `RolesGuard`.
- L16 `db.listUsers()` — DbService 디폴트 limit 200, 정렬은 `created_at DESC`. 페이지네이션 없음.
- 응답 형태 `{ items: [...] }`. listUsers는 password_hash/totp_secret을 제외한 컬럼만 SELECT (DbService L188 참조). 안전.
- snake_case 응답 (`last_login_at`, `totp_enabled`) — auth.service.me의 camelCase 응답과 일관성 결여.

**짚어볼 점**
- RolesGuard로 인가 분리 권고.
- 페이지네이션 없음 (limit hard-coded 200).
- 응답 키 케이스 불일치.

## File-level Verdict
- 강점: 명확한 권한 체크.
- 위험: 미들레이어 인가 분리 부재.
- 개선 권고: `@Roles()` + RolesGuard, camelCase 변환 헬퍼.
- 재읽기 권고 레벨: Low.
