import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { RedisService } from '../common/redis/redis.service';
import { MailService } from '../common/mail/mail.service';

const TOKEN_TTL_SECONDS = 600; // 10분
const RESEND_COOLDOWN_SECONDS = 60; // 재발송 남발 방지

const tokenKey = (token: string) => `email-verify:${token}`;
const cooldownKey = (email: string) => `email-verify-cooldown:${email}`;

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async sendLink(email: string): Promise<{ message: string }> {
    const acquired = await this.redis.tryAcquireLock(
      cooldownKey(email),
      RESEND_COOLDOWN_SECONDS,
    );
    if (!acquired) {
      throw new HttpException(
        '잠시 후 다시 시도해주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const token = randomBytes(32).toString('base64url');
    await this.redis.set(tokenKey(token), email, TOKEN_TTL_SECONDS);

    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    const link = `${frontendUrl}/verify?token=${token}`;

    try {
      await this.mail.sendVerificationLink(email, link);
    } catch (err) {
      this.logger.error(`인증 메일 발송 실패: ${(err as Error).message}`);
      throw new InternalServerErrorException(
        '인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.',
      );
    }

    return { message: '인증 메일을 발송했습니다.' };
  }

  async verifyToken(token: string): Promise<{ email: string; verified: true }> {
    const email = await this.redis.consume(tokenKey(token));
    if (!email) {
      throw new BadRequestException(
        '유효하지 않거나 만료된 링크입니다. 다시 요청해주세요.',
      );
    }
    return { email, verified: true };
  }
}
