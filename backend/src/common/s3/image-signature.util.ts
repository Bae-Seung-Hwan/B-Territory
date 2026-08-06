import { BadRequestException } from '@nestjs/common';

/** 매직 바이트로 판별한 실제 이미지 포맷. 저장 시 확장자·Content-Type의 근거가 된다. */
export interface DetectedImage {
  mimetype: string;
  ext: string;
}

/**
 * 매직 바이트로 실제 이미지 여부를 검증하고 판별된 포맷을 돌려준다 — 컨트롤러의
 * FileTypeValidator는 클라이언트가 보낸 mimetype만 보므로 위조 가능하다.
 * 반환값을 S3 확장자·Content-Type에 그대로 써서 선언값과 실제 바이트가 어긋나지 않게 한다.
 * 지원 포맷: JPEG/PNG/WebP.
 */
export function assertSupportedImage(buffer: Buffer): DetectedImage {
  const detected = detectImage(buffer);
  if (!detected) {
    throw new BadRequestException(
      '지원하지 않는 이미지입니다. (JPEG/PNG/WebP만 허용)',
    );
  }
  return detected;
}

function detectImage(buffer: Buffer): DetectedImage | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return { mimetype: 'image/jpeg', ext: '.jpg' };

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
    return { mimetype: 'image/png', ext: '.png' };

  // WebP: 'RIFF' .... 'WEBP'
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return { mimetype: 'image/webp', ext: '.webp' };

  return null;
}
