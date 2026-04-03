import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Contest } from './entities';
import { Logger } from 'nestjs-pino';
import { ContestsParticipateService, ContestsService } from './services';
import { CreateContestDto, UpdateContestDto } from './dto';
import { UserId } from 'src/common/decorators';
import { FileInterceptor } from '@nestjs/platform-express';
import { ParticipateContestDto } from './dto/participate-contest.dto';
import { GetContestsQueryDto } from './dto/get-contests-query.dto';
import { Paginated } from 'src/shared/commons/response/paginated.type';
import { ContestShortInfoDto } from './dto/contest-short-info.dto';
import { contestImageUploadOptions } from './commons/contest-image.interceptor';

@Controller('contest')
export class ContestsController {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly contestsParticipateService: ContestsParticipateService,
    private readonly logger: Logger,
  ) {}

  @Get()
  async getAllContests(
    @Query() query: GetContestsQueryDto,
  ): Promise<Paginated<Contest>> {
    this.logger.log('Получение списка конкурсов с фильтрацией и пагинацией');
    return this.contestsService.getAllContests(query);
  }

  @Get('short-info')
  async getAllContestsShortInfo(
    @Query() query: GetContestsQueryDto,
  ): Promise<Paginated<ContestShortInfoDto>> {
    this.logger.log('Получение короткой информации по конкурсам');
    return this.contestsService.getAllContestsShortInfo(query);
  }

  @Post()
  // @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('media', contestImageUploadOptions))
  create(
    @UserId()
    userId: number,
    @Body() dto: CreateContestDto,
    @UploadedFile() image?: Express.Multer.File,
  ): Promise<Contest> {
    this.logger.log(`Создание конкурса пользователем id=${userId}`);
    return this.contestsService.createContest({ ...dto, creatorId: 1 }, image);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('media', contestImageUploadOptions))
  updateContest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateContestDto,
    @UploadedFile() image?: Express.Multer.File,
  ): Promise<Contest> {
    return this.contestsService.updateContest(id, dto, image);
  }

  @Post(':contestId/participate')
  async participate(
    @Param('contestId', ParseIntPipe) contestId: number,
    @Body() dto: ParticipateContestDto,
  ) {
    return this.contestsParticipateService.participate(contestId, dto);
  }

  @Get(':id')
  async getContestById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Contest> {
    this.logger.log(`Получение конкурса id=${id}`);
    return this.contestsService.getContestById(id);
  }

  @Patch(':id/complete')
  async completeContest(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Contest> {
    return this.contestsService.completeContest(id);
  }

  @Patch(':id/cancel')
  async cancelContest(@Param('id', ParseIntPipe) id: number): Promise<Contest> {
    return this.contestsService.cancelContest(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) contestId: number): void {
    this.contestsService.removeContest(contestId);
  }
}
