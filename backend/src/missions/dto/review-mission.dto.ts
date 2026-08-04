import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 리뷰 미션 요청. 방문 근접 검증은 사전 체크인(POST /missions/checkin)에서 끝나므로
 * 좌표는 받지 않는다.
 */
export class ReviewMissionDto {
  @ApiProperty({ description: '관광지 ID' })
  @IsInt()
  @IsPositive()
  spotId: number;

  @ApiProperty({ description: '별점 1~5', minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ description: '리뷰 본문 (최대 1000자)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  content?: string;
}
