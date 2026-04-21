import { forwardRef, Module } from '@nestjs/common';
import { UsersService } from './services/users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserReadRepository, UserWriteRepository } from './repositories';
import { AdminService, TelegramUserService } from './services';
import { ContestParticipation } from '../contests/entities';
import { BotModule } from '../bot/bot.module';
import { UsersMailingService } from './services/users-mailing.service';
import { ContestsModule } from '../contests/contests.module';
import { MailingProcessor } from './jobs/mailing.processor';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { MailingMessageEntity } from './entities/mailing-message.entity';
import { MailingCleanupService } from './services/mailing-cleanup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      ContestParticipation,
      MailingMessageEntity,
    ]),
    BotModule,
    ContestsModule,
    BullModule.registerQueue({ name: 'user-mailing' }),
    forwardRef(() => AuthModule),
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    AdminService,
    TelegramUserService,
    UserWriteRepository,
    UserReadRepository,
    UsersMailingService,
    MailingProcessor,
    MailingCleanupService,
  ],
  exports: [UsersService, AdminService, TelegramUserService],
})
export class UsersModule {}
