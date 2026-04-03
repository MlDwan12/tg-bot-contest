import { Module } from '@nestjs/common';
import { AppConfigModule } from './config';

@Module({
  imports: [AppConfigModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
