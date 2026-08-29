import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useReviewMission } from '@/hooks/use-review-mission';
import { checkinMission, submitReviewMission } from '@/api/missions';
import { loadVisitCheckin, saveVisitCheckin, clearVisitCheckin } from '@/lib/visit-checkin';

jest.mock('@/api/missions', () => ({
  checkinMission: jest.fn(),
  submitReviewMission: jest.fn(),
}));

jest.mock('@/lib/visit-checkin', () => ({
  loadVisitCheckin: jest.fn(),
  saveVisitCheckin: jest.fn(),
  clearVisitCheckin: jest.fn(),
}));

const mockedCheckin = checkinMission as jest.Mock;
const mockedSubmitReview = submitReviewMission as jest.Mock;
const mockedLoadVisitCheckin = loadVisitCheckin as jest.Mock;
const mockedSaveVisitCheckin = saveVisitCheckin as jest.Mock;
const mockedClearVisitCheckin = clearVisitCheckin as jest.Mock;

function visitRequiredError() {
  return {
    isAxiosError: true,
    response: { status: 400, data: { code: 'MISSION_VISIT_REQUIRED' } },
  };
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

async function renderMission(spotId: number | null) {
  return renderHook(({ id }: { id: number | null }) => useReviewMission(id), {
    wrapper: createWrapper(),
    initialProps: { id: spotId },
  });
}

beforeEach(() => {
  mockedLoadVisitCheckin.mockResolvedValue(false);
  mockedSaveVisitCheckin.mockResolvedValue(undefined);
  mockedClearVisitCheckin.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('마운트 시 캐시 복원', () => {
  it('기기에 유효한 방문 창이 남아 있으면 재체크인 없이 checkedIn이 true가 된다', async () => {
    mockedLoadVisitCheckin.mockResolvedValue(true);

    const { result } = await renderMission(1);

    await waitFor(() => expect(result.current.checkedIn).toBe(true));
    expect(mockedLoadVisitCheckin).toHaveBeenCalledWith(1);
    expect(mockedCheckin).not.toHaveBeenCalled();
  });

  it('캐시가 없으면 checkedIn이 false로 시작한다', async () => {
    const { result } = await renderMission(1);

    await waitFor(() => expect(mockedLoadVisitCheckin).toHaveBeenCalledWith(1));
    expect(result.current.checkedIn).toBe(false);
  });
});

describe('체크인 성공', () => {
  it('만료 시각을 캐시에 저장하고 checkedIn을 true로 바꾼다', async () => {
    mockedCheckin.mockResolvedValue({ success: true, spotId: 1, expiresInSeconds: 86400 });
    const { result } = await renderMission(1);
    await waitFor(() => expect(mockedLoadVisitCheckin).toHaveBeenCalled());

    await act(async () => {
      await result.current.checkin.mutateAsync({ lat: 1, lng: 1 });
    });

    expect(mockedSaveVisitCheckin).toHaveBeenCalledWith(1, 86400);
    expect(result.current.checkedIn).toBe(true);
  });
});

describe('리뷰 성공 시 캐시를 지우지 않는다 (서버는 리뷰로 방문 창을 소진하지 않음)', () => {
  it('리뷰가 성공해도 clearVisitCheckin을 호출하지 않고 checkedIn을 유지한다', async () => {
    mockedLoadVisitCheckin.mockResolvedValue(true);
    mockedSubmitReview.mockResolvedValue({
      success: true,
      spotId: 1,
      team: 'KR',
      type: 'MISSION_REVIEW',
      pointsAwarded: 10,
      teamPointsAwarded: 10,
    });
    const { result } = await renderMission(1);
    await waitFor(() => expect(result.current.checkedIn).toBe(true));

    await act(async () => {
      await result.current.review.mutateAsync({ rating: 5, content: 'good' });
    });

    expect(mockedClearVisitCheckin).not.toHaveBeenCalled();
    expect(result.current.checkedIn).toBe(true);
  });
});

describe('리뷰가 MISSION_VISIT_REQUIRED로 거부되면', () => {
  it('캐시를 지우고 checkedIn을 false로 되돌린다', async () => {
    mockedLoadVisitCheckin.mockResolvedValue(true);
    mockedSubmitReview.mockRejectedValue(visitRequiredError());
    const { result } = await renderMission(1);
    await waitFor(() => expect(result.current.checkedIn).toBe(true));

    await act(async () => {
      await expect(result.current.review.mutateAsync({ rating: 5 })).rejects.toBeTruthy();
    });

    expect(mockedClearVisitCheckin).toHaveBeenCalledWith(1);
    expect(result.current.checkedIn).toBe(false);
  });

  it('같은 마운트에서 방금 체크인에 성공했더라도 되돌린다 (checkin.isSuccess에 기대지 않는다)', async () => {
    mockedCheckin.mockResolvedValue({ success: true, spotId: 1, expiresInSeconds: 86400 });
    mockedSubmitReview.mockRejectedValue(visitRequiredError());
    const { result } = await renderMission(1);
    await waitFor(() => expect(mockedLoadVisitCheckin).toHaveBeenCalled());

    await act(async () => {
      await result.current.checkin.mutateAsync({ lat: 1, lng: 1 });
    });
    expect(result.current.checkin.isSuccess).toBe(true);
    expect(result.current.checkedIn).toBe(true);

    await act(async () => {
      await expect(result.current.review.mutateAsync({ rating: 5 })).rejects.toBeTruthy();
    });

    // checkin mutation은 여전히 isSuccess지만, 안전장치는 이걸 참조하지 않으므로 되돌아간다.
    expect(result.current.checkin.isSuccess).toBe(true);
    expect(result.current.checkedIn).toBe(false);
  });
});

describe('spotId가 바뀌면', () => {
  it('새 spotId로 캐시를 다시 조회한다', async () => {
    const { rerender } = await renderMission(1);
    await waitFor(() => expect(mockedLoadVisitCheckin).toHaveBeenCalledWith(1));

    rerender({ id: 2 });

    await waitFor(() => expect(mockedLoadVisitCheckin).toHaveBeenCalledWith(2));
  });
});
