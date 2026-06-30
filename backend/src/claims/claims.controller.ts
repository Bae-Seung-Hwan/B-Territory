import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
  ParseIntPipe,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { ClaimsService } from './claims.service';
import { VisitDto } from './dto/visit.dto';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { UsersService } from '../users/users.service';

@ApiTags('Claims')
@Controller('claims')
export class ClaimsController {
  constructor(
    private readonly claimsService: ClaimsService,
    private readonly usersService: UsersService,
  ) {}

  @Post('visit')
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'GPS 방문 인증 및 점령 시도' })
  @ApiResponse({ status: 201, description: '점령 성공' })
  @ApiResponse({ status: 400, description: '50m 초과 — 방문 인증 실패' })
  @ApiResponse({ status: 409, description: '방어 시간 중' })
  async visit(
    @Body() dto: VisitDto,
    @Request() req: { user: { uid: string } },
  ) {
    const firebaseUid: string = req.user.uid;
    const user = await this.usersService.findByFirebaseUid(firebaseUid);
    if (!user) throw new NotFoundException('등록되지 않은 사용자입니다.');
    if (!user.team) throw new BadRequestException('팀이 배정되지 않은 사용자입니다.');
    return this.claimsService.visit(dto, user.id, user.team);
  }

  @Get('spots/:spotId')
  @ApiOperation({ summary: '관광지 현재 점령 현황 조회' })
  async getSpotClaim(@Param('spotId', ParseIntPipe) spotId: number) {
    return this.claimsService.getSpotClaim(spotId);
  }

  @Get('districts/:sigungucode')
  @ApiOperation({ summary: '구 단위 점령 현황 조회' })
  async getDistrictClaim(@Param('sigungucode') sigungucode: string) {
    return this.claimsService.getDistrictClaim(sigungucode);
  }
}
