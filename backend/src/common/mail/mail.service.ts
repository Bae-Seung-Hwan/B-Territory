import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly client: Resend;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    this.client = new Resend(this.config.get<string>('RESEND_API_KEY'));
    this.from = this.config.get<string>('MAIL_FROM', 'onboarding@resend.dev');
  }

  async sendVerificationLink(to: string, link: string): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to,
      subject: '[B-Territory] 이메일 인증',
      html: `
        <p>아래 버튼을 눌러 이메일 인증을 완료해주세요. (10분간 유효)</p>
        <p><a href="${link}" target="_blank" rel="noopener noreferrer">이메일 인증하기</a></p>
        <p>버튼이 동작하지 않으면 다음 링크를 브라우저 주소창에 붙여넣어주세요:<br/>${link}</p>
      `,
    });
    if (error) {
      this.logger.error(`메일 발송 실패 to=${to}: ${error.message}`);
      throw new Error(error.message);
    }
  }
}
