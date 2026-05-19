import { Module } from '@nestjs/common';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';
import { PolicyClient } from '../clients/policy.client';

@Module({
  controllers: [RulesController],
  providers: [RulesService, PolicyClient],
  exports: [RulesService],
})
export class RulesModule {}
