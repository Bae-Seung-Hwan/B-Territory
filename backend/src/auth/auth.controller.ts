import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: '회원가입 (국적 입력 → 팀 자동 배정)' })
  @ApiResponse({ status: 201, description: '회원가입 성공' })
  @ApiResponse({ status: 409, description: '이미 사용 중인 이메일' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '로그인 (JWT 발급)' })
  @ApiResponse({ status: 200, description: '로그인 성공, accessToken 반환' })
  @ApiResponse({ status: 401, description: '이메일 또는 비밀번호 불일치' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
