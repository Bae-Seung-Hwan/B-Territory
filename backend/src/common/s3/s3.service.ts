import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

/**
 * S3 업로드 래퍼. 자격증명은 env(AWS_ACCESS_KEY_ID/SECRET)나 EC2 인스턴스 IAM 역할
 * (기본 자격증명 체인)에서 자동으로 온다 — 자격증명을 명시적으로 넣지 않는다.
 * 업로드된 객체의 공개 URL을 반환한다.
 */
@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;

  constructor(private readonly config: ConfigService) {
    const region = this.config.get<string>('AWS_REGION', 'ap-northeast-2');
    this.bucket = this.config.get<string>('S3_BUCKET', '');
    // CDN/커스텀 도메인이 있으면 그걸 쓰고, 없으면 표준 S3 가상호스트 URL로 구성.
    this.publicBase =
      this.config.get<string>('S3_PUBLIC_BASE_URL', '') ||
      `https://${this.bucket}.s3.${region}.amazonaws.com`;
    this.client = new S3Client({ region });
  }

  /**
   * 버퍼를 S3에 업로드하고 공개 URL을 반환한다.
   * keyPrefix 아래에 UUID 파일명으로 저장한다(원본 파일명 노출·충돌 방지).
   */
  async upload(
    buffer: Buffer,
    contentType: string,
    keyPrefix: string,
    ext: string,
  ): Promise<string> {
    if (!this.bucket) {
      throw new InternalServerErrorException(
        'S3_BUCKET 미설정 — 이미지 업로드를 처리할 수 없습니다.',
      );
    }
    const key = `${keyPrefix}/${randomUUID()}${ext}`;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );
    } catch (err) {
      this.logger.error(`S3 업로드 실패 key=${key}`, err as Error);
      throw new InternalServerErrorException('이미지 업로드에 실패했습니다.');
    }
    return `${this.publicBase}/${key}`;
  }
}
