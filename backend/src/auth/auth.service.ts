import { Injectable, ConflictException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';

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

    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      nationality: user.nationality,
      team: user.team,
    };
  }
}
