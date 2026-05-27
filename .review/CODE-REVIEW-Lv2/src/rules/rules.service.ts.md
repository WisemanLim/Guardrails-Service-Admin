# `src/rules/rules.service.ts`

## Header
- 역할 / Role: Rules CRUD 비즈니스 로직. DTO → row 변환, DbService 호출, PolicyClient.invalidate.
- 진입점에서의 거리: 2
- 라인 수: 112
- 주요 export: `RulesService`
- 의존 모듈: `../db/db.service`, `../clients/policy.client`, `./csv-importer`, `./dto`
- 사용된 외부 패키지: `@nestjs/common`
- 부수효과: DB upsert/delete, Policy Engine HTTP call
- 동시성 모델: async 메서드. bulk 작업은 직렬 루프.
- 테스트 커버리지: 없음

## Line-by-Line Review (Level 2)

### list / get / create

```ts path=src/rules/rules.service.ts lines=1-36
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, RuleRow } from '../db/db.service';
import { PolicyClient } from '../clients/policy.client';
import { parseCsv } from './csv-importer';
import { RuleDto } from './dto';

@Injectable()
export class RulesService {
  constructor(private readonly db: DbService, private readonly policy: PolicyClient) {}

  list(filter: {...}) {
    return this.db.listRules(filter);
  }

  async get(ruleId: string) {
    const r = await this.db.findRuleById(ruleId);
    if (!r) throw new NotFoundException('rule_not_found');
    return r;
  }

  async create(dto: RuleDto, source: 'admin' | 'csv' = 'admin') {
    if (await this.db.findRuleById(dto.ruleId)) {
      throw new BadRequestException('rule_id_already_exists');
    }
    await this.db.upsertRule(this.dtoToRow(dto, source));
    await this.policy.invalidate();
    return { ok: true, ruleId: dto.ruleId };
  }
```

**분석 / Analysis (Level 2)**
- `list` thin pass-through. async 키워드 없어 promise 그대로 반환 — NestJS가 unwrap. OK.
- `create`: **race condition** — `findRuleById` 후 `upsertRule` 사이에 다른 요청이 같은 rule_id로 insert하면 첫 요청은 unique 조건이 없는 INSERT (upsert는 ON CONFLICT DO UPDATE — 즉, 첫 요청이 두 번째의 INSERT 후 데이터를 덮어쓰기). check + upsert 패턴이 불일관 — 진짜 중복 차단은 UNIQUE 제약과 INSERT 만에 의존해야. **개선**: `INSERT ... ON CONFLICT DO NOTHING` 후 rowCount=0 검사.
- `policy.invalidate()`는 swallow → 실패해도 throw 안함. OK.

### update / deleteOne / deleteMany

```ts path=src/rules/rules.service.ts lines=38-62
  async update(ruleId: string, dto: RuleDto) {
    if (dto.ruleId !== ruleId) {
      throw new BadRequestException('rule_id_mismatch');
    }
    const existing = await this.db.findRuleById(ruleId);
    if (!existing) throw new NotFoundException('rule_not_found');
    await this.db.upsertRule(this.dtoToRow(dto, (existing.source as 'admin' | 'csv' | 'file') ?? 'admin'));
    await this.policy.invalidate();
    return { ok: true, ruleId };
  }

  async deleteOne(ruleId: string) {
    const existing = await this.db.findRuleById(ruleId);
    if (!existing) throw new NotFoundException('rule_not_found');
    const deleted = await this.db.deleteRules([ruleId]);
    await this.policy.invalidate();
    return { ok: true, deleted };
  }

  async deleteMany(ruleIds: string[]) {
    if (ruleIds.length === 0) return { ok: true, deleted: 0 };
    const deleted = await this.db.deleteRules(ruleIds);
    await this.policy.invalidate();
    return { ok: true, deleted, requested: ruleIds.length };
  }
```

**분석 / Analysis (Level 2)**
- `update`: source는 기존 행에서 유지 (`file`이 admin으로 바뀌지 않음). 좋음.
- `upsertRule`은 INSERT...ON CONFLICT DO UPDATE — update 경로에서도 동작. `existing` 체크 후 upsert는 race-safe하진 않음(중간에 삭제되면 사실상 재삽입). 운영상 비잦은 케이스.
- `deleteOne`은 `existing` 체크 후 `deleteRules`로 위임. existing check가 race condition에 취약하나 결과 deleted=0이면 사실상 NotFound와 동일 — 단지 응답이 ok=true, deleted=0.
- `deleteMany`는 0이면 early return — invalidate 호출도 skip. 의도된 동작.
- 모든 변경 후 `invalidate()` — 단, deleted=0이어도 호출 → 불필요한 invalidate. 작은 오버헤드.

### bulkUpsert

```ts path=src/rules/rules.service.ts lines=64-72
  async bulkUpsert(dtos: RuleDto[], source: 'admin' | 'csv' = 'admin') {
    let upserted = 0;
    for (const dto of dtos) {
      await this.db.upsertRule(this.dtoToRow(dto, source));
      upserted++;
    }
    await this.policy.invalidate();
    return { ok: true, upserted };
  }
```

**분석 / Analysis (Level 2)**
- **N round-trips, 트랜잭션 없음**. 10,000행이면:
  - PG: 10,000 await + statement 디스패치 → 수십 초.
  - SQLite: 동기 호출이지만 event loop 점유 → 다른 요청 starvation.
- 부분 실패 시 일관성 깨짐 (앞 5,000행은 commit, 뒤 5,000행 실패).
- **개선**: SQLite는 `db.transaction(rows => rows.forEach(...))` (better-sqlite3의 transactional helper) 사용 시 단일 트랜잭션 + 동기 처리. PG는 `BEGIN; ... COMMIT;` 또는 `INSERT ... ON CONFLICT` 멀티-row VALUES.

### importCsv

```ts path=src/rules/rules.service.ts lines=74-89
  async importCsv(buf: Buffer) {
    const parsed = parseCsv(buf);
    if (parsed.accepted.length === 0) {
      throw new BadRequestException({ message: 'no_valid_rows', rejected: parsed.rejected });
    }
    for (const dto of parsed.accepted) {
      await this.db.upsertRule(this.dtoToRow(dto, 'csv'));
    }
    await this.policy.invalidate();
    return {
      ok: true,
      total: parsed.total,
      accepted: parsed.accepted.length,
      rejected: parsed.rejected,
    };
  }
```

**분석 / Analysis (Level 2)**
- `parseCsv`는 동기. 20MB CSV는 수십~수백ms 점유 가능.
- 같은 N+1 패턴.
- accepted=0 케이스만 throw — 부분 reject는 200 응답 (rejected 배열 포함). 운영 친화적.
- rejected는 raw row 데이터를 그대로 포함 → DB의 audit interceptor payload에도 포함되어 저장 → audit log 폭증 가능.

### dtoToRow helper

```ts path=src/rules/rules.service.ts lines=91-111
  private dtoToRow(dto: RuleDto, source: 'admin' | 'csv' | 'file'): RuleRow {
    return {
      rule_id: dto.ruleId,
      domain: dto.domain,
      locale: dto.locale,
      io_type: dto.ioType,
      category: dto.category,
      sub_category: dto.subCategory ?? null,
      severity: dto.severity,
      priority: dto.priority,
      action: dto.action,
      pattern_bundle: dto.patternBundle ?? {},
      message_template: dto.messageTemplate ?? {},
      regulation_tags: dto.regulationTags ?? [],
      examples_positive: dto.examplesPositive ?? [],
      examples_negative: dto.examplesNegative ?? [],
      enabled: dto.enabled ?? true,
      version: dto.version ?? '1.0.0',
      source,
    };
  }
```

**분석 / Analysis (Level 2)**
- camelCase → snake_case 매핑. null/default 처리 일관.
- `enabled: dto.enabled ?? true` — DTO에서 boolean이지만 undefined면 기본 true. 안전.
- `version: dto.version ?? '1.0.0'` — DTO에서 string. 빈 문자열은 그대로 (falsy 아닌 truthy). 빈 문자열이 들어가면 DB의 NOT NULL DEFAULT '1.0.0'을 우회하고 빈 문자열 저장 — 권고: `dto.version || '1.0.0'`.

**짚어볼 점**
- 트랜잭션 부재 (bulk).
- N+1 round-trip.
- version 빈 문자열 fall-through.
- create의 check-then-act race.
- rejected를 audit payload로 그대로 노출.

## File-level Verdict

**강점**
- 명확한 책임 분리.
- create/update의 정확한 에러 분기.
- invalidate를 모든 변경 직후 호출.

**위험**
- bulk/CSV import 트랜잭션 부재.
- N+1 패턴.
- create check-then-act race.

**개선 권고**
- DbService에 `withTransaction`/`bulkUpsertMany` 추가.
- create는 INSERT...DO NOTHING + rowCount 검사.
- version은 `||` 사용.
- importCsv에서 rejected 행은 audit payload에서 제외 (별도 응답에만 포함).

**재읽기 권고 레벨: High** — 비즈니스 흐름 중심.
