import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  CLIENT_CONSENT_DOCUMENTS,
  CONSENT_VERSION_PATTERN,
  ConsentDocument,
} from '../../consents/constants';

export class ConsentItemDto {
  @ApiProperty({
    enum: [
      ConsentDocument.SERVICE,
      ConsentDocument.PRIVACY,
      ConsentDocument.LOCATION,
    ],
    example: ConsentDocument.SERVICE,
    description:
      '동의 항목 식별자. 프론트 `LegalDocumentKey`와 값이 같다. `age14`는 여기 넣지 않는다 — 조항 전문이 없어 보낼 version이 없고, 아래 `ageConfirmed`로 받는다.',
  })
  @IsEnum(ConsentDocument)
  document: ConsentDocument;

  @ApiProperty({
    example: '2026-09-08',
    description:
      '동의한 문서의 개정일(`LegalDocument.version`). 재동의 대상 판단의 기준값이라 화면에 실제로 표시한 문서의 값을 그대로 보낸다. **형식뿐 아니라 값도 검사한다** — 서버가 아는 개정일(현재 또는 지난 버전)이 아니면 `CONSENT_VERSION_UNKNOWN`으로 거절한다.',
  })
  @IsString()
  @Length(1, 20)
  // 형식을 강제해 "undefined"·빈 값 같은 배선 사고가 그대로 적재되는 것을 막는다.
  // append-only 원장이라 잘못 들어간 값은 나중에 고칠 수 없다.
  // 형식이 맞는 엉뚱한 날짜는 여기서 걸러지지 않는다 — 값 자체의 대조는 실제 허용 목록을
  // 아는 ConsentsService(buildConsentRows)가 한다. 여기서 하면 상수 표가 DTO로 새어
  // 나가고, 소셜 가입 등 다른 호출부가 이 DTO를 안 쓰면 검사도 함께 빠진다.
  @Matches(CONSENT_VERSION_PATTERN, {
    message: 'version은 YYYY-MM-DD 형식이어야 합니다.',
  })
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
   * 어느 항목이 필수인지는 서버가 정한다(`CLIENT_CONSENT_DOCUMENTS`). 클라이언트가 보낸
   * 목록을 그대로 믿으면 화면에서 항목을 빠뜨렸을 때 서버도 함께 속아 넘어간다.
   */
  @ApiProperty({
    type: [ConsentItemDto],
    description:
      '가입 필수 동의 이력. `service`·`privacy`·`location` 세 항목이 모두 있어야 하며, 하나라도 없거나 중복되면 `CONSENT_INCOMPLETE`로 거절한다.',
  })
  @IsArray()
  @ArrayNotEmpty()
  // 정당한 요청은 정확히 CLIENT_CONSENT_DOCUMENTS 개수다. 상한이 없으면 본문 크기 한도까지
  // 채운 배열의 모든 원소에 대해 @IsEnum·@Matches가 먼저 돌고 나서야 거절된다.
  @ArrayMaxSize(CLIENT_CONSENT_DOCUMENTS.length)
  @ValidateNested({ each: true })
  @Type(() => ConsentItemDto)
  consents: ConsentItemDto[];

  /**
   * 만 14세 이상 확인. `true`가 아니면 가입을 받지 않는다.
   *
   * `consents` 배열이 아니라 별도 불리언인 이유는 이 항목에 조항 전문이 없어 클라이언트가
   * 보낼 `version`이 없기 때문이다. 원장에는 나머지와 같은 형태로 남되 `version`은 서버가
   * `AGE_POLICY_VERSION`으로 채운다.
   */
  @ApiProperty({
    example: true,
    description:
      '만 14세 이상 확인. `true`가 아니면 `CONSENT_INCOMPLETE`로 거절한다. 동의 이력에는 `age14` 행으로 남고 version은 서버가 채운다.',
  })
  @IsBoolean()
  ageConfirmed: boolean;
}
