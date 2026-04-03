import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    TypeOrmModule.forFeature([User, ContestParticipation]),
    BotModule,
    ContestsModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    AdminService,
    TelegramUserService,
    UserWriteRepository,
    UserReadRepository,
    UsersMailingService,
  ],
  exports: [UsersService, AdminService, TelegramUserService],
})
export class UsersModule {}
