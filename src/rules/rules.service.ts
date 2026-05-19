import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, RuleRow } from '../db/db.service';
import { PolicyClient } from '../clients/policy.client';
import { parseCsv } from './csv-importer';
import { RuleDto } from './dto';

@Injectable()
export class RulesService {
  constructor(private readonly db: DbService, private readonly policy: PolicyClient) {}

  list(filter: {
    domain?: string;
    locale?: string;
    ioType?: string;
    category?: string;
    enabledOnly?: boolean;
    limit?: number;
    offset?: number;
  }) {
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

  async bulkUpsert(dtos: RuleDto[], source: 'admin' | 'csv' = 'admin') {
    let upserted = 0;
    for (const dto of dtos) {
      await this.db.upsertRule(this.dtoToRow(dto, source));
      upserted++;
    }
    await this.policy.invalidate();
    return { ok: true, upserted };
  }

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
}
