import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { User } from '../users/entities/user.entity';

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  async register(dto: RegisterDto, firebaseUid: string, email?: string) {
    // Firebase 토큰의 email은 optional이다(전화번호/익명/이메일 비공개 로그인).
    // users.email이 NOT NULL이라 그대로 진행하면 500이 나므로 명시적으로 거른다.
    if (!email) {
      throw new BadRequestException(
        '이메일 정보가 있는 계정만 가입할 수 있습니다.',
      );
    }

    const existing = await this.usersService.findByFirebaseUid(firebaseUid);
    if (existing) throw new ConflictException('이미 가입된 사용자입니다.');

    const nationality = dto.nationality.toUpperCase();
    try {
      const user = await this.usersService.create({
        firebaseUid,
        email,
        nickname: dto.nickname,
        nationality,
        team: nationality,
      });
      return this.toProfile(user);
    } catch (err) {
      // 위 존재 검사~INSERT 사이에 동시 요청이 먼저 커밋한 경우(더블탭/재시도),
      // unique(firebaseUid|email) 위반을 500 대신 기존 재가입과 같은 409로 매핑한다.
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION
      ) {
        throw new ConflictException('이미 가입된 사용자입니다.');
      }
      throw err;
    }
  }

  async getMe(firebaseUid: string) {
    const user = await this.usersService.findByFirebaseUid(firebaseUid);
    if (!user) throw new NotFoundException('등록되지 않은 사용자입니다.');

    return this.toProfile(user);
  }

  private toProfile(user: User) {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      nationality: user.nationality,
      team: user.team,
    };
  }
}
