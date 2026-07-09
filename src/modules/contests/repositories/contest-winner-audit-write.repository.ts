import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContestWinnerAudit } from '../entities';

/**
 * Пишущий репозиторий провенанса победителей. Только вставка (append-only) —
 * след розыгрыша/назначения неизменяем.
 */
@Injectable()
export class ContestWinnerAuditWriteRepository {
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
}
