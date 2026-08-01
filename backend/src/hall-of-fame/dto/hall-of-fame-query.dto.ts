import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// 시즌 상한 — 3개월/시즌이라 10000이면 약 2500년치로 충분하고, 이보다 크면 seasonRange의
// Date.UTC 연도가 JS Date 표현 한계(연 275760)를 넘어 Invalid Date → 500이 되므로 미리 막는다.
const MAX_SEASON = 10000;

export class HallOfFameQueryDto {
  @ApiPropertyOptional({
    description:
      '시즌 번호(1-based). 생략 시 현재 시즌(pre-season이면 시즌 1).',
    minimum: 1,
    maximum: MAX_SEASON,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SEASON)
  season?: number;
}
