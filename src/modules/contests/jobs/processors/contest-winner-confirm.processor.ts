import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { jobMeta } from 'src/common/helpers/job-meta.helper';
import {
  BOT_MESSAGE_REPOSITORY,
  CONTEST_WINNER_REPOSITORY,
} from 'src/common/constants';
import type {
  IBotMessageRepository,
  IContestWinnerRepository,
} from '../../interfaces';
import { BotMessageType } from 'src/common/enums/bot';
import { TelegramService } from 'src/modules/bot/bot.service';
import { ContestWinnerStatus } from 'src/common/enums/contest';
import { ContestWinnerReplacementService } from '../../services/contest-winner-replacement.service';
import { ContestWinnerNotifyService } from '../../services/contest-winner-notify.service';
import {
  ConfirmationDeadlineJobData,
  PlaceVacatedJobData,
  PLACE_VACATED_JOB,
} from '../contest-winner-confirm.jobs';

/**
 * Истёк срок подтверждения приза → место освобождается и уходит следующему по
 * жеребьёвке. Джоб ставится отложенным на дедлайн при уведомлении победителя.
 */
@Processor('contest-winner-confirm')
export class ContestWinnerConfirmProcessor extends WorkerHost {
  constructor(
    @Inject(CONTEST_WINNER_REPOSITORY)
    private readonly contestWinnerRepo: IContestWinnerRepository,

    @Inject(BOT_MESSAGE_REPOSITORY)
    private readonly botMessageRepo: IBotMessageRepository,

    private readonly telegramService: TelegramService,
    private readonly replacementService: ContestWinnerReplacementService,
    private readonly notifyService: ContestWinnerNotifyService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(
    job: Job<ConfirmationDeadlineJobData | PlaceVacatedJobData>,
  ): Promise<void> {
    if (job.name === PLACE_VACATED_JOB) {
      const { contestId, place } = job.data as PlaceVacatedJobData;
      await this.replaceWinner(contestId, place);
      return;
    }

    await this.handleDeadline(job as Job<ConfirmationDeadlineJobData>);
  }

  private async handleDeadline(
    job: Job<ConfirmationDeadlineJobData>,
  ): Promise<void> {
    const { contestId, winnerId, place } = job.data;

    // Условный UPDATE вместо «прочитали статус → записали»: победитель мог
    // нажать кнопку ровно сейчас. Кто первый — тот и решил; false означает,
    // что решение уже принято и просрочки не было.
    const expired = await this.contestWinnerRepo.resolveConfirmation(
      winnerId,
      ContestWinnerStatus.EXPIRED,
      null,
    );

    if (!expired) {
      this.logger.debug(
        { ...jobMeta(job), contestId, winnerId },
        'confirmation-deadline: решение уже принято, автодобор не нужен',
      );
      return;
    }

    this.logger.log(
      { ...jobMeta(job), contestId, winnerId, place },
      'confirmation-deadline: срок истёк, место освобождено',
    );

    // Кнопки под старым уведомлением больше ничего не делают — снимаем их
    // сразу, не дожидаясь, пока человек ткнёт и не поймёт, почему тишина.
    await this.disableConfirmationButtons(winnerId);

    await this.replaceWinner(contestId, place);
  }

  /**
   * Снимает кнопки у уведомления просроченного победителя. Побочный шаг:
   * его сбой не должен мешать автодобору — место уже освобождено.
   */
  private async disableConfirmationButtons(winnerId: number): Promise<void> {
    try {
      const winner = await this.contestWinnerRepo.findById(winnerId);

      if (!winner?.userId) return;

      const sent = await this.botMessageRepo.findSentMessage({
        contestId: winner.contestId,
        userId: winner.userId,
        type: BotMessageType.CONTEST_WINNER,
      });

      if (!sent) return;

      await this.telegramService.removeInlineKeyboard(
        sent.chatId,
        sent.telegramMessageId,
      );
    } catch (error) {
      this.logger.warn(
        { err: error, winnerId },
        'confirmation-deadline: не удалось снять кнопки у просроченного уведомления',
      );
    }
  }

  /**
   * Замена — отдельный шаг после освобождения места. Её сбой не должен
   * возвращать место истёкшему победителю: EXPIRED уже проставлен, а ретрай
   * джоба (attempts=3) повторит именно добор.
   */
  private async replaceWinner(contestId: number, place: number): Promise<void> {
    const result = await this.replacementService.fillVacatedPlace(
      contestId,
      place,
    );

    if (result.status === 'replaced') {
      await this.notifyService.enqueueWinnerNotification(
        contestId,
        result.winnerId,
      );
      // Замена сама ждёт подтверждения, так что итог ещё не наступил — метод
      // это проверит и промолчит. Зовём безусловно, чтобы не держать знание
      // «когда наступает финал» в двух местах.
      await this.notifyService.enqueueFinalSummaryIfSettled(contestId);
      return;
    }

    if (result.status === 'no_candidates') {
      // Место закрыть некем — это должен увидеть человек, иначе приз просто
      // потеряется в тишине.
      await this.notifyService.notifyAdminsAboutUnfilledPlace(contestId, place);
    }

    await this.notifyService.enqueueFinalSummaryIfSettled(contestId);
  }
}
