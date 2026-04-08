import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto, ListTransactionsDto } from './transactions.dto';
import { TransactionRow } from './transactions.types';

@ApiTags('transactions')
@ApiBearerAuth('access-token')
@Controller('groups/:groupId/transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  /** POST /api/groups/:groupId/transactions — registra income ou expense */
  @Post()
  @ApiOperation({ summary: 'Registra uma nova transação (receita ou despesa)' })
  @ApiResponse({ status: 201, description: 'Transação criada com sucesso' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 403, description: 'Usuário não é membro do grupo' })
  create(
    @Param('groupId') groupId: string,
    @Body() dto: CreateTransactionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<TransactionRow> {
    return this.transactionsService.create(groupId, user.id, dto);
  }

  /**
   * GET /api/groups/:groupId/transactions — lista com filtros e paginação
   *
   * Query params: from, to, type, category_id, page, limit, order
   */
  @Get()
  @ApiOperation({ summary: 'Lista transações do grupo com filtros e paginação' })
  @ApiResponse({ status: 200, description: 'Lista de transações retornada com sucesso' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 403, description: 'Usuário não é membro do grupo' })
  findAll(
    @Param('groupId') groupId: string,
    @Query() filters: ListTransactionsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<TransactionRow[]> {
    return this.transactionsService.findAll(groupId, user.id, filters);
  }

  /** GET /api/groups/:groupId/transactions/:id — detalhe da transação */
  @Get(':id')
  @ApiOperation({ summary: 'Retorna detalhes de uma transação específica' })
  @ApiResponse({ status: 200, description: 'Transação encontrada' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 403, description: 'Usuário não é membro do grupo' })
  @ApiResponse({ status: 404, description: 'Transação não encontrada' })
  findOne(
    @Param('groupId') groupId: string,
    @Param('id') transactionId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TransactionRow> {
    return this.transactionsService.findOne(groupId, transactionId, user.id);
  }

  /** DELETE /api/groups/:groupId/transactions/:id — soft delete */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove uma transação (soft delete)' })
  @ApiResponse({ status: 204, description: 'Transação removida com sucesso' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 403, description: 'Apenas o criador pode remover a transação' })
  @ApiResponse({ status: 404, description: 'Transação não encontrada' })
  remove(
    @Param('groupId') groupId: string,
    @Param('id') transactionId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.transactionsService.remove(groupId, transactionId, user.id);
  }
}
