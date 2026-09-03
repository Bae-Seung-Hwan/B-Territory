import { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import { useChatSocket, type ChatSocketError } from '@/hooks/use-chat-socket';
import { useChatStore, type ChatFeedItem } from '@/store/useChatStore';
import {
  MessageActionSheet,
  type MessageActionTarget,
} from '@/components/chat/MessageActionSheet';
import { useBlockedUsers } from '@/hooks/use-moderation';

// 이 거리(px) 안에 있으면 "바닥 근처"로 보고 새 메시지 도착 시 자동 스크롤한다.
// 그 밖(지난 대화를 올려서 읽는 중)이면 화면을 억지로 바닥까지 끌어내리지 않는다.
const NEAR_BOTTOM_THRESHOLD_PX = 80;

function chatErrorKey(error: ChatSocketError): string {
  switch (error) {
    case 'connection':
      return 'chat.errors.connection';
    case 'rateLimit':
      return 'chat.errors.rateLimit';
    default:
      return 'chat.errors.unknown';
  }
}

export default function ChatScreen() {
  const { t } = useTranslation();
  const messages = useChatStore((s) => s.messages);
  const { sendMessage, retryMessage, chatError } = useChatSocket();
  const [text, setText] = useState('');
  const listRef = useRef<FlatList<ChatFeedItem>>(null);
  // onScroll로 갱신되는, 리렌더를 유발할 필요 없는 스크롤 위치 힌트(PR #50 리뷰 지적 2번).
  const isNearBottomRef = useRef(true);
  // 롱프레스로 연 신고/차단 대상. null이면 시트가 닫혀 있다(MessageActionSheet 참고).
  const [actionTarget, setActionTarget] = useState<MessageActionTarget | null>(null);

  // 차단한 사용자의 메시지는 화면에서도 거른다. 서버(ChatGateway의 blockerRooms)가
  // 릴레이 단계에서 이미 막지만 그건 **앞으로 올** 메시지 얘기고, 차단하기 전에 이미
  // 받아 스토어에 쌓인 메시지는 그대로 남는다 — 괴롭힘 때문에 차단했는데 정작 그
  // 메시지가 계속 보이면 차단이 반쪽이 된다. 백엔드 GET /api/blocks 문서가 요구하는
  // "서버 릴레이 필터의 이중 방어"가 이것이다.
  const { data: blockedUsers } = useBlockedUsers();
  const blockedIds = useMemo(
    () => new Set((blockedUsers ?? []).map((u) => u.userId)),
    [blockedUsers],
  );
  const visibleMessages = useMemo(
    () => messages.filter((m) => m.mine || !blockedIds.has(m.userId)),
    [messages, blockedIds],
  );

  const handleSend = () => {
    // 빈 문자열·500자 초과·profile 미준비 검증은 sendMessage 안에 이미 있다 — 여기서
    // 다시 text.trim()을 확인하지 않는다(PR #50 2차 리뷰 지적, 검증 중복 방지). 실패하면
    // 조용히 반환되므로, 그 값으로만 입력을 지울지 판단한다 — 그러지 않으면 사용자가
    // 쓴 내용이 흔적 없이 사라진다(PR #50 1차 리뷰 지적 1번).
    if (!sendMessage(text)) return;
    setText('');
    // 내가 보낸 메시지는 지난 대화를 올려보던 중이었어도 바로 확인할 수 있어야 한다.
    isNearBottomRef.current = true;
    listRef.current?.scrollToEnd({ animated: true });
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    isNearBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
  };

  const renderItem = ({ item }: { item: ChatFeedItem }) => (
    <View style={item.mine ? styles.mineRow : styles.theirRow}>
      <TouchableOpacity
        activeOpacity={item.mine ? 1 : 0.7}
        // 내 메시지는 신고·차단 대상이 될 수 없다 — 롱프레스도 걸지 않는다.
        onLongPress={
          item.mine
            ? undefined
            : () =>
                setActionTarget({ userId: item.userId, nickname: item.nickname, text: item.text })
        }
        style={[
          styles.bubble,
          item.mine ? styles.mineBubble : styles.theirBubble,
          // ack 대기 중임을 시각적으로 구분한다 — useChatStore 주석은 'sending'을
          // "ack 대기 중"이라는 별도 표시 상태로 설명하는데, 실제로는 전송 완료와
          // 구별되지 않았다(PR #50 2차 리뷰 지적).
          item.status === 'sending' && styles.sendingBubble,
        ]}
      >
        {!item.mine && <Text style={styles.nickname}>{item.nickname}</Text>}
        <Text style={styles.messageText}>{item.text}</Text>
      </TouchableOpacity>
      {item.status === 'sending' && (
        <Text style={styles.sendingText}>{t('chat.sending')}</Text>
      )}
      {item.status === 'failed' && (
        <TouchableOpacity onPress={() => retryMessage(item)} hitSlop={6}>
          <Text style={styles.failedText}>
            {t('chat.messageFailed')} · {t('chat.retry')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {chatError && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t(chatErrorKey(chatError))}</Text>
        </View>
      )}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={listRef}
          data={visibleMessages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyState}>{t('chat.emptyState')}</Text>}
          // 위로 올려 지난 대화를 읽는 중에 팀원 메시지가 오면 화면을 바닥으로 끌어내리지
          // 않는다 — 이미 바닥 근처였을 때만 자동으로 따라간다(PR #50 리뷰 지적 2번).
          onContentSizeChange={() => {
            if (isNearBottomRef.current) listRef.current?.scrollToEnd({ animated: true });
          }}
          onScroll={handleScroll}
          scrollEventThrottle={100}
        />
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={t('chat.inputPlaceholder')}
            placeholderTextColor="#666"
            onSubmitEditing={handleSend}
            // 백엔드 ChatMessageDto의 @Length(1, 500)과 맞춘다 — 없으면 500자를 넘긴
            // 메시지가 낙관적으로는 "보낸 메시지"로 표시되고 실제로는 서버 검증에서
            // 거부돼 조용히 유실된다(use-chat-socket.ts의 sendMessage 가드도 참고).
            maxLength={500}
          />
          <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
            <Text style={styles.sendBtnText}>{t('chat.send')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      <MessageActionSheet target={actionTarget} onDismiss={() => setActionTarget(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BrandColors.background },
  flex: { flex: 1 },
  banner: {
    backgroundColor: BrandColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.border,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  bannerText: { color: '#888', fontSize: 12, textAlign: 'center' },
  list: { padding: 16, gap: 8, flexGrow: 1 },
  emptyState: { color: '#555', fontSize: 14, textAlign: 'center', marginTop: 40 },
  mineRow: { alignItems: 'flex-end', marginBottom: 4 },
  theirRow: { alignItems: 'flex-start', marginBottom: 4 },
  bubble: { maxWidth: '80%', padding: 10, borderRadius: 12 },
  theirBubble: { backgroundColor: BrandColors.surface, alignSelf: 'flex-start' },
  mineBubble: { backgroundColor: BrandColors.accent, alignSelf: 'flex-end' },
  sendingBubble: { opacity: 0.6 },
  sendingText: { color: '#888', fontSize: 11, marginTop: 2 },
  failedText: { color: BrandColors.danger, fontSize: 11, marginTop: 2 },
  nickname: { color: '#999', fontSize: 11, marginBottom: 2 },
  messageText: { color: '#fff', fontSize: 15 },
  inputRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: BrandColors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    borderWidth: 1,
    borderColor: BrandColors.border,
  },
  sendBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: BrandColors.accent,
  },
  sendBtnText: { color: '#fff', fontWeight: '700' },
});
