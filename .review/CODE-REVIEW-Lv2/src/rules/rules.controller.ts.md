# `src/rules/rules.controller.ts`

## Header
- 역할 / Role: `/rules` GET/POST/PUT/DELETE + bulk + import-csv.
- 진입점에서의 거리: 1
- 라인 수: 92
- 주요 export: `RulesController`
- 의존 모듈: `./rules.service`, `./dto`, `../auth/jwt.guard`
- 사용된 외부 패키지: `@nestjs/common`, `@nestjs/platform-express` (FileInterceptor), `express`
- 부수효과: RulesService 호출 → DB write/read + Policy Engine invalidate
- 동시성 모델: async 핸들러. Multer는 memoryStorage 기본(20MB cap).
- 테스트 커버리지: 없음

## Line-by-Line Review (Level 2)

```ts path=src/rules/rules.controller.ts lines=1-16
import {
  Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus,
  Param, Post, Put, Query, Req, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { RulesService } from './rules.service';
import { BulkDeleteDto, BulkUpsertDto, RuleDto } from './dto';
import { AuthedUser } from '../auth/jwt.guard';

function requireWrite(req: Request) {
  const user = (req as Request & { user: AuthedUser }).user;
  if (user.role === 'viewer') throw new ForbiddenException('viewer_cannot_write');
  return user;
}
```

**분석 / Analysis (Level 2)**
- L11-15 `requireWrite` 헬퍼 — viewer 차단. admin/super_admin 모두 통과. RBAC 게이트 표현이 명확하지만 별도 가드(`@Roles()` + RolesGuard)로 옮기는 게 NestJS-idiomatic.
- 'viewer' 외 모든 role(undefined 포함)을 write 허용 — 만약 JWT 위조로 role을 임의 문자열로 만들 수 있다면 통과. JwtAuthGuard가 secret 검증으로 막지만, JWT 발급 시 role enum 검증은 부재.

```ts path=src/rules/rules.controller.ts lines=17-45
@Controller('/rules')
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Get()
  list(
    @Query('domain') domain?: string,
    @Query('locale') locale?: string,
    @Query('ioType') ioType?: string,
    @Query('category') category?: string,
    @Query('enabledOnly') enabledOnly?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.rules.list({
      domain,
      locale,
      ioType,
      category,
      enabledOnly: enabledOnly === '1' || enabledOnly === 'true',
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get(':ruleId')
  get(@Param('ruleId') ruleId: string) {
    return this.rules.get(ruleId);
  }
```

**분석 / Analysis (Level 2)**
- `enabledOnly` 'true'/'1' 외 값은 false. URL encoding 차이는 ok.
- `limit/offset`: `Number('abc')=NaN` 그대로 service로 전달 → DbService에서 어떻게 처리되는지(분석 결과: PG는 NaN 에러, SQLite는 모든 행). 검증 필요.
- `ruleId` 파라미터: DTO 없이 raw string. 길이/문자 검증 없음. DbService는 placeholder 바인딩이라 SQLi 안전.
- list/get은 viewer도 가능 (모든 authenticated user).

```ts path=src/rules/rules.controller.ts lines=47-70
  @Post()
  create(@Body() dto: RuleDto, @Req() req: Request) {
    requireWrite(req);
    return this.rules.create(dto);
  }

  @Post('bulk')
  bulkUpsert(@Body() dto: BulkUpsertDto, @Req() req: Request) {
    requireWrite(req);
    return this.rules.bulkUpsert(dto.rules);
  }

  @Post('import-csv')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  importCsv(
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Req() req: Request,
  ) {
    requireWrite(req);
    if (!file?.buffer) {
      throw new ForbiddenException('csv_file_required');
    }
    return this.rules.importCsv(file.buffer);
  }
```

**분석 / Analysis (Level 2)**
- `FileInterceptor('file', { limits: { fileSize: 20MB } })` — Multer가 in-memory에 20MB까지 버퍼링. 큰 CSV는 RSS 폭증. 디스크 스토리지(`MulterModule`) 또는 stream 처리 권고.
- `file?.buffer` 체크 후 `ForbiddenException('csv_file_required')` — **wrong status code**: 403 Forbidden은 권한 문제이고, 본 케이스는 422/400이 맞음 (`BadRequestException`). 의미적 오류.
- file MIME type 검증 부재 (`text/csv` 강제 안함). 임의 바이너리도 수락 → parseCsv가 utf8 decode 후 papaparse가 처리.

```ts path=src/rules/rules.controller.ts lines=72-91
  @Put(':ruleId')
  update(@Param('ruleId') ruleId: string, @Body() dto: RuleDto, @Req() req: Request) {
    requireWrite(req);
    return this.rules.update(ruleId, dto);
  }

  @Delete(':ruleId')
  @HttpCode(HttpStatus.OK)
  deleteOne(@Param('ruleId') ruleId: string, @Req() req: Request) {
    requireWrite(req);
    return this.rules.deleteOne(ruleId);
  }

  // Bulk delete via body: DELETE /rules with { ruleIds: [...] }
  @Delete()
  @HttpCode(HttpStatus.OK)
  deleteMany(@Body() dto: BulkDeleteDto, @Req() req: Request) {
    requireWrite(req);
    return this.rules.deleteMany(dto.ruleIds);
  }
}
```

**분석 / Analysis (Level 2)**
- `PUT /:ruleId` + body.dto.ruleId — service에서 mismatch면 BadRequest (rules.service L39).
- `DELETE` with body — 일부 HTTP 클라이언트(예: 일부 프록시)가 DELETE의 body를 stripping. fetch/axios는 OK. 컨벤션상 POST /rules/delete-bulk 또는 POST /rules/batch:delete 가 더 호환성↑.
- `@HttpCode(HttpStatus.OK)` — DELETE 성공의 기본 204를 200으로. 응답에 body가 있으니 OK 200 합리적.

**짚어볼 점**
- limit/offset/enabledOnly 입력 검증 미흡.
- `csv_file_required` 잘못된 HTTP 상태 (403 → 400).
- DELETE with body 호환성 위험.
- CSV MIME type 검증 부재.
- viewer 외 모든 role 허용 — admin/super_admin 분리되어 있지만 write 권한은 동일.

## File-level Verdict
- 강점: 명확한 라우트, FileInterceptor 한도 설정.
- 위험: 잘못된 HTTP status, 입력 검증 미흡.
- 개선 권고: `BadRequestException` 사용, MIME validation, RolesGuard, limit/offset Joi/Zod 검증.
- 재읽기 권고 레벨: Medium.
