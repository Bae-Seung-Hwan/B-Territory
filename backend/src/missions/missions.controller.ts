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
import { extname } from 'path';
import { MissionsService } from './missions.service';
import { PhotoMissionDto } from './dto/photo-mission.dto';
import { ReviewMissionDto } from './dto/review-mission.dto';
import { ReviewQueryDto } from './dto/review-query.dto';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { UsersService } from '../users/users.service';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB

// tsconfig의 types가 ["jest","node"]로 제한돼 multer의 전역 Express.Multer 확장이 로드되지
// 않으므로, 실제로 쓰는 필드만 담은 최소 타입으로 업로드 파일을 받는다.
interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

@ApiTags('Missions')
@Controller('missions')
export class MissionsController {
  constructor(
    private readonly missionsService: MissionsService,
    private readonly usersService: UsersService,
  ) {}

  @Post('photo')
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor('image'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: '현장 사진 인증 미션 (GPS 방문 전제, 개인 보너스)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image', 'spotId', 'lat', 'lng'],
      properties: {
        image: { type: 'string', format: 'binary' },
        spotId: { type: 'number' },
        lat: { type: 'number' },
        lng: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 201, description: '사진 인증 성공 + 보너스 지급' })
  @ApiResponse({ status: 400, description: '50m 초과 또는 잘못된 이미지' })
  @ApiResponse({
    status: 409,
    description: '오늘 이미 사진 인증함 (KST 자정 초기화)',
  })
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
      {
        buffer: file.buffer,
        mimetype: file.mimetype,
        ext: extname(file.originalname) || '.jpg',
      },
      dto.spotId,
      dto.lat,
      dto.lng,
      id,
      team,
    );
  }

  @Post('review')
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '관광지 리뷰 미션 (GPS 방문 전제, 개인 보너스)' })
  @ApiResponse({ status: 201, description: '리뷰 작성 성공 + 보너스 지급' })
  @ApiResponse({ status: 400, description: '50m 초과 또는 잘못된 입력' })
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
