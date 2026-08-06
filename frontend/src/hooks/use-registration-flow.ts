import { useCallback, useState } from 'react';
import { isAxiosError } from 'axios';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { clearRegisterDraft } from '@/lib/register-draft';
import { useRegisterMutation } from '@/hooks/use-auth';
import { useSendFirebaseVerificationEmail } from '@/hooks/use-firebase-email-verification';

export type RegistrationStep = 'form' | 'awaitingVerification';
export type ConfirmVerificationResult = 'no-session' | 'not-verified' | 'registered';
export type SubmitResult = 'awaitingVerification' | 'verificationSendFailed';

interface UseRegistrationFlowOptions {
  /** 백엔드 register()가 성공한 뒤 호출된다(라우팅은 호출자 책임 — 훅을 라우터에 결합하지 않기 위함). */
  onRegistered: () => void;
}

/**
 * 회원가입 상태기계: 계정생성/로그인 → (미인증이면) 인증메일 발송 → 대기 →
 * 인증 확인 → 백엔드 register. Firebase/백엔드 호출 순서와 롤백 판단을 전담하고,
 * register.tsx는 이 훅의 반환값으로 렌더링만 한다.
 */
export function useRegistrationFlow({ onRegistered }: UseRegistrationFlowOptions) {
  // 콜드스타트(앱 재시작) 복귀 감지: AuthProvider가 세션 확인 전까지 이 화면 자체를
  // 마운트하지 않으므로(frontend/src/providers/AuthProvider.tsx), 첫 렌더 시점에
  // auth.currentUser는 이미 확정값이다 — useEffect가 아니라 lazy initializer로
  // 판단해야 'form'으로 한 프레임 깜빡였다가 넘어가는 일이 없다.
  const [step, setStep] = useState<RegistrationStep>(() =>
    auth.currentUser ? 'awaitingVerification' : 'form',
  );
  // 이번 컴포넌트 인스턴스가 createUserWithEmailAndPassword를 직접 성공시켰는가.
  // 이어서-가입(signIn)이나 콜드스타트로 복귀한 세션은 전부 false로 수렴시켜
  // 롤백(user.delete()) 대상에서 제외한다.
  const [createdAccount, setCreatedAccount] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingVerification, setIsCheckingVerification] = useState(false);
  const [isChangingEmail, setIsChangingEmail] = useState(false);

  const registerMutation = useRegisterMutation();
  const {
    sendVerificationEmail,
    isSending: isSendingVerification,
    hasSent: hasSentVerification,
    cooldown: verificationCooldown,
  } = useSendFirebaseVerificationEmail();

  const finishRegistration = useCallback(
    async (user: User, createdThisAttempt: boolean, nickname: string, nationality: string) => {
      try {
        await registerMutation.mutateAsync({ nickname, nationality });
        void clearRegisterDraft();
        onRegistered();
      } catch (backendErr) {
        // 백엔드가 4xx로 명확히 거부한 경우(409 제외)에만 서버에 아무 부작용도
        // 없었다고 확신할 수 있어 Firebase 계정을 롤백한다. 네트워크/타임아웃/5xx는
        // 백엔드에 유저 row가 실제로 생겼을 수 있으므로 롤백하지 않는다.
        const shouldRollback =
          createdThisAttempt &&
          isAxiosError(backendErr) &&
          backendErr.response &&
          backendErr.response.status >= 400 &&
          backendErr.response.status < 500 &&
          backendErr.response.status !== 409;

        if (shouldRollback) {
          try {
            await user.delete();
          } catch (deleteErr) {
            console.warn('Failed to rollback Firebase user after registration failure', deleteErr);
          }
        }
        throw backendErr;
      }
    },
    [registerMutation, onRegistered],
  );

  const submit = useCallback(
    async (
      email: string,
      password: string,
      nickname: string,
      nationality: string,
    ): Promise<SubmitResult | undefined> => {
      setIsSubmitting(true);
      try {
        // Firebase 계정은 있는데 백엔드 프로필이 없는 사용자(이전 가입 시도가 중단됐거나,
        // 이미 인증까지 마친 유령 계정)는 createUserWithEmailAndPassword가
        // auth/email-already-in-use로 막힌다. 같은 자격증명으로 로그인이 되면 본인
        // 계정이므로 새로 만들지 않고 이어서 진행한다(비밀번호가 틀리면 남의 계정이라
        // 여기서 실패하고 그대로 사용자에게 안내된다).
        let user: User;
        let createdThisAttempt = false;
        try {
          user = (await createUserWithEmailAndPassword(auth, email, password)).user;
          createdThisAttempt = true;
        } catch (createErr) {
          if ((createErr as { code?: string } | null)?.code !== 'auth/email-already-in-use') {
            throw createErr;
          }
          user = (await signInWithEmailAndPassword(auth, email, password)).user;
        }
        setCreatedAccount(createdThisAttempt);

        if (user.emailVerified) {
          await finishRegistration(user, createdThisAttempt, nickname, nationality);
          return;
        }

        // 발송이 실패해도 대기 단계로 넘어간다 — 계정은 이미 생겼으므로 폼에 머물면
        // 재제출 시 createUserWithEmailAndPassword가 다시 email-already-in-use를
        // 던져 createdAccount 판정이 꼬인다. 재발송은 대기 화면에서 다시 시도하면 된다.
        // 이 실패를 그대로 rethrow하면 "계정은 생성됨"과 "가입 실패" 알럿이 동시에
        // 뜨는 모순이 생기므로, 결과값으로만 알려주고 여기서는 삼킨다.
        let sendFailed = false;
        try {
          await sendVerificationEmail(user);
        } catch (sendErr) {
          console.warn('Failed to send verification email after account creation', sendErr);
          sendFailed = true;
        } finally {
          setStep('awaitingVerification');
        }
        return sendFailed ? 'verificationSendFailed' : 'awaitingVerification';
      } finally {
        setIsSubmitting(false);
      }
    },
    [finishRegistration, sendVerificationEmail],
  );

  const confirmVerification = useCallback(
    async (nickname: string, nationality: string): Promise<ConfirmVerificationResult> => {
      const user = auth.currentUser;
      if (!user) {
        setStep('form');
        return 'no-session';
      }

      setIsCheckingVerification(true);
      try {
        await user.reload();
        if (!user.emailVerified) return 'not-verified';

        // api-client.ts의 요청 인터셉터는 강제갱신 없는 getIdToken()을 쓴다. 여기서
        // 미리 캐시를 갱신해두지 않으면 방금 인증한 사용자도 낡은 토큰(email_verified
        // 클레임이 아직 false인)으로 요청을 보내 정상 인증자인데도 403을 받는다.
        await user.getIdToken(true);
        await finishRegistration(user, createdAccount, nickname, nationality);
        return 'registered';
      } finally {
        setIsCheckingVerification(false);
      }
    },
    [createdAccount, finishRegistration],
  );

  const resendVerificationEmail = useCallback(() => {
    const user = auth.currentUser;
    if (!user) return Promise.resolve(false);
    return sendVerificationEmail(user);
  }, [sendVerificationEmail]);

  // 대기 단계에서 벗어나 다른 이메일로 처음부터 다시 가입할 수 있게 한다. 이 계정은
  // 아직 미인증이라 백엔드에 프로필이 없으므로, 지우고 폼으로 돌아가도 안전하다.
  const changeEmail = useCallback(async () => {
    const user = auth.currentUser;
    setIsChangingEmail(true);
    try {
      if (user) {
        try {
          await user.delete();
        } catch (err) {
          // delete가 auth/requires-recent-login 등으로 막혀도, 로그아웃은 시켜야
          // 같은 이메일이 auth.currentUser에 계속 남아 폼으로 못 돌아가는 일이 없다.
          console.warn('Failed to delete pending unverified account, signing out instead', err);
          await signOut(auth);
        }
      }
      await clearRegisterDraft();
      setCreatedAccount(false);
      setStep('form');
    } finally {
      setIsChangingEmail(false);
    }
  }, []);

  return {
    step,
    submit,
    confirmVerification,
    resendVerificationEmail,
    changeEmail,
    isSubmitting,
    isCheckingVerification,
    isChangingEmail,
    isRegistering: registerMutation.isPending,
    isSendingVerification,
    hasSentVerification,
    verificationCooldown,
  };
}
