import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminService, TelegramUserService, UsersService } from './services';
import { CreateUserAdminDto } from './dto';
import { User } from './entities';
import { UserListItemDto } from './dto/user-list-item.dto';
import { UserDetailsDto } from './dto/get-user-details.dto';
import { Paginated } from 'src/shared/commons/response/paginated.type';
import { GetUsersQueryDto } from './dto/get-users-query.dto';
import { SendUsersMailingDto } from './dto/send-users-mailing.dto';
import { UsersMailingService } from './services/users-mailing.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { MAILING_UPLOADS_DIR } from 'src/shared/commons/constants/storage.constants';
import { JwtAuthGuard } from '../auth/guards';
import * as fs from 'fs';
import { Logger } from 'nestjs-pino';
import { AfterMoscowTimeGuard } from './guard/time.guard';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersAdminService: AdminService,
    private readonly userTgService: TelegramUserService,
    private readonly usersService: UsersService,
    private readonly usersMailingService: UsersMailingService,
    private readonly logger: Logger,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateUserAdminDto): Promise<User> {
    const user = await this.usersAdminService.createAdmin(dto);
    return user;
  }

  @Get()
  async getAllUsers(
    @Query() query: GetUsersQueryDto,
  ): Promise<Paginated<UserListItemDto>> {
    return this.usersService.findAllUsersWithParticipationCount(query);
  }

  @Get('admin/:id')
  @UseGuards(JwtAuthGuard)
  async getAdminById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<User | null> {
    return this.usersAdminService.findById(id);
  }

  @Get('user/:id')
  async getUserById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<User | null> {
    return this.userTgService.findById(id);
  }

  @Get(':id/details')
  async getUserDetails(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<UserDetailsDto> {
    return this.usersService.findUserDetailsById(id);
  }

  @Post('broadcast')
  @UseGuards(JwtAuthGuard, AfterMoscowTimeGuard)
  @UseInterceptors(
    FileInterceptor('media', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          fs.mkdirSync(MAILING_UPLOADS_DIR, { recursive: true });
          cb(null, MAILING_UPLOADS_DIR);
        },
        filename: (req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase();
          cb(null, `mailing-${Date.now()}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const ok = [
          'image/jpeg',
          'image/png',
          'image/webp',
          'video/mp4',
          'video/quicktime', // .mov
          'video/webm',
        ].includes(file.mimetype);

        if (!ok) {
          return cb(
            new BadRequestException('Only jpeg/png/webp allowed'),
            false,
          );
        }

        cb(null, true);
      },
    }),
  )
  async sendBroadcast(
    @Body() dto: SendUsersMailingDto,
    @UploadedFile() image?: Express.Multer.File,
  ): Promise<{ jobId: string; enqueuedCount: number }> {
    this.logger.debug(`Началась рассылка ${dto.type}`, {
      dto,
      hasImage: !!image,
    });
    return await this.usersMailingService.sendMailing(dto, image);
  }
}
