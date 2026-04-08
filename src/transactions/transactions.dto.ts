import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { TransactionType } from '../common/types';

export class CreateTransactionDto {
  @ApiProperty({ example: 150.00, description: 'Valor da transação (deve ser positivo)' })
  @IsPositive({ message: 'Valor deve ser positivo' })
  amount!: number;

  @ApiProperty({ example: 'expense', description: "Tipo: 'income' (receita) ou 'expense' (despesa)", enum: ['income', 'expense'] })
  @IsEnum(['income', 'expense'], { message: "Tipo deve ser 'income' ou 'expense'" })
  type!: TransactionType;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'UUID da categoria' })
  @IsUUID('4', { message: 'category_id deve ser um UUID válido' })
  category_id!: string;

  @ApiPropertyOptional({ example: false, description: 'Se true, a despesa é um adiantamento (um membro paga pelo grupo)' })
  @IsBoolean()
  @IsOptional()
  is_advance?: boolean = false;

  @ApiPropertyOptional({ example: 'Compras do mês', description: 'Descrição opcional (máx. 255 caracteres)', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '2024-06-15T10:00:00Z', description: 'Data/hora da ocorrência (ISO 8601). Padrão: agora.' })
  @IsISO8601({}, { message: 'occurred_at deve ser uma data ISO 8601 válida' })
  @IsOptional()
  occurred_at?: string;
}

export class ListTransactionsDto {
  @ApiPropertyOptional({ example: '2024-06-01T00:00:00Z', description: 'Data inicial do filtro (ISO 8601)' })
  @IsISO8601()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ example: '2024-06-30T23:59:59Z', description: 'Data final do filtro (ISO 8601)' })
  @IsISO8601()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ example: 'expense', description: "Filtra por tipo: 'income' ou 'expense'", enum: ['income', 'expense'] })
  @IsEnum(['income', 'expense'])
  @IsOptional()
  type?: TransactionType;

  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'Filtra por UUID da categoria' })
  @IsUUID()
  @IsOptional()
  category_id?: string;

  @ApiPropertyOptional({ example: 1, description: 'Página (padrão: 1)', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, description: 'Itens por página (padrão: 20, máx: 50)', minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ example: 'desc', description: "Ordenação por data: 'asc' ou 'desc' (padrão: desc)", enum: ['asc', 'desc'] })
  @IsEnum(['asc', 'desc'])
  @IsOptional()
  order?: 'asc' | 'desc' = 'desc';
}
