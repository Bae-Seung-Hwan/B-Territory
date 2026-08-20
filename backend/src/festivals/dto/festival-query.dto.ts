import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export type FestivalStatus = 'ongoing' | 'upcoming';

export class FestivalQueryDto {
  @ApiPropertyOptional({
    enum: ['ongoing', 'upcoming'],
    description:
      '진행 상태 필터. 생략 시 진행 중 + 예정을 모두 반환(종료된 축제 제외).',
  })
  @IsOptional()
  @IsIn(['ongoing', 'upcoming'])
  status?: FestivalStatus;
}
