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
