import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ConsentDocument } from '../../consents/constants';

export class ConsentItemDto {
  @ApiProperty({
    enum: ConsentDocument,
    example: ConsentDocument.SERVICE,
    description: '동의 항목 식별자. 프론트 `LegalDocumentKey`와 값이 같다.',
  })
  @IsEnum(ConsentDocument)
  document: ConsentDocument;

  @ApiProperty({
    example: '2026-09-07',
    description:
      '동의한 문서의 개정일(`LegalDocument.version`). 재동의 대상 판단의 기준값이라 화면에 실제로 표시한 문서의 값을 그대로 보낸다.',
  })
  @IsString()
  @Length(1, 20)
  version: string;
}

export class RegisterDto {
  @ApiProperty({ example: '홍길동' })
  @IsString()
  @Length(2, 20)
  nickname: string;

  @ApiProperty({ example: 'KR', description: 'ISO 3166-1 alpha-2 국가코드' })
  @IsString()
  @Length(2, 2)
  nationality: string;

  /**
   * 필수 동의 항목 전체. **선택 항목이 아니다** — 빠지면 400이고 계정은 만들어지지 않는다.
   * 어느 항목이 필수인지는 서버가 정한다(`REQUIRED_CONSENT_DOCUMENTS`). 클라이언트가 보낸
   * 목록을 그대로 믿으면 화면에서 항목을 빠뜨렸을 때 서버도 함께 속아 넘어간다.
   */
  @ApiProperty({
    type: [ConsentItemDto],
    description:
      '가입 필수 동의 이력. `service`·`privacy`·`location`·`age14` 네 항목이 모두 있어야 하며, 하나라도 없거나 중복되면 `CONSENT_INCOMPLETE`로 거절한다.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ConsentItemDto)
  consents: ConsentItemDto[];
}
