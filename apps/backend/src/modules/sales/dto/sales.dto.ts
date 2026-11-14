import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

// ----------------------------------------------------
// PROFORMA INVOICES
// ----------------------------------------------------
export class ProformaItemDto {
  @ApiProperty({ description: 'Product UUID' })
  @IsUUID()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ description: 'Packing Type UUID' })
  @IsUUID()
  @IsNotEmpty()
  packingTypeId!: string;

  @ApiProperty({
    example: '1. 30KG BOPP BAGS 1000MT\n2. 25KG BOPP BAGS 500MT',
    required: false,
    description: 'Free-text packing + quantity breakdown (one per line)',
  })
  @IsString()
  @IsOptional()
  packingText?: string;

  @ApiProperty({ example: '10063020', required: false })
  @IsString()
  @IsOptional()
  hsCode?: string;

  @ApiProperty({ example: '2025', required: false })
  @IsString()
  @IsOptional()
  cropYear?: string;

  @ApiProperty({ example: 250.0, description: 'Quantity in Metric Tons (MT)' })
  @IsNumber()
  @Min(0.001)
  quantityMt!: number;

  @ApiProperty({ example: 980.0, description: 'Rate per MT' })
  @IsNumber()
  @Min(0.01)
  ratePerMt!: number;

  @ApiProperty({ example: 1.5, required: false })
  @IsNumber()
  @IsOptional()
  brokenPct?: number;

  @ApiProperty({ example: 0, required: false })
  @IsNumber()
  @IsOptional()
  cgst?: number;

  @ApiProperty({ example: 0, required: false })
  @IsNumber()
  @IsOptional()
  sgst?: number;

  @ApiProperty({ example: 0, required: false })
  @IsNumber()
  @IsOptional()
  igst?: number;

  @ApiProperty({ example: 'Max 1% Broken, Silky Polished', required: false })
  @IsString()
  @IsOptional()
  specifications?: string;
}

export class ProformaTermDto {
  @ApiProperty({ required: false, description: 'Master term UUID if selected' })
  @IsUUID()
  @IsOptional()
  termId?: string;

  @ApiProperty({ example: 'Weight and quality as determined at port of loading' })
  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class CreateProformaInvoiceDto {
  @ApiProperty({
    example: 'PI-RMM/AM/1015',
    required: false,
    description: 'Manual proforma number. If omitted, one is auto-allocated.',
  })
  @IsString()
  @IsOptional()
  documentNumber?: string;

  @ApiProperty({ example: '2026-11-06' })
  @IsString()
  @IsNotEmpty()
  documentDate!: string;

  @ApiProperty({
    enum: ['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED'],
    required: false,
    default: 'CONFIRMED',
  })
  @IsString()
  @IsOptional()
  status?: string;

  // Parties
  @ApiProperty({
    description: 'Consignee customer UUID (Rule 10 Gotcha: stored in customer slot)',
  })
  @IsUUID()
  @IsNotEmpty()
  customerId!: string;

  @ApiProperty({
    description: 'Foreign Buyer customer UUID (stored in consignee slot)',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  consigneeId?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  notifyPartyId?: string;

  // Buyer references & LC
  @ApiProperty({ example: 'PO-UAE-9921', required: false })
  @IsString()
  @IsOptional()
  buyerPoRef?: string;

  @ApiProperty({ example: '2026-10-24', required: false })
  @IsString()
  @IsOptional()
  poDate?: string;

  @ApiProperty({ example: 'LC-998877', required: false })
  @IsString()
  @IsOptional()
  lcNumber?: string;

  @ApiProperty({ example: '2026-11-04', required: false })
  @IsString()
  @IsOptional()
  lcDate?: string;

  // Commercial terms
  @ApiProperty({ enum: ['FOB', 'CFR', 'CIF'], example: 'FOB' })
  @IsEnum(['FOB', 'CFR', 'CIF'])
  incoterm!: 'FOB' | 'CFR' | 'CIF';

  @ApiProperty({ example: 'USD', default: 'USD' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiProperty({ example: 1.0, required: false, description: 'Dollar rate' })
  @IsNumber()
  @IsOptional()
  exchangeRate?: number;

  @ApiProperty({ example: 'LC AT SIGHT' })
  @IsString()
  @IsNotEmpty()
  paymentTerms!: string;

  @ApiProperty({ required: false, description: 'Delivery / shipment schedule' })
  @IsString()
  @IsOptional()
  deliveryTimeline?: string;

  // Shipping
  @ApiProperty({ example: 'INDIA', required: false })
  @IsString()
  @IsOptional()
  countryOfOrigin?: string;

  @ApiProperty({ example: 'INDIA', required: false })
  @IsString()
  @IsOptional()
  goodsCountry?: string;

  @ApiProperty({ example: 'Mundra' })
  @IsString()
  @IsNotEmpty()
  portOfLoading!: string;

  @ApiProperty({ example: 'Umm Qasr' })
  @IsString()
  @IsNotEmpty()
  portOfDischarge!: string;

  @ApiProperty({ example: 'IRAQ' })
  @IsString()
  @IsNotEmpty()
  finalDestination!: string;

  @ApiProperty({ example: 'By sea, FCL container', required: false })
  @IsString()
  @IsOptional()
  modeOfShipment?: string;

  // Branding
  @ApiProperty({ example: 'AL WALIMAH', required: false })
  @IsString()
  @IsOptional()
  brand?: string;

  @ApiProperty({ example: '1718 (70%) +1509(30%)', required: false })
  @IsString()
  @IsOptional()
  blend?: string;

  // Specification block
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  specVariety?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  specAvgLengthMm?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  specMoisturePct?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  specBrokenPct?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  specCropYear?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  bankDetailsId?: string;

  // Charges
  @ApiProperty({ example: 0, required: false })
  @IsNumber()
  @IsOptional()
  freightAmount?: number;

  @ApiProperty({ example: 0, required: false })
  @IsNumber()
  @IsOptional()
  insuranceAmount?: number;

  @ApiProperty({ example: 0, required: false })
  @IsNumber()
  @IsOptional()
  discountAmount?: number;

  // Section toggles
  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  showNotifyParty?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  showShippingDetails?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  showSpecification?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  showBankDetails?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  showLcDetails?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  showTermsConditions?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  showSignatureBlock?: boolean;

  @ApiProperty({ type: [ProformaTermDto], required: false })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProformaTermDto)
  @IsOptional()
  terms?: ProformaTermDto[];

  @ApiProperty({ type: [ProformaItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProformaItemDto)
  items!: ProformaItemDto[];
}

// ----------------------------------------------------
// PRODUCTION ORDERS (internal work order for the production department)
// ----------------------------------------------------
export class ProductionOrderItemDto {
  @ApiProperty({ description: 'Product UUID' })
  @IsUUID()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ required: false, description: 'Packing Type UUID' })
  @IsUUID()
  @IsOptional()
  packingTypeId?: string;

  @ApiProperty({ required: false, description: 'Free-text packing description' })
  @IsString()
  @IsOptional()
  packingText?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  hsCode?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  cropYear?: string;

  @ApiProperty({ example: 1000, required: false })
  @IsNumber()
  @IsOptional()
  noOfBags?: number;

  @ApiProperty({ example: 100.0, description: 'Net weight in MT' })
  @IsNumber()
  @Min(0.001)
  quantityMt!: number;

  @ApiProperty({ required: false, description: 'Gross weight in MT' })
  @IsNumber()
  @IsOptional()
  grossWtMt?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  ratePerMt?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  cgst?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  sgst?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  igst?: number;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  brokenBelow?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  fcl?: boolean;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  specifications?: string;
}

export class CreateProductionOrderDto {
  @ApiProperty({ required: false, description: 'Manual order number; auto if omitted' })
  @IsString()
  @IsOptional()
  documentNumber?: string;

  @ApiProperty({ example: '2026-11-07' })
  @IsString()
  @IsNotEmpty()
  documentDate!: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ required: false, description: 'Generate against this Proforma Invoice' })
  @IsUUID()
  @IsOptional()
  proformaInvoiceId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  buyerPoNumber?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  buyerPoRef?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  poDate?: string;

  @ApiProperty({ required: false, description: 'Rice Mill Supplier UUID' })
  @IsUUID()
  @IsOptional()
  supplierMillId?: string;

  // Parties
  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  customerId?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  consigneeId?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  notifyPartyId?: string;

  // Commercial
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  incoterm?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  exchangeRate?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  lcNumber?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  lcDate?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  freightAmount?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  insuranceAmount?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  fcl?: string;

  // Shipping
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  preCarriageBy?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  placeOfReceipt?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  countryOfOrigin?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  countryFinalDestination?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  vesselFlightNo?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  portOfLoading?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  portOfDischarge?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  destinationCountry?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  termsOf?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  paymentTerm?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  brand?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  transport?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  vehicleNo?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  orderRemark?: string;

  // Specification
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  specVariety?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  specAvgLengthMm?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  specMoisturePct?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  specBrokenPct?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  specCropYear?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  millingInstructions?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  packagingInstructions?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  showSignature?: boolean;

  @ApiProperty({ type: [ProformaTermDto], required: false })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProformaTermDto)
  @IsOptional()
  terms?: ProformaTermDto[];

  @ApiProperty({ type: [ProductionOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductionOrderItemDto)
  items!: ProductionOrderItemDto[];
}

// ----------------------------------------------------
// COMMERCIAL INVOICES & PACKING LISTS
// ----------------------------------------------------
export class ContainerDto {
  @ApiProperty({ example: 'MSCU1234567', description: 'Container number' })
  @IsString()
  @IsNotEmpty()
  containerNumber!: string;

  @ApiProperty({ example: 'SEAL-987654', description: 'Customs line seal number' })
  @IsString()
  @IsNotEmpty()
  sealNumber!: string;

  @ApiProperty({ example: '20FT', default: '20FT' })
  @IsString()
  @IsOptional()
  containerSize?: string;

  @ApiProperty({ example: 833, description: 'Total bags packed in container' })
  @IsNumber()
  totalBags!: number;

  @ApiProperty({ example: 25100.0, description: 'Gross weight in KG' })
  @IsNumber()
  grossWeightKg!: number;

  @ApiProperty({ example: 25000.0, description: 'Net weight in KG' })
  @IsNumber()
  netWeightKg!: number;
}

export class ShippingChargesDto {
  @ApiProperty({ example: 150.0, required: false })
  @IsNumber()
  @IsOptional()
  thcCharge?: number;

  @ApiProperty({ example: 50.0, required: false })
  @IsNumber()
  @IsOptional()
  blCharge?: number;

  @ApiProperty({ example: 15.0, required: false })
  @IsNumber()
  @IsOptional()
  sealCharge?: number;

  @ApiProperty({ example: 25.0, required: false })
  @IsNumber()
  @IsOptional()
  mucCharge?: number;

  @ApiProperty({ example: 10.0, required: false })
  @IsNumber()
  @IsOptional()
  riskCharge?: number;

  @ApiProperty({ example: 100.0, required: false })
  @IsNumber()
  @IsOptional()
  repositionCharge?: number;

  @ApiProperty({ example: 1200.0, required: false })
  @IsNumber()
  @IsOptional()
  oceanFreightCharge?: number;

  @ApiProperty({ example: 85.0, required: false })
  @IsNumber()
  @IsOptional()
  insuranceCharge?: number;
}

export class InvoiceItemDto {
  @ApiProperty({ description: 'Product UUID' })
  @IsUUID()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ required: false, description: 'Packing Type UUID' })
  @IsUUID()
  @IsOptional()
  packingTypeId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  packingText?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  hsCode?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  noOfBags?: number;

  @ApiProperty({ example: 100.0, description: 'Net weight in MT' })
  @IsNumber()
  @Min(0.001)
  quantityMt!: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  grossWtMt?: number;

  @ApiProperty({ example: 980.0, description: 'FOB Rate per MT' })
  @IsNumber()
  @Min(0.01)
  ratePerMt!: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  cgst?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  sgst?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  igst?: number;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  brokenBelow?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  fcl?: boolean;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  specifications?: string;
}

export class CreateCommercialInvoiceDto {
  @ApiProperty({ required: false, description: 'Manual invoice number; auto if omitted' })
  @IsString()
  @IsOptional()
  documentNumber?: string;

  @ApiProperty({ example: '2026-11-08' })
  @IsString()
  @IsNotEmpty()
  documentDate!: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ required: false, description: 'White / Custom etc.' })
  @IsString()
  @IsOptional()
  invoiceType?: string;

  @ApiProperty({ description: 'Referenced Proforma Invoice UUID', required: false })
  @IsUUID()
  @IsOptional()
  proformaInvoiceId?: string;

  @ApiProperty({ description: 'Referenced Production Order UUID', required: false })
  @IsUUID()
  @IsOptional()
  productionOrderId?: string;

  @ApiProperty({ example: 'PO-UAE-9921', required: false })
  @IsString()
  @IsOptional()
  buyerPoNumber?: string;

  @ApiProperty({ description: 'Customer UUID' })
  @IsUUID()
  @IsNotEmpty()
  customerId!: string;

  @ApiProperty({ description: 'Consignee UUID', required: false })
  @IsUUID()
  @IsOptional()
  consigneeId?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  notifyPartyId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  lcNumber?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  lcDate?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  exchangeRate?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  freightAmount?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  insuranceAmount?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  grossWtMt?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  fcl?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  shippingLineId?: string;

  // Shipping
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  preCarriageBy?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  placeOfReceipt?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  countryOfOrigin?: string;

  @ApiProperty({ example: 'SB-8877665', required: false })
  @IsString()
  @IsOptional()
  shippingBillNumber?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  shippingBillDate?: string;

  @ApiProperty({ example: 'MSCU-DXB-001', required: false })
  @IsString()
  @IsOptional()
  blNumber?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  blDate?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  ladingBlNumber?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  ladingBlDate?: string;

  @ApiProperty({ example: 'MSC REGINA', required: false })
  @IsString()
  @IsOptional()
  vesselFlightName?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  voyageNumber?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  containerNo?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  sealNo?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  portOfLoading?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  portOfDischarge?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  countryOfDestination?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  termsOf?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  paymentTerm?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  brand?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  marksNumbers?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  goodsDescription?: string;

  @ApiProperty({ enum: ['FOB', 'CFR', 'CIF'], example: 'CIF' })
  @IsEnum(['FOB', 'CFR', 'CIF'])
  incoterm!: 'FOB' | 'CFR' | 'CIF';

  @ApiProperty({ example: 'USD', default: 'USD' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  bankDetailsId?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  showSignature?: boolean;

  @ApiProperty({ type: [ProformaTermDto], required: false })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProformaTermDto)
  @IsOptional()
  terms?: ProformaTermDto[];

  @ApiProperty({ type: [InvoiceItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items!: InvoiceItemDto[];

  @ApiProperty({ type: ShippingChargesDto, required: false })
  @ValidateNested()
  @Type(() => ShippingChargesDto)
  @IsOptional()
  shippingCharges?: ShippingChargesDto;

  @ApiProperty({ type: [ContainerDto], required: false })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContainerDto)
  @IsOptional()
  containers?: ContainerDto[];
}

// ----------------------------------------------------
// RECEIPTS
// ----------------------------------------------------
export class CreateReceiptDto {
  @ApiProperty({ example: '2026-11-10' })
  @IsString()
  @IsNotEmpty()
  receiptDate!: string;

  @ApiProperty({ description: 'Commercial Invoice UUID being settled' })
  @IsUUID()
  @IsNotEmpty()
  commercialInvoiceId!: string;

  @ApiProperty({ description: 'Customer UUID' })
  @IsUUID()
  @IsNotEmpty()
  customerId!: string;

  @ApiProperty({ example: 98000.0, description: 'Amount received in invoice currency' })
  @IsNumber()
  @Min(0.01)
  amountReceived!: number;

  @ApiProperty({ example: 'USD', default: 'USD' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiProperty({ example: 'WIRE_TRANSFER', enum: ['WIRE_TRANSFER', 'LC_NEGOTIATION', 'CHEQUE', 'OTHER'] })
  @IsString()
  @IsNotEmpty()
  paymentMode!: string;

  @ApiProperty({ example: 'SWIFT-REF-20261109987', required: false })
  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  bankDetailsId?: string;
}
