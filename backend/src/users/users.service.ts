import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findByFirebaseUid(firebaseUid: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { firebaseUid } });
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    return this.userRepository.find({ where: { id: In(ids) } });
  }

  async create(data: Partial<User>): Promise<User> {
    const user = this.userRepository.create(data);
    return this.userRepository.save(user);
  }

  /** 원자적 점수 증감 (동시 결투 결과 반영 시 레이스 방지) — 하한 0, 감점으로 마이너스가 되지 않는다 */
  async applyScoreDelta(userId: string, delta: number): Promise<void> {
    await this.userRepository
      .createQueryBuilder()
      .update(User)
      .set({ score: () => 'GREATEST(0, score + :delta)' })
      .where('id = :id', { id: userId })
      .setParameters({ delta })
      .execute();
  }
}
