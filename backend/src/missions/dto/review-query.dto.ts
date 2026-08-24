import { IsInt, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ReviewQueryDto {
  @ApiProperty({ description: '관광지 ID' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  spotId: number;
}
