import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  CLIENT_CONSENT_DOCUMENTS,
  CURRENT_CONSENT_VERSIONS,
  ConsentDocument,
} from '../consents/constants';
import { ErrorCode } from '../common/errors/error-code';
import { RegisterDto } from './dto/register.dto';

/**
 * 문서별 현재 개정일. 손으로 적지 않고 상수 표에서 가져온다 — 서버가 `version` 값까지
 * 대조하므로, 날짜를 박아 두면 문서를 개정하는 순간 이 스펙이 통째로 깨진다.
 */
const currentVersion = (document: ConsentDocument): string =>
  CURRENT_CONSENT_VERSIONS[document] as string;

const V = currentVersion(ConsentDocument.SERVICE);

function makeDto(overrides: Partial<RegisterDto> = {}): RegisterDto {
  return {
    nickname: '홍길동',
    nationality: 'kr',
    consents: CLIENT_CONSENT_DOCUMENTS.map((document) => ({
      document,
      version: currentVersion(document),
    })),
    ageConfirmed: true,
    ...overrides,
  };
}

describe('AuthService.register', () => {
  function makeService() {
    const created = { id: 'user-1' };
    const manager = {
      create: jest.fn((_entity, data: object) => data),
      save: jest.fn().mockResolvedValue(created),
    };
    // 실제 트랜잭션과 같은 형태로 콜백을 실행한다 — 콜백이 던지면 그대로 전파(=롤백)된다.
    const dataSource = {
      transaction: jest.fn((cb: (m: unknown) => Promise<unknown>) =>
        cb(manager),
      ),
    };
    const usersService = {
      findByFirebaseUid: jest.fn().mockResolvedValue(null),
      toProfile: jest.fn((u: object) => u),
    };
    const consentsService = {
      recordAll: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuthService(
      usersService as never,
      consentsService as never,
      dataSource as never,
    );
    return { service, usersService, consentsService, dataSource, manager };
  }

  it('이용자 생성과 동의 이력을 같은 트랜잭션에서 처리한다', async () => {
    const { service, consentsService, dataSource, manager } = makeService();

    await service.register(makeDto(), 'uid-1', 'a@b.com', true);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    // 동의 이력은 반드시 그 트랜잭션의 manager로 기록돼야 한다. 따로 커밋하면
    // 중간에 죽었을 때 "동의 증거가 없는 계정"이 남는다.
    expect(consentsService.recordAll).toHaveBeenCalledWith(
      'user-1',
      { consents: makeDto().consents, ageConfirmed: true },
      manager,
    );
  });

  it('동의 기록이 실패하면 예외가 전파돼 계정 생성이 롤백된다', async () => {
    const { service, consentsService } = makeService();
    consentsService.recordAll.mockRejectedValue(
      new BadRequestException({ code: ErrorCode.CONSENT_INCOMPLETE }),
    );

    await expect(
      service.register(makeDto(), 'uid-1', 'a@b.com', true),
    ).rejects.toThrow(BadRequestException);
  });

  it('국적은 대문자로 정규화해 team에도 같은 값을 넣는다', async () => {
    const { service, manager } = makeService();

    await service.register(makeDto(), 'uid-1', 'a@b.com', true);

    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nationality: 'KR', team: 'KR' }),
    );
  });

  it('이메일 미인증이면 트랜잭션을 열기 전에 막는다', async () => {
    const { service, dataSource } = makeService();

    await expect(
      service.register(makeDto(), 'uid-1', 'a@b.com', false),
    ).rejects.toThrow(ForbiddenException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('이미 가입된 사용자면 409로 막는다', async () => {
    const { service, usersService, dataSource } = makeService();
    usersService.findByFirebaseUid.mockResolvedValue({ id: 'user-1' });

    await expect(
      service.register(makeDto(), 'uid-1', 'a@b.com', true),
    ).rejects.toThrow(ConflictException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('동의 항목이 모자라면 트랜잭션을 열기 전에 막는다', async () => {
    const { service, dataSource } = makeService();
    // 요청 본문만 보면 알 수 있는 400이라, INSERT와 롤백을 쓰지 않고 먼저 걸러야 한다.
    const partial = [{ document: ConsentDocument.SERVICE, version: V }];

    await expect(
      service.register(
        makeDto({ consents: partial }),
        'uid-1',
        'a@b.com',
        true,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('만 14세 확인이 없으면 가입을 받지 않는다', async () => {
    const { service, dataSource } = makeService();

    await expect(
      service.register(
        makeDto({ ageConfirmed: false }),
        'uid-1',
        'a@b.com',
        true,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
