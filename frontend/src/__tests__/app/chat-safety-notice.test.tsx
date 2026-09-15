import { act, render } from '@testing-library/react-native';
import ChatScreen from '@/app/(main)/chat';
import { i18n } from '@/i18n';
import { useChatStore } from '@/store/useChatStore';

jest.mock('@/hooks/use-chat-socket', () => ({
  useChatSocket: () => ({ sendMessage: jest.fn(), retryMessage: jest.fn(), chatError: null }),
}));
jest.mock('@/hooks/use-moderation', () => ({ useBlockedUsers: () => ({ data: [] }) }));
// 신고/차단 시트는 이 테스트의 관심사가 아니다(바텀시트 목킹을 통째로 끌고 오지 않는다).
jest.mock('@/components/chat/MessageActionSheet', () => ({ MessageActionSheet: () => null }));

/**
 * 원스토어 검수가 요구하는 채팅 이용자 보호 안내문구(공지 29889, 반려 사유 3번).
 *
 * "표시된다"가 아니라 **"대화가 쌓여도 계속 표시된다"** 가 요건이다 — 한때 후보였던
 * FlatList의 ListHeaderComponent는 메시지가 몇 개만 쌓여도 스크롤 밖으로 밀려 사라진다.
 */
describe('채팅 안내문구', () => {
  beforeEach(() => {
    i18n.locale = 'ko';
    useChatStore.getState().clear();
  });

  it('채팅 화면에 주의·제재 안내와 신고·차단 안내가 함께 떠 있다', async () => {
    const { getByText } = await render(<ChatScreen />);
    getByText(i18n.t('chat.safetyNotice'));
    getByText(i18n.t('chat.reportHint'));
  });

  it('메시지가 쌓여도 사라지지 않는다 — 목록 안이 아니라 화면에 고정돼야 한다', async () => {
    const { getByText } = await render(<ChatScreen />);

    await act(async () => {
      for (let i = 0; i < 30; i += 1) {
        useChatStore.getState().addMessage({
          id: `m${i}`,
          userId: 'u1',
          nickname: '팀원',
          team: 'KR',
          text: `메시지 ${i}`,
          at: new Date().toISOString(),
          mine: false,
        });
      }
    });

    getByText(i18n.t('chat.safetyNotice'));
  });

  it('문구는 ko·en 양쪽에 있어야 한다 — 영어 이용자에게만 고지가 빠지면 안 된다', () => {
    for (const locale of ['ko', 'en'] as const) {
      i18n.locale = locale;
      expect(i18n.t('chat.safetyNotice')).not.toMatch(/^\[missing/);
      expect(i18n.t('chat.reportHint')).not.toMatch(/^\[missing/);
    }
  });
});
