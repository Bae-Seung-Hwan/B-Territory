import { IsInt, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 사진 미션 요청. multipart/form-data로 오므로 필드가 문자열로 도착한다 —
 * @Type으로 number 변환 후 검증한다(전역 ValidationPipe transform:true).
 * 방문 근접 검증은 사전 체크인(POST /missions/checkin)에서 끝나므로 좌표는 받지 않는다.
 */
export class PhotoMissionDto {
  @ApiProperty({ description: '관광지 ID' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  spotId: number;
}
