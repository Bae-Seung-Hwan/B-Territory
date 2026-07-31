import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { sendEmailVerification, type User } from 'firebase/auth';

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Firebase 내장 이메일 인증 메일 발송 + 재발송 쿨다운 카운트다운.
 *
 * Firebase가 레이트리밋의 유일한 판정자다(`auth/too-many-requests`). 여기 타이머는
 * 그 전에 버튼을 잠가 불필요한 요청과 알럿을 줄이기 위한 로컬 UX 장치일 뿐이다.
 */
export function useSendFirebaseVerificationEmail() {
  const [cooldown, setCooldown] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = useCallback(() => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const mutation = useMutation({
    mutationFn: (user: User) => sendEmailVerification(user),
    onSettled: (_data, error) => {
      if (!error) {
        startCooldown();
        return;
      }
      // 그 외(네트워크 오류 등)는 Firebase에 실제로 도달해 락이 잡혔는지 알 수 없으므로
      // 잠그지 않는다 — 사용자가 바로 다시 시도할 수 있어야 한다.
      const code = (error as { code?: string } | null)?.code;
      if (code === 'auth/too-many-requests') startCooldown();
    },
  });

  // 버튼의 disabled는 리렌더를 거쳐야 반영돼서, 연타하면 그 사이로 press가 몇 개
  // 빠져나가 동시 요청이 된다. 진행 중인 요청이 있으면 큐에 쌓지 않고 그냥 버린다.
  const inFlightRef = useRef(false);

  /** 실제로 요청을 보냈고 성공했으면 true. 연타로 무시된 호출은 false. */
  const sendVerificationEmail = async (user: User): Promise<boolean> => {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    try {
      await mutation.mutateAsync(user);
      return true;
    } finally {
      inFlightRef.current = false;
    }
  };

  return {
    sendVerificationEmail,
    isSending: mutation.isPending,
    hasSent: mutation.isSuccess,
    cooldown,
  };
}
