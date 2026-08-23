import { useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
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
import { CHAT_ENABLED } from '@/config/feature-flags';

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
  const { sendMessage, chatError } = useChatSocket();
  const [text, setText] = useState('');
  const listRef = useRef<FlatList<ChatFeedItem>>(null);

  const handleSend = () => {
    if (!text.trim()) return;
    sendMessage(text);
    setText('');
  };

  const renderItem = ({ item }: { item: ChatFeedItem }) => (
    <View style={[styles.bubble, item.mine ? styles.mineBubble : styles.theirBubble]}>
      {!item.mine && <Text style={styles.nickname}>{item.nickname}</Text>}
      <Text style={styles.messageText}>{item.text}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {!CHAT_ENABLED && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t('chat.disabledBanner')}</Text>
        </View>
      )}
      {CHAT_ENABLED && chatError && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t(chatErrorKey(chatError))}</Text>
        </View>
      )}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyState}>{t('chat.emptyState')}</Text>}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        />
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={t('chat.inputPlaceholder')}
            placeholderTextColor="#666"
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
            <Text style={styles.sendBtnText}>{t('chat.send')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
  bubble: { maxWidth: '80%', padding: 10, borderRadius: 12, marginBottom: 4 },
  theirBubble: { backgroundColor: BrandColors.surface, alignSelf: 'flex-start' },
  mineBubble: { backgroundColor: BrandColors.accent, alignSelf: 'flex-end' },
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
