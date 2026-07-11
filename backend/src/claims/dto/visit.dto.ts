import { IsNumber, IsInt, IsPositive, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VisitDto {
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
}
