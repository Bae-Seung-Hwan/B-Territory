import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';

@Injectable()
export class FirebaseService implements OnModuleInit {
  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: this.config.get<string>('FIREBASE_PROJECT_ID'),
          clientEmail: this.config.get<string>('FIREBASE_CLIENT_EMAIL'),
          privateKey: this.config
            .get<string>('FIREBASE_PRIVATE_KEY')
            ?.replace(/\\n/g, '\n'),
        }),
      });
    }
  }

  async verifyIdToken(token: string): Promise<DecodedIdToken> {
    return getAuth().verifyIdToken(token);
  }

  /**
   * Firebase Auth 계정 삭제 — 탈퇴 처리의 일부다.
   *
   * DB 행만 지우고 Firebase 계정을 남기면, 같은 이메일로 재가입할 때 Firebase가
   * 이미 존재하는 계정이라며 거부해 영영 다시 가입할 수 없게 된다.
   *
   * 이미 없는 계정(auth/user-not-found)은 성공으로 본다 — 삭제 도중 실패해 재시도하는
   * 경우 여기서 막히면 안 된다(멱등).
   */
  async deleteUser(uid: string): Promise<void> {
    try {
      await getAuth().deleteUser(uid);
    } catch (err) {
      if ((err as { code?: string }).code === 'auth/user-not-found') return;
      throw err;
    }
  }
}
