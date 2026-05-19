import { Controller, ForbiddenException, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from './audit.service';
import { AuthedUser } from '../auth/jwt.guard';

@Controller('/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  // Per-user view: own login history. Super_admin can pass userId=*.
  @Get('login-history')
  async myLoginHistory(
    @Req() req: Request,
    @Query('limit') limitStr?: string,
    @Query('userId') queryUserId?: string,
  ) {
    const user = (req as Request & { user: AuthedUser }).user;
    const limit = Math.min(Number(limitStr ?? 100), 1000);
    if (queryUserId && queryUserId !== user.sub) {
      if (user.role !== 'super_admin') throw new ForbiddenException('super_admin_only');
      return { items: await this.audit.listLogin(queryUserId, limit) };
    }
    return { items: await this.audit.listLogin(user.sub, limit) };
  }

  @Get('actions')
  async actions(
    @Req() req: Request,
    @Query('limit') limitStr?: string,
    @Query('action') action?: string,
    @Query('actorId') actorId?: string,
  ) {
    const user = (req as Request & { user: AuthedUser }).user;
    const limit = Math.min(Number(limitStr ?? 200), 1000);
    if (user.role !== 'super_admin') {
      // Non-super_admin: only own audit
      return { items: await this.audit.listAudit({ actorId: user.sub, action, limit }) };
    }
    return { items: await this.audit.listAudit({ actorId, action, limit }) };
  }
}
