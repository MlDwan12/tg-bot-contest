import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { In } from 'typeorm';

import { ContestsService } from './contests.service';
import { AdminService } from 'src/modules/users/services';
import { ChannelsService } from 'src/modules/channels/services';
import { ContestJobsService } from '../jobs/services';
import { TelegramService } from 'src/modules/bot/bot.service';
import { ContestWinnerService } from './contest-winner.service';
import { ContestsParticipateService } from './contest-participate.service';
import { UsersService } from 'src/modules/users/services/users.service';

import {
  CONTEST_PARTICIPATE_READ_REPOSITORY,
  CONTEST_READ_REPOSITORY,
  CONTEST_WRITE_REPOSITORY,
} from 'src/shared/commons/constants';

import {
  ContestStatus,
  PublicationStatus,
  WinnerStrategy,
} from 'src/shared/enums/contest';
import { UserRole } from 'src/shared/enums/user';
import { ChannelType } from 'src/shared/enums/channel';

describe('ContestsService.updateContest', () => {
  let service: ContestsService;

  const contestReadRepo = {
    findByIdWithRelations: jest.fn(),
    findPublishedPublicationIdsForContest: jest.fn(),
  };

  const contestWriteRepo = {
    create: jest.fn(),
    update: jest.fn(),
    setPublishChannels: jest.fn(),
    setRequiredChannels: jest.fn(),
    deletePendingPublicationsByContestId: jest.fn(),
    createPublications: jest.fn(),
    replaceWinners: jest.fn(),
  };

  const contestParticipationReadRepo = {};

  const publicationQueue = {
    add: jest.fn(),
  };

  const adminService = {
    findById: jest.fn(),
  };

  const logger = {
    log: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  };

  const channelService = {
    getChannelsByParameters: jest.fn(),
  };

  const contestJobsService = {
    scheduleContest: jest.fn(),
  };

  const telegramService = {
    checkBotChannelPermissions: jest.fn(),
    updateContestPublishedMessage: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
  };

  const contestWinnerService = {
    saveResolvedWinners: jest.fn(),
    resolveAndSaveWinners: jest.fn(),
  };

  const contestsParticipateService = {};

  const usersService = {
    findByTelegramId: jest.fn(),
  };

  const makeChannel = (id: number, telegramId: number, name: string) => ({
    id,
    telegramId,
    name,
    telegramUsername: null,
    type: ChannelType.OTHER,
  });

  const makeContestForUpdate = (overrides: Record<string, any> = {}) => ({
    id: 500,
    name: 'Old contest',
    description: 'Old description',
    imagePath: '/uploads/contests/old.png',
    buttonText: 'Old button',
    status: ContestStatus.PENDING,
    winnerStrategy: WinnerStrategy.RANDOM,
    prizePlaces: 3,
    creator: 'admin',
    creatorId: 1,
    startDate: new Date('2026-05-01T09:00:00.000Z'),
    endDate: new Date('2026-05-02T09:00:00.000Z'),
    publishChannels: [],
    requiredChannels: [],
    participants: [],
    publications: [],
    winners: [],
    createdAt: new Date('2026-04-01T09:00:00.000Z'),
    ...overrides,
  });

  beforeEach(async () => {
    jest.resetAllMocks();

    contestReadRepo.findPublishedPublicationIdsForContest.mockResolvedValue([]);

    configService.get.mockImplementation((key: string) => {
      if (key === 'MINI_APP_URL') return 'https://mini-app.test';
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContestsService,
        {
          provide: CONTEST_READ_REPOSITORY,
          useValue: contestReadRepo,
        },
        {
          provide: CONTEST_WRITE_REPOSITORY,
          useValue: contestWriteRepo,
        },
        {
          provide: CONTEST_PARTICIPATE_READ_REPOSITORY,
          useValue: contestParticipationReadRepo,
        },
        {
          provide: getQueueToken('contest-publication'),
          useValue: publicationQueue,
        },
        {
          provide: AdminService,
          useValue: adminService,
        },
        {
          provide: Logger,
          useValue: logger,
        },
        {
          provide: ChannelsService,
          useValue: channelService,
        },
        {
          provide: ContestJobsService,
          useValue: contestJobsService,
        },
        {
          provide: TelegramService,
          useValue: telegramService,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: ContestWinnerService,
          useValue: contestWinnerService,
        },
        {
          provide: ContestsParticipateService,
          useValue: contestsParticipateService,
        },
        {
          provide: UsersService,
          useValue: usersService,
        },
      ],
    }).compile();

    service = module.get<ContestsService>(ContestsService);
  });

  it('should throw NotFoundException when contest is not found', async () => {
    contestReadRepo.findByIdWithRelations.mockResolvedValue(null);

    await expect(
      service.updateContest(500, { name: 'New name' }),
    ).rejects.toThrow(NotFoundException);

    expect(contestWriteRepo.update).not.toHaveBeenCalled();
  });

  it('should throw BadRequestException when nextStartDate is not before nextEndDate', async () => {
    const contest = makeContestForUpdate();
    contestReadRepo.findByIdWithRelations.mockResolvedValue(contest);

    await expect(
      service.updateContest(500, {
        startDate: '2026-05-03T12:00:00',
        endDate: '2026-05-03T12:00:00',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(contestWriteRepo.update).not.toHaveBeenCalled();
  });

  it('should throw BadRequestException when publish channels are changed after contest started', async () => {
    const contest = makeContestForUpdate({
      status: ContestStatus.ACTIVE,
    });

    contestReadRepo.findByIdWithRelations.mockResolvedValue(contest);

    await expect(
      service.updateContest(500, {
        publishChannelIds: [1001],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should update basic fields successfully', async () => {
    const contest = makeContestForUpdate();

    const updatedContest = makeContestForUpdate({
      name: 'New contest',
      description: 'New description',
      buttonText: 'Играть',
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 5,
      status: ContestStatus.PENDING,
    });

    contestReadRepo.findByIdWithRelations
      .mockResolvedValueOnce(contest)
      .mockResolvedValueOnce(updatedContest);

    contestWriteRepo.update.mockResolvedValue(undefined);
    contestJobsService.scheduleContest.mockResolvedValue(undefined);

    const result = await service.updateContest(500, {
      name: 'New contest',
      description: 'New description',
      buttonText: 'Играть',
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 5,
      status: ContestStatus.PENDING,
    });

    expect(contestWriteRepo.update).toHaveBeenCalledWith(
      500,
      expect.objectContaining({
        name: 'New contest',
        description: 'New description',
        winnerStrategy: WinnerStrategy.MANUAL,
        prizePlaces: 5,
        buttonText: 'Играть',
        imagePath: '/uploads/contests/old.png',
      }),
    );

    expect(result).toEqual(updatedContest);
  });

  it('should keep old imagePath when image is not provided', async () => {
    const contest = makeContestForUpdate({
      imagePath: '/uploads/contests/existing.png',
    });

    const updatedContest = makeContestForUpdate({
      imagePath: '/uploads/contests/existing.png',
    });

    contestReadRepo.findByIdWithRelations
      .mockResolvedValueOnce(contest)
      .mockResolvedValueOnce(updatedContest);

    contestWriteRepo.update.mockResolvedValue(undefined);
    contestJobsService.scheduleContest.mockResolvedValue(undefined);

    await service.updateContest(500, { name: 'Updated name' });

    expect(contestWriteRepo.update).toHaveBeenCalledWith(
      500,
      expect.objectContaining({
        imagePath: '/uploads/contests/existing.png',
      }),
    );
  });

  it('should update imagePath when image is provided', async () => {
    const contest = makeContestForUpdate();
    const image = {
      filename: 'new-image.png',
    } as Express.Multer.File;

    const updatedContest = makeContestForUpdate({
      imagePath: '/uploads/contests/new-image.png',
    });

    contestReadRepo.findByIdWithRelations
      .mockResolvedValueOnce(contest)
      .mockResolvedValueOnce(updatedContest);

    contestWriteRepo.update.mockResolvedValue(undefined);
    contestJobsService.scheduleContest.mockResolvedValue(undefined);

    await service.updateContest(500, { name: 'Updated name' }, image);

    expect(contestWriteRepo.update).toHaveBeenCalledWith(
      500,
      expect.objectContaining({
        imagePath: '/uploads/contests/new-image.png',
      }),
    );
  });

  it('should throw BadRequestException when image has no filename', async () => {
    const contest = makeContestForUpdate();
    const image = {} as Express.Multer.File;

    contestReadRepo.findByIdWithRelations.mockResolvedValue(contest);

    await expect(
      service.updateContest(500, { name: 'Updated name' }, image),
    ).rejects.toThrow(BadRequestException);
  });

  it('should throw NotFoundException when publish channels are not found', async () => {
    const contest = makeContestForUpdate();

    contestReadRepo.findByIdWithRelations.mockResolvedValue(contest);

    channelService.getChannelsByParameters.mockResolvedValue([
      makeChannel(11, 1001, 'Publish 1'),
    ]);

    await expect(
      service.updateContest(500, {
        publishChannelIds: [1001, 1002],
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException when required channels are not found', async () => {
    const contest = makeContestForUpdate();

    contestReadRepo.findByIdWithRelations.mockResolvedValue(contest);

    channelService.getChannelsByParameters.mockResolvedValue([
      makeChannel(21, 2001, 'Required 1'),
    ]);

    await expect(
      service.updateContest(500, {
        requiredChannelIds: [2001, 2002],
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should update publish channels and recreate pending publications', async () => {
    const contest = makeContestForUpdate({
      status: ContestStatus.PENDING,
    });

    const updatedContest = makeContestForUpdate({
      publishChannels: [{ telegramId: 1002, telegramUsername: null }],
    });

    contestReadRepo.findByIdWithRelations
      .mockResolvedValueOnce(contest)
      .mockResolvedValueOnce(updatedContest);

    channelService.getChannelsByParameters.mockResolvedValue([
      makeChannel(12, 1002, 'Publish 2'),
    ]);

    contestWriteRepo.update.mockResolvedValue(undefined);
    contestWriteRepo.setPublishChannels.mockResolvedValue(undefined);
    contestWriteRepo.deletePendingPublicationsByContestId.mockResolvedValue(
      undefined,
    );
    contestWriteRepo.createPublications.mockResolvedValue(undefined);
    contestJobsService.scheduleContest.mockResolvedValue(undefined);

    await service.updateContest(500, {
      publishChannelIds: [1002],
    });

    expect(channelService.getChannelsByParameters).toHaveBeenCalledWith({
      telegramId: In([1002]),
    });

    expect(contestWriteRepo.setPublishChannels).toHaveBeenCalledWith(500, [12]);
    expect(
      contestWriteRepo.deletePendingPublicationsByContestId,
    ).toHaveBeenCalledWith(500);
    expect(contestWriteRepo.createPublications).toHaveBeenCalledTimes(1);
  });

  it('should update required channels', async () => {
    const contest = makeContestForUpdate();
    const updatedContest = makeContestForUpdate();

    contestReadRepo.findByIdWithRelations
      .mockResolvedValueOnce(contest)
      .mockResolvedValueOnce(updatedContest);

    channelService.getChannelsByParameters.mockResolvedValue([
      makeChannel(21, 2001, 'Required 1'),
    ]);

    contestWriteRepo.update.mockResolvedValue(undefined);
    contestWriteRepo.setRequiredChannels.mockResolvedValue(undefined);
    contestJobsService.scheduleContest.mockResolvedValue(undefined);

    await service.updateContest(500, {
      requiredChannelIds: [2001],
    });

    expect(channelService.getChannelsByParameters).toHaveBeenCalledWith({
      telegramId: In([2001]),
    });

    expect(contestWriteRepo.setRequiredChannels).toHaveBeenCalledWith(
      500,
      [21],
    );
  });

  it('should not touch publish channels when publishChannelIds is undefined', async () => {
    const contest = makeContestForUpdate();
    const updatedContest = makeContestForUpdate();

    contestReadRepo.findByIdWithRelations
      .mockResolvedValueOnce(contest)
      .mockResolvedValueOnce(updatedContest);

    contestWriteRepo.update.mockResolvedValue(undefined);
    contestJobsService.scheduleContest.mockResolvedValue(undefined);

    await service.updateContest(500, {
      name: 'Only rename',
    });

    expect(contestWriteRepo.setPublishChannels).not.toHaveBeenCalled();
    expect(
      contestWriteRepo.deletePendingPublicationsByContestId,
    ).not.toHaveBeenCalled();
    expect(contestWriteRepo.createPublications).not.toHaveBeenCalled();
  });

  it('should update winners correctly', async () => {
    const contest = makeContestForUpdate({
      prizePlaces: 3,
    });

    const updatedContest = makeContestForUpdate();

    const user1 = { id: 101, telegramId: '777', username: 'u777' };
    const user2 = { id: 102, telegramId: '555', username: 'u555' };

    contestReadRepo.findByIdWithRelations
      .mockResolvedValueOnce(contest)
      .mockResolvedValueOnce(updatedContest);

    usersService.findByTelegramId
      .mockResolvedValueOnce(user1)
      .mockResolvedValueOnce(user2);

    contestWinnerService.saveResolvedWinners.mockResolvedValue(undefined);
    contestWriteRepo.replaceWinners.mockResolvedValue(undefined);
    contestWriteRepo.update.mockResolvedValue(undefined);
    contestJobsService.scheduleContest.mockResolvedValue(undefined);

    await service.updateContest(500, {
      winners: [777, 555],
    });

    expect(usersService.findByTelegramId).toHaveBeenNthCalledWith(1, '777');
    expect(usersService.findByTelegramId).toHaveBeenNthCalledWith(2, '555');

    expect(contestWinnerService.saveResolvedWinners).toHaveBeenCalledWith(
      500,
      [user1, user2],
      3,
    );

    expect(contestWriteRepo.replaceWinners).toHaveBeenCalledWith(500, [
      { contestId: 500, userId: 101, place: 1 },
      { contestId: 500, userId: 102, place: 2 },
    ]);
  });

  it('should throw NotFoundException when some winners are not found', async () => {
    const contestId = 123;

    const user1 = {
      id: 101,
      telegramId: '111',
    } as any;

    const contest = {
      id: contestId,
      name: 'Test contest',
      description: 'desc',
      winnerStrategy: WinnerStrategy.MANUAL,
      prizePlaces: 2,
      startDate: new Date('2026-04-21T10:00:00.000Z'),
      endDate: new Date('2026-04-21T12:00:00.000Z'),
      status: ContestStatus.PENDING,
      buttonText: 'Участвовать',
      imagePath: undefined,
    } as any;

    contestReadRepo.findByIdWithRelations.mockResolvedValue(contest);

    usersService.findByTelegramId
      .mockResolvedValueOnce(user1)
      .mockResolvedValueOnce(null);

    const promise = service.updateContest(contestId, {
      winners: [111, 555],
    } as any);

    await expect(promise).rejects.toThrow(NotFoundException);
    await expect(promise).rejects.toThrow(
      'Не найдены пользователи с telegramId: 555',
    );

    expect(contestWinnerService.saveResolvedWinners).not.toHaveBeenCalled();
    expect(contestWriteRepo.replaceWinners).not.toHaveBeenCalled();
  });
  it('should use updated prizePlaces when winners are provided', async () => {
    const contest = makeContestForUpdate({
      prizePlaces: 3,
    });

    const updatedContest = makeContestForUpdate({
      prizePlaces: 5,
    });

    const user1 = { id: 101, telegramId: '777', username: 'u777' };

    contestReadRepo.findByIdWithRelations
      .mockResolvedValueOnce(contest)
      .mockResolvedValueOnce(updatedContest);

    usersService.findByTelegramId.mockResolvedValue(user1);
    contestWinnerService.saveResolvedWinners.mockResolvedValue(undefined);
    contestWriteRepo.replaceWinners.mockResolvedValue(undefined);
    contestWriteRepo.update.mockResolvedValue(undefined);
    contestJobsService.scheduleContest.mockResolvedValue(undefined);

    await service.updateContest(500, {
      winners: [777],
      prizePlaces: 5,
    });

    expect(contestWinnerService.saveResolvedWinners).toHaveBeenCalledWith(
      500,
      [user1],
      5,
    );
  });

  it('should throw when saveResolvedWinners fails', async () => {
    const contest = makeContestForUpdate();

    contestReadRepo.findByIdWithRelations.mockResolvedValue(contest);

    usersService.findByTelegramId.mockResolvedValue({
      id: 101,
      telegramId: '777',
      username: 'u777',
    });

    contestWinnerService.saveResolvedWinners.mockRejectedValue(
      new Error('saveResolvedWinners failed'),
    );

    await expect(
      service.updateContest(500, {
        winners: [777],
      }),
    ).rejects.toThrow('saveResolvedWinners failed');
  });

  it('should throw when replaceWinners fails', async () => {
    const contest = makeContestForUpdate();

    contestReadRepo.findByIdWithRelations.mockResolvedValue(contest);

    usersService.findByTelegramId.mockResolvedValue({
      id: 101,
      telegramId: '777',
      username: 'u777',
    });

    contestWinnerService.saveResolvedWinners.mockResolvedValue(undefined);
    contestWriteRepo.replaceWinners.mockRejectedValue(
      new Error('replaceWinners failed'),
    );

    await expect(
      service.updateContest(500, {
        winners: [777],
      }),
    ).rejects.toThrow('replaceWinners failed');
  });

  it('should throw NotFoundException when updated contest is not found after update', async () => {
    const contest = makeContestForUpdate();

    contestReadRepo.findByIdWithRelations
      .mockResolvedValueOnce(contest)
      .mockResolvedValueOnce(null);

    contestWriteRepo.update.mockResolvedValue(undefined);

    await expect(
      service.updateContest(500, { name: 'Updated' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should return updated contest even if scheduleContest fails', async () => {
    const contest = makeContestForUpdate();
    const updatedContest = makeContestForUpdate({
      name: 'Updated contest',
    });

    contestReadRepo.findByIdWithRelations
      .mockResolvedValueOnce(contest)
      .mockResolvedValueOnce(updatedContest);

    contestWriteRepo.update.mockResolvedValue(undefined);
    contestJobsService.scheduleContest.mockRejectedValue(
      new Error('schedule failed'),
    );

    const result = await service.updateContest(500, {
      name: 'Updated contest',
    });

    expect(result).toEqual(updatedContest);
    expect(logger.error).toHaveBeenCalled();
  });

  it('should sync published posts after update when publications exist', async () => {
    const contest = makeContestForUpdate();

    const updatedContest = makeContestForUpdate({
      publications: [
        {
          id: 1,
          chatId: 1001,
          telegramMessageId: 777,
          payload: {
            buttonUrl: 'https://mini-app.test?startapp=1001_500',
            buttonText: 'Участвовать',
          },
        },
      ],
      participants: [],
      imagePath: '/uploads/contests/updated.png',
      name: 'Updated contest',
      description: 'Updated description',
      buttonText: 'Играть',
    });

    contestReadRepo.findByIdWithRelations
      .mockResolvedValueOnce(contest)
      .mockResolvedValueOnce(updatedContest);

    contestReadRepo.findPublishedPublicationIdsForContest.mockResolvedValue([
      {
        id: 1,
        chatId: 1001,
        telegramMessageId: 777,
      },
    ]);

    contestWriteRepo.update.mockResolvedValue(undefined);
    contestJobsService.scheduleContest.mockResolvedValue(undefined);
    telegramService.updateContestPublishedMessage.mockResolvedValue(undefined);

    await service.updateContest(500, {
      name: 'Updated contest',
      description: 'Updated description',
      buttonText: 'Играть',
    });

    expect(telegramService.updateContestPublishedMessage).toHaveBeenCalledTimes(
      1,
    );
  });
});
