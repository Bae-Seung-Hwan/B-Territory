import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScoreEvent } from './entities/score-event.entity';
import { ClaimScoreEvent } from './entities/claim-score-event.entity';
import { PointEvent } from './entities/point-event.entity';
import { ScoresService } from './scores.service';

/**
 * 점수 시스템 모듈.
 * - ScoreEvent(+ScoresService): 이번 점령 점수 시스템의 실제 원장·집계 구현.
 * - ClaimScoreEvent / PointEvent: PR #20이 선반영한 플레이스홀더 원장 스키마(아직 서비스 없음).
 *   ScoreEvent와 역할이 겹쳐 후속 정리 후보이나, #20 마이그레이션이 프로덕션에 해당 테이블을
 *   생성하므로 여기서는 엔티티 등록만 유지한다(비파괴적 병합).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ScoreEvent, ClaimScoreEvent, PointEvent]),
  ],
  providers: [ScoresService],
  exports: [ScoresService, TypeOrmModule],
})
export class ScoresModule {}
