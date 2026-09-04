import { apiClient } from '@/lib/api-client';

/**
 * 회원 탈퇴. 백엔드가 DB 삭제 → Firebase 계정 삭제까지 처리하고 204로 끝난다
 * (account.controller.ts 참고). 성공하면 이 기기의 Firebase 세션도 더 이상 유효하지
 * 않으므로, 호출부가 곧바로 signOut해 로컬 상태를 정리해야 한다.
 */
export async function deleteAccount(): Promise<void> {
  await apiClient.delete('/api/users/me');
}
