import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CONTEST_PARTICIPATE_REPOSITORY,
  CONTEST_REPOSITORY,
  CONTEST_WINNER_REPOSITORY,
} from 'src/common/constants';
import type {
  IContestParticipationRepository,
  IContestRepository,
  IContestWinnerRepository,
} from '../interfaces';
import { CSV_BOM, toCsvRow } from 'src/common/helpers/csv.helper';

/** Сколько участий тянем из базы за раз. */
const EXPORT_PAGE_SIZE = 500;

const CSV_HEADER = [
  'participationId',
  'userId',
  'telegramId',
  'username',
  'firstName',
  'lastName',
  'joinedAt',
  'groupId',
  'subscriptionStatus',
  'subscriptionCheckedAt',
  'isWinner',
  'prizePlace',
  'winnerStatus',
];

/**
 * Выгрузка участников конкурса в CSV.
 *
 * Отдаётся генератором, а не одной строкой: у крупного конкурса десятки тысяч
 * участий, и собирать весь файл в памяти — верный способ уронить процесс.
 * Контроллер пишет куски в ответ по мере готовности.
 */
@Injectable()
export class ContestExportService {
  constructor(
    @Inject(CONTEST_REPOSITORY)
    private readonly contestRepo: IContestRepository,

    @Inject(CONTEST_PARTICIPATE_REPOSITORY)
    private readonly contestParticipationRepo: IContestParticipationRepository,

    @Inject(CONTEST_WINNER_REPOSITORY)
    private readonly contestWinnerRepo: IContestWinnerRepository,
  ) {}

  async *streamParticipantsCsv(contestId: number): AsyncGenerator<string> {
    const contest = await this.contestRepo.findByParams({ id: contestId });

    if (!contest) {
      // Бросаем ДО первого yield: пока в ответ ничего не записано, Nest ещё
      // может отдать честный 404. После первого куска заголовки уже ушли.
      throw new NotFoundException('Конкурс не найден');
    }

    // Победителей единицы (призовые места плюс замены), поэтому грузим их
    // разом и держим в памяти — в отличие от участий, которые стримим
    // страницами. Статус живёт в contest_winners, а строки CSV идут по
    // участиям, так что без этой карты его было бы не показать.
    const statusByUserId = await this.loadWinnerStatuses(contestId);

    yield CSV_BOM + toCsvRow(CSV_HEADER);

    let afterId = 0;

    for (;;) {
      const page = await this.contestParticipationRepo.findPageForExport(
        contestId,
        afterId,
        EXPORT_PAGE_SIZE,
      );

      if (!page.length) return;

      for (const participation of page) {
        yield toCsvRow([
          participation.id,
          participation.userId,
          participation.user?.telegramId,
          participation.user?.username,
          participation.user?.firstName,
          participation.user?.lastName,
          participation.joinedAt,
          participation.groupId,
          participation.subscriptionStatus,
          participation.subscriptionCheckedAt,
          participation.isWinner,
          participation.prizePlace,
          participation.userId
            ? (statusByUserId.get(participation.userId) ?? '')
            : '',
        ]);
      }

      afterId = page[page.length - 1].id;

      // Страница неполная — дальше читать нечего, экономим лишний запрос.
      if (page.length < EXPORT_PAGE_SIZE) return;
    }
  }

  /** Имя файла для Content-Disposition. */
  buildFileName(contestId: number): string {
    return `contest-${contestId}-participants.csv`;
  }

  /**
   * userId → статус выдачи приза. У побывавшего победителем несколько раз
   * (отказался, потом снова попал) берём последнюю строку: она отражает
   * текущее положение дел.
   */
  private async loadWinnerStatuses(
    contestId: number,
  ): Promise<Map<number, string>> {
    const winners = await this.contestWinnerRepo.findByContestId(contestId);
    const byUserId = new Map<number, string>();

    for (const winner of winners) {
      if (winner.userId != null) {
        byUserId.set(winner.userId, winner.status);
      }
    }

    return byUserId;
  }
}
