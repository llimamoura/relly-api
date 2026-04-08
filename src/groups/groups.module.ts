import { forwardRef, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

/**
 * Módulo de gerenciamento de grupos.
 * Depende do CommonModule (global) para o SUPABASE_ADMIN_CLIENT.
 * Exporta GroupsService para uso no AuthModule (acceptInvite pós-registro)
 * e no NotificationsModule (acceptInvite via notificação interna).
 *
 * Dependência circular com NotificationsModule:
 *  - GroupsService usa NotificationsService.create (fluxo de convite interno)
 *  - NotificationsService usa GroupsService.acceptInvite
 * Resolvido com forwardRef em ambos os módulos.
 */
@Module({
  imports: [forwardRef(() => NotificationsModule)],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
