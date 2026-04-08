import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'maria@email.com', description: 'E-mail do usuário' })
  @IsEmail({}, { message: 'E-mail inválido' })
  email!: string;

  @ApiProperty({ example: 'senha1234', description: 'Senha (mínimo 8 caracteres)', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Senha deve ter no mínimo 8 caracteres' })
  password!: string;

  @ApiProperty({ example: 'Maria Silva', description: 'Nome do usuário (mínimo 2 caracteres)', minLength: 2 })
  @IsString()
  @MinLength(2, { message: 'Nome deve ter no mínimo 2 caracteres' })
  name!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'maria@email.com', description: 'E-mail do usuário' })
  @IsEmail({}, { message: 'E-mail inválido' })
  email!: string;

  @ApiProperty({ example: 'senha1234', description: 'Senha do usuário' })
  @IsString()
  password!: string;
}
