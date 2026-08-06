import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  DataSource,
  EntityManager,
  QueryFailedError,
} from 'typeorm';
import { Review } from './entities/review.entity';
import { MissionPhoto } from './entities/mission-photo.entity';
import { RedisService } from '../common/redis/redis.service';
import { S3Service } from '../common/s3/s3.service';
import { UsersService } from '../users/users.service';
import { ScoresService } from '../scores/scores.service';
import { DistrictsService } from '../districts/districts.service';
import { ScoreEventType } from '../scores/entities/score-event.entity';
import { secondsUntilKstMidnight } from '../common/utils/kst.util';
import { verifySpotProximity } from '../common/geo/spot-proximity.util';
import { assertSupportedImage } from '../common/s3/image-signature.util';
import { ReviewMissionDto } from './dto/review-mission.dto';

// 미션 보너스 기본값(가중치 곱하기 전). 개인 점수에만 기여하고 팀 점수는 0.
const PHOTO_PERSONAL_BASE = 50;
const REVIEW_PERSONAL_BASE = 50;

const REVIEW_LIST_LIMIT = 50;

// 방문 체크인 후 사진·리뷰 제출을 허용하는 창(초). 체크인 시점 기준 롤링 24시간.
const VISIT_WINDOW_SECONDS = 24 * 60 * 60;

interface UploadedPhoto {
  buffer: Buffer;
}

@Injectable()
export class MissionsService {
  private readonly logger = new Logger(MissionsService.name);

  constructor(
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly s3: S3Service,
    private readonly usersService: UsersService,
    private readonly scoresService: ScoresService,
    private readonly districtsService: DistrictsService,
  ) {}

  /**
   * 현장 방문 체크인. GPS(50m) 검증만 수행하고 방문 창(24h)을 연다 — 점수 지급은 없다.
   * 이후 창 유효기간 안에서는 사진·리뷰를 좌표 없이 제출할 수 있다.
   */
  async checkin(spotId: number, lat: number, lng: number, userId: string) {
    const sigungucode = await verifySpotProximity(
      this.dataSource,
      spotId,
      lat,
      lng,
    );
    await this.redis.markVisit(
      userId,
      spotId,
      sigungucode,
      VISIT_WINDOW_SECONDS,
    );
    return { success: true, spotId, expiresInSeconds: VISIT_WINDOW_SECONDS };
  }

  /**
   * 현장 사진 인증. 사전 체크인으로 열린 방문 창 전제 → S3 업로드 → 개인 보너스 지급.
   * 관광지별 인당 하루 1회(KST 자정 리셋).
   */
  async submitPhoto(
    photo: UploadedPhoto,
    spotId: number,
    userId: string,
    team: string,
  ) {
    // 방문 전제가 상위 조건 — 체크인 없으면 이미지 검증 이전에 먼저 막고,
    // 일일 게이트도 소진하지 않는다.
    const sigungucode = await this.requireVisit(userId, spotId);

    // 선언된 mimetype·파일명은 믿지 않는다. 실제 바이트 시그니처로 포맷을 판별해
    // S3의 확장자·Content-Type까지 그 결과에서만 파생시킨다.
    const image = assertSupportedImage(photo.buffer);

    const daily = await this.redis.markMissionDaily(
      'photo',
      userId,
      spotId,
      secondsUntilKstMidnight(),
    );
    if (!daily.created) {
      throw new ConflictException(
        '이 관광지 사진 인증은 오늘 이미 완료했습니다. (KST 자정에 초기화)',
      );
    }

    try {
      const imageUrl = await this.s3.upload(
        photo.buffer,
        image.mimetype,
        `missions/photos/${spotId}`,
        image.ext,
      );
      const personal = await this.awardBonus({
        userId,
        team,
        spotId,
        type: ScoreEventType.MISSION_PHOTO,
        personalBase: PHOTO_PERSONAL_BASE,
        sigungucode,
        persist: (manager) =>
          manager.insert(MissionPhoto, { userId, team, spotId, imageUrl }),
      });
      return {
        success: true,
        spotId,
        team,
        type: ScoreEventType.MISSION_PHOTO,
        pointsAwarded: personal,
        teamPointsAwarded: 0,
        imageUrl,
      };
    } catch (err) {
      await this.rollbackDaily('photo', userId, spotId, daily.token);
      throw err;
    }
  }

  /**
   * 관광지 리뷰(별점). 사전 체크인으로 열린 방문 창 전제 → 리뷰 저장 → 개인 보너스 지급.
   * 관광지별 인당 하루 1회(KST 자정 리셋).
   */
  async submitReview(dto: ReviewMissionDto, userId: string, team: string) {
    const { spotId, rating, content } = dto;
    const sigungucode = await this.requireVisit(userId, spotId);

    const daily = await this.redis.markMissionDaily(
      'review',
      userId,
      spotId,
      secondsUntilKstMidnight(),
    );
    if (!daily.created) {
      throw new ConflictException(
        '이 관광지 리뷰는 오늘 이미 작성했습니다. (KST 자정에 초기화)',
      );
    }

    try {
      const personal = await this.awardBonus({
        userId,
        team,
        spotId,
        type: ScoreEventType.MISSION_REVIEW,
        personalBase: REVIEW_PERSONAL_BASE,
        sigungucode,
        persist: (manager) =>
          manager.insert(Review, {
            userId,
            team,
            spotId,
            rating,
            content: content ?? null,
          }),
      });
      return {
        success: true,
        spotId,
        team,
        type: ScoreEventType.MISSION_REVIEW,
        pointsAwarded: personal,
        teamPointsAwarded: 0,
      };
    } catch (err) {
      await this.rollbackDaily('review', userId, spotId, daily.token);
      throw err;
    }
  }

  /** 관광지 리뷰 목록 (최신순, 최대 50건) + 평균 별점·전체 개수. */
  async listReviews(spotId: number) {
    const items = await this.reviewRepo
      .createQueryBuilder('review')
      .leftJoin('review.user', 'user')
      .select('review.id', 'id')
      .addSelect('review.rating', 'rating')
      .addSelect('review.content', 'content')
      .addSelect('review.team', 'team')
      .addSelect('review.createdAt', 'createdAt')
      .addSelect('user.nickname', 'nickname')
      .where('review.spotId = :spotId', { spotId })
      .orderBy('review.createdAt', 'DESC')
      .limit(REVIEW_LIST_LIMIT)
      .getRawMany();

    const stats = await this.reviewRepo
      .createQueryBuilder('review')
      .select('COUNT(*)', 'count')
      .addSelect('AVG(review.rating)', 'avg')
      .where('review.spotId = :spotId', { spotId })
      .getRawOne<{ count: string; avg: string | null }>();

    return {
      spotId,
      count: Number(stats?.count ?? 0),
      averageRating:
        stats?.avg != null ? Number(Number(stats.avg).toFixed(2)) : null,
      items,
    };
  }

  /**
   * 미션 기록 저장 + 개인 점수 원장 append + user.score 반영을 한 트랜잭션으로 묶는다.
   * 팀 점수는 항상 0(영토 집계는 CLAIM_*만 계산). 지급한 개인 점수를 반환한다.
   */
  private async awardBonus(input: {
    userId: string;
    team: string;
    spotId: number;
    type: ScoreEventType;
    personalBase: number;
    sigungucode: string | null;
    persist: (manager: EntityManager) => Promise<unknown>;
  }): Promise<number> {
    const weight = this.districtsService.getWeight(input.sigungucode);
    const personal = Math.round(input.personalBase * weight);

    try {
      await this.dataSource.transaction(async (manager) => {
        await input.persist(manager);
        // 가중치가 0이라 지급 점수가 0이면 원장·user.score는 건드리지 않는다(claims.visit과 동일).
        if (personal > 0) {
          await this.scoresService.record(manager, {
            userId: input.userId,
            team: input.team,
            type: input.type,
            personalPoints: personal,
            teamPoints: 0,
            spotId: input.spotId,
          });
          await this.usersService.applyScoreDelta(
            input.userId,
            personal,
            manager,
          );
        }
      });
    } catch (err) {
      // FK 위반(23503): 근접 검증 이후 이 시점 사이에 spot이 삭제된 경합 —
      // claims.visit과 동일하게 404로 처리한다.
      const pgCode = (err instanceof QueryFailedError &&
        (err.driverError as { code?: string })?.code) as string | undefined;
      if (pgCode === '23503') {
        throw new NotFoundException('관광지를 찾을 수 없습니다.');
      }
      throw err;
    }

    return personal;
  }

  /**
   * 사전 체크인으로 열린 방문 창을 확인하고 체크인 당시 저장한 sigungucode를 돌려준다.
   * 창이 없으면(미체크인/만료) 400 — 일일 게이트를 소진하기 전에 호출해야 한다.
   */
  private async requireVisit(
    userId: string,
    spotId: number,
  ): Promise<string | null> {
    const visit = await this.redis.getVisit(userId, spotId);
    if (visit === null) {
      throw new BadRequestException(
        '먼저 현장에서 방문 인증(체크인)을 해주세요. (체크인 후 24시간 이내 제출 가능)',
      );
    }
    // 빈 문자열은 "방문했으나 시군구코드 없음" — null(미방문)과 구분해 그대로 반환한다.
    return visit === '' ? null : visit;
  }

  private async rollbackDaily(
    mission: string,
    userId: string,
    spotId: number,
    token: string,
  ): Promise<void> {
    await this.redis
      .clearMissionDaily(mission, userId, spotId, token)
      .catch((redisErr) => {
        this.logger.error(
          `미션 일일 키 롤백 실패 mission=${mission} userId=${userId} spotId=${spotId}`,
          redisErr,
        );
      });
  }
}
