import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HallOfFameService } from './hall-of-fame.service';
import { HallOfFameQueryDto } from './dto/hall-of-fame-query.dto';

@ApiTags('HallOfFame')
@Controller('hall-of-fame')
export class HallOfFameController {
  constructor(private readonly hallOfFameService: HallOfFameService) {}

  @Get('teams')
  @ApiOperation({ summary: '시즌 팀 랭킹 (기본: 현재 시즌)' })
  @ApiResponse({
    status: 200,
    description: '팀 점수(teamPoints) 합산 상위 랭킹 + 시즌 구간/상태',
  })
  getTeams(@Query() query: HallOfFameQueryDto) {
    return this.hallOfFameService.getTeams(query.season);
  }

  @Get('users')
  @ApiOperation({ summary: '시즌 개인 랭킹 (기본: 현재 시즌)' })
  @ApiResponse({
    status: 200,
    description: '개인 점수(personalPoints) 합산 상위 랭킹 + 시즌 구간/상태',
  })
  getUsers(@Query() query: HallOfFameQueryDto) {
    return this.hallOfFameService.getUsers(query.season);
  }
}
