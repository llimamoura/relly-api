import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

export class SummaryQueryDto {
  @ApiPropertyOptional({
    example: '2024-06-01T00:00:00Z',
    description: 'Data inicial do período (ISO 8601). Padrão: primeiro dia do mês atual.',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    example: '2024-06-30T23:59:59Z',
    description: 'Data final do período (ISO 8601). Padrão: fim do dia atual.',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
