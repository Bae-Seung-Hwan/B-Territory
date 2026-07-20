import { IsInt, IsPositive, IsUUID } from 'class-validator';

export class DuelResultDto {
  @IsInt()
  @IsPositive()
  duelId: number;

  @IsUUID()
  winnerId: string;
}
