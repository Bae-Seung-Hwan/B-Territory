import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendLinkDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;
}
