# `src/rules/csv-importer.ts`

## Header
- 역할 / Role: CSV Buffer/string → `{ total, accepted: RuleDto[], rejected: [...] }`. papaparse + 수동 enum 검증.
- 진입점에서의 거리: 3 (importCsv → parseCsv)
- 라인 수: 98
- 주요 export: `parseCsv`, `CsvImportResult` 인터페이스
- 의존 모듈: `./dto`
- 사용된 외부 패키지: `papaparse`
- 부수효과: 없음 (순수 함수)
- 동시성 모델: 동기 함수. 호출자는 큰 파일에서 event loop 점유 가능.
- 테스트 커버리지: csv-importer.spec.ts (5 cases)

## Line-by-Line Review (Level 2)

```ts path=src/rules/csv-importer.ts lines=1-19
import Papa from 'papaparse';
import { RuleDto, ACTIONS, IO_TYPES, SEVERITIES } from './dto';

/**
 * CSV column contract (header row required, case-sensitive):
 * ...
 */
export interface CsvImportResult {
  total: number;
  accepted: RuleDto[];
  rejected: { row: number; reason: string; raw: Record<string, string> }[];
}
```

**분석 / Analysis (Level 2)**
- `Papa` default import — papaparse는 CommonJS + ESM 호환. `esModuleInterop:true`이라 OK.
- `CsvImportResult.rejected.row`는 1-indexed (헤더 = row 1, 첫 데이터 = row 2 — L39 `idx + 2`).

```ts path=src/rules/csv-importer.ts lines=21-44
export function parseCsv(buf: Buffer | string): CsvImportResult {
  const text = typeof buf === 'string' ? buf : buf.toString('utf8');
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const accepted: RuleDto[] = [];
  const rejected: CsvImportResult['rejected'] = [];

  parsed.data.forEach((rawRow, idx) => {
    const row = Object.fromEntries(
      Object.entries(rawRow).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]),
    ) as Record<string, string>;
    try {
      const r = rowToDto(row);
      accepted.push(r);
    } catch (e) {
      rejected.push({ row: idx + 2, reason: (e as Error).message, raw: row });
    }
  });

  return { total: parsed.data.length, accepted, rejected };
}
```

**분석 / Analysis (Level 2)**
- L22 `buf.toString('utf8')` — BOM 처리 미고려. Excel CSV는 종종 UTF-8 BOM 포함. `﻿ruleId`로 시작하면 header가 `﻿ruleId`가 되어 `row.ruleId`가 undefined → required 검증 실패 → 모든 행 reject. **개선**: BOM strip (`text.replace(/^﻿/, '')`).
- L24 `header: true` + `transformHeader: trim` — 좋음. 단 case-sensitive (`RuleID`는 매치 안됨).
- L25 `skipEmptyLines: true` — 안전.
- L31-33 모든 셀 값을 `.trim()` — 좋은 정규화. 빈 문자열은 그대로 (filter 안함).
- L35 try/catch 안에서 rowToDto 호출. enum 위반/required 누락 시 throw. **흔한 실수**: catch에서 unknown error를 `as Error`로 가정 — papaparse 외부 throw가 string이면 `.message` undefined. 본 함수는 자체 throw만 → 안전.
- L39 `idx+2` — header row 보정.
- `parsed.errors`(papaparse가 채우는 파싱 오류 배열) **무시**됨 — quote mismatch 등 malformed CSV는 partial data만 채워지고 보고되지 않음. 권고: parsed.errors도 rejected에 포함.

```ts path=src/rules/csv-importer.ts lines=46-77
function rowToDto(row: Record<string, string>): RuleDto {
  const required = ['ruleId', 'domain', 'locale', 'ioType', 'category', 'severity', 'priority', 'action'];
  for (const k of required) {
    if (!row[k]) throw new Error(`missing required column: ${k}`);
  }
  if (!IO_TYPES.includes(row.ioType as any)) throw new Error(`invalid ioType: ${row.ioType}`);
  if (!SEVERITIES.includes(row.severity as any)) throw new Error(`invalid severity: ${row.severity}`);
  if (!ACTIONS.includes(row.action as any)) throw new Error(`invalid action: ${row.action}`);

  const dto = new RuleDto();
  dto.ruleId = row.ruleId;
  dto.domain = row.domain;
  dto.locale = row.locale;
  dto.ioType = row.ioType as 'input' | 'output' | 'both';
  dto.category = row.category;
  dto.subCategory = row.subCategory || undefined;
  dto.severity = row.severity as 'low' | 'medium' | 'high' | 'critical';
  dto.priority = Number(row.priority);
  if (Number.isNaN(dto.priority)) throw new Error(`invalid priority: ${row.priority}`);
  dto.action = row.action;
  dto.patternBundle = parseObject(row.patternBundle, {});
  dto.messageTemplate = parseObject(row.messageTemplate, {}) as Record<string, string>;
  dto.regulationTags = parseArray(row.regulationTags);
  dto.examplesPositive = parseArray(row.examplesPositive);
  dto.examplesNegative = parseArray(row.examplesNegative);
  if (row.enabled !== undefined && row.enabled !== '') {
    dto.enabled = ['1', 'true', 'TRUE', 'yes', 'Y'].includes(row.enabled);
  }
  dto.version = row.version || '1.0.0';
  dto.source = 'csv';
  return dto;
}
```

**분석 / Analysis (Level 2)**
- `required` 체크는 `!row[k]` — 빈 문자열도 missing 처리 → 의도된 동작.
- enum 검사 3종 → 좋음. `as any` 캐스팅은 필요악 (const tuple과 string의 차이).
- `priority = Number(row.priority)` — `Number('1.5')=1.5` (정수 아님). DB는 INTEGER. `parseInt` 또는 `@IsInt` 위반은 RulesService.upsertRule 단계에서 발견될 수 있으나, **CSV는 ValidationPipe를 거치지 않음** (controller 진입 후 만들어진 DTO 인스턴스 — pipe는 controller body 한정). 따라서 `priority=1.5`가 DB INTEGER에 cast되어 1 또는 SQLite에서 1.5(SQLite는 동적 타입). 정확성 ↓. **개선**: `parseInt`(radix 10) + 검증.
- `enabled` truthy 값 리스트가 case-sensitive('TRUE' included but not 'True'). `['1','true','TRUE','yes','Y']` — 'True' 누락. **버그성 inconsistency**. 단순화: `row.enabled.toLowerCase() in {'1','true','yes','y'}`.
- `version: row.version || '1.0.0'` — `||` 사용 좋음 (빈 문자열도 default).
- `subCategory: row.subCategory || undefined` — 빈 문자열을 undefined로. DbService.upsertRule이 `?? null`로 변환 → DB에 NULL. OK.

```ts path=src/rules/csv-importer.ts lines=79-98
function parseObject(v: string | undefined, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!v) return fallback;
  try { return JSON.parse(v); } catch {
    throw new Error(`invalid JSON object value: ${v.slice(0, 80)}`);
  }
}

function parseArray(v: string | undefined): string[] {
  if (!v) return [];
  if (v.trim().startsWith('[')) {
    try {
      const arr = JSON.parse(v);
      if (!Array.isArray(arr)) throw new Error();
      return arr.map(String);
    } catch {
      throw new Error(`invalid JSON array: ${v.slice(0, 80)}`);
    }
  }
  return v.split('|').map((s) => s.trim()).filter(Boolean);
}
```

**분석 / Analysis (Level 2)**
- `parseObject`은 JSON 실패 시 row reject. 단, `JSON.parse('null')` → null 반환 → null이 fallback이 아닌 그대로 반환 (Record<string, unknown> 시그니처 위반, 타입 거짓말). **개선**: parse 결과가 object인지 검증.
- `parseObject`이 array 입력을 받으면 (`'[1,2]'`) `JSON.parse`가 배열 반환 → 시그니처 위반.
- `parseArray`은 `[`로 시작이면 JSON, 아니면 pipe split. JSON 검증 후 `Array.isArray` 체크 → 안전. 단, JSON 배열 안에 비-string 요소 있으면 `String(num)`로 강제 변환 → 의도된 동작 ('123' 같은 문자열로).
- pipe-split: `'a|b|c'` → ['a','b','c']. trim + filter(falsy) → 좋음.
- 빈 셀 (`''`) → `[]`. OK.

**짚어볼 점**
- BOM 미처리.
- papaparse `parsed.errors` 무시.
- `True`(혼합 케이스) 누락.
- `parseObject` 시그니처 위반 가능 (null/array).
- priority float 허용.
- ValidationPipe가 CSV 경로에서 적용되지 않음 → DTO 데코레이터 검증 미실행.

## File-level Verdict

**강점**
- accepted/rejected 분리 응답.
- enum 검증 + required 체크.
- JSON 또는 pipe-delimited 양쪽 지원.

**위험**
- BOM 미처리.
- papaparse error 누락.
- `parseObject` 타입 안전성 결함.

**개선 권고**
- BOM strip 추가.
- `parsed.errors`를 rejected로 합치기.
- `parseObject`에 type guard (`if (typeof r !== 'object' || Array.isArray(r) || r === null) throw`).
- truthy 리스트를 `lower-case` 정규화.
- 명시적으로 RuleDto 인스턴스에 ValidationPipe를 적용하거나 zod 스키마로 통일.

**재읽기 권고 레벨: Medium** — 외부 입력 진입점.
