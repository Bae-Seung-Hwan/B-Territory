import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { ConsentsService } from '../consents/consents.service';
import { RegisterDto } from './dto/register.dto';
import {
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
} from '../common/utils/pg-error.util';
import { ErrorCode, errBody } from '../common/errors/error-code';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly consentsService: ConsentsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async register(
    dto: RegisterDto,
    firebaseUid: string,
    email?: string,
    emailVerified?: boolean,
  ) {
    // Firebase 토큰의 email은 optional이다(전화번호/익명/이메일 비공개 로그인).
    // users.email이 NOT NULL이라 그대로 진행하면 500이 나므로 명시적으로 거른다.
    if (!email) {
      throw new BadRequestException(
        errBody(
          ErrorCode.EMAIL_REQUIRED,
          '이메일 정보가 있는 계정만 가입할 수 있습니다.',
        ),
      );
    }

    const existing = await this.usersService.findByFirebaseUid(firebaseUid);
    if (existing)
      throw new ConflictException(
        errBody(ErrorCode.USER_ALREADY_EXISTS, '이미 가입된 사용자입니다.'),
      );

    // Firebase가 검증한 ID Token의 email_verified 클레임으로 이메일 소유를 확인한다.
    // 클라이언트는 가입 전 sendEmailVerification → 링크 클릭 → 토큰 강제 갱신을 거쳐야
    // 이 값이 true가 된다. Firebase가 표준으로 제공하므로 별도 발송 인프라가 필요 없다.
    if (!emailVerified) {
      throw new ForbiddenException(
        errBody(
          ErrorCode.EMAIL_NOT_VERIFIED,
          '이메일 인증이 필요합니다. 인증 메일의 링크를 먼저 확인해주세요.',
        ),
      );
    }

    const nationality = dto.nationality.toUpperCase();
    try {
      // 이용자 INSERT와 동의 이력을 한 트랜잭션에 묶는다. 따로 커밋하면 그 사이에 프로세스가
      // 죽었을 때 "동의했다는 증거가 없는 계정"이 남는데, 그건 이 기능이 없애려던 상태다.
      // 동의 항목 검증(누락·중복)도 이 안에서 던져 계정 생성까지 함께 되돌린다.
      const user = await this.dataSource.transaction(async (manager) => {
        const created = await manager.save(
          manager.create(User, {
            firebaseUid,
            email,
            nickname: dto.nickname,
            nationality,
            team: nationality,
          }),
        );
        await this.consentsService.recordAll(created.id, dto.consents, manager);
        return created;
      });
      return this.usersService.toProfile(user);
    } catch (err) {
      // 위 존재 검사~INSERT 사이에 동시 요청이 먼저 커밋한 경우(더블탭/재시도),
      // unique(firebaseUid|email) 위반을 500 대신 기존 재가입과 같은 409로 매핑한다.
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(
          errBody(ErrorCode.USER_ALREADY_EXISTS, '이미 가입된 사용자입니다.'),
        );
      }
      throw err;
    }
  }

  async getMe(firebaseUid: string) {
    const user = await this.usersService.findByFirebaseUid(firebaseUid);
    if (!user)
      throw new NotFoundException(
        errBody(ErrorCode.USER_NOT_REGISTERED, '등록되지 않은 사용자입니다.'),
      );

    return this.usersService.toProfile(user);
  }
}
