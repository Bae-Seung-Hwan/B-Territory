import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserConsent } from './entities/user-consent.entity';
import {
  AGE_POLICY_VERSION,
  CLIENT_CONSENT_DOCUMENTS,
  ConsentDocument,
  SERVER_CONSENT_DOCUMENTS,
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
 * 요청을 원장 행으로 바꾼다. 필수 항목이 빠지거나 중복되면 400을 던진다.
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
  )
    return [
      ...input.consents.map((item) => ({
        document: item.document,
        version: item.version,
      })),
      ...SERVER_CONSENT_DOCUMENTS.map((document) => ({
        document,
        version: AGE_POLICY_VERSION,
      })),
    ];

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
