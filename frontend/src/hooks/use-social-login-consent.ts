import { useRef } from 'react';

interface UseSocialLoginConsentOptions {
  /** 동의를 요청하는 시점의 부수효과 (체크박스 초기화 + 시트 열기 등). */
  onRequest: () => void;
}

/**
 * Google/Apple 로그인 버튼이 실제 인증을 시작하기 전에 약관 동의를 기다리게 하는
 * Promise/resolver 상태만 담당한다. 시트를 실제로 어떻게 그리고 언제 닫는지는
 * 호출부(login.tsx)의 책임이라 이 훅은 UI를 전혀 모른다 — 그래서 BottomSheet 없이도
 * 단위테스트할 수 있다.
 */
export function useSocialLoginConsent({ onRequest }: UseSocialLoginConsentOptions) {
  const resolveRef = useRef<((agreed: boolean) => void) | null>(null);
  // 대기 중인 Promise 자체도 들고 있는다 — Google/Apple 버튼을 연타하거나 번갈아 눌러
  // requestConsent가 응답 전에 다시 호출되면, resolveRef만 새로 만들 경우 이전 호출이
  // 받아간 Promise의 resolver가 유실돼 그 Promise는 영원히 대기 상태로 남는다(첫 탭이
  // 조용히 무시된 것처럼 보인다). 이미 대기 중이면 새로 만들지 않고 같은 Promise를
  // 돌려줘 두 호출 모두 같은 결과로 풀리게 한다.
  const pendingRef = useRef<Promise<boolean> | null>(null);

  const requestConsent = () => {
    if (pendingRef.current) return pendingRef.current;

    const promise = new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
    pendingRef.current = promise;
    onRequest();
    return promise;
  };

  // 대기 중인 요청이 없을 때 호출돼도(예: 이메일 가입 흐름의 시트 닫힘) 안전하게 무시된다.
  const resolveConsent = (agreed: boolean) => {
    resolveRef.current?.(agreed);
    resolveRef.current = null;
    pendingRef.current = null;
  };

  const isAwaitingConsent = () => resolveRef.current !== null;

  return { requestConsent, resolveConsent, isAwaitingConsent };
}
