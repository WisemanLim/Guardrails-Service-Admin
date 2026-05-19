import Papa from 'papaparse';
import { RuleDto, ACTIONS, IO_TYPES, SEVERITIES } from './dto';

/**
 * CSV column contract (header row required, case-sensitive):
 *
 *   ruleId,domain,locale,ioType,category,subCategory,severity,priority,action,
 *   patternBundle,messageTemplate,regulationTags,examplesPositive,examplesNegative,
 *   enabled,version
 *
 * JSON-shaped columns (`patternBundle`, `messageTemplate`, `regulationTags`,
 * `examplesPositive`, `examplesNegative`) accept either valid JSON or a
 * pipe-separated string for arrays (e.g. `KR_PIPA|EU_GDPR`).
 */
export interface CsvImportResult {
  total: number;
  accepted: RuleDto[];
  rejected: { row: number; reason: string; raw: Record<string, string> }[];
}

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
