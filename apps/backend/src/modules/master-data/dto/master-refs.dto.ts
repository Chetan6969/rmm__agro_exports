import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

// ---- Ports ----
export class CreatePortDto {
  @ApiProperty({ example: 'Mundra' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'INMUN', required: false })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiProperty({ enum: ['LOADING', 'DISCHARGE', 'BOTH'], example: 'LOADING' })
  @IsEnum(['LOADING', 'DISCHARGE', 'BOTH'])
  portType!: 'LOADING' | 'DISCHARGE' | 'BOTH';

  @ApiProperty({ example: 'India' })
  @IsString()
  @IsNotEmpty()
  country!: string;
}

export class UpdatePortDto extends CreatePortDto {}

// ---- Shipping lines ----
export class CreateShippingLineDto {
  @ApiProperty({ example: 'Maersk Line' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'MAEU', required: false })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  contactDetails?: string;
}

export class UpdateShippingLineDto extends CreateShippingLineDto {}

// ---- Countries ----
export class CreateCountryDto {
  @ApiProperty({ example: 'Iraq' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'IRQ', required: false })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiProperty({ example: 'Middle East', required: false })
  @IsString()
  @IsOptional()
  region?: string;

  @ApiProperty({ required: false, default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateCountryDto extends CreateCountryDto {}

// ---- Terms & conditions ----
export class CreateTermDto {
  @ApiProperty({ example: 'Jurisdiction' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    enum: ['PROFORMA', 'INVOICE', 'PRODUCTION_ORDER'],
    default: 'PROFORMA',
    required: false,
  })
  @IsString()
  @IsOptional()
  documentType?: string;

  @ApiProperty({ example: 'Any dispute is subject to the jurisdiction ...' })
  @IsString()
  @IsNotEmpty()
  content!: string;

  @ApiProperty({ required: false, default: false })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

export class UpdateTermDto extends CreateTermDto {}
