import { apiClient } from '@/lib/api-client';

/** backend/src/moderation/entities/report.entity.ts의 ReportReason과 값이 같아야 한다. */
export enum ReportReason {
  SPAM = 'SPAM',
  ABUSE = 'ABUSE',
  SEXUAL = 'SEXUAL',
  HATE = 'HATE',
  OTHER = 'OTHER',
}

export interface BlockedUser {
  userId: string;
  nickname: string;
  blockedAt: string;
}

/** GET /api/blocks — 내가 차단한 사용자 목록. */
export async function fetchBlockedUsers(): Promise<BlockedUser[]> {
  const { data } = await apiClient.get<BlockedUser[]>('/api/blocks');
  return data;
}

/** POST /api/blocks/:userId — 차단(멱등, 204). 상대의 채팅이 이후 나에게 릴레이되지 않는다. */
export async function blockUser(userId: string): Promise<void> {
  await apiClient.post(`/api/blocks/${userId}`);
}

/** DELETE /api/blocks/:userId — 차단 해제(멱등, 204). */
export async function unblockUser(userId: string): Promise<void> {
  await apiClient.delete(`/api/blocks/${userId}`);
}

export interface CreateReportPayload {
  targetUserId: string;
  reason: ReportReason;
  /**
   * 신고 대상 메시지 원문. 채팅은 서버에 저장되지 않으므로(ChatGateway는 순수 릴레이)
   * 이 값이 운영자가 확인할 수 있는 유일한 증거다 — 신고 시 반드시 함께 보내야 한다.
   */
  contentSnapshot?: string;
  detail?: string;
}

/** POST /api/reports — 신고 접수. */
export async function reportUser(
  payload: CreateReportPayload,
): Promise<{ id: number }> {
  const { data } = await apiClient.post<{ id: number }>('/api/reports', payload);
  return data;
}
