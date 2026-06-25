import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
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
  @ApiResponse({ status: 401, description: '유효하지 않은 Firebase ID Token' })
  @ApiResponse({ status: 409, description: '이미 가입된 사용자' })
  register(@Body() dto: RegisterDto, @Req() req: { user: { uid: string; email: string } }) {
    return this.authService.register(dto, req.user.uid, req.user.email);
  }
}
