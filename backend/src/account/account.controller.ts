import { Controller, Delete, HttpCode, Req, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { AccountService } from './account.service';
import { UsersService } from '../users/users.service';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';

/**
 * 경로는 `/api/users/me`로 UsersController와 같은 프리픽스를 쓴다 — 클라이언트에게는
 * 같은 리소스이기 때문이다. 구현만 도메인 횡단이라 별도 모듈에 있다(AccountService 주석).
 */
@ApiTags('Users')
@Controller('users')
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    private readonly usersService: UsersService,
  ) {}

  @Delete('me')
  @UseGuards(FirebaseAuthGuard)
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '회원 탈퇴 (계정 삭제)',
    description:
      '계정과 Firebase 인증 정보를 삭제한다. 진행 중인 결투는 먼저 종료되고, 점령·점수· ' +
      '결투 기록은 유저 참조만 끊긴 채 남아 팀 점수가 보존되며, 위치정보 이용·제공사실 ' +
      '확인자료는 위치정보법 제16조 2항에 따라 6개월간 보존된다. 되돌릴 수 없다.',
  })
  @ApiResponse({
    status: 204,
    description: '탈퇴 완료 (프로필이 이미 없어도 204 — 멱등)',
  })
  @ApiResponse({ status: 401, description: '유효하지 않은 Firebase ID Token' })
  async deleteMe(@Req() req: { user: { uid: string } }): Promise<void> {
    const user = await this.usersService.findByFirebaseUid(req.user.uid);
    // 다른 조회와 달리 404를 내지 않는다. 삭제는 DB를 먼저 커밋하므로 그 직후
    // 크래시하면 Firebase 계정만 남는데, 여기서 막으면 같은 토큰으로 재시도해도
    // 정리할 길이 없어 그 이메일로 영구 재가입 불가가 된다.
    if (!user) {
      await this.accountService.deleteOrphanedAuth(req.user.uid);
      return;
    }
    await this.accountService.deleteAccount(user);
  }
}
