import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { SpotsService } from './spots.service';

@ApiTags('Spots')
@Controller('spots')
export class SpotsController {
  constructor(private readonly spotsService: SpotsService) {}

  @Get()
  @ApiOperation({ summary: '관광지 목록 조회' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'areacode',
    required: false,
    type: String,
    description: '지역코드 (부산=6)',
  })
  @ApiQuery({
    name: 'sigungucode',
    required: false,
    type: String,
    description: '구 코드',
  })
  @ApiQuery({
    name: 'contenttypeid',
    required: false,
    type: String,
    description: '콘텐츠 유형',
  })
  @ApiResponse({ status: 200, description: '관광지 목록 반환' })
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('areacode') areacode?: string,
    @Query('sigungucode') sigungucode?: string,
    @Query('contenttypeid') contenttypeid?: string,
  ) {
    return this.spotsService.findAll({
      page,
      limit,
      areacode,
      sigungucode,
      contenttypeid,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '관광지 상세 조회' })
  @ApiQuery({
    name: 'lang',
    required: false,
    type: String,
    description:
      '언어(ko/en) 또는 국가코드(KR/US 등). 설명(description) 언어 선택용',
  })
  @ApiResponse({ status: 200, description: '관광지 상세 정보 반환' })
  @ApiResponse({ status: 404, description: '관광지 없음' })
  findOne(@Param('id', ParseIntPipe) id: number, @Query('lang') lang?: string) {
    return this.spotsService.findOne(id, lang);
  }
}
