import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyTokenDto {
  @ApiProperty({ description: '메일로 발송된 인증 링크의 token 쿼리 파라미터' })
  @IsString()
  @Length(1, 200)
  token: string;
}
