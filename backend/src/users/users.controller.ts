import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { ErrorCode, errBody } from '../common/errors/error-code';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 포인트/프로필 조회 (현재 점수 포함)' })
  @ApiResponse({
    status: 200,
    description: '내 프로필 + 현재 점수(score) 반환',
  })
  @ApiResponse({ status: 404, description: '등록되지 않은 사용자' })
  async getMe(@Req() req: { user: { uid: string } }) {
    const user = await this.usersService.findByFirebaseUid(req.user.uid);
    if (!user)
      throw new NotFoundException(
        errBody(ErrorCode.USER_NOT_REGISTERED, '등록되지 않은 사용자입니다.'),
      );
    return this.usersService.toProfile(user);
  }

  @Get(':id')
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '특정 유저 포인트/공개 프로필 조회 (결투 상대 등)' })
  @ApiResponse({
    status: 200,
    description: '공개 프로필(닉네임·팀·국적·점수) 반환',
  })
  @ApiResponse({ status: 400, description: 'id 형식 오류(UUID 아님)' })
  @ApiResponse({ status: 404, description: '유저 없음' })
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersService.findById(id);
    if (!user)
      throw new NotFoundException(
        errBody(ErrorCode.USER_NOT_FOUND, '유저를 찾을 수 없습니다.'),
      );
    return this.usersService.toPublicProfile(user);
  }
}
