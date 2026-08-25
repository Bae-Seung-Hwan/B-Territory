import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Text, TextInput, View, StyleSheet } from 'react-native';
import { BottomSheetModal, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { ReportReason } from '@/api/moderation';
import { useBlockMutation, useReportMutation, moderationErrorMessage } from '@/hooks/use-moderation';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

// BottomSheetTextInput의 blur 처리가 web에서 크래시 난다(register.tsx의 CountrySearchInput과
// 동일한 이유) — native에서만 바텀시트 전용 입력을 쓴다.
const DetailInput = Platform.OS === 'web' ? TextInput : BottomSheetTextInput;

const REASONS = Object.values(ReportReason);

export interface MessageActionTarget {
  userId: string;
  nickname: string;
  /** 신고 대상 메시지 원문 — 채팅은 서버에 저장되지 않아 이게 유일한 증거다. */
  text: string;
}

interface MessageActionSheetProps {
  target: MessageActionTarget | null;
  onDismiss: () => void;
}

type Step = 'actions' | 'report';

/**
 * 채팅 메시지 롱프레스로 여는 신고/차단 진입점. `target`이 채워지면 열리고, 시트가
 * 닫히면(스와이프·백드롭 탭 포함) onDismiss로 부모에게 알려 target을 비운다 — 그래야
 * 다음 롱프레스가 새 target으로 다시 열 수 있다.
 */
export function MessageActionSheet({ target, onDismiss }: MessageActionSheetProps) {
  const { t } = useTranslation();
  const sheetRef = useRef<BottomSheetModal>(null);
  const [step, setStep] = useState<Step>('actions');
  const [reason, setReason] = useState<ReportReason>(ReportReason.SPAM);
  const [detail, setDetail] = useState('');
  const blockMutation = useBlockMutation();
  const reportMutation = useReportMutation();

  // target이 바뀔 때(새 롱프레스) 폼 상태를 리셋한다 — effect가 아니라 렌더 중에 직접
  // setState하는, React가 안내하는 "prop이 바뀌면 state를 조정하는" 패턴이다. effect
  // 안에서 setState하면 커밋 후 리렌더가 한 번 더 생겨(react-hooks/set-state-in-effect
  // lint 규칙이 이를 막는다) 불필요한 프레임이 낀다.
  const [prevTarget, setPrevTarget] = useState(target);
  if (target !== prevTarget) {
    setPrevTarget(target);
    if (target) {
      setStep('actions');
      setReason(ReportReason.SPAM);
      setDetail('');
    }
  }

  // 여기는 반대로 진짜 외부 시스템(bottom sheet 라이브러리의 명령형 API)과 동기화하는
  // 것이라 effect가 맞다 — state를 만들지 않고 present()/dismiss()만 호출한다.
  useEffect(() => {
    if (target) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [target]);

  const handleBlock = () => {
    if (!target) return;
    const { userId, nickname } = target;
    Alert.alert(t('moderation.blockConfirmTitle'), t('moderation.blockConfirmMessage', { nickname }), [
      { text: t('moderation.cancel'), style: 'cancel' },
      {
        text: t('moderation.block'),
        style: 'destructive',
        onPress: () => {
          blockMutation.mutate(userId, {
            onSuccess: () => sheetRef.current?.dismiss(),
            onError: (err) => Alert.alert(t('auth.errors.title'), moderationErrorMessage(err, t)),
          });
        },
      },
    ]);
  };

  const handleSubmitReport = () => {
    if (!target) return;
    reportMutation.mutate(
      {
        targetUserId: target.userId,
        reason,
        contentSnapshot: target.text,
        detail: detail.trim() ? detail.trim() : undefined,
      },
      {
        onSuccess: () => {
          sheetRef.current?.dismiss();
          Alert.alert(t('auth.errors.title'), t('moderation.reportSuccess'));
        },
        onError: (err) => Alert.alert(t('auth.errors.title'), moderationErrorMessage(err, t)),
      },
    );
  };

  return (
    <BottomSheet
      ref={sheetRef}
      snapPoints={[step === 'actions' ? '32%' : '65%']}
      onDismiss={onDismiss}
    >
      {step === 'actions' && target && (
        <View style={styles.actions}>
          <Text style={styles.actionsTitle}>{t('moderation.actionsSheetTitle')}</Text>
          <Text style={styles.targetNickname}>{target.nickname}</Text>
          <Button title={t('moderation.report')} onPress={() => setStep('report')} style={styles.actionButton} />
          <Button
            title={t('moderation.block')}
            onPress={handleBlock}
            variant="danger"
            loading={blockMutation.isPending}
            style={styles.actionButton}
          />
        </View>
      )}

      {step === 'report' && target && (
        <View style={styles.report}>
          <Text style={styles.reportTitle}>{t('moderation.reportTitle')}</Text>
          <View style={styles.reasonList}>
            {REASONS.map((r) => (
              <Card
                key={r}
                onPress={() => setReason(r)}
                selected={reason === r}
                style={styles.reasonCard}
              >
                <Text style={styles.reasonText}>{t(`moderation.reportReason.${r}`)}</Text>
              </Card>
            ))}
          </View>

          <Text style={styles.contentLabel}>{t('moderation.reportContentLabel')}</Text>
          <Text style={styles.contentSnapshot} numberOfLines={4}>
            {target.text}
          </Text>

          <DetailInput
            style={styles.detailInput}
            placeholder={t('moderation.detailPlaceholder')}
            placeholderTextColor="#666"
            value={detail}
            onChangeText={setDetail}
            maxLength={500}
            multiline
          />

          <Button
            title={t('moderation.submitReport')}
            onPress={handleSubmitReport}
            loading={reportMutation.isPending}
            style={styles.actionButton}
          />
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10 },
  actionsTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  targetNickname: { color: '#999', fontSize: 13, marginBottom: 6 },
  actionButton: { marginTop: 4 },
  report: { gap: 10 },
  reportTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  reasonList: { gap: 8 },
  reasonCard: { paddingVertical: 12 },
  reasonText: { color: '#fff', fontSize: 14 },
  contentLabel: { color: '#888', fontSize: 12, marginTop: 6 },
  contentSnapshot: {
    color: '#ccc',
    fontSize: 13,
    backgroundColor: BrandColors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: 10,
  },
  detailInput: {
    minHeight: 60,
    backgroundColor: BrandColors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BrandColors.border,
    color: '#fff',
    padding: 10,
    fontSize: 14,
    textAlignVertical: 'top',
  },
});
