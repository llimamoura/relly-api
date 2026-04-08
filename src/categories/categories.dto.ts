import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { TransactionType } from '../common/types';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Mercado', description: 'Nome da categoria (2–50 caracteres)', minLength: 2, maxLength: 50 })
  @IsString()
  @MinLength(2, { message: 'Nome deve ter no mínimo 2 caracteres' })
  @MaxLength(50, { message: 'Nome deve ter no máximo 50 caracteres' })
  name!: string;

  @ApiProperty({ example: 'expense', description: "Tipo: 'income' (receita) ou 'expense' (despesa)", enum: ['income', 'expense'] })
  @IsEnum(['income', 'expense'], { message: "Tipo deve ser 'income' ou 'expense'" })
  type!: TransactionType;

  @ApiPropertyOptional({ example: '🛒', description: 'Ícone emoji ou identificador visual (opcional, máx. 100 caracteres)', maxLength: 100 })
  @IsString()
  @MaxLength(100, { message: 'Ícone deve ter no máximo 100 caracteres' })
  @IsOptional()
  icon?: string;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Supermercado', description: 'Novo nome da categoria (2–50 caracteres)', minLength: 2, maxLength: 50 })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'income', description: "Novo tipo: 'income' ou 'expense'", enum: ['income', 'expense'] })
  @IsEnum(['income', 'expense'])
  @IsOptional()
  type?: TransactionType;

  @ApiPropertyOptional({ example: '🏪', description: 'Novo ícone emoji ou identificador visual (máx. 100 caracteres)', maxLength: 100 })
  @IsString()
  @MaxLength(100, { message: 'Ícone deve ter no máximo 100 caracteres' })
  @IsOptional()
  icon?: string;
}
