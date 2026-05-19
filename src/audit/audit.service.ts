import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  async record(opts: {
    actorId?: string | null;
    actorEmail?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    payload?: unknown;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await this.db.insertAuditLog({
      actor_id: opts.actorId ?? null,
      actor_email: opts.actorEmail ?? null,
      action: opts.action,
      target_type: opts.targetType ?? null,
      target_id: opts.targetId ?? null,
      payload: opts.payload ?? null,
      ip: opts.ip ?? null,
      user_agent: opts.userAgent ?? null,
    });
  }

  listLogin(userId: string | null, limit = 100) {
    return this.db.listLoginHistory(userId, limit);
  }

  listAudit(opts: { actorId?: string; action?: string; limit?: number }) {
    return this.db.listAuditLog(opts);
  }
}
