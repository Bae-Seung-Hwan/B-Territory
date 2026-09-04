import { useChatStore, type ChatFeedItem } from '@/store/useChatStore';

const message = (over: Partial<ChatFeedItem> = {}): ChatFeedItem => ({
  id: 'm1',
  userId: 'u1',
  nickname: 'nick',
  team: 'KR',
  text: 'hello',
  at: new Date().toISOString(),
  mine: false,
  ...over,
});

describe('useChatStore.removeMessagesByUser', () => {
  beforeEach(() => useChatStore.getState().clear());

  it('차단한 사용자가 보낸 메시지만 걷어내고 나머지는 남긴다', () => {
    const { addMessage, removeMessagesByUser } = useChatStore.getState();
    addMessage(message({ id: 'a', userId: 'blocked', text: '괴롭힘' }));
    addMessage(message({ id: 'b', userId: 'other', text: '정상 메시지' }));
    addMessage(message({ id: 'c', userId: 'blocked', text: '괴롭힘2' }));

    removeMessagesByUser('blocked');

    const remaining = useChatStore.getState().messages;
    expect(remaining.map((m) => m.id)).toEqual(['b']);
  });

  it('내가 보낸 메시지는 userId가 같아도 지우지 않는다', () => {
    const { addMessage, removeMessagesByUser } = useChatStore.getState();
    addMessage(message({ id: 'mine', userId: 'me', mine: true }));
    addMessage(message({ id: 'theirs', userId: 'me', mine: false }));

    removeMessagesByUser('me');

    expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(['mine']);
  });

  it('해당 사용자의 메시지가 없으면 아무것도 바뀌지 않는다', () => {
    const { addMessage, removeMessagesByUser } = useChatStore.getState();
    addMessage(message({ id: 'a', userId: 'other' }));

    removeMessagesByUser('nobody');

    expect(useChatStore.getState().messages).toHaveLength(1);
  });
});
