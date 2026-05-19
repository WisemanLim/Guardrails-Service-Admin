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

  it('rejects unknown action enum', () => {
    const csv = `${CSV_HEADER}
PRIV_KR_998,global,ko-KR,input,pii,x,high,500,explode,{},{},,,,1,`;
    const result = parseCsv(csv);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/invalid action/);
  });

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
