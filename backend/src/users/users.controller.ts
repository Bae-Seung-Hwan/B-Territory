import {
  Controller,
  Delete,
  Get,
  HttpCode,
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

  @Delete('me')
  @UseGuards(FirebaseAuthGuard)
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '회원 탈퇴 (계정 삭제)',
    description:
      '계정과 Firebase 인증 정보를 삭제한다. 점령·점수·결투 기록은 유저 참조만 끊긴 채 ' +
      '남아 팀 점수가 보존되며, 위치정보 이용·제공사실 확인자료는 위치정보법 제16조 2항에 ' +
      '따라 6개월간 보존된다. 되돌릴 수 없다.',
  })
  @ApiResponse({ status: 204, description: '탈퇴 완료' })
  @ApiResponse({ status: 401, description: '유효하지 않은 Firebase ID Token' })
  @ApiResponse({ status: 404, description: '등록되지 않은 사용자' })
  async deleteMe(@Req() req: { user: { uid: string } }): Promise<void> {
    const user = await this.usersService.findByFirebaseUid(req.user.uid);
    if (!user)
      throw new NotFoundException(
        errBody(ErrorCode.USER_NOT_REGISTERED, '등록되지 않은 사용자입니다.'),
      );
    await this.usersService.deleteAccount(user);
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
