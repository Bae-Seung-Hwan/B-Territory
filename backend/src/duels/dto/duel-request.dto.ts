import { IsUUID } from 'class-validator';

export class DuelRequestDto {
  @IsUUID()
  targetUserId: string;
}
