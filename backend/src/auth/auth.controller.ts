import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '회원가입 (Firebase ID Token 검증 + 프로필 저장)' })
  @ApiResponse({ status: 201, description: '회원가입 성공' })
  @ApiResponse({ status: 400, description: '이메일 정보가 없는 계정' })
  @ApiResponse({ status: 401, description: '유효하지 않은 Firebase ID Token' })
  @ApiResponse({
    status: 403,
    description: 'Firebase 이메일 인증(email_verified)을 먼저 완료해야 함',
  })
  @ApiResponse({ status: 409, description: '이미 가입된 사용자' })
  register(
    @Body() dto: RegisterDto,
    @Req()
    req: { user: { uid: string; email?: string; email_verified?: boolean } },
  ) {
    return this.authService.register(
      dto,
      req.user.uid,
      req.user.email,
      req.user.email_verified,
    );
  }

  @Get('me')
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 프로필 조회 (가입 여부 확인)' })
  @ApiResponse({ status: 200, description: '가입된 사용자의 프로필 반환' })
  @ApiResponse({ status: 404, description: '등록되지 않은 사용자' })
  getMe(@Req() req: { user: { uid: string } }) {
    return this.authService.getMe(req.user.uid);
  }
}
