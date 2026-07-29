import { useEffect, useRef } from 'react';
import { loadRegisterDraft, saveRegisterDraft, type RegisterDraft } from '@/lib/register-draft';

const SAVE_DEBOUNCE_MS = 400;

interface Options extends RegisterDraft {
  onRestore: (draft: RegisterDraft) => void;
}

/**
 * 회원가입 입력값을 기기에 임시 보관한다.
 *
 * 이메일 인증은 앱 밖(메일함·브라우저)을 거치므로 그 사이 앱이 종료되기 쉽다.
 * 서버의 인증 마커는 30분간 남아 가입 자체는 이어서 할 수 있는데, 폼이 전부
 * 비어버리면 사용자는 "처음부터 다시"로 받아들인다. 그 간극만 메운다.
 */
export function useRegisterDraft({ email, nickname, nationality, onRestore }: Options) {
  // 불러오기 전에 저장 이펙트가 돌면 초기 빈 값이 저장된 초안을 덮어쓴다.
  const hydratedRef = useRef(false);
  const onRestoreRef = useRef(onRestore);

  // 복원은 마운트 시 한 번뿐이라 콜백을 의존성에 넣지 않는다. 대신 최신 참조만
  // 유지한다(렌더 중 ref에 쓰면 안 되므로 이펙트에서 갱신하고, 선언 순서상
  // 아래 로드 이펙트보다 먼저 실행된다).
  useEffect(() => {
    onRestoreRef.current = onRestore;
  });

  useEffect(() => {
    let cancelled = false;
    void loadRegisterDraft()
      .then((draft) => {
        if (cancelled) return;
        if (draft) onRestoreRef.current(draft);
      })
      .catch(() => {
        // 초안 복원 실패는 빈 폼으로 시작하면 그만이라 사용자에게 알리지 않는다.
      })
      .finally(() => {
        if (!cancelled) hydratedRef.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const timer = setTimeout(() => {
      void saveRegisterDraft({ email, nickname, nationality }).catch(() => {
        // 저장 실패는 재입력 불편일 뿐이라 흐름을 막지 않는다.
      });
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [email, nickname, nationality]);
}
