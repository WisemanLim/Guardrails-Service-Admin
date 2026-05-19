import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Runtime } from '../config/runtime';

export interface AuthedUser {
  sub: string;
  email: string;
  role: string;
}

export const PUBLIC_KEY = 'public_route';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const auth = (req.headers.authorization ?? '').toString();
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) throw new UnauthorizedException('missing_bearer_token');
    try {
      const payload = await this.jwt.verifyAsync<AuthedUser>(m[1], { secret: Runtime.jwtSecret });
      req.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('invalid_token');
    }
  }
}
