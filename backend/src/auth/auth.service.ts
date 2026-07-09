import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  async register(dto: RegisterDto, firebaseUid: string, email: string) {
    const existing = await this.usersService.findByFirebaseUid(firebaseUid);
    if (existing) throw new ConflictException('이미 가입된 사용자입니다.');

    const nationality = dto.nationality.toUpperCase();
    const user = await this.usersService.create({
      firebaseUid,
      email,
      nickname: dto.nickname,
      nationality,
      team: nationality,
    });

    return this.toProfile(user);
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
