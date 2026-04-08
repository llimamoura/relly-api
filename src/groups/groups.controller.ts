import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { GroupsService } from './groups.service';
import { CreateGroupDto, CreateInviteDto } from './groups.dto';
import { GroupWithMembers, InviteResponse } from './groups.types';

@ApiTags('groups')
@ApiBearerAuth('access-token')
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  /** POST /api/groups — cria grupo couple ou shared */
  @Post()
  @ApiOperation({ summary: 'Cria um novo grupo couple ou shared' })
  @ApiResponse({ status: 201, description: 'Grupo criado com sucesso' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  create(
    @Body() dto: CreateGroupDto,
    @CurrentUser() user: AuthUser,
  ): Promise<GroupWithMembers> {
    return this.groupsService.create(user.id, dto);
  }

  /** GET /api/groups — lista todos os grupos do usuário autenticado */
  @Get()
  @ApiOperation({ summary: 'Lista todos os grupos do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Lista de grupos retornada com sucesso' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  findAll(@CurrentUser() user: AuthUser): Promise<GroupWithMembers[]> {
    return this.groupsService.findAllByUser(user.id);
  }

  /** GET /api/groups/:id — detalhes do grupo com membros */
  @Get(':id')
  @ApiOperation({ summary: 'Retorna detalhes e membros de um grupo' })
  @ApiResponse({ status: 200, description: 'Grupo encontrado' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 403, description: 'Usuário não é membro do grupo' })
  @ApiResponse({ status: 404, description: 'Grupo não encontrado' })
  findOne(
    @Param('id') groupId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<GroupWithMembers> {
    return this.groupsService.findOne(groupId, user.id);
  }

  /**
   * POST /api/groups/:id/invite
   *
   * Dois fluxos:
   * - `{ email }` → notificação interna se o usuário for encontrado, link como fallback.
   * - `{ use_link: true }` ou sem body → gera link de token para compartilhamento manual.
   */
  @Post(':id/invite')
  @ApiOperation({
    summary: 'Gera convite para o grupo (fluxo interno por email ou link externo)',
    description:
      'Se `email` for informado e o usuário existir, cria notificação interna. ' +
      'Caso contrário, gera link de token para compartilhamento manual. ' +
      'Use `use_link: true` para forçar o fluxo de link.',
  })
  @ApiResponse({ status: 201, description: 'Convite gerado — delivery indica o canal utilizado' })
  @ApiResponse({ status: 400, description: 'Grupo cheio' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 403, description: 'Apenas administradores podem gerar convites' })
  @ApiResponse({ status: 409, description: 'Usuário já é membro do grupo' })
  generateInvite(
    @Param('id') groupId: string,
    @Body() dto: CreateInviteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<InviteResponse> {
    return this.groupsService.generateInvite(groupId, user.id, dto);
  }

  /** POST /api/groups/join/:token — aceita convite pelo token (fluxo externo) */
  @Post('join/:token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aceita convite de grupo pelo token (fluxo de link externo)' })
  @ApiResponse({ status: 200, description: 'Convite aceito — usuário adicionado ao grupo' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 404, description: 'Token inválido ou expirado' })
  joinGroup(
    @Param('token') token: string,
    @CurrentUser() user: AuthUser,
  ): Promise<GroupWithMembers> {
    return this.groupsService.acceptInvite(token, user.id);
  }

  /** DELETE /api/groups/:id/members/:userId — remove membro (apenas admin) */
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove membro do grupo (apenas admin)' })
  @ApiResponse({ status: 204, description: 'Membro removido com sucesso' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 403, description: 'Apenas administradores podem remover membros' })
  removeMember(
    @Param('id') groupId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.groupsService.removeMember(groupId, targetUserId, user.id);
  }
}
