import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FestivalsService } from './festivals.service';
import { FestivalQueryDto } from './dto/festival-query.dto';

@ApiTags('Festivals')
@Controller('festivals')
export class FestivalsController {
  constructor(private readonly festivalsService: FestivalsService) {}

  @Get()
  @ApiOperation({
    summary: '부산 축제 목록 (진행 중/예정)',
    description:
      'status=ongoing(진행 중) | upcoming(예정). 생략 시 종료되지 않은 축제를 시작일순으로 반환.',
  })
  @ApiResponse({ status: 200, description: '축제 목록 { items, count }' })
  findAll(@Query() query: FestivalQueryDto) {
    return this.festivalsService.findAll(query.status);
  }
}
