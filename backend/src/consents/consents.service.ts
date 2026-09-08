import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserConsent } from './entities/user-consent.entity';
import {
  ACCEPTED_CONSENT_VERSIONS,
  CLIENT_CONSENT_DOCUMENTS,
  ConsentDocument,
  SERVER_CONSENT_DOCUMENTS,
  SERVER_CONSENT_ROWS,
} from './constants';
import { ErrorCode, errBody } from '../common/errors/error-code';

export interface ConsentInput {
  document: ConsentDocument;
  version: string;
}

export interface RecordConsentsInput {
  /** 조항 전문이 있는 문서의 동의. 클라이언트가 표시한 문서의 개정일을 함께 보낸다. */
  consents: ConsentInput[];
  /** 만 14세 이상 확인. `version`은 서버가 채운다. */
  ageConfirmed: boolean;
}

/** 원장에 들어갈 한 행. `userId`는 호출부가 붙인다. */
interface ConsentRow {
  document: ConsentDocument;
  version: string;
}

@Injectable()
export class ConsentsService {
  constructor(
    @InjectRepository(UserConsent)
    private readonly repo: Repository<UserConsent>,
  ) {}

  /**
   * 동의 이력을 남긴다. 필수 항목이 하나라도 빠졌거나 중복되면 기록하지 않고 400으로 막는다.
   *
   * 검증을 호출부가 아니라 여기서 하는 이유: 이 서비스를 거치지 않고 동의가 기록되는 길이
   * 없어야, 새 호출부(소셜 가입 등)가 생겼을 때 검증을 다시 옮겨 적다 빠뜨리는 일이 없다.
   * (호출부가 트랜잭션을 열기 전에 같은 검증을 미리 부르는 것은 무방하다 — 아래 buildConsentRows는
   * 부수효과가 없어 두 번 불러도 결과가 같고, 여기 검사가 최종 방어선으로 남는다.)
   *
   * `manager`가 필수인 것도 같은 이유다 — 이용자 INSERT와 반드시 한 트랜잭션에 묶여야 한다.
   * 따로 커밋하면 이용자는 생겼는데 동의 이력만 없는 행이 남을 수 있고, 그건 이 기능이
   * 없애려던 상태(동의를 받았다는 증거가 없는 계정) 그 자체다.
   */
  async recordAll(
    userId: string,
    input: RecordConsentsInput,
    manager: EntityManager,
  ): Promise<void> {
    const rows = buildConsentRows(input);

    const repo = manager.getRepository(UserConsent);
    await repo.insert(rows.map((row) => ({ userId, ...row })));
  }

  /**
   * 이용자가 문서별로 마지막에 동의한 버전. 문서 개정 시 재동의 대상을 고르는 데 쓴다.
   * append-only 원장이라 문서당 여러 행이 있을 수 있어 가장 최근 것만 남긴다.
   *
   * 아직 호출부가 없다 — 재동의 흐름이 생길 때 쓰려고 원장의 읽기 경로를 함께 둔 것이다.
   */
  async findLatestVersions(userId: string): Promise<Record<string, string>> {
    const rows = await this.repo.find({
      where: { userId },
      order: { agreedAt: 'ASC', id: 'ASC' },
    });

    // 오름차순으로 훑으며 덮어써 문서별 마지막 값만 남긴다. agreedAt이 같은 초에 몰려도
    // (가입 시 네 건이 한 트랜잭션에서 들어간다) id가 tie-breaker라 순서가 확정된다.
    const latest: Record<string, string> = {};
    for (const row of rows) latest[row.document] = row.version;
    return latest;
  }
}

/**
 * 요청을 원장 행으로 바꾼다. 필수 항목이 빠지거나 중복되면 `CONSENT_INCOMPLETE`,
 * 개정일이 서버가 아는 값이 아니면 `CONSENT_VERSION_UNKNOWN`으로 400을 던진다.
 *
 * 중복까지 거르는 이유: 같은 문서를 서로 다른 버전으로 두 번 보내면 어느 쪽이 실제 동의인지
 * 알 수 없는데, append-only라 나중에 구분할 방법도 없다. 애매한 이력을 남기느니 거절한다.
 *
 * 부수효과가 없어 트랜잭션 밖에서 미리 불러 fail-fast 용도로 써도 된다.
 */
export function buildConsentRows(input: RecordConsentsInput): ConsentRow[] {
  const seen = new Set<string>();
  const duplicated: string[] = [];
  for (const item of input.consents) {
    if (seen.has(item.document)) duplicated.push(item.document);
    seen.add(item.document);
  }

  const missing: string[] = CLIENT_CONSENT_DOCUMENTS.filter(
    (doc) => !seen.has(doc),
  );
  // 클라이언트가 보낼 version이 없는 항목이라 배열이 아니라 별도 불리언으로 받는다.
  if (!input.ageConfirmed) missing.push(ConsentDocument.AGE_14_OVER);

  // 클라이언트가 보내면 안 되는 항목(서버가 version을 채우는 것)을 보낸 경우도 막는다 —
  // 통과시키면 서버가 채운 행과 함께 같은 문서가 두 번 남아 어느 쪽이 진짜인지 알 수 없다.
  const notAllowed = [...seen].filter((doc) =>
    SERVER_CONSENT_DOCUMENTS.includes(doc as ConsentDocument),
  );

  if (
    missing.length === 0 &&
    duplicated.length === 0 &&
    notAllowed.length === 0
  ) {
    // 항목이 다 갖춰진 뒤에야 버전을 본다 — 문서가 빠졌거나 보내면 안 되는 항목이 섞인
    // 상태에서는 어느 문서의 허용 목록과 대조해야 하는지가 정해지지 않는다.
    assertKnownVersions(input.consents);

    return [
      ...input.consents.map((item) => ({
        document: item.document,
        version: item.version,
      })),
      // 항목별 버전이 상수 표에 함께 적혀 있다 — 여기서 버전을 고르지 않는다.
      ...SERVER_CONSENT_ROWS,
    ];
  }

  const detail = [
    missing.length ? `누락: ${missing.join(', ')}` : '',
    duplicated.length ? `중복: ${duplicated.join(', ')}` : '',
    notAllowed.length ? `서버가 채우는 항목: ${notAllowed.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' / ');

  throw new BadRequestException(
    errBody(
      ErrorCode.CONSENT_INCOMPLETE,
      `필수 동의 항목이 올바르지 않습니다. (${detail})`,
    ),
  );
}

/**
 * 보내온 개정일이 서버가 아는 값인지 확인한다. 하나라도 모르는 값이면 가입을 받지 않는다.
 *
 * DTO의 `@Matches`는 형식(YYYY-MM-DD)만 보므로 `"2020-01-01"` 같은 실재하지 않는 개정일이
 * 그대로 통과한다. append-only 원장이라 한 번 들어가면 고칠 수 없고, 그러면 "동의 사실을
 * 입증한다"는 이 표의 목적이 그 행에 대해서는 성립하지 않는다.
 *
 * 지난 개정일까지 받아주므로(`ACCEPTED_CONSENT_VERSIONS`) 아직 업데이트하지 않은 설치본의
 * 가입은 막히지 않는다. 반대로 **서버가 모르는 값은 대개 프론트가 백엔드보다 먼저 배포된
 * 상태**라, 거절이 곧 배포 순서가 뒤집혔다는 신호가 된다.
 */
function assertKnownVersions(consents: ConsentInput[]): void {
  const unknown = consents.filter(
    (item) => !ACCEPTED_CONSENT_VERSIONS[item.document]?.includes(item.version),
  );
  if (unknown.length === 0) return;

  const detail = unknown
    .map(
      (item) =>
        `${item.document}: ${item.version} (허용: ${(
          ACCEPTED_CONSENT_VERSIONS[item.document] ?? []
        ).join(', ')})`,
    )
    .join(' / ');

  throw new BadRequestException(
    errBody(
      ErrorCode.CONSENT_VERSION_UNKNOWN,
      `동의한 문서의 개정일이 서버가 아는 값이 아닙니다. (${detail})`,
    ),
  );
}
