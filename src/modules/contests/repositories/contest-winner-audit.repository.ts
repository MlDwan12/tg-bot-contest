import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ContestWinnerAudit } from '../entities';

/**
 * Репозиторий провенанса победителей. Запись — только вставка (append-only),
 * след розыгрыша неизменяем. Чтение появилось для автодобора: очередь замен
 * восстанавливается из seed и пула той же записи, что определила победителей,
 * поэтому отдельно хранить её не нужно.
 */
@Injectable()
export class ContestWinnerAuditRepository {
  constructor(
    @InjectRepository(ContestWinnerAudit)
    private readonly repo: Repository<ContestWinnerAudit>,
  ) {}

  async record(data: {
    contestId: number;
    strategy: string;
    prizePlaces: number;
    winnerUserIds: number[];
    seed?: string | null;
    algorithm?: string | null;
    participantUserIds?: number[] | null;
    assignedByUserId?: number | null;
    note?: string | null;
  }): Promise<void> {
    await this.repo.insert({
      seed: null,
      algorithm: null,
      participantUserIds: null,
      assignedByUserId: null,
      note: null,
      ...data,
    });
  }

  /**
   * Запись исходного розыгрыша — та, где есть seed и пул. Замены пишутся
   * отдельными строками и seed не несут, поэтому берём самую раннюю запись с
   * seed: именно она задаёт порядок жеребьёвки, из которого идёт автодобор.
   */
  async findDrawByContestId(
    contestId: number,
  ): Promise<ContestWinnerAudit | null> {
    return this.repo.findOne({
      where: { contestId, seed: Not(IsNull()) },
      order: { id: 'ASC' },
    });
  }
}
