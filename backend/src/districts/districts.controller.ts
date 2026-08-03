import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DistrictsService } from './districts.service';

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

  @Get(':code')
  @ApiOperation({ summary: '구·군 상세 조회 (sigunguCode)' })
  @ApiResponse({ status: 200, description: '구·군 상세 반환' })
  @ApiResponse({ status: 404, description: '구·군 없음' })
  async findOne(@Param('code') code: string) {
    const district = await this.districtsService.findOne(code);
    if (!district)
      throw new NotFoundException(
        `구·군(sigunguCode=${code})을 찾을 수 없습니다.`,
      );
    return district;
  }
}
