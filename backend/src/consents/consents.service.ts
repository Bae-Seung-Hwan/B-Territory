import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserConsent } from './entities/user-consent.entity';
import { ConsentDocument, REQUIRED_CONSENT_DOCUMENTS } from './constants';
import { ErrorCode, errBody } from '../common/errors/error-code';

export interface ConsentInput {
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
   *
   * `manager`가 필수인 것도 같은 이유다 — 이용자 INSERT와 반드시 한 트랜잭션에 묶여야 한다.
   * 따로 커밋하면 이용자는 생겼는데 동의 이력만 없는 행이 남을 수 있고, 그건 이 기능이
   * 없애려던 상태(동의를 받았다는 증거가 없는 계정) 그 자체다.
   */
  async recordAll(
    userId: string,
    items: ConsentInput[],
    manager: EntityManager,
  ): Promise<void> {
    assertConsentsComplete(items);

    const repo = manager.getRepository(UserConsent);
    await repo.insert(
      items.map((item) => ({
        userId,
        document: item.document,
        version: item.version,
      })),
    );
  }

  /**
   * 이용자가 문서별로 마지막에 동의한 버전. 문서 개정 시 재동의 대상을 고르는 데 쓴다.
   * append-only 원장이라 문서당 여러 행이 있을 수 있어 가장 최근 것만 남긴다.
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
 * 필수 동의 항목이 빠짐없이, 중복 없이 왔는지 검증한다.
 *
 * 중복까지 거르는 이유: 같은 문서를 서로 다른 버전으로 두 번 보내면 어느 쪽이 실제 동의인지
 * 알 수 없는데, append-only라 나중에 구분할 방법도 없다. 애매한 이력을 남기느니 거절한다.
 */
export function assertConsentsComplete(items: ConsentInput[]): void {
  const seen = new Set<string>();
  const duplicated: string[] = [];
  for (const item of items) {
    if (seen.has(item.document)) duplicated.push(item.document);
    seen.add(item.document);
  }

  const missing = REQUIRED_CONSENT_DOCUMENTS.filter((doc) => !seen.has(doc));

  if (missing.length === 0 && duplicated.length === 0) return;

  const detail = [
    missing.length ? `누락: ${missing.join(', ')}` : '',
    duplicated.length ? `중복: ${duplicated.join(', ')}` : '',
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
