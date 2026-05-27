# `src/rules/dto.ts`

## Header
- 역할 / Role: 규칙 DTO + 상수 enum 정의. RuleDto, BulkDeleteDto, BulkUpsertDto.
- 진입점에서의 거리: 2
- 라인 수: 50
- 주요 export: `RuleDto`, `BulkDeleteDto`, `BulkUpsertDto`, `SEVERITIES`, `ACTIONS`, `IO_TYPES`
- 의존 모듈: 없음
- 사용된 외부 패키지: `class-transformer`, `class-validator`
- 부수효과: import-time decorator 등록
- 동시성 모델: N/A
- 테스트 커버리지: csv-importer.spec.ts에서 간접 사용

## Line-by-Line Review (Level 2)

```ts path=src/rules/dto.ts lines=1-13
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional,
  IsString, ValidateNested,
} from 'class-validator';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const ACTIONS = [
  'allow', 'warn', 'redact', 'sanitize', 'block', 'block_or_redact',
  'block_or_pseudonymize', 'aggregate_only', 'refuse', 'escalate',
  'add_disclaimer', 'route',
] as const;
export const IO_TYPES = ['input', 'output', 'both'] as const;
```

**분석 / Analysis (Level 2)**
- `as const` tuple → literal union 타입 추론. DB CHECK 제약(`severity IN ('low','medium','high','critical')`)과 일치. action은 DB schema CHECK가 없음 (schema 분석 참조) → DTO만이 유일한 enum gate.

```ts path=src/rules/dto.ts lines=15-33
export class RuleDto {
  @IsString() ruleId!: string;
  @IsString() domain!: string;
  @IsString() locale!: string;
  @IsIn(IO_TYPES as unknown as string[]) ioType!: 'input' | 'output' | 'both';
  @IsString() category!: string;
  @IsOptional() @IsString() subCategory?: string;
  @IsIn(SEVERITIES as unknown as string[]) severity!: 'low' | 'medium' | 'high' | 'critical';
  @IsInt() priority!: number;
  @IsIn(ACTIONS as unknown as string[]) action!: string;
  @IsOptional() @IsObject() patternBundle?: Record<string, unknown>;
  @IsOptional() @IsObject() messageTemplate?: Record<string, string>;
  @IsOptional() @IsArray() regulationTags?: string[];
  @IsOptional() @IsArray() examplesPositive?: string[];
  @IsOptional() @IsArray() examplesNegative?: string[];
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() version?: string;
  @IsOptional() @IsString() source?: 'file' | 'admin' | 'csv';
}
```

**분석 / Analysis (Level 2)**
- `@IsIn(... as unknown as string[])` — class-validator 타입 시그니처(`(string|number)[]`)와 const tuple 호환을 위한 캐스팅. 실제 검증은 정상 작동.
- `ruleId`/`domain`/`locale`/`category` — pattern/length 검증 없음. 길이 1만 있으면 통과. **권고**: `@Length(1, 64)`, ruleId 패턴 (예: `/^[A-Z][A-Z0-9_]*$/`).
- `priority`: `@IsInt()` 만. 범위 검증 없음. 음수 or 매우 큰 값 가능. DB schema는 INTEGER, 양수 가정.
- `patternBundle`: `@IsObject()` — 안전. 그러나 내부 스키마(regex/keywords/entities/luhnCheck/...)는 미검증. 잘못된 regex는 Policy Engine이 컴파일 시 발견 — Admin에서 검증하지 않음으로써 invalid 규칙 등록 가능.
- `regulationTags/examples*`: `@IsArray()`만. 요소 타입 미검증 (`@IsString({ each: true })` 누락).
- `source` DTO 필드: 클라이언트가 보내면 무시되지 않음 — RulesService.create는 source 인자를 받지만 컨트롤러는 dto.source를 무시하고 default 'admin' 전달. 즉, DTO source 필드는 사실상 dead. 권고: DTO에서 제거.

```ts path=src/rules/dto.ts lines=35-50
export class BulkDeleteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @IsString({ each: true })
  ruleIds!: string[];
}

export class BulkUpsertDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => RuleDto)
  rules!: RuleDto[];
}
```

**분석 / Analysis (Level 2)**
- 10,000 max — 합리적 cap. 단, 10,000개 처리 시간/메모리에 대한 backpressure 없음.
- `@ValidateNested({ each: true }) + @Type(() => RuleDto)` — class-transformer가 plain object → RuleDto 인스턴스로 변환 후 검증. 정상.
- BulkDeleteDto의 `@IsString({ each: true })` — 좋음. RuleDto.regulationTags 등에는 없음 (위 노트).

**짚어볼 점**
- ruleId/domain/locale/category 길이·패턴 검증 부재.
- regulationTags 요소 타입 미검증.
- patternBundle 내부 스키마 미검증.
- source DTO 필드 dead.

## File-level Verdict
- 강점: enum/range 검증 + nested validation.
- 위험: 자유 string 필드의 길이·패턴 부재.
- 개선 권고: `@Length` / `@Matches` / `@IsString({each:true})` 추가. patternBundle은 zod 또는 별도 스키마로 검증.
- 재읽기 권고 레벨: Medium.
