import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { ErrorCode, errBody } from '../errors/error-code';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(private readonly firebaseService: FirebaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user: { uid: string; email?: string; email_verified?: boolean };
    }>();
    const authHeader = request.headers.authorization ?? '';

    if (!authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        errBody(ErrorCode.TOKEN_REQUIRED, 'Firebase ID Token이 필요합니다.'),
      );
    }

    const token = authHeader.slice(7);
    try {
      const decoded = await this.firebaseService.verifyIdToken(token);
      request.user = decoded;
      return true;
    } catch {
      throw new UnauthorizedException(
        errBody(ErrorCode.INVALID_TOKEN, '유효하지 않은 토큰입니다.'),
      );
    }
  }
}
