import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ example: 'Casa', description: 'Nome do grupo (mínimo 2 caracteres)', minLength: 2 })
  @IsString()
  @MinLength(2, { message: 'Nome do grupo deve ter no mínimo 2 caracteres' })
  name!: string;

  @ApiProperty({
    example: 'shared',
    description: "Tipo do grupo: 'couple' (2 pessoas) ou 'shared' (até 10). Grupos 'personal' são criados automaticamente no cadastro.",
    enum: ['couple', 'shared'],
  })
  @IsEnum(['couple', 'shared'], {
    message: "Tipo deve ser 'couple' ou 'shared'. Grupos 'personal' são criados automaticamente no cadastro.",
  })
  type!: 'couple' | 'shared';
}

/**
 * Body do endpoint POST /groups/:id/invite.
 *
 * Dois fluxos:
 *  - Fluxo interno (padrão): forneça `email` de um usuário já cadastrado.
 *    O backend localiza o usuário e cria uma notificação interna de convite.
 *  - Fluxo externo (fallback): omita `email` ou envie `use_link = true`
 *    para gerar um token de link que pode ser compartilhado manualmente.
 */
export class CreateInviteDto {
  @ApiPropertyOptional({
    example: 'bruno@email.com',
    description: 'E-mail do usuário a convidar (fluxo interno via notificação)',
  })
  @IsEmail({}, { message: 'E-mail inválido' })
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Se true, força geração de link mesmo que o e-mail seja encontrado (padrão: false)',
  })
  @IsBoolean()
  @IsOptional()
  use_link?: boolean = false;
}

/**
 * Usado tanto no endpoint POST /groups/join/:token
 * quanto internamente pelo AuthService após o registro quando um token
 * de convite estava presente na URL.
 */
export class AcceptInviteDto {
  @ApiProperty({ example: 'abc123token', description: 'Token de convite gerado pelo admin do grupo' })
  @IsString()
  token!: string;
}
