import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import { SummaryQueryDto } from './reports.dto';
import type { GroupSummary } from './reports.types';

@ApiTags('reports')
@ApiBearerAuth('access-token')
@Controller('groups/:groupId/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /** GET /api/groups/:groupId/reports/summary?from=&to= */
  @Get('summary')
  @ApiOperation({
    summary: 'Resumo financeiro do grupo no período',
    description:
      'Retorna `personal` (grupos pessoais) ou `pool` + `members` (couple/shared). ' +
      'A seção `members` aparece apenas se houver adiantamentos no período.',
  })
  @ApiResponse({ status: 200, description: 'Resumo calculado com sucesso' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 403, description: 'Usuário não é membro do grupo' })
  getSummary(
    @Param('groupId') groupId: string,
    @Query() dto: SummaryQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<GroupSummary> {
    return this.reportsService.getSummary(groupId, user.id, dto);
  }
}
