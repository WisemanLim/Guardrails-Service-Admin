import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';
import { AuthedUser } from '../auth/jwt.guard';

/**
 * Records every mutating Admin API call as an audit event. Read-only verbs
 * (GET, HEAD, OPTIONS) are skipped. Auth endpoints emit their own
 * login_history rows separately.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const skip = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const path = req.originalUrl as string;
    // Don't double-record login attempts here — auth.service writes login_history.
    const isAuthPath = path.startsWith('/admin/auth/');
    return next.handle().pipe(
      tap({
        next: async () => {
          if (skip || isAuthPath) return;
          const user = (req.user ?? {}) as AuthedUser;
          await this.audit.record({
            actorId: user?.sub ?? null,
            actorEmail: user?.email ?? null,
            action: `${req.method.toLowerCase()} ${path}`,
            targetType: 'http',
            targetId: path,
            payload: this.safeBody(req.body),
            ip: this.clientIp(req),
            userAgent: req.headers?.['user-agent'] ?? null,
          });
        },
      }),
    );
  }

  private safeBody(body: unknown): unknown {
    if (!body || typeof body !== 'object') return undefined;
    // Strip secrets.
    const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    for (const k of ['password', 'newPassword', 'currentPassword', 'totp']) delete clone[k];
    return clone;
  }

  private clientIp(req: any): string | null {
    const xff = (req.headers?.['x-forwarded-for'] as string) ?? '';
    return xff.split(',')[0]?.trim() || req.ip || null;
  }
}
