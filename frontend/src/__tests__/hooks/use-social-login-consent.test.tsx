import { renderHook } from '@testing-library/react-native';
import { useSocialLoginConsent } from '@/hooks/use-social-login-consent';

describe('useSocialLoginConsent', () => {
  it('requestConsent를 호출하면 onRequest가 실행되고 Promise는 대기 상태다', async () => {
    const onRequest = jest.fn();
    const { result } = await renderHook(() => useSocialLoginConsent({ onRequest }));

    let settled = false;
    result.current.requestConsent().then(() => {
      settled = true;
    });

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(result.current.isAwaitingConsent()).toBe(true);
    expect(settled).toBe(false);
  });

  it('resolveConsent(true)면 Promise가 true로 풀리고 대기 상태가 해제된다', async () => {
    const { result } = await renderHook(() => useSocialLoginConsent({ onRequest: jest.fn() }));

    const requestPromise = result.current.requestConsent();
    result.current.resolveConsent(true);

    await expect(requestPromise).resolves.toBe(true);
    expect(result.current.isAwaitingConsent()).toBe(false);
  });

  it('resolveConsent(false)면 Promise가 false로 풀린다 (동의하지 않고 시트를 닫은 경우)', async () => {
    const { result } = await renderHook(() => useSocialLoginConsent({ onRequest: jest.fn() }));

    const requestPromise = result.current.requestConsent();
    result.current.resolveConsent(false);

    await expect(requestPromise).resolves.toBe(false);
  });

  it('대기 중인 요청이 없을 때 resolveConsent를 호출해도 무시된다', async () => {
    const { result } = await renderHook(() => useSocialLoginConsent({ onRequest: jest.fn() }));

    expect(() => result.current.resolveConsent(true)).not.toThrow();
    expect(result.current.isAwaitingConsent()).toBe(false);
  });

  it('resolve 후 다시 요청하면 새 Promise가 독립적으로 대기한다', async () => {
    const onRequest = jest.fn();
    const { result } = await renderHook(() => useSocialLoginConsent({ onRequest }));

    const first = result.current.requestConsent();
    result.current.resolveConsent(true);
    await expect(first).resolves.toBe(true);

    const second = result.current.requestConsent();
    expect(result.current.isAwaitingConsent()).toBe(true);
    expect(onRequest).toHaveBeenCalledTimes(2);

    result.current.resolveConsent(false);
    await expect(second).resolves.toBe(false);
  });
});
