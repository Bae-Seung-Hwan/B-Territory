import { withTimeout } from './with-timeout.util';

describe('withTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('원본이 먼저 끝나면 그 값을 그대로 돌려준다', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 500)).resolves.toBe('ok');
  });

  it('원본이 먼저 실패하면 그 오류를 그대로 전파한다', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 500),
    ).rejects.toThrow('boom');
  });

  it('제한 시간을 넘기면 거부한다', async () => {
    jest.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 500);
    const assertion = expect(pending).rejects.toThrow('timeout 500ms');
    jest.advanceTimersByTime(500);
    await assertion;
  });

  it('원본이 먼저 끝나면 타이머를 남기지 않는다', async () => {
    // 점령 경로가 요청마다 이 래퍼를 두 번 타므로, 정리하지 않으면 Redis가 1ms에 답해도
    // 요청마다 500ms 타이머가 두 개씩 쌓인다.
    jest.useFakeTimers();

    await withTimeout(Promise.resolve('ok'), 500);

    expect(jest.getTimerCount()).toBe(0);
  });
});
