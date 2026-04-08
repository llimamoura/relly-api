import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN_CLIENT } from '../common/supabase.provider';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';
import { CategoryRow } from './categories.types';

@Injectable()
export class CategoriesService {
  constructor(
    @Inject(SUPABASE_ADMIN_CLIENT) private readonly db: SupabaseClient,
  ) {}

  // ── Helper privado ──────────────────────────────────────────────────────

  private async assertMember(groupId: string, userId: string): Promise<void> {
    const { data } = await this.db
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .single();

    if (!data) throw new ForbiddenException('Você não é membro deste grupo');
  }

  // ── Métodos públicos ────────────────────────────────────────────────────

  /**
   * Retorna as categorias globais (group_id IS NULL) mais as do grupo.
   * Categorias de outros grupos nunca são retornadas.
   *
   * @throws {ForbiddenException} Se o usuário não for membro do grupo.
   */
  async findAll(groupId: string, userId: string): Promise<CategoryRow[]> {
    await this.assertMember(groupId, userId);

    const { data, error } = await this.db
      .from('categories')
      .select('id, name, type, icon, group_id, created_at')
      .or(`group_id.is.null,group_id.eq.${groupId}`)
      .order('type')
      .order('name');

    if (error ?? !data) throw new InternalServerErrorException('Erro ao buscar categorias');
    return data as CategoryRow[];
  }

  /**
   * Cria uma categoria vinculada ao grupo.
   * Categorias globais são gerenciadas via seed/migration — não via API.
   *
   * @throws {ForbiddenException}           Se o usuário não for membro.
   * @throws {InternalServerErrorException} Se o insert falhar.
   */
  async create(
    groupId: string,
    userId: string,
    dto: CreateCategoryDto,
  ): Promise<CategoryRow> {
    await this.assertMember(groupId, userId);

    const { data, error } = await this.db
      .from('categories')
      .insert({ name: dto.name, type: dto.type, icon: dto.icon ?? null, group_id: groupId })
      .select('id, name, type, icon, group_id, created_at')
      .single();

    if (error ?? !data) throw new InternalServerErrorException('Erro ao criar categoria');
    return data as CategoryRow;
  }

  /**
   * Atualiza uma categoria do grupo.
   * Categorias globais (group_id IS NULL) são imutáveis via API.
   *
   * @throws {ForbiddenException} Se o usuário não for membro ou a categoria for global.
   * @throws {NotFoundException}  Se a categoria não existir no grupo.
   */
  async update(
    groupId: string,
    categoryId: string,
    userId: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryRow> {
    await this.assertMember(groupId, userId);

    // Busca a categoria para verificar escopo antes de editar
    const { data: existing } = await this.db
      .from('categories')
      .select('group_id')
      .eq('id', categoryId)
      .single();

    if (!existing) throw new NotFoundException('Categoria não encontrada');

    const cat = existing as { group_id: string | null };
    if (cat.group_id === null) {
      throw new ForbiddenException('Categorias globais não podem ser editadas');
    }
    if (cat.group_id !== groupId) {
      throw new ForbiddenException('Categoria não pertence a este grupo');
    }

    // Constrói payload apenas com os campos informados
    const payload: Record<string, unknown> = {};
    if (dto.name  !== undefined) payload['name']  = dto.name;
    if (dto.type  !== undefined) payload['type']  = dto.type;
    if (dto.icon  !== undefined) payload['icon']  = dto.icon;

    const { data, error } = await this.db
      .from('categories')
      .update(payload)
      .eq('id', categoryId)
      .select('id, name, type, icon, group_id, created_at')
      .single();

    if (error ?? !data) throw new InternalServerErrorException('Erro ao atualizar categoria');
    return data as CategoryRow;
  }

  /**
   * Remove uma categoria do grupo.
   *
   * Regras:
   *  - Categorias globais são imutáveis via API.
   *  - Se houver transações usando a categoria (não deletadas), lança
   *    ConflictException informando a quantidade.
   *
   * @throws {ForbiddenException}  Se global ou de outro grupo.
   * @throws {NotFoundException}   Se não existir.
   * @throws {ConflictException}   Se estiver em uso por transações.
   */
  async remove(
    groupId: string,
    categoryId: string,
    userId: string,
  ): Promise<void> {
    await this.assertMember(groupId, userId);

    // Verifica escopo da categoria
    const { data: existing } = await this.db
      .from('categories')
      .select('group_id')
      .eq('id', categoryId)
      .single();

    if (!existing) throw new NotFoundException('Categoria não encontrada');

    const cat = existing as { group_id: string | null };
    if (cat.group_id === null) {
      throw new ForbiddenException('Categorias globais não podem ser removidas');
    }
    if (cat.group_id !== groupId) {
      throw new ForbiddenException('Categoria não pertence a este grupo');
    }

    // Verifica se há transações ativas usando a categoria
    const { count, error: countErr } = await this.db
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('category_id', categoryId)
      .is('deleted_at', null);

    if (countErr) throw new InternalServerErrorException('Erro ao verificar uso da categoria');

    if (count !== null && count > 0) {
      throw new ConflictException(
        `Categoria em uso por ${count} transação(ões). Reatribua-as antes de remover.`,
      );
    }

    const { error } = await this.db
      .from('categories')
      .delete()
      .eq('id', categoryId);

    if (error) throw new InternalServerErrorException('Erro ao remover categoria');
  }
}
