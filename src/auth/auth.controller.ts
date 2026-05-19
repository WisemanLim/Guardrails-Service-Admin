import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto, EnableTotpDto, LoginDto, RegisterDto } from './dto';
import { JwtAuthGuard, AuthedUser } from './jwt.guard';
import { Public } from './public.decorator';

function clientCtx(req: Request) {
  const xff = (req.headers['x-forwarded-for'] as string) ?? '';
  const ip = xff.split(',')[0]?.trim() || req.ip || undefined;
  const userAgent = (req.headers['user-agent'] as string) ?? undefined;
  return { ip, userAgent };
}

@Controller('/auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.password, dto.role);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, dto.totp, clientCtx(req));
  }

  @Get('me')
  me(@Req() req: Request) {
    const user = (req as Request & { user: AuthedUser }).user;
    return this.auth.me(user.sub);
  }

  @Get('totp/qr')
  totpQr(@Req() req: Request) {
    const user = (req as Request & { user: AuthedUser }).user;
    return this.auth.totpQr(user.sub);
  }

  @Post('totp/enable')
  enableTotp(@Body() dto: EnableTotpDto, @Req() req: Request) {
    const user = (req as Request & { user: AuthedUser }).user;
    return this.auth.enableTotp(user.sub, dto.totp);
  }

  @Post('password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request) {
    const user = (req as Request & { user: AuthedUser }).user;
    return this.auth.changePassword(user.sub, dto.currentPassword, dto.newPassword);
  }
}
