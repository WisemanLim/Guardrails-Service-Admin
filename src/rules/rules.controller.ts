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
