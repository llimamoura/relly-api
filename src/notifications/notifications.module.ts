import { forwardRef, Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Módulo de notificações internas.
 *
 * Dependência circular com GroupsModule:
 *  - NotificationsService usa GroupsService.acceptInvite
 *  - GroupsService usa NotificationsService.create
 * Resolvido com forwardRef em ambos os módulos.
 */
@Module({
  imports: [forwardRef(() => GroupsModule)],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
