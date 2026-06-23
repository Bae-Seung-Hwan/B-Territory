import { IsEmail, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @Length(6, 50)
  password: string;

  @ApiProperty({ example: '홍길동' })
  @IsString()
  @Length(2, 20)
  nickname: string;

  @ApiProperty({ example: 'KR', description: 'ISO 3166-1 alpha-2 국가코드' })
  @IsString()
  @Length(2, 2)
  nationality: string;
}
