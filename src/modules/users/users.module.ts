import { Module } from '@nestjs/common';
import { UsersService } from './services/users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserRepository } from './repositories';
import { USER_REPOSITORY } from 'src/common/constants';
import { AdminService, TelegramUserService } from './services';
import { ContestParticipation } from '../contests/entities';
import { BotModule } from '../bot/bot.module';
import { UsersMailingService } from './services/users-mailing.service';
import { ContestsModule } from '../contests/contests.module';
import { MailingProcessor } from './jobs/mailing.processor';
import { BullModule } from '@nestjs/bullmq';
import { MailingMessageEntity } from './entities/mailing-message.entity';
import { MailingCleanupService } from './services/mailing-cleanup.service';
import { MailingJobEntity } from './entities/mailing-jobs.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      ContestParticipation,
      MailingMessageEntity,
      MailingJobEntity,
    ]),
    BotModule,
    ContestsModule,
    BullModule.registerQueue({ name: 'user-mailing' }),
    // AuthModule НЕ импортируем: он @Global, JwtAuthGuard доступен глобально
    // (как в contests.controller). Импорт был избыточен и замыкал ложный цикл.
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    AdminService,
    TelegramUserService,
    {
      provide: USER_REPOSITORY,
      useClass: UserRepository,
    },
    UsersMailingService,
    MailingProcessor,
    MailingCleanupService,
  ],
  exports: [UsersService, AdminService, TelegramUserService],
})
export class UsersModule {}
