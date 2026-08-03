import { IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

export class ChatMessageDto {
  // 앞뒤 공백을 제거해 저장·릴레이하고, 공백만 있는 메시지는 Length(1,...)에서 걸러낸다.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 500)
  text: string;
}
