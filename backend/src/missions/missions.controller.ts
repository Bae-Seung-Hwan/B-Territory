import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
  NotFoundException,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { MissionsService } from './missions.service';
import { CheckinDto } from './dto/checkin.dto';
import { PhotoMissionDto } from './dto/photo-mission.dto';
import { ReviewMissionDto } from './dto/review-mission.dto';
import { ReviewQueryDto } from './dto/review-query.dto';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { UsersService } from '../users/users.service';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB

// tsconfig의 types가 ["jest","node"]로 제한돼 multer의 전역 Express.Multer 확장이 로드되지
// 않으므로, 실제로 쓰는 필드만 담은 최소 타입으로 업로드 파일을 받는다.
// 파일명·mimetype은 클라이언트가 위조할 수 있어 서비스로 넘기지 않는다 — 확장자와
// Content-Type은 서비스가 매직 바이트로 판별한 실제 포맷에서 파생시킨다.
interface UploadedImage {
  buffer: Buffer;
}

@ApiTags('Missions')
@Controller('missions')
export class MissionsController {
  constructor(
    private readonly missionsService: MissionsService,
    private readonly usersService: UsersService,
  ) {}

  @Post('checkin')
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '현장 방문 체크인 (GPS 50m 검증, 이후 24h 사진·리뷰 허용)',
  })
  @ApiResponse({ status: 201, description: '방문 인증 성공 (24시간 창 오픈)' })
  @ApiResponse({ status: 400, description: '50m 초과 또는 좌표 없음' })
  @ApiResponse({ status: 404, description: '관광지를 찾을 수 없음' })
  async checkin(
    @Body() dto: CheckinDto,
    @Request() req: { user: { uid: string } },
  ) {
    const { id } = await this.resolveUser(req.user.uid);
    return this.missionsService.checkin(dto.spotId, dto.lat, dto.lng, id);
  }

  @Post('photo')
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth()
  // FileInterceptor는 메모리 스토리지라, limits 없이는 파일 전체를 버퍼링한 뒤에야
  // 아래 MaxFileSizeValidator가 거부한다(사후 검증 → 메모리 소진 위험). multer 레벨에서
  // 스트림 단계부터 끊어 실제 상한을 강제한다. 파일 초과는 413, 나머지 초과는 400.
  // fileSize만 걸면 busboy 기본값상 fields/parts가 여전히 Infinity라 "파일이 아닌 파트"로
  // 같은 메모리 소진이 가능하다 — 요청 전체를 유한하게 묶으려면 아래가 모두 필요하다.
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        fileSize: MAX_PHOTO_BYTES,
        files: 1,
        fields: 4, // 실제로는 spotId 하나 (여유분 포함)
        parts: 6, // 파일 + 필드 총 파트 수
        fieldSize: 16 * 1024, // 파일 아닌 필드 값의 상한
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: '현장 사진 인증 미션 (사전 체크인 전제, 개인 보너스)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image', 'spotId'],
      properties: {
        image: { type: 'string', format: 'binary' },
        spotId: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 201, description: '사진 인증 성공 + 보너스 지급' })
  @ApiResponse({
    status: 400,
    description: '방문 체크인 없음(만료 포함) 또는 잘못된 이미지',
  })
  @ApiResponse({ status: 404, description: '관광지를 찾을 수 없음' })
  @ApiResponse({
    status: 409,
    description: '오늘 이미 사진 인증함 (KST 자정 초기화)',
  })
  @ApiResponse({ status: 413, description: '이미지가 5MB를 초과함' })
  async submitPhoto(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_PHOTO_BYTES }),
          // mimetype 문자열만 1차 확인한다. NestJS 11의 FileTypeValidator는
          // 기본적으로 file-type(ESM) 매직넘버 검사를 하는데, 이는 Jest(CJS VM)에서
          // 로드에 실패해 항상 400을 내고 실제 위조 방어도 아래 assertSupportedImage가
          // 담당하므로 매직넘버 검사는 끈다.
          new FileTypeValidator({
            fileType: /^image\/(jpe?g|png|webp)$/,
            skipMagicNumbersValidation: true,
          }),
        ],
      }),
    )
    file: UploadedImage,
    @Body() dto: PhotoMissionDto,
    @Request() req: { user: { uid: string } },
  ) {
    const { id, team } = await this.resolveUser(req.user.uid);
    return this.missionsService.submitPhoto(
      { buffer: file.buffer },
      dto.spotId,
      id,
      team,
    );
  }

  @Post('review')
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '관광지 리뷰 미션 (사전 체크인 전제, 개인 보너스)' })
  @ApiResponse({ status: 201, description: '리뷰 작성 성공 + 보너스 지급' })
  @ApiResponse({
    status: 400,
    description: '방문 체크인 없음(만료 포함) 또는 잘못된 입력',
  })
  @ApiResponse({ status: 404, description: '관광지를 찾을 수 없음' })
  @ApiResponse({
    status: 409,
    description: '오늘 이미 리뷰함 (KST 자정 초기화)',
  })
  async submitReview(
    @Body() dto: ReviewMissionDto,
    @Request() req: { user: { uid: string } },
  ) {
    const { id, team } = await this.resolveUser(req.user.uid);
    return this.missionsService.submitReview(dto, id, team);
  }

  @Get('reviews')
  @ApiOperation({ summary: '관광지 리뷰 목록 조회 (최신순 + 평균 별점)' })
  @ApiResponse({
    status: 200,
    description: '리뷰 목록 { items, count, averageRating }',
  })
  async listReviews(@Query() query: ReviewQueryDto) {
    return this.missionsService.listReviews(query.spotId);
  }

  /** 인증된 Firebase uid로 내부 유저·팀을 확정한다 (claims 컨트롤러와 동일 규칙). */
  private async resolveUser(
    firebaseUid: string,
  ): Promise<{ id: string; team: string }> {
    const user = await this.usersService.findByFirebaseUid(firebaseUid);
    if (!user) throw new NotFoundException('등록되지 않은 사용자입니다.');
    if (!user.team)
      throw new BadRequestException('팀이 배정되지 않은 사용자입니다.');
    return { id: user.id, team: user.team };
  }
}
