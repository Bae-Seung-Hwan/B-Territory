import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import { ModerationService } from './moderation.service';
import { CreateReportDto } from './dto/create-report.dto';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { UsersService } from '../users/users.service';
import { ErrorCode, errBody } from '../common/errors/error-code';

@ApiTags('Moderation')
@Controller()
@UseGuards(FirebaseAuthGuard)
@ApiBearerAuth()
export class ModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly usersService: UsersService,
  ) {}

  /** 요청자의 가입 유저 id를 확보한다 (claims/missions 컨트롤러와 동일 규칙). */
  private async requireUserId(uid: string): Promise<string> {
    const user = await this.usersService.findByFirebaseUid(uid);
    if (!user)
      throw new NotFoundException(
        errBody(ErrorCode.USER_NOT_REGISTERED, '등록되지 않은 사용자입니다.'),
      );
    return user.id;
  }

  @Get('blocks')
  @ApiOperation({
    summary: '내가 차단한 사용자 목록',
    description:
      '클라이언트는 이 목록으로 로컬 필터링도 함께 수행한다(서버 릴레이 필터의 이중 방어).',
  })
  @ApiResponse({ status: 200, description: '차단 목록' })
  async list(@Req() req: { user: { uid: string } }) {
    return this.moderation.listBlocks(await this.requireUserId(req.user.uid));
  }

  @Post('blocks/:userId')
  @HttpCode(204)
  @ApiOperation({
    summary: '사용자 차단',
    description:
      '차단하면 상대의 팀 채팅·위치 공유가 나에게 릴레이되지 않는다. 단방향이며 상대는 알 수 없다. 이미 차단한 상대면 그대로 성공(멱등).',
  })
  @ApiResponse({ status: 204, description: '차단 완료' })
  @ApiResponse({ status: 400, description: '자기 자신 차단' })
  @ApiResponse({ status: 404, description: '대상 유저 없음' })
  async block(
    @Req() req: { user: { uid: string } },
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.moderation.block(await this.requireUserId(req.user.uid), userId);
  }

  @Delete('blocks/:userId')
  @HttpCode(204)
  @ApiOperation({ summary: '차단 해제 (차단하지 않은 상대여도 성공)' })
  @ApiResponse({ status: 204, description: '해제 완료' })
  async unblock(
    @Req() req: { user: { uid: string } },
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.moderation.unblock(
      await this.requireUserId(req.user.uid),
      userId,
    );
  }

  @Post('reports')
  @ApiOperation({
    summary: '사용자/메시지 신고',
    description:
      '채팅은 서버에 저장되지 않으므로 신고 대상 메시지 원문을 contentSnapshot으로 함께 보내야 운영자가 내용을 확인할 수 있다.',
  })
  @ApiResponse({ status: 201, description: '접수 완료 — 신고 id 반환' })
  @ApiResponse({
    status: 400,
    description: '자기 자신 신고 또는 신고 도배 제한',
  })
  @ApiResponse({ status: 404, description: '대상 유저 없음' })
  async report(
    @Req() req: { user: { uid: string } },
    @Body() dto: CreateReportDto,
  ) {
    return this.moderation.report(await this.requireUserId(req.user.uid), dto);
  }
}
