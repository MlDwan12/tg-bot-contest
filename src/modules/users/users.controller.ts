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
import { Paginated } from 'src/common/response/paginated.type';
import { GetUsersQueryDto } from './dto/get-users-query.dto';
import { SendUsersMailingDto } from './dto/send-users-mailing.dto';
import { UsersMailingService } from './services/users-mailing.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { MAILING_UPLOADS_DIR } from 'src/common/constants/storage.constants';
import { JwtAuthGuard } from '../auth/guards';
import * as fs from 'fs';
import { Logger } from 'nestjs-pino';
import { AfterMailingHourGuard } from './guard/mailing-hour.guard';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  ApiEnvelopedPaginatedResponse,
  ApiEnvelopedResponse,
  ApiEnvelopedResponseRaw,
} from 'src/common/swagger/api-enveloped-response.decorator';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersAdminService: AdminService,
    private readonly userTgService: TelegramUserService,
    private readonly usersService: UsersService,
    private readonly usersMailingService: UsersMailingService,
    private readonly logger: Logger,
  ) {}

  @ApiOperation({
    summary: 'Создать администратора',
    description: 'Заводит логин+пароль для входа в админ-панель.',
  })
  @ApiCookieAuth('accessToken')
  @ApiEnvelopedResponse(User, { status: 201 })
  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateUserAdminDto): Promise<User> {
    const user = await this.usersAdminService.createAdmin(dto);
    return user;
  }

  @ApiOperation({
    summary: 'Список пользователей бота',
    description:
      'Пользователи Telegram-бота (role=user) с числом участий в конкурсах, ' +
      'постранично, с фильтром по группе (каналу) и поиском.',
  })
  @ApiEnvelopedPaginatedResponse(UserListItemDto)
  @Get()
  async getAllUsers(
    @Query() query: GetUsersQueryDto,
  ): Promise<Paginated<UserListItemDto>> {
    return this.usersService.findAllUsersWithParticipationCount(query);
  }

  @ApiOperation({ summary: 'Администратор по id' })
  @ApiCookieAuth('accessToken')
  @ApiParam({ name: 'id', type: Number })
  @ApiEnvelopedResponse(User, { nullable: true })
  @Get('admin/:id')
  @UseGuards(JwtAuthGuard)
  async getAdminById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<User | null> {
    return this.usersAdminService.findById(id);
  }

  @ApiOperation({ summary: 'Пользователь бота по id' })
  @ApiParam({ name: 'id', type: Number })
  @ApiEnvelopedResponse(User, { nullable: true })
  @Get('user/:id')
  async getUserById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<User | null> {
    return this.userTgService.findById(id);
  }

  @ApiOperation({
    summary: 'Детали пользователя',
    description: 'Группы (каналы), в которых состоит, и список его конкурсов.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiEnvelopedResponse(UserDetailsDto)
  @Get(':id/details')
  async getUserDetails(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<UserDetailsDto> {
    return this.usersService.findUserDetailsById(id);
  }

  @ApiOperation({
    summary: 'Массовая рассылка',
    description:
      'Отправляет сообщение одному пользователю (type=USER), всем участникам ' +
      'одной группы/канала (type=GROUP) или всем пользователям бота ' +
      '(type=ALL). Картинка/видео — необязательное поле media (multipart). ' +
      'Гард AfterMailingHourGuard на разрешённый час суток сейчас ' +
      'закомментирован в коде — де-факто ограничения по времени нет.',
  })
  @ApiCookieAuth('accessToken')
  @ApiExtraModels(SendUsersMailingDto)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      allOf: [
        { $ref: getSchemaPath(SendUsersMailingDto) },
        {
          type: 'object',
          properties: {
            media: {
              type: 'string',
              format: 'binary',
              description: 'jpeg/png/webp/mp4/mov/webm, до 5 МБ',
            },
          },
        },
      ],
    },
  })
  @ApiEnvelopedResponseRaw({
    type: 'object',
    properties: {
      jobId: { type: 'string' },
      enqueuedCount: { type: 'number' },
    },
  })
  @Post('broadcast')
  @UseGuards(JwtAuthGuard)
  // @UseGuards(JwtAuthGuard, AfterMailingHourGuard)
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
