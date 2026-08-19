import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserBlock } from './entities/user-block.entity';
import { Report, ReportStatus } from './entities/report.entity';
import { CreateReportDto } from './dto/create-report.dto';
import { UsersService } from '../users/users.service';
import { RedisService } from '../common/redis/redis.service';
import { ErrorCode, errBody } from '../common/errors/error-code';

// 신고 도배 방지 — 같은 신고자가 짧은 시간에 대량 접수하는 것을 막는다.
const REPORT_LIMIT = 10;
const REPORT_WINDOW_SEC = 60 * 60;

// "나를 차단한 사람" 캐시 TTL. 릴레이 핫패스에서 매 메시지마다 DB를 치지 않기 위한 것으로,
// 짧게 잡아 차단 직후에도 오래 반영이 밀리지 않게 한다. 차단/해제 시 즉시 무효화도 한다.
const BLOCKED_BY_TTL_SEC = 300;

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    @InjectRepository(UserBlock)
    private readonly blockRepo: Repository<UserBlock>,
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
    private readonly usersService: UsersService,
    private readonly redis: RedisService,
  ) {}

  private blockedByKey(userId: string): string {
    return `chat:blockedby:${userId}`;
  }

  /** 차단 목록(내가 차단한 사람) — 클라이언트가 로컬 필터링에 쓴다. */
  async listBlocks(
    blockerId: string,
  ): Promise<{ userId: string; nickname: string; blockedAt: string }[]> {
    const rows = await this.blockRepo.find({
      where: { blockerId },
      relations: { blocked: true },
      order: { createdAt: 'DESC' },
    });
    return rows.map((r) => ({
      userId: r.blockedId,
      nickname: r.blocked?.nickname ?? '(탈퇴한 사용자)',
      blockedAt: r.createdAt.toISOString(),
    }));
  }

  async block(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId)
      throw new BadRequestException(
        errBody(ErrorCode.BLOCK_SELF, '자기 자신은 차단할 수 없습니다.'),
      );

    const target = await this.usersService.findById(blockedId);
    if (!target)
      throw new NotFoundException(
        errBody(ErrorCode.USER_NOT_FOUND, '유저를 찾을 수 없습니다.'),
      );

    // 이미 차단한 상대를 다시 차단해도 성공으로 본다(멱등) — 클라이언트 재시도나
    // 중복 탭에서 409를 받을 이유가 없다.
    await this.blockRepo
      .createQueryBuilder()
      .insert()
      .into(UserBlock)
      .values({ blockerId, blockedId })
      .orIgnore()
      .execute();

    await this.invalidateBlockedBy(blockedId);
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    await this.blockRepo.delete({ blockerId, blockedId });
    await this.invalidateBlockedBy(blockedId);
  }

  /**
   * targetId를 차단한 사람들의 id 집합. 채팅 릴레이가 수신자를 제외할 때 쓴다.
   *
   * Redis 장애는 미스로 흡수한다 — 캐시는 가속 장치일 뿐이고, 여기서 throw하면
   * Redis가 죽었을 때 채팅 전체가 멈춘다.
   */
  async getBlockedBy(targetId: string): Promise<string[]> {
    const key = this.blockedByKey(targetId);
    try {
      const cached = await this.redis.get(key);
      if (cached !== null) return cached === '' ? [] : cached.split(',');
    } catch (err) {
      this.logger.warn(`차단 캐시 조회 실패: ${(err as Error).message}`);
    }

    const rows = await this.blockRepo.find({
      where: { blockedId: targetId },
      select: { blockerId: true },
    });
    const ids = rows.map((r) => r.blockerId);

    try {
      await this.redis.set(key, ids.join(','), BLOCKED_BY_TTL_SEC);
    } catch (err) {
      this.logger.warn(`차단 캐시 저장 실패: ${(err as Error).message}`);
    }
    return ids;
  }

  private async invalidateBlockedBy(targetId: string): Promise<void> {
    try {
      await this.redis.del(this.blockedByKey(targetId));
    } catch (err) {
      this.logger.warn(`차단 캐시 무효화 실패: ${(err as Error).message}`);
    }
  }

  /**
   * 신고 접수. 채팅 메시지는 서버에 저장되지 않으므로 클라이언트가 보낸 원문을
   * 스냅샷으로 함께 보관한다(신고 시점의 유일한 증거).
   */
  async report(
    reporterId: string,
    dto: CreateReportDto,
  ): Promise<{ id: number }> {
    if (reporterId === dto.targetUserId)
      throw new BadRequestException(
        errBody(ErrorCode.REPORT_SELF, '자기 자신은 신고할 수 없습니다.'),
      );

    const target = await this.usersService.findById(dto.targetUserId);
    if (!target)
      throw new NotFoundException(
        errBody(ErrorCode.USER_NOT_FOUND, '유저를 찾을 수 없습니다.'),
      );

    const allowed = await this.redis.consumeRateLimit(
      `report:rate:${reporterId}`,
      REPORT_LIMIT,
      REPORT_WINDOW_SEC,
    );
    if (!allowed)
      throw new BadRequestException(
        errBody(
          ErrorCode.REPORT_RATE_LIMIT,
          '신고가 너무 잦습니다. 잠시 후 다시 시도하세요.',
        ),
      );

    const saved = await this.reportRepo.save({
      reporterId,
      targetUserId: dto.targetUserId,
      targetNickname: target.nickname,
      reason: dto.reason,
      contentSnapshot: dto.contentSnapshot ?? null,
      detail: dto.detail ?? null,
      status: ReportStatus.PENDING,
    });

    // 운영자가 별도 도구 없이도 접수 사실을 인지할 수 있도록 로그로 남긴다.
    this.logger.warn(
      `신고 접수 #${saved.id}: target=${dto.targetUserId} reason=${dto.reason}`,
    );
    return { id: saved.id };
  }
}
