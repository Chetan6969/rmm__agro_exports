import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
} from './dto/customer.dto.js';
import { CreateProductDto } from './dto/product.dto.js';
import {
  CreateCountryDto,
  CreatePortDto,
  CreateShippingLineDto,
  CreateTermDto,
} from './dto/master-refs.dto.js';
import { MasterDataService } from './master-data.service.js';

@ApiTags('Master Data')
@ApiSecurity('bearer')
@Controller('master-data')
export class MasterDataController {
  constructor(private readonly masterDataService: MasterDataService) {}

  private getCompanyId(req: Request): string {
    const user = (req as any).user;
    return (
      user?.activeCompanyId ||
      (req.headers['x-company-id'] as string) ||
      '00000000-0000-0000-0000-000000000001'
    );
  }

  // Customers
  @Get('customers')
  @ApiOperation({ summary: 'List all active customers, buyers and consignees' })
  @ApiResponse({ status: 200, description: 'Customer list' })
  async listCustomers(@Req() req: Request) {
    return this.masterDataService.listCustomers(this.getCompanyId(req));
  }

  @Get('customers/:id')
  @ApiOperation({ summary: 'Get customer by ID' })
  async getCustomer(@Req() req: Request, @Param('id') id: string) {
    return this.masterDataService.getCustomerById(this.getCompanyId(req), id);
  }

  @Post('customers')
  @ApiOperation({ summary: 'Create a new customer / buyer' })
  async createCustomer(
    @Req() req: Request,
    @Body() dto: CreateCustomerDto,
  ) {
    const user = (req as any).user;
    return this.masterDataService.createCustomer(
      this.getCompanyId(req),
      dto,
      user?.sub || 'usr-mock',
      user?.username || 'admin',
    );
  }

  @Put('customers/:id')
  @ApiOperation({
    summary:
      'Update customer with optimistic locking (requires version field)',
  })
  async updateCustomer(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    const user = (req as any).user;
    return this.masterDataService.updateCustomer(
      this.getCompanyId(req),
      id,
      dto,
      user?.sub || 'usr-mock',
      user?.username || 'admin',
    );
  }

  @Delete('customers/:id')
  @ApiOperation({ summary: 'Soft delete a customer' })
  @ApiQuery({ name: 'reason', required: false })
  async deleteCustomer(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    const user = (req as any).user;
    return this.masterDataService.deleteCustomer(
      this.getCompanyId(req),
      id,
      user?.sub || 'usr-mock',
      user?.username || 'admin',
      reason,
    );
  }

  // Products
  @Get('products')
  @ApiOperation({ summary: 'List all Basmati rice products and varieties' })
  async listProducts(@Req() req: Request) {
    return this.masterDataService.listProducts(this.getCompanyId(req));
  }

  @Post('products')
  @ApiOperation({ summary: 'Create a new product variety' })
  async createProduct(@Req() req: Request, @Body() dto: CreateProductDto) {
    const user = (req as any).user;
    return this.masterDataService.createProduct(
      this.getCompanyId(req),
      dto,
      user?.sub || 'usr-mock',
      user?.username || 'admin',
    );
  }

  // Reference Masters
  @Get('packing-types')
  @ApiOperation({ summary: 'List packaging bag styles and weights' })
  async listPackingTypes(@Req() req: Request) {
    return this.masterDataService.listPackingTypes(this.getCompanyId(req));
  }

  // Ports
  @Get('ports')
  @ApiOperation({ summary: 'List ports of loading and discharge' })
  async listPorts(@Req() req: Request) {
    return this.masterDataService.listPorts(this.getCompanyId(req));
  }

  @Post('ports')
  @ApiOperation({ summary: 'Create a port' })
  async createPort(@Req() req: Request, @Body() dto: CreatePortDto) {
    return this.masterDataService.createPort(this.getCompanyId(req), dto);
  }

  @Put('ports/:id')
  @ApiOperation({ summary: 'Update a port' })
  async updatePort(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreatePortDto,
  ) {
    return this.masterDataService.updatePort(this.getCompanyId(req), id, dto);
  }

  @Delete('ports/:id')
  @ApiOperation({ summary: 'Soft-delete a port' })
  async deletePort(@Req() req: Request, @Param('id') id: string) {
    return this.masterDataService.deletePort(this.getCompanyId(req), id);
  }

  // Shipping lines
  @Get('shipping-lines')
  @ApiOperation({ summary: 'List carrier shipping lines' })
  async listShippingLines(@Req() req: Request) {
    return this.masterDataService.listShippingLines(this.getCompanyId(req));
  }

  @Post('shipping-lines')
  @ApiOperation({ summary: 'Create a shipping line' })
  async createShippingLine(
    @Req() req: Request,
    @Body() dto: CreateShippingLineDto,
  ) {
    return this.masterDataService.createShippingLine(this.getCompanyId(req), dto);
  }

  @Put('shipping-lines/:id')
  @ApiOperation({ summary: 'Update a shipping line' })
  async updateShippingLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateShippingLineDto,
  ) {
    return this.masterDataService.updateShippingLine(
      this.getCompanyId(req),
      id,
      dto,
    );
  }

  @Delete('shipping-lines/:id')
  @ApiOperation({ summary: 'Soft-delete a shipping line' })
  async deleteShippingLine(@Req() req: Request, @Param('id') id: string) {
    return this.masterDataService.deleteShippingLine(this.getCompanyId(req), id);
  }

  // Countries
  @Get('countries')
  @ApiOperation({ summary: 'List destination / origin countries' })
  async listCountries(@Req() req: Request) {
    return this.masterDataService.listCountries(this.getCompanyId(req));
  }

  @Post('countries')
  @ApiOperation({ summary: 'Create a country' })
  async createCountry(@Req() req: Request, @Body() dto: CreateCountryDto) {
    return this.masterDataService.createCountry(this.getCompanyId(req), dto);
  }

  @Put('countries/:id')
  @ApiOperation({ summary: 'Update a country' })
  async updateCountry(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateCountryDto,
  ) {
    return this.masterDataService.updateCountry(this.getCompanyId(req), id, dto);
  }

  @Delete('countries/:id')
  @ApiOperation({ summary: 'Soft-delete a country' })
  async deleteCountry(@Req() req: Request, @Param('id') id: string) {
    return this.masterDataService.deleteCountry(this.getCompanyId(req), id);
  }

  @Get('bank-details')
  @ApiOperation({ summary: 'List company bank accounts and AD codes' })
  async listBankDetails(@Req() req: Request) {
    return this.masterDataService.listBankDetails(this.getCompanyId(req));
  }

  @Get('terms')
  @ApiOperation({ summary: 'List master terms and conditions' })
  @ApiQuery({ name: 'documentType', required: false })
  async listTerms(
    @Req() req: Request,
    @Query('documentType') documentType?: string,
  ) {
    return this.masterDataService.listTerms(
      this.getCompanyId(req),
      documentType,
    );
  }

  @Post('terms')
  @ApiOperation({ summary: 'Create a term & condition' })
  async createTerm(@Req() req: Request, @Body() dto: CreateTermDto) {
    return this.masterDataService.createTerm(this.getCompanyId(req), dto);
  }

  @Put('terms/:id')
  @ApiOperation({ summary: 'Update a term & condition' })
  async updateTerm(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateTermDto,
  ) {
    return this.masterDataService.updateTerm(this.getCompanyId(req), id, dto);
  }

  @Delete('terms/:id')
  @ApiOperation({ summary: 'Soft-delete a term & condition' })
  async deleteTerm(@Req() req: Request, @Param('id') id: string) {
    return this.masterDataService.deleteTerm(this.getCompanyId(req), id);
  }
}
