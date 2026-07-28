import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { CONTEST_REPOSITORY } from 'src/common/constants';
import type { IContestRepository } from '../interfaces';
import { ContestWinnerService } from './contest-winner.service';
import { buildWinnerNotificationText } from './contest-winner-message.util';

/**
 * Уведомление намеренно текстовое, без картинки конкурса: sendMailingMessage
 * перезаливает файл на КАЖДОГО получателя (file_id мы не храним), а отсутствие
 * файла на диске роняет отправку. Победитель картинку уже видел в посте.
 */
export interface WinnerNotifyJobData {
  contestId: number;
  userId: number;
  telegramId: string;
  text: string;
}

/**
 * Постановка личных уведомлений победителям. Отправку делает процессор
 * очереди contest-winner-notify — здесь только выборка и enqueue.
 */
@Injectable()
export class ContestWinnerNotifyService {
  constructor(
    @Inject(CONTEST_REPOSITORY)
    private readonly contestRepo: IContestRepository,

    @InjectQueue('contest-winner-notify')
    private readonly notifyQueue: Queue,

    private readonly contestWinnerService: ContestWinnerService,
    private readonly logger: Logger,
  ) {}

  /**
   * Ставит по джобу на каждого победителя, которому есть куда писать.
   *
   * Пропускаются двое: фиктивный победитель (ник без TG-аккаунта — адресата
   * попросту нет) и реальный без telegramId. Обоих считаем и логируем, чтобы
   * расхождение «победителей N, уведомлений M» было объяснимым.
   *
   * Идемпотентность — по jobId вида contest:<id>:winner:<userId>: повторный
   * вызов (ретрай завершения, двойной клик) не поставит второй джоб. Вторая
   * линия защиты — проверка уже отправленного в самом процессоре.
   */
  async enqueueWinnerNotifications(contestId: number): Promise<{
    queued: number;
    skipped: number;
  }> {
    const contest = await this.contestRepo.findByParams({ id: contestId });

    if (!contest) {
      this.logger.warn(
        { contestId },
        'enqueueWinnerNotifications: конкурс не найден, уведомления не ставим',
      );
      return { queued: 0, skipped: 0 };
    }

    const winners =
      await this.contestWinnerService.getContestWinners(contestId);

    const jobs: Array<{
      name: string;
      data: WinnerNotifyJobData;
      opts: object;
    }> = [];
    let skipped = 0;

    for (const winner of winners) {
      const telegramId = winner.user?.telegramId;

      if (winner.userId == null || !telegramId) {
        skipped++;
        continue;
      }

      jobs.push({
        name: 'notify-winner',
        data: {
          contestId,
          userId: winner.userId,
          telegramId: String(telegramId),
          text: buildWinnerNotificationText({
            contestName: contest.name,
            place: winner.place,
          }),
        },
        opts: { jobId: `contest:${contestId}:winner:${winner.userId}` },
      });
    }

    if (jobs.length) {
      await this.notifyQueue.addBulk(jobs);
    }

    this.logger.log(
      { contestId, winners: winners.length, queued: jobs.length, skipped },
      'enqueueWinnerNotifications: уведомления победителей поставлены в очередь',
    );

    return { queued: jobs.length, skipped };
  }
}
