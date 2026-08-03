import { IsInt, IsNumber, IsPositive, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 사진 미션 요청. multipart/form-data로 오므로 필드가 문자열로 도착한다 —
 * @Type으로 number 변환 후 검증한다(전역 ValidationPipe transform:true).
 */
export class PhotoMissionDto {
  @ApiProperty({ description: '관광지 ID' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  spotId: number;

  @ApiProperty({ description: '현재 위도', example: 35.1796 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ description: '현재 경도', example: 129.0756 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}
