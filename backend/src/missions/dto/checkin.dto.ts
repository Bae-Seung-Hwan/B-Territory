import { IsInt, IsNumber, IsPositive, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 방문 체크인 요청. 현장 GPS로 관광지 근접(50m)을 검증해 방문 창을 여는 데만 쓰인다.
 * application/json으로 오지만, 안전하게 @Type으로 number 변환 후 검증한다.
 */
export class CheckinDto {
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
