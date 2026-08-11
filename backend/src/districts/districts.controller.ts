import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DistrictsService, CAPITAL_MULTIPLIER } from './districts.service';
import { ErrorCode, errBody } from '../common/errors/error-code';

@ApiTags('Districts')
@Controller('districts')
export class DistrictsController {
  constructor(private readonly districtsService: DistrictsService) {}

  @Get()
  @ApiOperation({ summary: '부산 구·군 마스터 목록 조회' })
  @ApiResponse({ status: 200, description: '구·군 목록(가중치 포함) 반환' })
  findAll() {
    return this.districtsService.findAll();
  }

  // ':code'보다 먼저 선언 — 'capital/current'는 2개 세그먼트라 :code(단일 세그먼트)와
  // 충돌하지 않지만, 의도를 명확히 하기 위해 위에 둔다.
  @Get('capital/current')
  @ApiOperation({ summary: '이번 주 수도 조회' })
  @ApiResponse({
    status: 200,
    description:
      '현재 수도 구 상세와 점수 배수 반환 (미지정 시 sigunguCode=null)',
  })
  async currentCapital() {
    const sigunguCode = await this.districtsService.getCurrentCapital();
    if (!sigunguCode) {
      return { sigunguCode: null, multiplier: 1, district: null };
    }
    return {
      sigunguCode,
      multiplier: CAPITAL_MULTIPLIER,
      district: await this.districtsService.findOne(sigunguCode),
    };
  }

  @Get(':code')
  @ApiOperation({ summary: '구·군 상세 조회 (sigunguCode)' })
  @ApiResponse({ status: 200, description: '구·군 상세 반환' })
  @ApiResponse({ status: 404, description: '구·군 없음' })
  async findOne(@Param('code') code: string) {
    const district = await this.districtsService.findOne(code);
    if (!district)
      throw new NotFoundException(
        errBody(
          ErrorCode.DISTRICT_NOT_FOUND,
          `구·군(sigunguCode=${code})을 찾을 수 없습니다.`,
        ),
      );
    return district;
  }
}
