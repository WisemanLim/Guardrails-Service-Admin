import { BadRequestException, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { DbService } from '../db/db.service';
import { Runtime } from '../config/runtime';

interface LoginContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger(AuthService.name);

  constructor(private readonly db: DbService, private readonly jwt: JwtService) {}

  async onModuleInit() {
    if (!Runtime.bootstrapEmail || !Runtime.bootstrapPassword) return;
    const existing = await this.db.findUserByEmail(Runtime.bootstrapEmail);
    if (existing) return;
    const hash = await bcrypt.hash(Runtime.bootstrapPassword, Runtime.bcryptRounds);
    const secret = authenticator.generateSecret();
    await this.db.insertUser(Runtime.bootstrapEmail, hash, secret, 'super_admin');
    this.log.warn(`Bootstrap super_admin created: ${Runtime.bootstrapEmail} (TOTP secret stored, enroll via /auth/totp/qr).`);
  }

  async register(email: string, password: string, role: 'admin' | 'super_admin' | 'viewer' = 'admin') {
    if (await this.db.findUserByEmail(email)) {
      throw new BadRequestException('email_already_registered');
    }
    const hash = await bcrypt.hash(password, Runtime.bcryptRounds);
    const totpSecret = authenticator.generateSecret();
    const user = await this.db.insertUser(email, hash, totpSecret, role);
    const otpauth = authenticator.keyuri(email, Runtime.totpIssuer, totpSecret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      totp: {
        otpauth,
        secret: totpSecret,
        qrDataUrl,
        enabled: false,
        hint: 'Scan in an authenticator app, then POST /admin/auth/totp/enable with the 6-digit code.',
      },
    };
  }

  async totpQr(userId: string) {
    const user = await this.db.findUserById(userId);
    if (!user || !user.totp_secret) throw new BadRequestException('totp_not_enrolled');
    const otpauth = authenticator.keyuri(user.email, Runtime.totpIssuer, user.totp_secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    return { otpauth, qrDataUrl, enabled: user.totp_enabled };
  }

  async enableTotp(userId: string, code: string) {
    const user = await this.db.findUserById(userId);
    if (!user || !user.totp_secret) throw new BadRequestException('totp_not_enrolled');
    if (!authenticator.check(code, user.totp_secret)) {
      throw new UnauthorizedException('invalid_totp');
    }
    await this.db.updateUserTotpEnabled(userId, true);
    return { enabled: true };
  }

  async login(email: string, password: string, totp: string | undefined, ctx: LoginContext) {
    const user = await this.db.findUserByEmail(email);
    if (!user) {
      await this.db.insertLoginHistory({
        user_id: null, email, ip: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
        success: false, reason: 'no_such_user',
      });
      throw new UnauthorizedException('invalid_credentials');
    }
    if (user.status !== 'active') {
      await this.db.insertLoginHistory({
        user_id: user.id, email, ip: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
        success: false, reason: 'disabled',
      });
      throw new UnauthorizedException('account_disabled');
    }
    if (!(await bcrypt.compare(password, user.password_hash))) {
      await this.db.insertLoginHistory({
        user_id: user.id, email, ip: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
        success: false, reason: 'bad_password',
      });
      throw new UnauthorizedException('invalid_credentials');
    }
    if (user.totp_enabled) {
      if (!totp) throw new UnauthorizedException('totp_required');
      if (!user.totp_secret || !authenticator.check(totp, user.totp_secret)) {
        await this.db.insertLoginHistory({
          user_id: user.id, email, ip: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
          success: false, reason: 'bad_totp',
        });
        throw new UnauthorizedException('invalid_totp');
      }
    }
    const token = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { secret: Runtime.jwtSecret, expiresIn: Runtime.jwtExpiresIn },
    );
    await this.db.touchUserLastLogin(user.id);
    await this.db.insertLoginHistory({
      user_id: user.id, email, ip: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
      success: true, reason: null,
    });
    return {
      token,
      tokenType: 'Bearer',
      expiresIn: Runtime.jwtExpiresIn,
      user: { id: user.id, email: user.email, role: user.role, totpEnabled: user.totp_enabled },
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.db.findUserById(userId);
    if (!user) throw new UnauthorizedException('invalid_token');
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      throw new UnauthorizedException('invalid_credentials');
    }
    const newHash = await bcrypt.hash(newPassword, Runtime.bcryptRounds);
    await this.db.updateUserPassword(userId, newHash);
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.db.findUserById(userId);
    if (!user) throw new UnauthorizedException('invalid_token');
    return {
      id: user.id, email: user.email, role: user.role,
      totpEnabled: user.totp_enabled, status: user.status,
      lastLoginAt: user.last_login_at, createdAt: user.created_at,
    };
  }
}
