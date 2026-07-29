import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { sendVerificationLink, verifyEmailToken } from '@/api/email';

/** 백엔드 EmailService.RESEND_COOLDOWN_SECONDS와 맞춘 값. 넘기면 429가 온다. */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * 인증 메일 발송 + 재발송 쿨다운 카운트다운.
 *
 * 서버가 쿨다운의 최종 판정자이고(429), 여기 타이머는 그 전에 버튼을 잠가
 * 불필요한 요청과 429 알럿을 줄이기 위한 것이다.
 */
export function useSendVerificationLink() {
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
    mutationFn: sendVerificationLink,
    onSettled: (_data, error) => {
      // 백엔드는 발송을 "시도하기 전에" 60초 락을 먼저 잡는다. 그래서 성공뿐 아니라
      // 5xx(락을 잡고 메일 발송에서 실패)와 429(다른 요청이 락 보유)에서도 그 시간 동안
      // 재요청은 무조건 429다. 성공에만 쿨다운을 걸면 실패 직후 버튼이 되살아나
      // 헛된 요청과 알럿만 쌓인다.
      // 400(이메일 형식 오류)은 락을 잡기 전에 거부되고, 네트워크 오류는 서버 도달
      // 여부를 알 수 없으므로 둘 다 잠그지 않는다.
      if (!error) {
        startCooldown();
        return;
      }
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (status === 429 || (status !== undefined && status >= 500)) startCooldown();
    },
  });

  // 버튼의 disabled는 리렌더를 거쳐야 반영돼서, 연타하면 그 사이로 press가 몇 개
  // 빠져나가 동시 요청이 된다. 진행 중인 요청이 있으면 큐에 쌓지 않고 그냥 버린다.
  const inFlightRef = useRef(false);

  /** 실제로 요청을 보냈고 성공했으면 true. 연타로 무시된 호출은 false. */
  const sendLink = async (email: string): Promise<boolean> => {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    try {
      await mutation.mutateAsync(email);
      return true;
    } finally {
      inFlightRef.current = false;
    }
  };

  return {
    sendLink,
    isSending: mutation.isPending,
    hasSent: mutation.isSuccess,
    cooldown,
  };
}

/** 매직 링크 토큰 검증. 토큰이 1회용이라 자동 재시도를 켜지 않는다. */
export function useVerifyEmailToken() {
  return useMutation({ mutationFn: verifyEmailToken });
}
