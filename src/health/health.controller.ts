import { Controller, Get } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Runtime } from '../config/runtime';
import { Public } from '../auth/public.decorator';

@Controller('/health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get()
  health() {
    return {
      status: 'ok',
      db: { driver: this.db.driver, available: this.db.isAvailable() },
      downstream: { policy: Runtime.policyEngineUrl },
    };
  }
}
