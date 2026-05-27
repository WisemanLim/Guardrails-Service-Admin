# `src/rules/__tests__/csv-importer.spec.ts`

## Header
- 역할 / Role: parseCsv 단위 테스트. 5 케이스 — happy/enum reject/missing required/pipe array/JSON array.
- 진입점에서의 거리: 3 (test runner)
- 라인 수: 51
- 주요 export: 없음 (test)
- 의존 모듈: `../csv-importer`
- 사용된 외부 패키지: `jest` (글로벌 describe/it/expect)
- 부수효과: 없음
- 동시성 모델: jest 기본 직렬
- 테스트 커버리지: 본 파일 자체

## Line-by-Line Review (Level 2)

```ts path=src/rules/__tests__/csv-importer.spec.ts lines=1-19
import { parseCsv } from '../csv-importer';

const CSV_HEADER =
  'ruleId,domain,locale,ioType,category,subCategory,severity,priority,action,patternBundle,messageTemplate,regulationTags,examplesPositive,examplesNegative,enabled,version';

describe('parseCsv', () => {
  it('accepts a valid row', () => {
    const csv = `${CSV_HEADER}
PRIV_KR_999,global,ko-KR,input,pii,national_id_kr,critical,950,block,{},{"ko-KR":"주민번호 차단"},KR_PIPA,예시,반례,1,1.0.0`;
    const result = parseCsv(csv);
    expect(result.total).toBe(1);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    const r = result.accepted[0];
    expect(r.ruleId).toBe('PRIV_KR_999');
    expect(r.regulationTags).toEqual(['KR_PIPA']);
    expect(r.enabled).toBe(true);
    expect(r.source).toBe('csv');
  });
```

**분석 / Analysis (Level 2)**
- L3-4 헤더 상수가 csv-importer 도큐먼트의 contract와 1:1 매치. 단, 변경 시 양쪽 동기화 필요.
- L8-9 한국어 문자열을 그대로 CSV에 (테스트 파일 인코딩 UTF-8). 좋음.
- L13 `regulationTags`가 `'KR_PIPA'` 단일 값 → pipe-split이 `['KR_PIPA']`로 처리. 검증.
- L17 `r.enabled` true ← '1' 인식.
- L18 `r.source` 'csv'.

```ts path=src/rules/__tests__/csv-importer.spec.ts lines=21-29
  it('rejects unknown action enum', () => {
    const csv = `${CSV_HEADER}
PRIV_KR_998,global,ko-KR,input,pii,x,high,500,explode,{},{},,,,1,`;
    const result = parseCsv(csv);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/invalid action/);
  });
```

**분석 / Analysis (Level 2)**
- `explode`는 ACTIONS에 없음 → reject.
- 마지막 컬럼이 비어있음 → version은 '' → `row.version || '1.0.0'` → '1.0.0' default. (단, version 검증은 행 reject가 이미 action 단계에서 발생).

```ts path=src/rules/__tests__/csv-importer.spec.ts lines=31-50
  it('rejects missing required field', () => {
    const csv = `${CSV_HEADER}
,global,ko-KR,input,pii,x,high,500,block,{},{},,,,1,`;
    const result = parseCsv(csv);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/missing required column/);
  });

  it('parses pipe-delimited regulationTags', () => {
    const csv = `${CSV_HEADER}
PRIV_KR_997,global,ko-KR,input,pii,x,high,500,block,{},{},KR_PIPA|EU_GDPR,,,,`;
    const result = parseCsv(csv);
    expect(result.accepted[0].regulationTags).toEqual(['KR_PIPA', 'EU_GDPR']);
  });

  it('parses JSON-array regulationTags', () => {
    const csv = `${CSV_HEADER}
PRIV_KR_996,global,ko-KR,input,pii,x,high,500,block,{},{},"[\\"KR_PIPA\\",\\"EU_GDPR\\"]",,,,`;
    const result = parseCsv(csv);
    expect(result.accepted[0].regulationTags).toEqual(['KR_PIPA', 'EU_GDPR']);
  });
});
```

**분석 / Analysis (Level 2)**
- 마지막 케이스의 quote escape: 외부는 CSV double-quote(`"..."`), 내부 JSON은 `\"...\"`로 escape. JS string literal에선 `\\"`로 표기. papaparse가 quoted field 내부의 `""`를 single `"`로 unescape — 본 케이스에선 `\"`를 사용하므로 papaparse는 ` \"...\" `로 본 그대로 → JSON.parse 통과. 안전.
- 단, **테스트가 다루지 않는 케이스 다수**:
  - BOM 처리.
  - 헤더 case-mismatch (`RuleID`).
  - `enabled='True'` (혼합 케이스).
  - 큰 파일 (수만 행).
  - `parsed.errors` 발생 시 (quote mismatch).
  - `priority='1.5'` (float).
  - `patternBundle='null'` 또는 `'[1,2]'` (parseObject 타입 가드 부재).

**짚어볼 점**
- 테스트가 happy paths + 일부 reject만. edge 사례 무도.

## File-level Verdict
- 강점: 핵심 경로 5개 커버.
- 위험: 테스트 갭 (BOM, 케이스, float priority 등).
- 개선 권고: 위 누락 케이스 추가.
- 재읽기 권고 레벨: Low.
