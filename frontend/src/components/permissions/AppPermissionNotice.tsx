import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { BrandColors, Spacing } from '@/constants/theme';
import {
  OPTIONAL_PERMISSIONS,
  REQUIRED_PERMISSIONS,
  type AppPermission,
} from '@/constants/app-permissions';
import {
  acknowledgePermissionNotice,
  usePermissionNoticeState,
} from '@/lib/permission-notice';

/**
 * 접근권한 사전 고지 화면(정보통신망법 제22조의2 / 방송미디어통신위원회 가이드).
 *
 * **OS 권한 대화상자보다 먼저** 떠야 하므로 앱 루트(`app/_layout.tsx`)에 두고, 확인 전에는
 * `use-location.ts`가 `requestForegroundPermissionsAsync`를 아예 부르지 않는다. 화면만으로
 * 막으면 이미 로그인된 채로 앱을 업데이트한 이용자가 문제가 된다 — 그 경우 이 고지와
 * `LocationBroadcaster`가 **같은 프레임에 함께 마운트**돼, 고지문 위로 OS 권한 팝업이
 * 겹쳐 뜬다. 고지를 읽기 전에 동의 여부를 묻는 셈이라 반려 사유가 그대로 남는다.
 *
 * 항목은 손으로 적지 않고 `APP_PERMISSIONS`를 순회해 그린다 — 권한을 추가하면서 이 화면을
 * 빠뜨리는 것이 이 반려의 원래 원인이기 때문이다.
 */
export function AppPermissionNotice() {
  const noticeState = usePermissionNoticeState();
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await acknowledgePermissionNotice();
    } finally {
      // 확인되면 이 컴포넌트는 곧 사라지지만, 저장 경로가 예외로 끝나 남아 있는 경우까지
      // 버튼이 로딩 상태로 굳지 않도록 되돌린다.
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={noticeState === 'pending'}
      animationType="fade"
      statusBarTranslucent
      // 뒤로가기로 닫으면 고지를 읽지 않고도 통과한다 — onRequestClose는 필수 prop이라
      // 지정은 하되 아무것도 하지 않는다.
      onRequestClose={() => {}}
    >
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{t('permissions.title')}</Text>
          <Text style={styles.subtitle}>{t('permissions.subtitle')}</Text>

          <Text style={styles.sectionTitle}>{t('permissions.requiredSection')}</Text>
          {REQUIRED_PERMISSIONS.map((permission) => (
            <PermissionRow key={permission.key} permission={permission} />
          ))}

          <Text style={styles.sectionTitle}>{t('permissions.optionalSection')}</Text>
          {OPTIONAL_PERMISSIONS.length === 0 ? (
            <Text style={styles.noneText}>{t('permissions.noOptional')}</Text>
          ) : (
            OPTIONAL_PERMISSIONS.map((permission) => (
              <PermissionRow key={permission.key} permission={permission} />
            ))
          )}

          {/* 가이드가 고지하도록 요구하는 두 가지: 거부 시 제약, 그리고 철회 방법. */}
          <Text style={styles.note}>{t('permissions.requiredNote')}</Text>
          <Text style={styles.note}>{t('permissions.withdraw')}</Text>
        </ScrollView>

        <View style={styles.footer}>
          <Button title={t('permissions.confirm')} onPress={handleConfirm} loading={saving} />
        </View>
      </View>
    </Modal>
  );
}

function PermissionRow({ permission }: { permission: AppPermission }) {
  const { t } = useTranslation();
  return (
    <View style={styles.item}>
      <Text style={styles.itemName}>{t(`permissions.items.${permission.key}.name`)}</Text>
      <Text style={styles.itemPurpose}>{t(`permissions.items.${permission.key}.purpose`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BrandColors.background },
  // 루트 오버레이라 SafeAreaProvider 밖에 있다(다른 오버레이도 같다) — 상단 여백을
  // 넉넉히 둬 상태바와 겹치지 않게 한다.
  content: { padding: Spacing.four, paddingTop: Spacing.six, gap: Spacing.two },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  subtitle: { color: '#888', fontSize: 14, lineHeight: 20, marginBottom: Spacing.three },
  sectionTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginTop: Spacing.three,
  },
  item: {
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  itemName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  itemPurpose: { color: '#aaa', fontSize: 13, lineHeight: 19 },
  noneText: { color: '#aaa', fontSize: 13, lineHeight: 19 },
  note: { color: '#888', fontSize: 12, lineHeight: 18, marginTop: Spacing.two },
  footer: {
    padding: Spacing.four,
    borderTopWidth: 1,
    borderTopColor: BrandColors.border,
  },
});
