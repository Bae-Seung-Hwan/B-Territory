const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import { getMe, registerUser } from '@/api/auth';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_KEYS } from '@/legal';

describe('getMe', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('정상 응답이면 프로필을 반환한다', async () => {
    const profile = { id: '1', email: 'a@b.com', nickname: 'n', nationality: 'KR', team: 'KR' };
    mockGet.mockResolvedValue({ data: profile });

    await expect(getMe()).resolves.toEqual(profile);
    expect(mockGet).toHaveBeenCalledWith('/api/auth/me');
  });

  it('404면 null을 반환한다 (미가입)', async () => {
    mockGet.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });

    await expect(getMe()).resolves.toBeNull();
  });

  it('404가 아닌 에러는 그대로 던진다', async () => {
    const err = { isAxiosError: true, response: { status: 500 } };
    mockGet.mockRejectedValue(err);

    await expect(getMe()).rejects.toBe(err);
  });
});

describe('registerUser', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  // 서버는 필수 동의 항목을 스스로 정하고(CLIENT_CONSENT_DOCUMENTS) 하나라도 빠지면
  // CONSENT_INCOMPLETE로 400을 준다. 그 400은 use-registration-flow.ts의 롤백 판정에
  // 걸려 Firebase 계정 삭제까지 가므로, 이 함수가 동의를 흘리지 않는지 본다.
  const payload = {
    nickname: 'n',
    nationality: 'KR',
    consents: LEGAL_DOCUMENT_KEYS.map((key) => ({
      document: key,
      version: LEGAL_DOCUMENTS[key].version,
    })),
    ageConfirmed: true,
  };

  it('닉네임/국적/동의를 그대로 POST하고 프로필을 반환한다', async () => {
    const profile = { id: '1', email: 'a@b.com', nickname: 'n', nationality: 'KR', team: 'KR' };
    mockPost.mockResolvedValue({ data: profile });

    await expect(registerUser(payload)).resolves.toEqual(profile);
    expect(mockPost).toHaveBeenCalledWith('/api/auth/register', payload);
  });

  /**
   * `document`는 append-only 원장의 varchar라 백엔드 `ConsentDocument`와 어긋난 채로
   * 쌓이면 되돌릴 수 없다. 프론트가 보내는 값이 문서 키 그대로인지 여기서 못 박는다 —
   * 두 저장소를 잇는 자동 검증이 없어(백엔드 consents/constants.ts 주석 참고) 값이
   * 갈라지는 것을 CI가 잡지 못한다.
   */
  it('document는 문서 키를 그대로 쓴다 (백엔드 ConsentDocument와 같은 문자열)', () => {
    expect(payload.consents.map((item) => item.document)).toEqual([
      'service',
      'privacy',
      'location',
    ]);
  });
});
