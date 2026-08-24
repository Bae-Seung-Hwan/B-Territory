import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ReportReason } from '../entities/report.entity';

export class CreateReportDto {
  @ApiProperty({ description: '신고 대상 유저 ID' })
  @IsUUID()
  targetUserId: string;

  @ApiProperty({ enum: ReportReason, description: '신고 사유' })
  @IsEnum(ReportReason)
  reason: ReportReason;

  @ApiPropertyOptional({
    description:
      '신고 대상 메시지 원문. 채팅은 서버에 저장되지 않으므로 이 값이 유일한 증거가 된다.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  contentSnapshot?: string;

  @ApiPropertyOptional({ description: '신고자 부연 설명', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  detail?: string;
}
