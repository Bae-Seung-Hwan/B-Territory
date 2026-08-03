import { BadRequestException } from '@nestjs/common';

/**
 * 매직 바이트로 실제 이미지 여부를 검증한다 — 컨트롤러의 FileTypeValidator는
 * 클라이언트가 보낸 mimetype만 보므로 위조 가능하다. 지원 포맷: JPEG/PNG/WebP.
 */
export function assertSupportedImage(buffer: Buffer): void {
  if (!isSupportedImage(buffer)) {
    throw new BadRequestException(
      '지원하지 않는 이미지입니다. (JPEG/PNG/WebP만 허용)',
    );
  }
}

function isSupportedImage(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return true;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  )
    return true;

  // WebP: 'RIFF' .... 'WEBP'
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return true;

  return false;
}
