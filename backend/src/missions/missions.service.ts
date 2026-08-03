import {
  Injectable,
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

interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
  ext: string;
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
   * 현장 사진 인증. GPS 방문 전제(50m 이내) → S3 업로드 → 개인 보너스 지급.
   * 관광지별 인당 하루 1회(KST 자정 리셋).
   */
  async submitPhoto(
    photo: UploadedPhoto,
    spotId: number,
    lat: number,
    lng: number,
    userId: string,
    team: string,
  ) {
    // 선언된 mimetype만 믿지 않고 실제 바이트 시그니처로 이미지 여부를 확인한다.
    assertSupportedImage(photo.buffer);

    // 방문 전제: 실패 시 일일 게이트를 소진하지 않도록 근접 검증을 먼저 한다.
    const sigungucode = await verifySpotProximity(
      this.dataSource,
      spotId,
      lat,
      lng,
    );

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
        photo.mimetype,
        `missions/photos/${spotId}`,
        photo.ext,
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
   * 관광지 리뷰(별점). GPS 방문 전제 → 리뷰 저장 → 개인 보너스 지급.
   * 관광지별 인당 하루 1회(KST 자정 리셋).
   */
  async submitReview(dto: ReviewMissionDto, userId: string, team: string) {
    const { spotId, lat, lng, rating, content } = dto;
    const sigungucode = await verifySpotProximity(
      this.dataSource,
      spotId,
      lat,
      lng,
    );

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
