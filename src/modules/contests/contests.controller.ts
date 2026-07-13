import {
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
import {
  ContestLifecycleService,
  ContestsParticipateService,
  ContestsService,
  ContestWinnerService,
} from './services';
import { CreateContestDto, UpdateContestDto } from './dto';
import { UserId } from 'src/common/decorators';
import { FileInterceptor } from '@nestjs/platform-express';
import { ParticipateContestDto } from './dto/participate-contest.dto';
import { GetContestsQueryDto } from './dto/get-contests-query.dto';
import { Paginated } from 'src/common/response/paginated.type';
import { ContestShortInfoDto } from './dto/contest-short-info.dto';
import { contestImageUploadOptions } from './interceptors/contest-image.interceptor';
import { JwtAuthGuard } from '../auth/guards';

@Controller('contest')
export class ContestsController {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly contestLifecycleService: ContestLifecycleService,
    private readonly contestsParticipateService: ContestsParticipateService,
    private readonly contestWinnerService: ContestWinnerService,
    private readonly logger: Logger,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getAllContests(
    @Query() query: GetContestsQueryDto,
  ): Promise<Paginated<Contest>> {
    this.logger.debug({ query }, 'getAllContests');
    return this.contestsService.getAllContests(query);
  }

  @Get('short-info')
  async getAllContestsShortInfo(
    @Query() query: GetContestsQueryDto,
  ): Promise<Paginated<ContestShortInfoDto>> {
    this.logger.debug({ query }, 'getAllContestsShortInfo');
    return this.contestsService.getAllContestsShortInfo(query);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('media', contestImageUploadOptions))
  create(
    @UserId()
    userId: number,
    @Body() dto: CreateContestDto,
    @UploadedFile() image?: Express.Multer.File,
  ): Promise<Contest> {
    this.logger.log({ userId }, 'createContest');
    return this.contestsService.createContest(
      { ...dto, creatorId: userId },
      image,
    );
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('media', contestImageUploadOptions))
  updateContest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateContestDto,
    @UserId() actorUserId: number,
    @UploadedFile() image?: Express.Multer.File,
  ): Promise<Contest> {
    return this.contestsService.updateContest(id, dto, image, actorUserId);
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
    this.logger.debug({ id }, 'getContestById');
    return this.contestsService.getContestById(id);
  }

  @Patch(':id/complete')
  @UseGuards(JwtAuthGuard)
  async completeContest(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Contest> {
    return this.contestLifecycleService.completeContest(id);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard)
  async cancelContest(@Param('id', ParseIntPipe) id: number): Promise<Contest> {
    return this.contestLifecycleService.cancelContest(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id', ParseIntPipe) contestId: number): Promise<void> {
    await this.contestsService.removeContest(contestId);
  }
}
