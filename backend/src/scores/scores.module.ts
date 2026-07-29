import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClaimScoreEvent } from './entities/claim-score-event.entity';
import { PointEvent } from './entities/point-event.entity';

/**
 * 점수·포인트 원장 스키마 등록용 모듈.
 * 서비스/컨트롤러(점수 지급, 팀 점수 집계, 포인트 잔액 API)는 기준 점령치·가중치
 * 기획 확정 후 후속 PR에서 구현한다. 지금은 autoLoadEntities가 엔티티를 인식하도록
 * forFeature 등록만 한다.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ClaimScoreEvent, PointEvent])],
  exports: [TypeOrmModule],
})
export class ScoresModule {}
