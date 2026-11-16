import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CompaniesService } from '../companies/companies.service.js';
import { PdfService } from '../pdf/pdf.service.js';
import {
  CreateCommercialInvoiceDto,
  CreateProductionOrderDto,
  CreateProformaInvoiceDto,
  CreateReceiptDto,
} from './dto/sales.dto.js';
import { SalesService } from './sales.service.js';

@ApiTags('Sales & Export Documents')
@ApiSecurity('bearer')
@Controller('sales')
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly pdfService: PdfService,
    private readonly companiesService: CompaniesService,
  ) {}

  private getCompanyContext(req: Request): {
    companyId: string;
    companyCode: string;
  } {
    const user = (req as any).user;
    return {
      companyId:
        user?.activeCompanyId ||
        (req.headers['x-company-id'] as string) ||
        '00000000-0000-0000-0000-000000000001',
      companyCode: user?.activeCompanyCode || 'RMM',
    };
  }

  // ----------------------------------------------------
  // PROFORMA INVOICES
  // ----------------------------------------------------
  @Get('proformas')
  @ApiOperation({
    summary: 'List all Proforma Invoices for the active exporting company',
  })
  @ApiResponse({ status: 200, description: 'Proforma invoices list' })
  async listProformas(@Req() req: Request) {
    const { companyId } = this.getCompanyContext(req);
    return this.salesService.listProformas(companyId);
  }

  @Post('proformas')
  @ApiOperation({
    summary:
      'Issue a new Proforma Invoice (atomic gap-free numbering & frozen terms)',
  })
  @ApiResponse({ status: 201, description: 'Proforma invoice created' })
  async createProforma(
    @Req() req: Request,
    @Body() dto: CreateProformaInvoiceDto,
  ) {
    const { companyId, companyCode } = this.getCompanyContext(req);
    const user = (req as any).user;

    return this.salesService.createProformaInvoice(
      companyId,
      companyCode,
      dto,
      user?.sub || 'usr-mock',
      user?.username || 'admin',
    );
  }

  @Get('proformas/reports/field-usage')
  @ApiOperation({
    summary:
      'Aggregate a single proforma field across all PIs (e.g. most-used payment terms)',
  })
  @ApiQuery({
    name: 'field',
    description:
      'paymentTerms | incoterm | currency | brand | portOfLoading | portOfDischarge | finalDestination | status | specCropYear',
  })
  async proformaFieldUsage(
    @Req() req: Request,
    @Query('field') field: string,
  ) {
    const { companyId } = this.getCompanyContext(req);
    return this.salesService.getProformaFieldUsage(companyId, field);
  }

  @Get('proformas/reports/terms-usage')
  @ApiOperation({
    summary: 'Aggregate how often each Term & Condition line is used across PIs',
  })
  async proformaTermsUsage(@Req() req: Request) {
    const { companyId } = this.getCompanyContext(req);
    return this.salesService.getProformaTermsUsage(companyId);
  }

  @Get('proformas/:id')
  @ApiOperation({ summary: 'Get full Proforma Invoice detail (items, terms, parties, bank)' })
  @ApiParam({ name: 'id', description: 'Proforma Invoice UUID' })
  async getProforma(@Req() req: Request, @Param('id') id: string) {
    const { companyId } = this.getCompanyContext(req);
    return this.salesService.getProformaById(companyId, id);
  }

  @Get('proformas/:id/pdf')
  @ApiOperation({ summary: 'Download the print-faithful Proforma Invoice PDF' })
  @ApiParam({ name: 'id', description: 'Proforma Invoice UUID' })
  async getProformaPdf(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { companyId } = this.getCompanyContext(req);
    const detail = await this.salesService.getProformaById(companyId, id);
    const company = await this.companiesService.getCompanyById(companyId);
    const p = detail.proforma;

    const addressLines = [
      company.addressLine1,
      company.addressLine2 || '',
      `${company.city}, ${company.state} - ${company.pincode}`,
      `GSTIN: ${company.gstin || '-'}  |  IEC: ${company.iecCode || '-'}`,
    ].filter(Boolean);

    const pdf = await this.pdfService.generateProformaInvoicePdf({
      company: {
        name: company.name,
        code: company.code,
        legalName: company.legalName,
        addressLines,
        gstin: company.gstin || undefined,
        iec: company.iecCode || undefined,
      },
      documentNumber: p.documentNumber,
      documentDate: p.documentDate,
      buyerPoRef: p.buyerPoRef || undefined,
      poDate: p.poDate || undefined,
      lcNumber: p.lcNumber || undefined,
      lcDate: p.lcDate || undefined,
      currency: p.currency,
      incoterm: p.incoterm,
      paymentTerms: p.paymentTerms,
      consignee: detail.consignee || undefined,
      buyer: detail.buyer || undefined,
      notifyParty: detail.notifyParty || undefined,
      countryOfOrigin: p.countryOfOrigin,
      portOfLoading: p.portOfLoading,
      portOfDischarge: p.portOfDischarge,
      finalDestination: p.finalDestination,
      modeOfShipment: p.modeOfShipment,
      items: detail.items.map((it) => ({
        lineNumber: it.lineNumber,
        productName: it.productName || 'Product',
        description: it.specifications || undefined,
        packingText: it.packingText || undefined,
        hsCode: it.hsCode || undefined,
        cropYear: it.cropYear || undefined,
        quantityMt: Number(it.quantityMt),
        ratePerMt: Number(it.ratePerMt),
        amount: Number(it.amount),
      })),
      totalQuantityMt: Number(p.totalQuantityMt),
      goodsSubtotal: Number(p.totalAmount),
      freightAmount: Number(p.freightAmount),
      insuranceAmount: Number(p.insuranceAmount),
      discountAmount: Number(p.discountAmount),
      grandTotal: Number(p.grandTotal),
      amountInWords: p.amountInWords || '',
      bankDetails: detail.bank
        ? {
            accountName: detail.bank.accountName,
            bankName: detail.bank.bankName,
            accountNumber: detail.bank.accountNumber,
            swiftCode: detail.bank.swiftCode,
            ifscAdCode:
              [detail.bank.ifscCode, detail.bank.adCode]
                .filter(Boolean)
                .join(' / ') || undefined,
          }
        : undefined,
      terms: detail.terms.map((t) => t.content),
      sections: {
        showNotifyParty: p.showNotifyParty,
        showShippingDetails: p.showShippingDetails,
        showBankDetails: p.showBankDetails,
        showLcDetails: p.showLcDetails,
        showTermsConditions: p.showTermsConditions,
        showSignatureBlock: p.showSignatureBlock,
      },
      footer: {
        addressLine: `${company.legalName}, ${company.addressLine1}, ${company.city}, ${company.state}`,
        contactLine: `GSTIN: ${company.gstin || '-'}  |  IEC: ${company.iecCode || '-'}  |  Email: ${company.contactEmail || '-'}`,
      },
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Proforma_${p.documentNumber.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }

  @Delete('proformas/:id')
  @ApiOperation({ summary: 'Soft-delete a Proforma Invoice' })
  @ApiParam({ name: 'id', description: 'Proforma Invoice UUID' })
  @ApiQuery({ name: 'reason', required: false })
  async deleteProforma(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    const { companyId } = this.getCompanyContext(req);
    const user = (req as any).user;
    return this.salesService.deleteProforma(
      companyId,
      id,
      user?.sub || 'usr-mock',
      user?.username || 'admin',
      reason,
    );
  }

  // ----------------------------------------------------
  // PRODUCTION ORDERS
  // ----------------------------------------------------
  @Get('production-orders')
  @ApiOperation({
    summary: 'List all Production Orders dispatched to rice mills',
  })
  @ApiResponse({ status: 200, description: 'Production orders list' })
  async listProductionOrders(@Req() req: Request) {
    const { companyId } = this.getCompanyContext(req);
    return this.salesService.listProductionOrders(companyId);
  }

  @Post('production-orders')
  @ApiOperation({
    summary:
      'Create Production Order with strict Rule 8 remaining-quantity verification',
  })
  @ApiResponse({ status: 201, description: 'Production order created' })
  async createProductionOrder(
    @Req() req: Request,
    @Body() dto: CreateProductionOrderDto,
  ) {
    const { companyId, companyCode } = this.getCompanyContext(req);
    const user = (req as any).user;

    return this.salesService.createProductionOrder(
      companyId,
      companyCode,
      dto,
      user?.sub || 'usr-mock',
      user?.username || 'admin',
    );
  }

  @Get('production-orders/:id')
  @ApiOperation({ summary: 'Get full Production Order detail' })
  @ApiParam({ name: 'id', description: 'Production Order UUID' })
  async getProductionOrder(@Req() req: Request, @Param('id') id: string) {
    const { companyId } = this.getCompanyContext(req);
    return this.salesService.getProductionOrderById(companyId, id);
  }

  @Get('production-orders/:id/pdf')
  @ApiOperation({ summary: 'Download the print-faithful Production Order PDF' })
  @ApiParam({ name: 'id', description: 'Production Order UUID' })
  async getProductionOrderPdf(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { companyId } = this.getCompanyContext(req);
    const detail = await this.salesService.getProductionOrderById(companyId, id);
    const company = await this.companiesService.getCompanyById(companyId);
    const o = detail.order;

    const addressLines = [
      company.addressLine1,
      company.addressLine2 || '',
      `${company.city}, ${company.state} - ${company.pincode}`,
    ].filter(Boolean);

    const pdf = await this.pdfService.generateProductionOrderPdf({
      company: {
        name: company.name,
        code: company.code,
        legalName: company.legalName,
        addressLines,
      },
      documentNumber: o.documentNumber,
      documentDate: o.documentDate,
      buyer: detail.buyer || undefined,
      consignee: detail.consignee || undefined,
      notifyParty: detail.notifyParty || undefined,
      buyerPoRef: o.buyerPoRef || o.buyerPoNumber || undefined,
      poDate: o.poDate || undefined,
      incoterm: o.incoterm,
      currency: o.currency,
      status: o.status,
      spec: {
        variety: o.specVariety || undefined,
        avgLength: o.specAvgLengthMm != null ? String(o.specAvgLengthMm) : undefined,
        moisture: o.specMoisturePct != null ? String(o.specMoisturePct) : undefined,
        broken: o.specBrokenPct != null ? String(o.specBrokenPct) : undefined,
        cropYear: o.specCropYear || undefined,
      },
      shipping: {
        portOfLoading: o.portOfLoading || undefined,
        portOfDischarge: o.portOfDischarge || undefined,
        destinationCountry: o.destinationCountry || undefined,
        vesselFlightNo: o.vesselFlightNo || undefined,
        transport: o.transport || undefined,
        vehicleNo: o.vehicleNo || undefined,
        brand: o.brand || undefined,
      },
      items: detail.items.map((it) => ({
        lineNumber: it.lineNumber,
        productName: it.productName || 'Product',
        packing: it.packingText || it.packingName || '',
        noOfBags: it.noOfBags,
        quantityMt: Number(it.quantityMt),
        description: it.specifications || undefined,
      })),
      totalQuantityMt: Number(o.totalQuantityMt),
      totalBags: o.totalBags,
      instructions: [o.millingInstructions, o.packagingInstructions, o.orderRemark]
        .filter(Boolean)
        .join('\n'),
      terms: detail.terms.map((t) => t.content),
      showSignature: o.showSignature,
      footer: {
        line: `${company.legalName}, ${company.addressLine1}, ${company.city}, ${company.state}`,
      },
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="ProductionOrder_${o.documentNumber.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }

  @Delete('production-orders/:id')
  @ApiOperation({ summary: 'Soft-delete a Production Order' })
  @ApiParam({ name: 'id', description: 'Production Order UUID' })
  @ApiQuery({ name: 'reason', required: false })
  async deleteProductionOrder(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    const { companyId } = this.getCompanyContext(req);
    const user = (req as any).user;
    return this.salesService.deleteProductionOrder(
      companyId,
      id,
      user?.sub || 'usr-mock',
      user?.username || 'admin',
      reason,
    );
  }

  // ----------------------------------------------------
  // COMMERCIAL INVOICES & PACKING LISTS
  // ----------------------------------------------------
  @Get('invoices')
  @ApiOperation({
    summary: 'List all Commercial Export Invoices for the active company',
  })
  @ApiResponse({ status: 200, description: 'Commercial invoices list' })
  async listCommercialInvoices(@Req() req: Request) {
    const { companyId } = this.getCompanyContext(req);
    return this.salesService.listCommercialInvoices(companyId);
  }

  @Get('invoices/:id')
  @ApiOperation({
    summary: 'Get Commercial Invoice details with items, shipping charges, and container packing',
  })
  @ApiParam({ name: 'id', description: 'Commercial Invoice UUID' })
  @ApiResponse({ status: 200, description: 'Commercial invoice full details' })
  async getCommercialInvoice(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const { companyId } = this.getCompanyContext(req);
    return this.salesService.getCommercialInvoiceById(companyId, id);
  }

  @Post('invoices')
  @ApiOperation({
    summary:
      'Generate Commercial Export Invoice with automated Rule 7 Incoterm freight, insurance, and amount-in-words calculation',
  })
  @ApiResponse({ status: 201, description: 'Commercial invoice generated' })
  async createCommercialInvoice(
    @Req() req: Request,
    @Body() dto: CreateCommercialInvoiceDto,
  ) {
    const { companyId, companyCode } = this.getCompanyContext(req);
    const user = (req as any).user;

    return this.salesService.createCommercialInvoice(
      companyId,
      companyCode,
      dto,
      user?.sub || 'usr-mock',
      user?.username || 'admin',
    );
  }

  @Get('invoices/:id/pdf')
  @ApiOperation({ summary: 'Download the print-faithful Commercial Invoice PDF' })
  @ApiParam({ name: 'id', description: 'Commercial Invoice UUID' })
  async getCommercialInvoicePdf(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { companyId } = this.getCompanyContext(req);
    const detail = await this.salesService.getCommercialInvoiceById(companyId, id);
    const company = await this.companiesService.getCompanyById(companyId);
    const inv = detail.invoice;

    const addressLines = [
      company.addressLine1,
      company.addressLine2 || '',
      `${company.city}, ${company.state} - ${company.pincode}`,
      `GSTIN: ${company.gstin || '-'}`,
    ].filter(Boolean);

    const totalNet = detail.items.reduce((a, it) => a + Number(it.quantityMt), 0);
    const introParts = [
      detail.items.reduce((a, it) => a + (it.noOfBags || 0), 0)
        ? `TOTAL ${detail.items.reduce((a, it) => a + (it.noOfBags || 0), 0)} BAGS`
        : '',
      inv.brand ? `BAGS MARKS: ${inv.brand}` : '',
      inv.goodsDescription || '',
    ].filter(Boolean);

    const pdf = await this.pdfService.generateInvoicePdf({
      company: {
        name: company.name,
        code: company.code,
        legalName: company.legalName,
        addressLines,
        gstin: company.gstin || undefined,
        iec: company.iecCode || undefined,
        lutNumber: company.lutNumber || undefined,
      },
      documentNumber: inv.documentNumber,
      documentDate: inv.documentDate,
      buyerOrderNoAndDate: inv.buyerPoNumber || undefined,
      consignee: detail.consignee || undefined,
      buyer: detail.buyer || undefined,
      notifyParty: detail.notifyParty || undefined,
      bank: detail.bank
        ? {
            bankName: detail.bank.bankName,
            accountNumber: detail.bank.accountNumber,
            swiftCode: detail.bank.swiftCode,
            adCode: detail.bank.adCode,
            ifscCode: detail.bank.ifscCode,
          }
        : undefined,
      currency: inv.currency,
      incoterm: inv.incoterm,
      shipping: {
        preCarriageBy: inv.preCarriageBy || undefined,
        placeOfReceipt: inv.placeOfReceipt || undefined,
        countryOfOrigin: inv.countryOfOrigin || undefined,
        destinationCountry: inv.countryOfDestination || undefined,
        vesselFlightNo: inv.vesselFlightName || undefined,
        portOfLoading: inv.portOfLoading || undefined,
        portOfDischarge: inv.portOfDischarge || undefined,
        finalDestination: inv.countryOfDestination || undefined,
        termsOfDelivery: inv.termsOf || `${inv.incoterm}`,
        payment: inv.paymentTerm || undefined,
      },
      brand: inv.brand || undefined,
      marksNumbers: inv.brand || inv.marksNumbers || undefined,
      hsCode: detail.items[0]?.hsCode || undefined,
      goodsIntro: introParts.join('\n') || undefined,
      items: detail.items.map((it) => ({
        description:
          `${it.packingText || it.packingName || it.productName || ''}` +
          (it.noOfBags ? ` (BAGS ${it.noOfBags})` : ''),
        quantityMt: Number(it.quantityMt),
        pricePerMt: Number(it.ratePerMt),
        amount: Number(it.amount),
      })),
      totalQuantityMt: totalNet,
      totalNetWeightMt: totalNet,
      totalGrossWeightMt: inv.grossWtMt != null ? Number(inv.grossWtMt) : undefined,
      totalFobValue: Number(inv.totalFobAmount),
      oceanFreightAmount: Number(inv.oceanFreightAmount),
      insuranceAmount: Number(inv.insuranceAmount),
      totalCfrValue: Number(inv.totalInvoiceAmount),
      amountInWords: inv.amountInWords || '',
      blNumber: inv.blNumber || inv.ladingBlNumber || undefined,
      blDate: inv.blDate || inv.ladingBlDate || undefined,
      shippingBillNumber: inv.shippingBillNumber || undefined,
      shippingBillDate: inv.shippingBillDate || undefined,
      showSignature: inv.showSignature,
      footer: {
        addressLine: `${company.legalName}, ${company.addressLine1}, ${company.city}, ${company.state}`,
        contactLine: `GSTIN: ${company.gstin || '-'}  |  IEC: ${company.iecCode || '-'}  |  Email: ${company.contactEmail || '-'}`,
      },
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Invoice_${inv.documentNumber.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }

  @Delete('invoices/:id')
  @ApiOperation({ summary: 'Soft-delete a Commercial Invoice' })
  @ApiParam({ name: 'id', description: 'Commercial Invoice UUID' })
  @ApiQuery({ name: 'reason', required: false })
  async deleteCommercialInvoice(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    const { companyId } = this.getCompanyContext(req);
    const user = (req as any).user;
    return this.salesService.deleteCommercialInvoice(
      companyId,
      id,
      user?.sub || 'usr-mock',
      user?.username || 'admin',
      reason,
    );
  }

  // ----------------------------------------------------
  // PAYMENT RECEIPTS
  // ----------------------------------------------------
  @Get('receipts')
  @ApiOperation({
    summary: 'List all export payment receipts recorded for active company',
  })
  @ApiResponse({ status: 200, description: 'Payment receipts list' })
  async listReceipts(@Req() req: Request) {
    const { companyId } = this.getCompanyContext(req);
    return this.salesService.listReceipts(companyId);
  }

  @Post('receipts')
  @ApiOperation({
    summary: 'Record foreign exchange payment receipt against a Commercial Invoice',
  })
  @ApiResponse({ status: 201, description: 'Receipt recorded' })
  async createReceipt(
    @Req() req: Request,
    @Body() dto: CreateReceiptDto,
  ) {
    const { companyId, companyCode } = this.getCompanyContext(req);
    const user = (req as any).user;

    return this.salesService.createReceipt(
      companyId,
      companyCode,
      dto,
      user?.sub || 'usr-mock',
      user?.username || 'admin',
    );
  }
}
