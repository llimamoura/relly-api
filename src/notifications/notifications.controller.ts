import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListNotificationsDto } from './notifications.dto';
import { NotificationsService } from './notifications.service';
import type {
  DeclineResult,
  Notification,
  NotificationsResult,
} from './notifications.types';
import type { GroupWithMembers } from '../groups/groups.types';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /** GET /api/notifications */
  @Get()
  @ApiOperation({ summary: 'Lista notificações do usuário autenticado com paginação' })
  @ApiResponse({ status: 200, description: 'Lista de notificações + contagem de não lidas' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  findAll(
    @Query() dto: ListNotificationsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<NotificationsResult> {
    return this.notificationsService.findAll(user.id, dto);
  }

  /** PATCH /api/notifications/read-all — deve vir antes de /:id/read */
  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Marca todas as notificações do usuário como lidas' })
  @ApiResponse({ status: 204, description: 'Todas as notificações marcadas como lidas' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  markAllAsRead(@CurrentUser() user: AuthUser): Promise<void> {
    return this.notificationsService.markAllAsRead(user.id);
  }

  /** PATCH /api/notifications/:id/read */
  @Patch(':id/read')
  @ApiOperation({ summary: 'Marca uma notificação específica como lida' })
  @ApiResponse({ status: 200, description: 'Notificação marcada como lida' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 403, description: 'Notificação não pertence ao usuário' })
  @ApiResponse({ status: 404, description: 'Notificação não encontrada' })
  markAsRead(
    @Param('id') notificationId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<Notification> {
    return this.notificationsService.markAsRead(notificationId, user.id);
  }

  /** POST /api/notifications/:id/accept */
  @Post(':id/accept')
  @ApiOperation({ summary: 'Aceita um convite de grupo recebido via notificação' })
  @ApiResponse({ status: 201, description: 'Convite aceito — retorna o grupo atualizado' })
  @ApiResponse({ status: 400, description: 'Notificação não é um convite ou convite inválido/expirado' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 403, description: 'Notificação não pertence ao usuário' })
  @ApiResponse({ status: 404, description: 'Notificação ou convite não encontrado' })
  accept(
    @Param('id') notificationId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<GroupWithMembers> {
    return this.notificationsService.accept(notificationId, user.id);
  }

  /** POST /api/notifications/:id/decline */
  @Post(':id/decline')
  @ApiOperation({ summary: 'Recusa um convite de grupo (silencioso — o invitador não é notificado)' })
  @ApiResponse({ status: 201, description: 'Convite recusado' })
  @ApiResponse({ status: 400, description: 'Notificação não é um convite' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 403, description: 'Notificação não pertence ao usuário' })
  @ApiResponse({ status: 404, description: 'Notificação não encontrada' })
  decline(
    @Param('id') notificationId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DeclineResult> {
    return this.notificationsService.decline(notificationId, user.id);
  }
}
