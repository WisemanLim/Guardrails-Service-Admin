import { Controller, ForbiddenException, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DbService } from '../db/db.service';
import { AuthedUser } from '../auth/jwt.guard';

@Controller('/users')
export class UsersController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@Req() req: Request) {
    const user = (req as Request & { user: AuthedUser }).user;
    if (user.role !== 'super_admin') {
      throw new ForbiddenException('super_admin_only');
    }
    return { items: await this.db.listUsers() };
  }
}
