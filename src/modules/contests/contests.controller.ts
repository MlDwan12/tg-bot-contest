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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Contest } from './entities';
import { ContestWithRelations } from './types';
import { Logger } from 'nestjs-pino';
import {
  ContestLifecycleService,
  ContestsParticipateService,
  ContestsService,
  ContestWinnerService,
  ContestStatsService,
  ContestPublicationService,
  ContestExportService,
} from './services';
import { CreateContestDto, UpdateContestDto } from './dto';
import { ContestStatsDto } from './dto/contest-stats.dto';
import { UserId } from 'src/common/decorators';
import { FileInterceptor } from '@nestjs/platform-express';
import { ParticipateContestDto } from './dto/participate-contest.dto';
import { GetContestsQueryDto } from './dto/get-contests-query.dto';
import { Paginated } from 'src/common/response/paginated.type';
import { ContestShortInfoDto } from './dto/contest-short-info.dto';
import { contestImageUploadOptions } from './interceptors/contest-image.interceptor';
import { JwtAuthGuard } from '../auth/guards';
import type { Response } from 'express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  ApiEnvelopedPaginatedResponse,
  ApiEnvelopedResponse,
  ApiEnvelopedResponseRaw,
} from 'src/common/swagger/api-enveloped-response.decorator';
import { ContestWithRelationsDto } from './dto/contest-with-relations.dto';

@ApiTags('contests')
@Controller('contest')
export class ContestsController {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly contestLifecycleService: ContestLifecycleService,
    private readonly contestsParticipateService: ContestsParticipateService,
    private readonly contestWinnerService: ContestWinnerService,
    private readonly contestStatsService: ContestStatsService,
    private readonly contestPublicationService: ContestPublicationService,
    private readonly contestExportService: ContestExportService,
    private readonly logger: Logger,
  ) {}

  @ApiOperation({
    summary: 'Список конкурсов (полный)',
    description:
      'Конкурсы-сущности целиком, с фильтрами по статусу/стратегии/датам/' +
      'создателю и поиском, постранично.',
  })
  @ApiCookieAuth('accessToken')
  @ApiEnvelopedPaginatedResponse(Contest)
  @Get()
  @UseGuards(JwtAuthGuard)
  async getAllContests(
    @Query() query: GetContestsQueryDto,
  ): Promise<Paginated<Contest>> {
    this.logger.debug({ query }, 'getAllContests');
    return this.contestsService.getAllContests(query);
  }

  @ApiOperation({
    summary: 'Список конкурсов (краткая карточка)',
    description:
      'Облегчённая проекция для списков/меню: имя, создатель, число ' +
      'участников, статус, даты. Без auth — используется публичными вьюхами.',
  })
  @ApiEnvelopedPaginatedResponse(ContestShortInfoDto)
  @Get('short-info')
  async getAllContestsShortInfo(
    @Query() query: GetContestsQueryDto,
  ): Promise<Paginated<ContestShortInfoDto>> {
    this.logger.debug({ query }, 'getAllContestsShortInfo');
    return this.contestsService.getAllContestsShortInfo(query);
  }

  @ApiOperation({
    summary: 'Создать конкурс',
    description:
      'Картинка — необязательное поле media (multipart). creatorId ' +
      'проставляется из JWT (@UserId), в теле запроса его нет.',
  })
  @ApiCookieAuth('accessToken')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      allOf: [
        { $ref: getSchemaPath(CreateContestDto) },
        {
          type: 'object',
          properties: {
            media: {
              type: 'string',
              format: 'binary',
              description: 'Картинка поста конкурса',
            },
          },
        },
      ],
    },
  })
  @ApiEnvelopedResponse(ContestWithRelationsDto, { status: 201 })
  @ApiExtraModels(CreateContestDto)
  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('media', contestImageUploadOptions))
  create(
    @UserId()
    userId: number,
    @Body() dto: CreateContestDto,
    @UploadedFile() image?: Express.Multer.File,
  ): Promise<ContestWithRelations> {
    this.logger.log({ userId }, 'createContest');
    return this.contestsService.createContest(
      { ...dto, creatorId: userId },
      image,
    );
  }

  @ApiOperation({
    summary: 'Изменить конкурс',
    description:
      'Частичное обновление (все поля CreateContestDto опциональны) плюс ' +
      'status и ручной список победителей (winners, JSON-строка в multipart). ' +
      'Новая картинка — необязательное поле media.',
  })
  @ApiCookieAuth('accessToken')
  @ApiParam({ name: 'id', type: Number })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      allOf: [
        { $ref: getSchemaPath(UpdateContestDto) },
        {
          type: 'object',
          properties: {
            media: { type: 'string', format: 'binary' },
          },
        },
      ],
    },
  })
  @ApiEnvelopedResponse(ContestWithRelationsDto)
  @ApiExtraModels(UpdateContestDto)
  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('media', contestImageUploadOptions))
  updateContest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateContestDto,
    @UserId() actorUserId: number,
    @UploadedFile() image?: Express.Multer.File,
  ): Promise<ContestWithRelations> {
    return this.contestsService.updateContest(id, dto, image, actorUserId);
  }

  @ApiOperation({
    summary: 'Участвовать в конкурсе',
    description:
      'Без auth-гарда — вызывается из мини-аппа с telegramId/groupId прямо ' +
      'в теле. Известный открытый вопрос безопасности: initData не проверяется, ' +
      'участвовать можно за чужой telegramId обычным запросом (см. ' +
      'CONTEST_FEATURES_PLAN.md, «Открытые вопросы»).',
  })
  @ApiParam({ name: 'contestId', type: Number })
  @ApiEnvelopedResponseRaw(
    { type: 'object' },
    { description: 'Форма ответа зависит от исхода участия' },
  )
  @Post(':contestId/participate')
  async participate(
    @Param('contestId', ParseIntPipe) contestId: number,
    @Body() dto: ParticipateContestDto,
  ) {
    return this.contestsParticipateService.participate(contestId, dto);
  }

  @ApiOperation({
    summary: 'Конкурс по id',
    description: 'Без auth-гарда — открытая карточка конкурса.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiEnvelopedResponse(ContestWithRelationsDto)
  @Get(':id')
  async getContestById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ContestWithRelations> {
    this.logger.debug({ id }, 'getContestById');
    return this.contestsService.getContestById(id);
  }

  /**
   * Сводка по конкурсу: сколько участников отсеялось на перепроверке подписки
   * и до скольких победителей дошло личное уведомление. Под гардом — это
   * внутренняя аналитика, а не публичная выдача.
   */
  @ApiOperation({
    summary: 'Статистика конкурса',
    description:
      'Качество аудитории (кто отписался) и доставка уведомлений ' +
      'победителям. Внутренняя аналитика — под auth.',
  })
  @ApiCookieAuth('accessToken')
  @ApiParam({ name: 'id', type: Number })
  @ApiEnvelopedResponse(ContestStatsDto)
  @Get(':id/stats')
  @UseGuards(JwtAuthGuard)
  async getContestStats(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ContestStatsDto> {
    return this.contestStatsService.getContestStats(id);
  }

  /**
   * Превью поста: что уйдёт в каждый канал публикации, без самой публикации.
   * Собирается тем же кодом, что и реальный пост, — оператор видит факт, а не
   * его приблизительное описание.
   */
  @ApiOperation({
    summary: 'Превью поста конкурса',
    description:
      'Что реально уйдёт в каждый канал публикации (текст/кнопка/картинка), ' +
      'без самой публикации — собирается тем же кодом, что и настоящий пост.',
  })
  @ApiCookieAuth('accessToken')
  @ApiParam({ name: 'id', type: Number })
  @ApiEnvelopedResponseRaw({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        channelTelegramId: { type: 'string' },
        channelUsername: { type: 'string', nullable: true },
        payload: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            buttonText: { type: 'string' },
            buttonUrl: { type: 'string' },
            photoUrl: { type: 'string', nullable: true },
          },
        },
      },
    },
  })
  @Get(':id/preview')
  @UseGuards(JwtAuthGuard)
  async getContestPreview(@Param('id', ParseIntPipe) id: number) {
    return this.contestPublicationService.buildContestPreview(id);
  }

  /**
   * Выгрузка участников в CSV. Пишем в ответ потоком: у крупного конкурса
   * десятки тысяч строк, и держать весь файл в памяти незачем.
   *
   * @Res без passthrough отключает ResponseInterceptor — обёртка
   * {success, status, data} для файла не нужна, отдаём сырой CSV.
   */
  @ApiOperation({
    summary: 'Выгрузка участников (CSV)',
    description:
      'Потоковый CSV, без обёртки {success,status,data} (см. комментарий в ' +
      'коде — @Res без passthrough отключает ResponseInterceptor).',
  })
  @ApiCookieAuth('accessToken')
  @ApiParam({ name: 'id', type: Number })
  @ApiProduces('text/csv')
  @Get(':id/participants.csv')
  @UseGuards(JwtAuthGuard)
  async exportParticipants(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const stream = this.contestExportService.streamParticipantsCsv(id);

    // Первый кусок берём отдельно: до него сервис успевает бросить 404, и
    // ошибка ещё уйдёт нормальным JSON-ответом. После записи заголовков
    // сделать это уже нельзя.
    const first = await stream.next();

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${this.contestExportService.buildFileName(id)}"`,
    );

    if (!first.done) res.write(first.value);

    for await (const chunk of stream) {
      res.write(chunk);
    }

    res.end();
  }

  @ApiOperation({
    summary: 'Завершить конкурс досрочно',
    description:
      'Запускает розыгрыш/подведение итогов раньше endDate тем же путём, ' +
      'что и штатное завершение по расписанию.',
  })
  @ApiCookieAuth('accessToken')
  @ApiParam({ name: 'id', type: Number })
  @ApiEnvelopedResponse(ContestWithRelationsDto)
  @Patch(':id/complete')
  @UseGuards(JwtAuthGuard)
  async completeContest(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ContestWithRelations> {
    return this.contestLifecycleService.completeContest(id);
  }

  @ApiOperation({
    summary: 'Отменить конкурс',
    description: 'Без розыгрыша и уведомлений победителям.',
  })
  @ApiCookieAuth('accessToken')
  @ApiParam({ name: 'id', type: Number })
  @ApiEnvelopedResponse(ContestWithRelationsDto)
  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard)
  async cancelContest(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ContestWithRelations> {
    return this.contestLifecycleService.cancelContest(id);
  }

  @ApiOperation({ summary: 'Удалить конкурс' })
  @ApiCookieAuth('accessToken')
  @ApiParam({ name: 'id', type: Number })
  @ApiEnvelopedResponseRaw({ type: 'null' })
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id', ParseIntPipe) contestId: number): Promise<void> {
    await this.contestsService.removeContest(contestId);
  }
}
