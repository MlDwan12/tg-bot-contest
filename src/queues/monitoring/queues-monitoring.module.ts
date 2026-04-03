import { Module } from '@nestjs/common';
import {
  ContestFinishQueueEventsListener,
  ContestMaintenanceQueueEventsListener,
  ContestPublicationQueueEventsListener,
  ContestSchedulerQueueEventsListener,
  TelegramMessagesQueueEventsListener,
} from './queue-events.listener';

@Module({
  providers: [
    TelegramMessagesQueueEventsListener,
    ContestSchedulerQueueEventsListener,
    ContestFinishQueueEventsListener,
    ContestPublicationQueueEventsListener,
    ContestMaintenanceQueueEventsListener,
  ],
})
export class QueuesMonitoringModule {}
