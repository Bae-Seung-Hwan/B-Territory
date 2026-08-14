import { useMemo, useRef, useState } from 'react';
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
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import { useChatSocket } from '@/hooks/use-chat-socket';
import { useChatStore, type ChatFeedItem } from '@/store/useChatStore';
import { useLocation } from '@/hooks/use-location';
import { fetchBusanSpots, type Spot } from '@/api/spots';
import { queryKeys } from '@/lib/query-keys';
import { nearestByCoords } from '@/utils/geo';
import { CHAT_ENABLED } from '@/config/feature-flags';
import { SPOT_PROXIMITY_M } from '@/constants/game';

function spotCoords(spot: Spot) {
  return { lat: Number(spot.mapY), lng: Number(spot.mapX) };
}

export default function ChatScreen() {
  const { t } = useTranslation();
  const messages = useChatStore((s) => s.messages);
  const { sendMessage, shareLocation } = useChatSocket();
  const { coords } = useLocation();
  const [text, setText] = useState('');
  const listRef = useRef<FlatList<ChatFeedItem>>(null);

  // 채팅 위치 공유(team:location)엔 spotId가 없어(PR #34 스키마), 좌표로 직접
  // 최근접 관광지를 계산한다 — 지도 화면에서 이미 같은 목적으로 조회하는 데이터라
  // React Query 캐시를 그대로 재사용한다.
  const { data: spots = [] } = useQuery({
    queryKey: queryKeys.spots.busan,
    queryFn: fetchBusanSpots,
  });

  // 위치 항목별 관광지명을 한 번만 계산해 renderItem에서는 조회만 한다 — renderItem에서
  // 직접 계산하면 메시지가 하나 올 때마다 보이는 항목 × 관광지 500개를 다시 훑는다.
  const spotTitleByCoords = useMemo(() => {
    const cache = new Map<string, string | null>();
    for (const item of messages) {
      if (item.kind !== 'location') continue;
      const key = `${item.lat},${item.lng}`;
      if (cache.has(key)) continue;
      cache.set(
        key,
        nearestByCoords({ lat: item.lat, lng: item.lng }, spots, spotCoords, SPOT_PROXIMITY_M)
          ?.title ?? null,
      );
    }
    return cache;
  }, [messages, spots]);

  const handleSend = () => {
    if (!text.trim()) return;
    sendMessage(text);
    setText('');
  };

  const handleShareLocation = () => {
    if (!coords) return;
    shareLocation(coords.latitude, coords.longitude);
  };

  const renderItem = ({ item }: { item: ChatFeedItem }) => {
    if (item.kind === 'location') {
      const nickname = item.mine ? t('chat.you') : item.nickname;
      const spotTitle = spotTitleByCoords.get(`${item.lat},${item.lng}`) ?? null;
      return (
        <View style={[styles.bubble, styles.locationBubble, item.mine && styles.mineBubble]}>
          <Text style={styles.locationText}>
            {/* 근처(SPOT_PROXIMITY_M 이내)에 관광지가 없으면 엉뚱한 곳을 붙이지 않는다 */}
            {spotTitle
              ? t('chat.locationShared', { nickname, spot: spotTitle })
              : t('chat.locationSharedUnknown', { nickname })}
          </Text>
        </View>
      );
    }
    return (
      <View style={[styles.bubble, item.mine ? styles.mineBubble : styles.theirBubble]}>
        {!item.mine && <Text style={styles.nickname}>{item.nickname}</Text>}
        <Text style={styles.messageText}>{item.text}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {!CHAT_ENABLED && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t('chat.disabledBanner')}</Text>
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
          <TouchableOpacity style={styles.shareBtn} onPress={handleShareLocation} disabled={!coords}>
            <Text style={styles.shareBtnText}>{t('chat.shareLocation')}</Text>
          </TouchableOpacity>
        </View>
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
  locationBubble: { backgroundColor: BrandColors.surface, alignSelf: 'center' },
  nickname: { color: '#999', fontSize: 11, marginBottom: 2 },
  messageText: { color: '#fff', fontSize: 15 },
  locationText: { color: '#ccc', fontSize: 12, fontStyle: 'italic' },
  inputRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
    alignItems: 'center',
  },
  shareBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BrandColors.border,
  },
  shareBtnText: { color: BrandColors.accent, fontSize: 13, fontWeight: '600' },
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
