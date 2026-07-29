import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
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
    onSuccess: startCooldown,
  });

  return {
    sendLink: mutation.mutateAsync,
    isSending: mutation.isPending,
    hasSent: mutation.isSuccess,
    cooldown,
  };
}

/** 매직 링크 토큰 검증. 토큰이 1회용이라 자동 재시도를 켜지 않는다. */
export function useVerifyEmailToken() {
  return useMutation({ mutationFn: verifyEmailToken });
}
