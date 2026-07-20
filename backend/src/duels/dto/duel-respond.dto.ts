import { IsInt, IsPositive } from 'class-validator';

export class DuelRespondDto {
  @IsInt()
  @IsPositive()
  duelId: number;
}
