import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewMissionDto {
  @ApiProperty({ description: '관광지 ID' })
  @IsInt()
  @IsPositive()
  spotId: number;

  @ApiProperty({ description: '현재 위도', example: 35.1796 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ description: '현재 경도', example: 129.0756 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

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
