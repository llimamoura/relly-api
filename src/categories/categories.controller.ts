import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';
import type { CategoryRow } from './categories.types';

@ApiTags('categories')
@ApiBearerAuth('access-token')
@Controller('groups/:groupId/categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  /** GET /api/groups/:groupId/categories — globais + do grupo */
  @Get()
  @ApiOperation({ summary: 'Lista categorias globais e do grupo' })
  @ApiResponse({ status: 200, description: 'Lista de categorias retornada com sucesso' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 403, description: 'Usuário não é membro do grupo' })
  findAll(
    @Param('groupId') groupId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<CategoryRow[]> {
    return this.categoriesService.findAll(groupId, user.id);
  }

  /** POST /api/groups/:groupId/categories — cria categoria do grupo */
  @Post()
  @ApiOperation({ summary: 'Cria uma nova categoria para o grupo' })
  @ApiResponse({ status: 201, description: 'Categoria criada com sucesso' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 403, description: 'Usuário não é membro do grupo' })
  create(
    @Param('groupId') groupId: string,
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CategoryRow> {
    return this.categoriesService.create(groupId, user.id, dto);
  }

  /** PUT /api/groups/:groupId/categories/:id — edita (apenas do grupo) */
  @Put(':id')
  @ApiOperation({ summary: 'Atualiza uma categoria do grupo' })
  @ApiResponse({ status: 200, description: 'Categoria atualizada com sucesso' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 403, description: 'Não é possível editar categorias globais' })
  @ApiResponse({ status: 404, description: 'Categoria não encontrada' })
  update(
    @Param('groupId') groupId: string,
    @Param('id') categoryId: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CategoryRow> {
    return this.categoriesService.update(groupId, categoryId, user.id, dto);
  }

  /** DELETE /api/groups/:groupId/categories/:id — remove se não estiver em uso */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove uma categoria do grupo (não pode estar em uso)' })
  @ApiResponse({ status: 204, description: 'Categoria removida com sucesso' })
  @ApiResponse({ status: 401, description: 'Não autorizado' })
  @ApiResponse({ status: 403, description: 'Não é possível remover categorias globais' })
  @ApiResponse({ status: 409, description: 'Categoria em uso por transações existentes' })
  remove(
    @Param('groupId') groupId: string,
    @Param('id') categoryId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.categoriesService.remove(groupId, categoryId, user.id);
  }
}
