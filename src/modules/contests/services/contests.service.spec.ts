import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { In } from 'typeorm';
import { Logger } from 'nestjs-pino';

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
import { CreateContest } from 'src/shared/types/contests';

describe('ContestsService.createContest', () => {
  let service: ContestsService;

  const contestReadRepo = {
    findByIdWithRelations: jest.fn(),
  };

  const contestWriteRepo = {
    create: jest.fn(),
    setPublishChannels: jest.fn(),
    setRequiredChannels: jest.fn(),
    deletePendingPublicationsByContestId: jest.fn(),
    createPublications: jest.fn(),
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

  const makeDto = (overrides: Partial<CreateContest> = {}): CreateContest => ({
    name: 'Test contest',
    description: 'Test description',
    winnerStrategy: WinnerStrategy.RANDOM,
    prizePlaces: 3,
    startDate: '2026-05-01T12:00:00',
    endDate: '2026-05-02T12:00:00',
    creatorId: 1,
    publishChannelIds: [1001, 1002],
    requiredChannelIds: [2001],
    buttonText: 'Участвовать',
    ...overrides,
  });

  const makeChannel = (id: number, telegramId: number, name: string) => ({
    id,
    telegramId,
    name,
    telegramUsername: null,
    type: ChannelType.OTHER,
  });

  beforeEach(async () => {
    jest.resetAllMocks();

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

  it('should create contest successfully without image', async () => {
    const dto = makeDto();

    const creator = {
      id: 1,
      role: UserRole.ADMIN,
      login: 'admin',
    };

    const publishChannels = [
      makeChannel(11, 1001, 'Publish 1'),
      makeChannel(12, 1002, 'Publish 2'),
    ];

    const requiredChannels = [makeChannel(21, 2001, 'Required 1')];

    const createdContest = {
      id: 999,
      name: dto.name,
      description: dto.description,
      winnerStrategy: dto.winnerStrategy,
      prizePlaces: dto.prizePlaces,
      startDate: new Date('2026-05-01T09:00:00.000Z'),
      endDate: new Date('2026-05-02T09:00:00.000Z'),
      status: ContestStatus.PENDING,
      creatorId: dto.creatorId,
      imagePath: undefined,
      buttonText: dto.buttonText,
    };

    const finalContest = {
      ...createdContest,
      publishChannels,
      requiredChannels,
    };

    adminService.findById.mockResolvedValue(creator);

    channelService.getChannelsByParameters
      .mockResolvedValueOnce(publishChannels)
      .mockResolvedValueOnce(requiredChannels);

    telegramService.checkBotChannelPermissions.mockResolvedValue({
      exists: true,
      isAdmin: true,
      canPost: true,
      canEdit: true,
    });

    contestWriteRepo.create.mockResolvedValue(createdContest);
    contestWriteRepo.setPublishChannels.mockResolvedValue(undefined);
    contestWriteRepo.setRequiredChannels.mockResolvedValue(undefined);
    contestWriteRepo.deletePendingPublicationsByContestId.mockResolvedValue(
      undefined,
    );
    contestWriteRepo.createPublications.mockResolvedValue(undefined);
    contestJobsService.scheduleContest.mockResolvedValue(undefined);
    contestReadRepo.findByIdWithRelations.mockResolvedValue(finalContest);

    const result = await service.createContest(dto);

    expect(adminService.findById).toHaveBeenCalledWith(dto.creatorId);

    expect(channelService.getChannelsByParameters).toHaveBeenNthCalledWith(1, {
      telegramId: In(dto.publishChannelIds),
    });

    expect(channelService.getChannelsByParameters).toHaveBeenNthCalledWith(2, {
      telegramId: In(dto.requiredChannelIds),
    });

    expect(telegramService.checkBotChannelPermissions).toHaveBeenCalledTimes(2);
    expect(telegramService.checkBotChannelPermissions).toHaveBeenNthCalledWith(
      1,
      1001,
    );
    expect(telegramService.checkBotChannelPermissions).toHaveBeenNthCalledWith(
      2,
      1002,
    );

    expect(contestWriteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: dto.name,
        description: dto.description,
        winnerStrategy: dto.winnerStrategy,
        prizePlaces: dto.prizePlaces,
        creatorId: dto.creatorId,
        status: ContestStatus.PENDING,
        imagePath: undefined,
        buttonText: dto.buttonText,
      }),
    );

    expect(contestWriteRepo.setPublishChannels).toHaveBeenCalledWith(
      999,
      [11, 12],
    );
    expect(contestWriteRepo.setRequiredChannels).toHaveBeenCalledWith(
      999,
      [21],
    );

    expect(
      contestWriteRepo.deletePendingPublicationsByContestId,
    ).toHaveBeenCalledWith(999);
    expect(contestWriteRepo.createPublications).toHaveBeenCalledTimes(1);

    expect(contestJobsService.scheduleContest).toHaveBeenCalledWith(
      999,
      createdContest.startDate,
      createdContest.endDate,
    );

    expect(contestReadRepo.findByIdWithRelations).toHaveBeenCalledWith(999);
    expect(result).toEqual(finalContest);
  });

  it('should create contest successfully with image', async () => {
    const dto = makeDto({
      publishChannelIds: [1001],
      requiredChannelIds: [],
    });

    const image = {
      filename: 'contest-image.png',
    } as Express.Multer.File;

    const creator = {
      id: 1,
      role: UserRole.ADMIN,
      login: 'admin',
    };

    const publishChannels = [makeChannel(11, 1001, 'Publish 1')];

    const createdContest = {
      id: 1000,
      name: dto.name,
      description: dto.description,
      winnerStrategy: dto.winnerStrategy,
      prizePlaces: dto.prizePlaces,
      startDate: new Date('2026-05-01T09:00:00.000Z'),
      endDate: new Date('2026-05-02T09:00:00.000Z'),
      status: ContestStatus.PENDING,
      creatorId: dto.creatorId,
      imagePath: '/uploads/contests/contest-image.png',
      buttonText: dto.buttonText,
    };

    adminService.findById.mockResolvedValue(creator);

    channelService.getChannelsByParameters
      .mockResolvedValueOnce(publishChannels)
      .mockResolvedValueOnce([]);

    telegramService.checkBotChannelPermissions.mockResolvedValue({
      exists: true,
      isAdmin: true,
      canPost: true,
      canEdit: true,
    });

    contestWriteRepo.create.mockResolvedValue(createdContest);
    contestWriteRepo.setPublishChannels.mockResolvedValue(undefined);
    contestWriteRepo.setRequiredChannels.mockResolvedValue(undefined);
    contestWriteRepo.deletePendingPublicationsByContestId.mockResolvedValue(
      undefined,
    );
    contestWriteRepo.createPublications.mockResolvedValue(undefined);
    contestJobsService.scheduleContest.mockResolvedValue(undefined);
    contestReadRepo.findByIdWithRelations.mockResolvedValue(createdContest);

    await service.createContest(dto, image);

    expect(contestWriteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        imagePath: '/uploads/contests/contest-image.png',
      }),
    );
  });

  it('should use default buttonText when it is not provided', async () => {
    const dto = makeDto({
      buttonText: undefined,
      publishChannelIds: [],
      requiredChannelIds: [],
    });

    adminService.findById.mockResolvedValue({
      id: 1,
      role: UserRole.ADMIN,
    });

    contestWriteRepo.create.mockResolvedValue({
      id: 1,
      startDate: new Date('2026-05-01T09:00:00.000Z'),
      endDate: new Date('2026-05-02T09:00:00.000Z'),
    });

    contestWriteRepo.setPublishChannels.mockResolvedValue(undefined);
    contestWriteRepo.setRequiredChannels.mockResolvedValue(undefined);
    contestWriteRepo.deletePendingPublicationsByContestId.mockResolvedValue(
      undefined,
    );
    contestJobsService.scheduleContest.mockResolvedValue(undefined);
    contestReadRepo.findByIdWithRelations.mockResolvedValue({ id: 1 });

    const result = await service.createContest(dto);

    expect(contestWriteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        buttonText: 'Участвовать',
      }),
    );

    expect(result).toEqual({ id: 1 });
  });

  it('should throw BadRequestException when startDate is not before endDate', async () => {
    const dto = makeDto({
      startDate: '2026-05-02T12:00:00',
      endDate: '2026-05-02T12:00:00',
    });

    await expect(service.createContest(dto)).rejects.toThrow(
      BadRequestException,
    );

    expect(adminService.findById).not.toHaveBeenCalled();
    expect(contestWriteRepo.create).not.toHaveBeenCalled();
  });

  it('should throw NotFoundException when creator is not found', async () => {
    const dto = makeDto();

    adminService.findById.mockResolvedValue(null);

    await expect(service.createContest(dto)).rejects.toThrow(NotFoundException);

    expect(channelService.getChannelsByParameters).not.toHaveBeenCalled();
    expect(contestWriteRepo.create).not.toHaveBeenCalled();
  });

  it('should throw NotFoundException when publish channels are not fully found', async () => {
    const dto = makeDto({
      publishChannelIds: [1001, 1002],
      requiredChannelIds: [],
    });

    adminService.findById.mockResolvedValue({
      id: 1,
      role: UserRole.ADMIN,
    });

    channelService.getChannelsByParameters.mockResolvedValue([
      makeChannel(11, 1001, 'Publish 1'),
    ]);

    await expect(service.createContest(dto)).rejects.toThrow(NotFoundException);

    expect(contestWriteRepo.create).not.toHaveBeenCalled();
  });

  it('should throw BadRequestException when bot has no permissions in publish channel', async () => {
    const dto = makeDto({
      publishChannelIds: [1001],
      requiredChannelIds: [],
    });

    adminService.findById.mockResolvedValue({
      id: 1,
      role: UserRole.ADMIN,
    });

    channelService.getChannelsByParameters
      .mockResolvedValueOnce([makeChannel(11, 1001, 'Publish 1')])
      .mockResolvedValueOnce([]);

    telegramService.checkBotChannelPermissions.mockResolvedValue({
      exists: true,
      isAdmin: true,
      canPost: false,
      canEdit: true,
    });

    await expect(service.createContest(dto)).rejects.toThrow(
      BadRequestException,
    );

    expect(contestWriteRepo.create).not.toHaveBeenCalled();
  });

  it('should rethrow repository create error', async () => {
    const dto = makeDto({
      publishChannelIds: [],
      requiredChannelIds: [],
    });

    adminService.findById.mockResolvedValue({
      id: 1,
      role: UserRole.ADMIN,
    });

    const dbError = new Error('DB create failed');
    contestWriteRepo.create.mockRejectedValue(dbError);

    await expect(service.createContest(dto)).rejects.toThrow(
      'DB create failed',
    );

    expect(logger.error).toHaveBeenCalled();
  });

  it('should throw NotFoundException when required channels are not fully found', async () => {
    const dto = makeDto({
      publishChannelIds: [],
      requiredChannelIds: [2001, 2002],
    });

    adminService.findById.mockResolvedValue({
      id: 1,
      role: UserRole.ADMIN,
    });

    channelService.getChannelsByParameters
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeChannel(21, 2001, 'Required 1')]);

    await expect(service.createContest(dto)).rejects.toThrow(NotFoundException);

    expect(contestWriteRepo.create).not.toHaveBeenCalled();
  });

  it('should create contest when publishChannelIds is empty', async () => {
    const dto = makeDto({
      publishChannelIds: [],
      requiredChannelIds: [2001],
    });

    adminService.findById.mockResolvedValue({
      id: 1,
      role: UserRole.ADMIN,
    });

    channelService.getChannelsByParameters.mockResolvedValueOnce([
      makeChannel(21, 2001, 'Required 1'),
    ]);

    const createdContest = {
      id: 10,
      startDate: new Date('2026-05-01T09:00:00.000Z'),
      endDate: new Date('2026-05-02T09:00:00.000Z'),
    };

    contestWriteRepo.create.mockResolvedValue(createdContest);
    contestWriteRepo.setPublishChannels.mockResolvedValue(undefined);
    contestWriteRepo.setRequiredChannels.mockResolvedValue(undefined);
    contestWriteRepo.deletePendingPublicationsByContestId.mockResolvedValue(
      undefined,
    );
    contestJobsService.scheduleContest.mockResolvedValue(undefined);
    contestReadRepo.findByIdWithRelations.mockResolvedValue({ id: 10 });

    await service.createContest(dto);

    expect(channelService.getChannelsByParameters).toHaveBeenCalledTimes(1);
    expect(contestWriteRepo.setPublishChannels).toHaveBeenCalledWith(10, []);
    expect(contestWriteRepo.setRequiredChannels).toHaveBeenCalledWith(10, [21]);
    expect(telegramService.checkBotChannelPermissions).not.toHaveBeenCalled();
    expect(contestWriteRepo.createPublications).not.toHaveBeenCalled();
  });

  it('should create contest when requiredChannelIds is empty', async () => {
    const dto = makeDto({
      publishChannelIds: [1001],
      requiredChannelIds: [],
    });

    adminService.findById.mockResolvedValue({
      id: 1,
      role: UserRole.ADMIN,
    });

    channelService.getChannelsByParameters
      .mockResolvedValueOnce([makeChannel(11, 1001, 'Publish 1')]) // publish
      .mockResolvedValueOnce([]); // required

    telegramService.checkBotChannelPermissions.mockResolvedValue({
      exists: true,
      isAdmin: true,
      canPost: true,
      canEdit: true,
    });

    const createdContest = {
      id: 11,
      startDate: new Date('2026-05-01T09:00:00.000Z'),
      endDate: new Date('2026-05-02T09:00:00.000Z'),
    };

    contestWriteRepo.create.mockResolvedValue(createdContest);
    contestWriteRepo.setPublishChannels.mockResolvedValue(undefined);
    contestWriteRepo.setRequiredChannels.mockResolvedValue(undefined);
    contestWriteRepo.deletePendingPublicationsByContestId.mockResolvedValue(
      undefined,
    );
    contestWriteRepo.createPublications.mockResolvedValue(undefined);
    contestJobsService.scheduleContest.mockResolvedValue(undefined);
    contestReadRepo.findByIdWithRelations.mockResolvedValue({ id: 11 });

    await service.createContest(dto);

    expect(contestWriteRepo.setPublishChannels).toHaveBeenCalledWith(11, [11]);
    expect(contestWriteRepo.setRequiredChannels).toHaveBeenCalledWith(11, []);
  });

  it('should preserve requested order of publish channels', async () => {
    const dto = makeDto({
      publishChannelIds: [1002, 1001],
      requiredChannelIds: [],
    });

    adminService.findById.mockResolvedValue({
      id: 1,
      role: UserRole.ADMIN,
    });

    channelService.getChannelsByParameters
      .mockResolvedValueOnce([
        makeChannel(11, 1001, 'Publish 1'),
        makeChannel(12, 1002, 'Publish 2'),
      ])
      .mockResolvedValueOnce([]);

    telegramService.checkBotChannelPermissions.mockResolvedValue({
      exists: true,
      isAdmin: true,
      canPost: true,
      canEdit: true,
    });

    const createdContest = {
      id: 12,
      startDate: new Date('2026-05-01T09:00:00.000Z'),
      endDate: new Date('2026-05-02T09:00:00.000Z'),
    };

    contestWriteRepo.create.mockResolvedValue(createdContest);
    contestWriteRepo.setPublishChannels.mockResolvedValue(undefined);
    contestWriteRepo.setRequiredChannels.mockResolvedValue(undefined);
    contestWriteRepo.deletePendingPublicationsByContestId.mockResolvedValue(
      undefined,
    );
    contestWriteRepo.createPublications.mockResolvedValue(undefined);
    contestJobsService.scheduleContest.mockResolvedValue(undefined);
    contestReadRepo.findByIdWithRelations.mockResolvedValue({ id: 12 });

    await service.createContest(dto);

    expect(contestWriteRepo.setPublishChannels).toHaveBeenCalledWith(
      12,
      [12, 11],
    );
  });

  it('should throw BadRequestException when bot is not found in channel', async () => {
    const dto = makeDto({
      publishChannelIds: [1001],
      requiredChannelIds: [],
    });

    adminService.findById.mockResolvedValue({
      id: 1,
      role: UserRole.ADMIN,
    });

    channelService.getChannelsByParameters
      .mockResolvedValueOnce([makeChannel(11, 1001, 'Publish 1')])
      .mockResolvedValueOnce([]);

    telegramService.checkBotChannelPermissions.mockResolvedValue({
      exists: false,
      isAdmin: false,
      canPost: false,
      canEdit: false,
    });

    await expect(service.createContest(dto)).rejects.toThrow(
      BadRequestException,
    );
  });
  it('should throw BadRequestException when bot is not admin in channel', async () => {
    const dto = makeDto({
      publishChannelIds: [1001],
      requiredChannelIds: [],
    });

    adminService.findById.mockResolvedValue({ id: 1, role: UserRole.ADMIN });

    channelService.getChannelsByParameters
      .mockResolvedValueOnce([makeChannel(11, 1001, 'Publish 1')])
      .mockResolvedValueOnce([]);

    telegramService.checkBotChannelPermissions.mockResolvedValue({
      exists: true,
      isAdmin: false,
      canPost: true,
      canEdit: true,
    });

    await expect(service.createContest(dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should throw BadRequestException when bot cannot edit in channel', async () => {
    const dto = makeDto({
      publishChannelIds: [1001],
      requiredChannelIds: [],
    });

    adminService.findById.mockResolvedValue({
      id: 1,
      role: UserRole.ADMIN,
    });

    channelService.getChannelsByParameters
      .mockResolvedValueOnce([makeChannel(11, 1001, 'Publish 1')])
      .mockResolvedValueOnce([]);

    telegramService.checkBotChannelPermissions.mockResolvedValue({
      exists: true,
      isAdmin: true,
      canPost: true,
      canEdit: false,
    });

    await expect(service.createContest(dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should aggregate permission errors from multiple publish channels', async () => {
    const dto = makeDto({
      publishChannelIds: [1001, 1002],
      requiredChannelIds: [],
    });

    adminService.findById.mockResolvedValue({
      id: 1,
      role: UserRole.ADMIN,
    });

    channelService.getChannelsByParameters
      .mockResolvedValueOnce([
        makeChannel(11, 1001, 'Publish 1'),
        makeChannel(12, 1002, 'Publish 2'),
      ])
      .mockResolvedValueOnce([]);

    telegramService.checkBotChannelPermissions
      .mockResolvedValueOnce({
        exists: true,
        isAdmin: false,
        canPost: true,
        canEdit: true,
      })
      .mockResolvedValueOnce({
        exists: true,
        isAdmin: true,
        canPost: false,
        canEdit: false,
      });

    try {
      await service.createContest(dto);
      fail('Expected createContest to throw');
    } catch (error: any) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toContain('Бот не администратор канала');
      expect(error.message).toContain('Нет права на публикацию');
      expect(error.message).toContain('Нет права на редактирование');
    }
  });
  it('should throw BadRequestException when image has no filename', async () => {
    const dto = makeDto({
      publishChannelIds: [],
      requiredChannelIds: [],
    });

    const image = {} as Express.Multer.File;

    adminService.findById.mockResolvedValue({ id: 1, role: UserRole.ADMIN });

    await expect(service.createContest(dto, image)).rejects.toThrow(
      BadRequestException,
    );

    expect(contestWriteRepo.create).not.toHaveBeenCalled();
  });

  it('should rethrow error when setPublishChannels fails', async () => {
    const dto = makeDto({
      publishChannelIds: [1001],
      requiredChannelIds: [],
    });

    adminService.findById.mockResolvedValue({ id: 1, role: UserRole.ADMIN });

    channelService.getChannelsByParameters
      .mockResolvedValueOnce([makeChannel(11, 1001, 'Publish 1')])
      .mockResolvedValueOnce([]);

    telegramService.checkBotChannelPermissions.mockResolvedValue({
      exists: true,
      isAdmin: true,
      canPost: true,
      canEdit: true,
    });

    const createdContest = {
      id: 13,
      startDate: new Date('2026-05-01T09:00:00.000Z'),
      endDate: new Date('2026-05-02T09:00:00.000Z'),
    };

    contestWriteRepo.create.mockResolvedValue(createdContest);
    contestWriteRepo.setPublishChannels.mockRejectedValue(
      new Error('setPublishChannels failed'),
    );

    await expect(service.createContest(dto)).rejects.toThrow(
      'setPublishChannels failed',
    );
  });

  it('should rethrow error when setRequiredChannels fails', async () => {
    const dto = makeDto({
      publishChannelIds: [],
      requiredChannelIds: [2001],
    });

    adminService.findById.mockResolvedValue({
      id: 1,
      role: UserRole.ADMIN,
    });

    channelService.getChannelsByParameters.mockResolvedValueOnce([
      makeChannel(21, 2001, 'Required 1'),
    ]);

    const createdContest = {
      id: 14,
      startDate: new Date('2026-05-01T09:00:00.000Z'),
      endDate: new Date('2026-05-02T09:00:00.000Z'),
    };

    contestWriteRepo.create.mockResolvedValue(createdContest);
    contestWriteRepo.setPublishChannels.mockResolvedValue(undefined);
    contestWriteRepo.setRequiredChannels.mockRejectedValue(
      new Error('setRequiredChannels failed'),
    );

    await expect(service.createContest(dto)).rejects.toThrow(
      'setRequiredChannels failed',
    );
  });
  it('should rethrow error when createPublications fails', async () => {
    const dto = makeDto({
      publishChannelIds: [1001],
      requiredChannelIds: [],
    });

    adminService.findById.mockResolvedValue({ id: 1, role: UserRole.ADMIN });

    channelService.getChannelsByParameters
      .mockResolvedValueOnce([makeChannel(11, 1001, 'Publish 1')])
      .mockResolvedValueOnce([]);

    telegramService.checkBotChannelPermissions.mockResolvedValue({
      exists: true,
      isAdmin: true,
      canPost: true,
      canEdit: true,
    });

    const createdContest = {
      id: 15,
      startDate: new Date('2026-05-01T09:00:00.000Z'),
      endDate: new Date('2026-05-02T09:00:00.000Z'),
    };

    contestWriteRepo.create.mockResolvedValue(createdContest);
    contestWriteRepo.setPublishChannels.mockResolvedValue(undefined);
    contestWriteRepo.setRequiredChannels.mockResolvedValue(undefined);
    contestWriteRepo.deletePendingPublicationsByContestId.mockResolvedValue(
      undefined,
    );
    contestWriteRepo.createPublications.mockRejectedValue(
      new Error('createPublications failed'),
    );

    await expect(service.createContest(dto)).rejects.toThrow(
      'createPublications failed',
    );
  });

  it('should rethrow error when scheduleContest fails', async () => {
    const dto = makeDto({
      publishChannelIds: [],
      requiredChannelIds: [],
    });

    adminService.findById.mockResolvedValue({ id: 1, role: UserRole.ADMIN });

    const createdContest = {
      id: 16,
      startDate: new Date('2026-05-01T09:00:00.000Z'),
      endDate: new Date('2026-05-02T09:00:00.000Z'),
    };

    contestWriteRepo.create.mockResolvedValue(createdContest);
    contestWriteRepo.setPublishChannels.mockResolvedValue(undefined);
    contestWriteRepo.setRequiredChannels.mockResolvedValue(undefined);
    contestWriteRepo.deletePendingPublicationsByContestId.mockResolvedValue(
      undefined,
    );
    contestJobsService.scheduleContest.mockRejectedValue(
      new Error('schedule failed'),
    );

    await expect(service.createContest(dto)).rejects.toThrow('schedule failed');
  });

  it('should create correct publication payloads', async () => {
    const dto = makeDto({
      publishChannelIds: [1001],
      requiredChannelIds: [],
      buttonText: 'Играть',
    });

    adminService.findById.mockResolvedValue({
      id: 1,
      role: UserRole.ADMIN,
    });

    channelService.getChannelsByParameters
      .mockResolvedValueOnce([makeChannel(11, 1001, 'Publish 1')])
      .mockResolvedValueOnce([]);

    telegramService.checkBotChannelPermissions.mockResolvedValue({
      exists: true,
      isAdmin: true,
      canPost: true,
      canEdit: true,
    });

    const createdContest = {
      id: 17,
      startDate: new Date('2026-05-01T09:00:00.000Z'),
      endDate: new Date('2026-05-02T09:00:00.000Z'),
    };

    contestWriteRepo.create.mockResolvedValue(createdContest);
    contestWriteRepo.setPublishChannels.mockResolvedValue(undefined);
    contestWriteRepo.setRequiredChannels.mockResolvedValue(undefined);
    contestWriteRepo.deletePendingPublicationsByContestId.mockResolvedValue(
      undefined,
    );
    contestWriteRepo.createPublications.mockResolvedValue(undefined);
    contestJobsService.scheduleContest.mockResolvedValue(undefined);
    contestReadRepo.findByIdWithRelations.mockResolvedValue({ id: 17 });

    await service.createContest(dto);

    expect(contestWriteRepo.createPublications).toHaveBeenCalledWith([
      expect.objectContaining({
        contestId: 17,
        channelId: 11,
        chatId: 1001,
        status: PublicationStatus.PENDING,
        payload: expect.objectContaining({
          text: `${dto.name}\n\n${dto.description}`,
          buttonText: 'Играть',
          buttonUrl: 'https://mini-app.test?startapp=1001_17',
        }),
      }),
    ]);
  });

  it('should propagate error when final findByIdWithRelations fails', async () => {
    const dto = makeDto({
      publishChannelIds: [],
      requiredChannelIds: [],
    });

    adminService.findById.mockResolvedValue({ id: 1, role: UserRole.ADMIN });

    const createdContest = {
      id: 18,
      startDate: new Date('2026-05-01T09:00:00.000Z'),
      endDate: new Date('2026-05-02T09:00:00.000Z'),
    };

    contestWriteRepo.create.mockResolvedValue(createdContest);
    contestWriteRepo.setPublishChannels.mockResolvedValue(undefined);
    contestWriteRepo.setRequiredChannels.mockResolvedValue(undefined);
    contestWriteRepo.deletePendingPublicationsByContestId.mockResolvedValue(
      undefined,
    );
    contestJobsService.scheduleContest.mockResolvedValue(undefined);
    contestReadRepo.findByIdWithRelations.mockRejectedValue(
      new Error('findByIdWithRelations failed'),
    );

    await expect(service.createContest(dto)).rejects.toThrow(
      'findByIdWithRelations failed',
    );
  });
});
