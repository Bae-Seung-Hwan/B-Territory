import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EmailService } from './email.service';
import { SendLinkDto } from './dto/send-link.dto';
import { VerifyTokenDto } from './dto/verify-token.dto';

@ApiTags('Email')
@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('send-link')
  @ApiOperation({ summary: '이메일 인증 매직 링크 발송' })
  @ApiResponse({ status: 201, description: '발송 성공' })
  @ApiResponse({ status: 429, description: '재요청 대기 시간 미경과' })
  sendLink(@Body() dto: SendLinkDto) {
    return this.emailService.sendLink(dto.email);
  }

  @Post('verify-token')
  @ApiOperation({ summary: '매직 링크 토큰 검증 (이메일 소유 확인)' })
  @ApiResponse({ status: 201, description: '검증 성공' })
  @ApiResponse({ status: 400, description: '유효하지 않거나 만료된 토큰' })
  verifyToken(@Body() dto: VerifyTokenDto) {
    return this.emailService.verifyToken(dto.token);
  }
}
