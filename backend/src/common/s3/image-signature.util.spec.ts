import { BadRequestException } from '@nestjs/common';
import { assertSupportedImage } from './image-signature.util';
import { ErrorCode } from '../errors/error-code';

/** 시그니처 바이트 뒤에 지정한 길이까지 0을 채운 버퍼를 만든다. */
function withSignature(signature: number[], totalLength: number): Buffer {
  const buf = Buffer.alloc(Math.max(signature.length, totalLength));
  Buffer.from(signature).copy(buf);
  return buf;
}

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function webp(totalLength = 12): Buffer {
  const buf = Buffer.alloc(totalLength);
  buf.write('RIFF', 0, 'ascii');
  if (totalLength >= 12) buf.write('WEBP', 8, 'ascii');
  return buf;
}

describe('assertSupportedImage', () => {
  it('JPEG 매직 바이트를 image/jpeg로 판별한다', () => {
    expect(assertSupportedImage(withSignature(JPEG, 64))).toEqual({
      mimetype: 'image/jpeg',
      ext: '.jpg',
    });
  });

  it('PNG 매직 바이트를 image/png로 판별한다', () => {
    expect(assertSupportedImage(withSignature(PNG, 64))).toEqual({
      mimetype: 'image/png',
      ext: '.png',
    });
  });

  it('WebP(RIFF....WEBP)를 image/webp로 판별한다', () => {
    expect(assertSupportedImage(webp(64))).toEqual({
      mimetype: 'image/webp',
      ext: '.webp',
    });
  });

  // 포맷별 최소 길이를 각각 본다. 예전에는 가장 긴 WebP 기준(12바이트)을 모든 포맷에
  // 일괄 적용해서, 3바이트면 판별되는 JPEG가 4~11바이트일 때 근거 없이 거부됐다.
  it('시그니처 길이만 채운 짧은 JPEG/PNG도 판별한다', () => {
    expect(assertSupportedImage(Buffer.from(JPEG)).mimetype).toBe('image/jpeg');
    expect(assertSupportedImage(withSignature(JPEG, 5)).mimetype).toBe(
      'image/jpeg',
    );
    expect(assertSupportedImage(Buffer.from(PNG)).mimetype).toBe('image/png');
  });

  it('시그니처보다 짧은 버퍼는 거부한다', () => {
    expect(() => assertSupportedImage(Buffer.from([0xff, 0xd8]))).toThrow(
      BadRequestException,
    );
    // 'RIFF'만 있고 'WEBP' 태그가 없는 11바이트는 WebP로 볼 수 없다.
    expect(() => assertSupportedImage(webp(11))).toThrow(BadRequestException);
  });

  it('빈 버퍼와 지원하지 않는 포맷은 MISSION_UNSUPPORTED_IMAGE로 거부한다', () => {
    for (const buf of [
      Buffer.alloc(0),
      Buffer.from('GIF89a-not-supported', 'ascii'),
      Buffer.from('<html>definitely not an image</html>', 'ascii'),
    ]) {
      let thrown: BadRequestException | undefined;
      try {
        assertSupportedImage(buf);
      } catch (e) {
        thrown = e as BadRequestException;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
      expect(thrown?.getResponse()).toMatchObject({
        code: ErrorCode.MISSION_UNSUPPORTED_IMAGE,
      });
    }
  });
});
