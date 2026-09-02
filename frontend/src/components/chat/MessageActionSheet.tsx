import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Text, TextInput, View, StyleSheet } from 'react-native';
import { BottomSheetModal, BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { ReportReason } from '@/api/moderation';
import { useBlockMutation, useReportMutation, moderationErrorMessage } from '@/hooks/use-moderation';
import { useTranslation } from '@/i18n';
import { BrandColors } from '@/constants/theme';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useChatStore } from '@/store/useChatStore';

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
  // null = 사용자가 아직 사유를 고르지 않음. 특정 사유를 기본 선택해두면 안 건드리고
  // 제출해도 성공해버려, 실제로는 욕설/혐오를 신고하려던 유저가 스팸으로 잘못
  // 접수시킬 수 있다 — 명시적으로 고르기 전까진 제출 자체를 막는다.
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const blockMutation = useBlockMutation();
  const reportMutation = useReportMutation();
  const removeMessagesByUser = useChatStore((s) => s.removeMessagesByUser);

  // target이 바뀔 때(새 롱프레스) 폼 상태를 리셋한다 — effect가 아니라 렌더 중에 직접
  // setState하는, React가 안내하는 "prop이 바뀌면 state를 조정하는" 패턴이다. effect
  // 안에서 setState하면 커밋 후 리렌더가 한 번 더 생겨(react-hooks/set-state-in-effect
  // lint 규칙이 이를 막는다) 불필요한 프레임이 낀다.
  const [prevTarget, setPrevTarget] = useState(target);
  if (target !== prevTarget) {
    setPrevTarget(target);
    if (target) {
      setStep('actions');
      setReason(null);
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
            onSuccess: () => {
              // 이미 받아둔 이 사용자의 메시지도 피드에서 걷어낸다 — 차단 필터만으로는
              // 차단을 푸는 순간 되살아난다(useChatStore.removeMessagesByUser 주석).
              removeMessagesByUser(userId);
              sheetRef.current?.dismiss();
              // 차단은 화면에 즉시 드러나는 변화가 적어(상대 메시지가 사라지는 것뿐)
              // 확인 문구가 없으면 처리됐는지 알기 어렵다.
              Alert.alert(t('moderation.noticeTitle'), t('moderation.blockSuccess'));
            },
            onError: (err) => Alert.alert(t('auth.errors.title'), moderationErrorMessage(err, t)),
          });
        },
      },
    ]);
  };

  const handleSubmitReport = () => {
    if (!target || !reason) return;
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
          Alert.alert(t('moderation.noticeTitle'), t('moderation.reportSuccess'));
        },
        onError: (err) => Alert.alert(t('auth.errors.title'), moderationErrorMessage(err, t)),
      },
    );
  };

  // step에만 의존하는데도 인라인 배열은 렌더마다 새로 만들어져, @gorhom/bottom-sheet가
  // prop 참조 변화로 보고 폼 입력(detail 타이핑) 같은 무관한 리렌더마다 스냅 포인트를
  // 다시 계산했다(PR #50 2차 리뷰 지적).
  const snapPoints = useMemo(() => [step === 'actions' ? '32%' : '65%'], [step]);

  return (
    <BottomSheet
      ref={sheetRef}
      snapPoints={snapPoints}
      onDismiss={onDismiss}
      // 신고 스텝은 사유 카드 5개 + 내용 미리보기 + 상세 입력창 + 제출 버튼이 한
      // 화면에 들어가는데, 작은 기기거나 상세 입력창에 포커스해 키보드가 뜨면 65%
      // 높이를 넘길 수 있다. scrollable 없이는 넘친 만큼이 그냥 안 보이고 손이
      // 안 닿는다 — BottomSheetScrollView로 감싸 넘치면 스크롤되게 한다.
      scrollable
    >
      <BottomSheetScrollView contentContainerStyle={styles.scrollContent}>
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
              disabled={!reason}
              loading={reportMutation.isPending}
              style={styles.actionButton}
            />
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // scrollable 모드는 BottomSheet의 기본 padding(BottomSheetView 쪽)을 안 거치므로
  // 여기서 직접 채운다.
  scrollContent: { padding: 16, paddingBottom: 32 },
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
