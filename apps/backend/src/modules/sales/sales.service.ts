import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { DatabaseService } from '../../database/database.service.js';
import {
  bankDetails,
  commercialInvoices,
  containers,
  customers,
  invoiceItems,
  packingTypes,
  productionOrderItems,
  productionOrders,
  productionTerms,
  products,
  proformaInvoices,
  proformaItems,
  proformaTerms,
  receipts,
  shippingCharges,
  type CommercialInvoice,
  type Container,
  type InvoiceItem,
  type ProductionOrder,
  type ProductionOrderItem,
  type ProductionTerm,
  type ProformaInvoice,
  type ProformaItem,
  type ProformaTerm,
  type Receipt,
  type ShippingCharge,
} from '../../database/schema/index.js';
import { ActivityLogService } from '../activity-log/activity-log.service.js';
import {
  computeFinancialYear,
  DocumentNumberingService,
} from '../document-numbering/document-numbering.service.js';
import type {
  CreateCommercialInvoiceDto,
  CreateProductionOrderDto,
  CreateProformaInvoiceDto,
  CreateReceiptDto,
} from './dto/sales.dto.js';
import {
  computeShippingCharges,
  convertAmountToWords,
} from './utils/export-calculations.js';

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly numberingService: DocumentNumberingService,
    private readonly activityLogService: ActivityLogService,
  ) {}

  // -------------------------------------------------------------------------
  // PROFORMA INVOICES (Quotation to Foreign Buyer)
  // -------------------------------------------------------------------------
  async createProformaInvoice(
    companyId: string,
    companyCode: string,
    dto: CreateProformaInvoiceDto,
    userId: string,
    username: string,
  ): Promise<ProformaInvoice> {
    const docDate = new Date(dto.documentDate);
    const fy = computeFinancialYear(docDate);

    // 1. Document number: manual if supplied, otherwise auto-allocated
    let documentNumber: string;
    const manualNumber = dto.documentNumber?.trim();
    if (manualNumber) {
      documentNumber = manualNumber;
      if (this.databaseService.isConnected) {
        const [dup] = await this.databaseService.db
          .select({ id: proformaInvoices.id })
          .from(proformaInvoices)
          .where(
            and(
              eq(proformaInvoices.companyId, companyId),
              eq(proformaInvoices.documentNumber, documentNumber),
              isNull(proformaInvoices.deletedAt),
            ),
          )
          .limit(1);
        if (dup) {
          throw new ConflictException(
            `Proforma number "${documentNumber}" already exists. Use a different number.`,
          );
        }
      }
    } else {
      const numbering = await this.numberingService.allocateNextNumber(
        companyId,
        companyCode,
        'PROFORMA',
        docDate,
      );
      documentNumber = numbering.documentNumber;
    }

    // 2. Compute authoritative line and document totals
    let totalQtyMt = 0;
    let goodsSubtotal = 0;

    const lineCalculations = dto.items.map((item, idx) => {
      const lineAmt = Math.round(item.quantityMt * item.ratePerMt * 100) / 100;
      totalQtyMt += item.quantityMt;
      goodsSubtotal += lineAmt;
      return {
        lineNumber: idx + 1,
        productId: item.productId,
        packingTypeId: item.packingTypeId,
        packingText: item.packingText,
        hsCode: item.hsCode,
        cropYear: item.cropYear,
        quantityMt: item.quantityMt,
        ratePerMt: item.ratePerMt,
        brokenPct: item.brokenPct,
        cgst: item.cgst ?? 0,
        sgst: item.sgst ?? 0,
        igst: item.igst ?? 0,
        specifications: item.specifications,
        amount: lineAmt,
      };
    });

    goodsSubtotal = Math.round(goodsSubtotal * 100) / 100;
    const freight = dto.freightAmount ?? 0;
    const insurance = dto.insuranceAmount ?? 0;
    const discount = dto.discountAmount ?? 0;
    const grandTotal =
      Math.round((goodsSubtotal + freight + insurance - discount) * 100) / 100;
    const currency = dto.currency || 'USD';
    const amountInWords = convertAmountToWords(grandTotal, currency);
    const status = dto.status || 'CONFIRMED';

    if (!this.databaseService.isConnected) {
      throw new BadRequestException(
        'Database is not connected. Configure DATABASE_URL to create proforma invoices.',
      );
    }

    const db = this.databaseService.db;

    const created = await db.transaction(async (tx) => {
      const [pi] = await tx
        .insert(proformaInvoices)
        .values({
          companyId,
          documentNumber,
          documentDate: dto.documentDate,
          financialYear: fy,
          customerId: dto.customerId,
          consigneeId: dto.consigneeId || null,
          notifyPartyId: dto.notifyPartyId || null,
          buyerPoRef: dto.buyerPoRef || null,
          poDate: dto.poDate || null,
          lcNumber: dto.lcNumber || null,
          lcDate: dto.lcDate || null,
          incoterm: dto.incoterm,
          currency,
          exchangeRate: (dto.exchangeRate ?? 1).toFixed(4),
          paymentTerms: dto.paymentTerms,
          deliveryTimeline: dto.deliveryTimeline || null,
          countryOfOrigin: dto.countryOfOrigin || 'India',
          goodsCountry: dto.goodsCountry || null,
          portOfLoading: dto.portOfLoading,
          portOfDischarge: dto.portOfDischarge,
          finalDestination: dto.finalDestination,
          modeOfShipment: dto.modeOfShipment || 'By sea, FCL container',
          brand: dto.brand || null,
          blend: dto.blend || null,
          specVariety: dto.specVariety || null,
          specAvgLengthMm:
            dto.specAvgLengthMm != null ? String(dto.specAvgLengthMm) : null,
          specMoisturePct:
            dto.specMoisturePct != null ? String(dto.specMoisturePct) : null,
          specBrokenPct:
            dto.specBrokenPct != null ? String(dto.specBrokenPct) : null,
          specCropYear: dto.specCropYear || null,
          bankDetailsId: dto.bankDetailsId || null,
          totalQuantityMt: totalQtyMt.toFixed(3),
          totalAmount: goodsSubtotal.toFixed(2),
          freightAmount: freight.toFixed(2),
          insuranceAmount: insurance.toFixed(2),
          discountAmount: discount.toFixed(2),
          grandTotal: grandTotal.toFixed(2),
          amountInWords,
          showNotifyParty: dto.showNotifyParty ?? true,
          showShippingDetails: dto.showShippingDetails ?? true,
          showSpecification: dto.showSpecification ?? true,
          showBankDetails: dto.showBankDetails ?? true,
          showLcDetails: dto.showLcDetails ?? true,
          showTermsConditions: dto.showTermsConditions ?? true,
          showSignatureBlock: dto.showSignatureBlock ?? true,
          frozenTerms: (dto.terms || []).map((t) => t.content).join('\n'),
          status,
          version: 1,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();

      for (const line of lineCalculations) {
        await tx.insert(proformaItems).values({
          proformaInvoiceId: pi.id,
          lineNumber: line.lineNumber,
          productId: line.productId,
          packingTypeId: line.packingTypeId,
          packingText: line.packingText || null,
          hsCode: line.hsCode || null,
          cropYear: line.cropYear || null,
          quantityMt: line.quantityMt.toFixed(3),
          allocatedProductionMt: '0.000',
          ratePerMt: line.ratePerMt.toFixed(2),
          amount: line.amount.toFixed(2),
          brokenPct: line.brokenPct != null ? String(line.brokenPct) : null,
          cgst: line.cgst.toFixed(2),
          sgst: line.sgst.toFixed(2),
          igst: line.igst.toFixed(2),
          specifications: line.specifications || null,
        });
      }

      // Each selected term is persisted as its own queryable row
      let position = 0;
      for (const term of dto.terms || []) {
        await tx.insert(proformaTerms).values({
          proformaInvoiceId: pi.id,
          termId: term.termId || null,
          position: position++,
          content: term.content,
        });
      }

      await this.activityLogService.record(
        {
          companyId,
          userId,
          username,
          action: 'CREATE',
          entityTable: 'proforma_invoices',
          entityId: pi.id,
          newValues: {
            documentNumber: pi.documentNumber,
            grandTotal: pi.grandTotal,
          },
        },
        tx,
      );

      return pi;
    });

    return created;
  }

  async listProformas(companyId: string): Promise<
    Array<
      ProformaInvoice & {
        consigneeName: string | null;
        buyerName: string | null;
      }
    >
  > {
    if (!this.databaseService.isConnected) return [];
    const buyer = alias(customers, 'buyer');
    const rows = await this.databaseService.db
      .select({
        pi: proformaInvoices,
        consigneeName: customers.name,
        buyerName: buyer.name,
      })
      .from(proformaInvoices)
      .leftJoin(customers, eq(proformaInvoices.customerId, customers.id))
      .leftJoin(buyer, eq(proformaInvoices.consigneeId, buyer.id))
      .where(
        and(
          eq(proformaInvoices.companyId, companyId),
          isNull(proformaInvoices.deletedAt),
        ),
      )
      .orderBy(desc(proformaInvoices.createdAt));

    return rows.map((r) => ({
      ...r.pi,
      consigneeName: r.consigneeName,
      buyerName: r.buyerName,
    }));
  }

  async getProformaById(
    companyId: string,
    id: string,
  ): Promise<{
    proforma: ProformaInvoice;
    items: Array<
      ProformaItem & { productName: string | null; packingName: string | null }
    >;
    terms: ProformaTerm[];
    consignee: { name: string; address: string; country: string } | null;
    buyer: { name: string; address: string; country: string } | null;
    notifyParty: { name: string; address: string; country: string } | null;
    bank: {
      bankName: string;
      accountName: string;
      accountNumber: string;
      ifscCode: string | null;
      swiftCode: string;
      adCode: string;
    } | null;
  }> {
    if (!this.databaseService.isConnected) {
      throw new NotFoundException('Database not connected');
    }
    const db = this.databaseService.db;

    const [proforma] = await db
      .select()
      .from(proformaInvoices)
      .where(
        and(
          eq(proformaInvoices.id, id),
          eq(proformaInvoices.companyId, companyId),
          isNull(proformaInvoices.deletedAt),
        ),
      );

    if (!proforma) {
      throw new NotFoundException(`Proforma ${id} not found`);
    }

    const items = await db
      .select({
        item: proformaItems,
        productName: products.name,
        packingName: packingTypes.name,
      })
      .from(proformaItems)
      .leftJoin(products, eq(proformaItems.productId, products.id))
      .leftJoin(packingTypes, eq(proformaItems.packingTypeId, packingTypes.id))
      .where(eq(proformaItems.proformaInvoiceId, id))
      .orderBy(asc(proformaItems.lineNumber));

    const terms = await db
      .select()
      .from(proformaTerms)
      .where(eq(proformaTerms.proformaInvoiceId, id))
      .orderBy(asc(proformaTerms.position));

    const partyById = async (customerId: string | null) => {
      if (!customerId) return null;
      const [c] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, customerId));
      return c
        ? { name: c.name, address: c.address, country: c.country }
        : null;
    };

    const consignee = await partyById(proforma.customerId);
    const buyer = await partyById(proforma.consigneeId);
    const notifyParty = await partyById(proforma.notifyPartyId);

    let bank = null as null | {
      bankName: string;
      accountName: string;
      accountNumber: string;
      ifscCode: string | null;
      swiftCode: string;
      adCode: string;
    };
    if (proforma.bankDetailsId) {
      const [b] = await db
        .select()
        .from(bankDetails)
        .where(eq(bankDetails.id, proforma.bankDetailsId));
      if (b) {
        bank = {
          bankName: b.bankName,
          accountName: b.accountName,
          accountNumber: b.accountNumber,
          ifscCode: b.ifscCode,
          swiftCode: b.swiftCode,
          adCode: b.adCode,
        };
      }
    }

    return {
      proforma,
      items: items.map((r) => ({
        ...r.item,
        productName: r.productName,
        packingName: r.packingName,
      })),
      terms,
      consignee,
      buyer,
      notifyParty,
      bank,
    };
  }

  async deleteProforma(
    companyId: string,
    id: string,
    userId: string,
    username: string,
    reason?: string,
  ): Promise<{ message: string }> {
    if (!this.databaseService.isConnected) {
      throw new NotFoundException('Database not connected');
    }
    const [existing] = await this.databaseService.db
      .select()
      .from(proformaInvoices)
      .where(
        and(
          eq(proformaInvoices.id, id),
          eq(proformaInvoices.companyId, companyId),
          isNull(proformaInvoices.deletedAt),
        ),
      );
    if (!existing) {
      throw new NotFoundException(`Proforma ${id} not found`);
    }

    await this.databaseService.db
      .update(proformaInvoices)
      .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: userId })
      .where(eq(proformaInvoices.id, id));

    await this.activityLogService.record({
      companyId,
      userId,
      username,
      action: 'DELETE',
      entityTable: 'proforma_invoices',
      entityId: id,
      deletionReason: reason || 'Deleted from Proforma Invoices screen',
      previousValues: { documentNumber: existing.documentNumber },
    });

    return { message: 'Proforma invoice deleted successfully' };
  }

  // -------------------------------------------------------------------------
  // CROSS-DOCUMENT REPORTING (every field is an independent queryable entity)
  // -------------------------------------------------------------------------
  private static readonly REPORTABLE_PI_FIELDS: Record<string, AnyPgColumn> = {
    paymentTerms: proformaInvoices.paymentTerms,
    incoterm: proformaInvoices.incoterm,
    currency: proformaInvoices.currency,
    brand: proformaInvoices.brand,
    portOfLoading: proformaInvoices.portOfLoading,
    portOfDischarge: proformaInvoices.portOfDischarge,
    finalDestination: proformaInvoices.finalDestination,
    status: proformaInvoices.status,
    specCropYear: proformaInvoices.specCropYear,
  };

  async getProformaFieldUsage(
    companyId: string,
    field: string,
  ): Promise<{
    field: string;
    rows: Array<{ value: string; count: number; totalAmount: number }>;
  }> {
    const column = SalesService.REPORTABLE_PI_FIELDS[field];
    if (!column) {
      throw new BadRequestException(
        `Field "${field}" is not reportable. Allowed: ${Object.keys(
          SalesService.REPORTABLE_PI_FIELDS,
        ).join(', ')}`,
      );
    }
    if (!this.databaseService.isConnected) return { field, rows: [] };

    const result = await this.databaseService.db
      .select({
        value: sql<string>`coalesce(${column}::text, '(none)')`,
        count: sql<number>`count(*)::int`,
        totalAmount: sql<number>`coalesce(sum(${proformaInvoices.grandTotal}), 0)::float8`,
      })
      .from(proformaInvoices)
      .where(
        and(
          eq(proformaInvoices.companyId, companyId),
          isNull(proformaInvoices.deletedAt),
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`);

    return {
      field,
      rows: result.map((r) => ({
        value: r.value,
        count: Number(r.count),
        totalAmount: Number(r.totalAmount),
      })),
    };
  }

  async getProformaTermsUsage(
    companyId: string,
  ): Promise<Array<{ value: string; count: number }>> {
    if (!this.databaseService.isConnected) return [];
    const result = await this.databaseService.db
      .select({
        value: proformaTerms.content,
        count: sql<number>`count(*)::int`,
      })
      .from(proformaTerms)
      .innerJoin(
        proformaInvoices,
        eq(proformaTerms.proformaInvoiceId, proformaInvoices.id),
      )
      .where(
        and(
          eq(proformaInvoices.companyId, companyId),
          isNull(proformaInvoices.deletedAt),
        ),
      )
      .groupBy(proformaTerms.content)
      .orderBy(sql`count(*) desc`);

    return result.map((r) => ({ value: r.value, count: Number(r.count) }));
  }

  // -------------------------------------------------------------------------
  // PRODUCTION ORDERS (internal work order for the production department)
  // -------------------------------------------------------------------------
  async createProductionOrder(
    companyId: string,
    companyCode: string,
    dto: CreateProductionOrderDto,
    userId: string,
    username: string,
  ): Promise<ProductionOrder> {
    const docDate = new Date(dto.documentDate);

    if (!this.databaseService.isConnected) {
      throw new BadRequestException(
        'Database is not connected. Configure DATABASE_URL to create production orders.',
      );
    }
    const db = this.databaseService.db;

    // Document number: manual if supplied, else auto-allocated
    let documentNumber: string;
    const manualNumber = dto.documentNumber?.trim();
    if (manualNumber) {
      documentNumber = manualNumber;
      const [dup] = await db
        .select({ id: productionOrders.id })
        .from(productionOrders)
        .where(
          and(
            eq(productionOrders.companyId, companyId),
            eq(productionOrders.documentNumber, documentNumber),
            isNull(productionOrders.deletedAt),
          ),
        )
        .limit(1);
      if (dup) {
        throw new ConflictException(
          `Order number "${documentNumber}" already exists. Use a different number.`,
        );
      }
    } else {
      const numbering = await this.numberingService.allocateNextNumber(
        companyId,
        companyCode,
        'PRODUCTION_ORDER',
        docDate,
      );
      documentNumber = numbering.documentNumber;
    }

    let totalQty = 0;
    let totalBags = 0;
    let totalAmount = 0;
    const lines = dto.items.map((item, idx) => {
      const rate = item.ratePerMt ?? 0;
      const amount = Math.round(item.quantityMt * rate * 100) / 100;
      totalQty += item.quantityMt;
      totalBags += item.noOfBags ?? 0;
      totalAmount += amount;
      return { ...item, lineNumber: idx + 1, rate, amount };
    });
    totalAmount = Math.round(totalAmount * 100) / 100;

    const num = (n: number | undefined | null) =>
      n != null ? String(n) : null;

    const created = await db.transaction(async (tx) => {
      const [po] = await tx
        .insert(productionOrders)
        .values({
          companyId,
          documentNumber,
          documentDate: dto.documentDate,
          proformaInvoiceId: dto.proformaInvoiceId || null,
          buyerPoNumber: dto.buyerPoNumber || null,
          buyerPoRef: dto.buyerPoRef || null,
          poDate: dto.poDate || null,
          supplierMillId: dto.supplierMillId || null,
          customerId: dto.customerId || null,
          consigneeId: dto.consigneeId || null,
          notifyPartyId: dto.notifyPartyId || null,
          incoterm: dto.incoterm || 'FOB',
          currency: dto.currency || 'USD',
          exchangeRate: (dto.exchangeRate ?? 1).toFixed(4),
          lcNumber: dto.lcNumber || null,
          lcDate: dto.lcDate || null,
          freightAmount: (dto.freightAmount ?? 0).toFixed(2),
          insuranceAmount: (dto.insuranceAmount ?? 0).toFixed(2),
          fcl: dto.fcl || null,
          preCarriageBy: dto.preCarriageBy || null,
          placeOfReceipt: dto.placeOfReceipt || null,
          countryOfOrigin: dto.countryOfOrigin || 'India',
          countryFinalDestination: dto.countryFinalDestination || null,
          vesselFlightNo: dto.vesselFlightNo || null,
          portOfLoading: dto.portOfLoading || null,
          portOfDischarge: dto.portOfDischarge || null,
          destinationCountry: dto.destinationCountry || null,
          termsOf: dto.termsOf || null,
          paymentTerm: dto.paymentTerm || null,
          brand: dto.brand || null,
          transport: dto.transport || null,
          vehicleNo: dto.vehicleNo || null,
          orderRemark: dto.orderRemark || null,
          specVariety: dto.specVariety || null,
          specAvgLengthMm: num(dto.specAvgLengthMm),
          specMoisturePct: num(dto.specMoisturePct),
          specBrokenPct: num(dto.specBrokenPct),
          specCropYear: dto.specCropYear || null,
          millingInstructions: dto.millingInstructions || null,
          packagingInstructions: dto.packagingInstructions || null,
          totalQuantityMt: totalQty.toFixed(3),
          totalBags,
          totalAmount: totalAmount.toFixed(2),
          allocatedInvoiceMt: '0.000',
          showSignature: dto.showSignature ?? true,
          frozenTerms: (dto.terms || []).map((t) => t.content).join('\n'),
          status: dto.status || 'OPEN',
          version: 1,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();

      for (const line of lines) {
        await tx.insert(productionOrderItems).values({
          productionOrderId: po.id,
          lineNumber: line.lineNumber,
          productId: line.productId,
          packingTypeId: line.packingTypeId || null,
          packingText: line.packingText || null,
          hsCode: line.hsCode || null,
          cropYear: line.cropYear || null,
          noOfBags: line.noOfBags ?? 0,
          quantityMt: line.quantityMt.toFixed(3),
          grossWtMt: num(line.grossWtMt),
          ratePerMt: line.rate.toFixed(2),
          amount: line.amount.toFixed(2),
          cgst: (line.cgst ?? 0).toFixed(2),
          sgst: (line.sgst ?? 0).toFixed(2),
          igst: (line.igst ?? 0).toFixed(2),
          brokenBelow: line.brokenBelow ?? false,
          fcl: line.fcl ?? false,
          allocatedInvoiceMt: '0.000',
          specifications: line.specifications || null,
        });
      }

      let position = 0;
      for (const term of dto.terms || []) {
        await tx.insert(productionTerms).values({
          productionOrderId: po.id,
          termId: term.termId || null,
          position: position++,
          content: term.content,
        });
      }

      await this.activityLogService.record(
        {
          companyId,
          userId,
          username,
          action: 'CREATE',
          entityTable: 'production_orders',
          entityId: po.id,
          newValues: {
            documentNumber: po.documentNumber,
            totalQuantityMt: po.totalQuantityMt,
          },
        },
        tx,
      );

      return po;
    });

    return created;
  }

  async listProductionOrders(companyId: string): Promise<
    Array<ProductionOrder & { customerName: string | null; invoiceCount: number }>
  > {
    if (!this.databaseService.isConnected) return [];
    const rows = await this.databaseService.db
      .select({
        po: productionOrders,
        customerName: customers.name,
        invoiceCount: sql<number>`(
          select count(*)::int from ${commercialInvoices}
          where ${commercialInvoices.productionOrderId} = ${productionOrders.id}
            and ${commercialInvoices.deletedAt} is null
        )`,
      })
      .from(productionOrders)
      .leftJoin(customers, eq(productionOrders.customerId, customers.id))
      .where(
        and(
          eq(productionOrders.companyId, companyId),
          isNull(productionOrders.deletedAt),
        ),
      )
      .orderBy(desc(productionOrders.createdAt));

    return rows.map((r) => ({
      ...r.po,
      customerName: r.customerName,
      invoiceCount: Number(r.invoiceCount),
    }));
  }

  async getProductionOrderById(
    companyId: string,
    id: string,
  ): Promise<{
    order: ProductionOrder;
    items: Array<
      ProductionOrderItem & {
        productName: string | null;
        packingName: string | null;
      }
    >;
    terms: ProductionTerm[];
    buyer: { name: string; address: string; country: string } | null;
    consignee: { name: string; address: string; country: string } | null;
    notifyParty: { name: string; address: string; country: string } | null;
  }> {
    if (!this.databaseService.isConnected) {
      throw new NotFoundException('Database not connected');
    }
    const db = this.databaseService.db;

    const [order] = await db
      .select()
      .from(productionOrders)
      .where(
        and(
          eq(productionOrders.id, id),
          eq(productionOrders.companyId, companyId),
          isNull(productionOrders.deletedAt),
        ),
      );
    if (!order) throw new NotFoundException(`Production order ${id} not found`);

    const items = await db
      .select({
        item: productionOrderItems,
        productName: products.name,
        packingName: packingTypes.name,
      })
      .from(productionOrderItems)
      .leftJoin(products, eq(productionOrderItems.productId, products.id))
      .leftJoin(
        packingTypes,
        eq(productionOrderItems.packingTypeId, packingTypes.id),
      )
      .where(eq(productionOrderItems.productionOrderId, id))
      .orderBy(asc(productionOrderItems.lineNumber));

    const terms = await db
      .select()
      .from(productionTerms)
      .where(eq(productionTerms.productionOrderId, id))
      .orderBy(asc(productionTerms.position));

    const partyById = async (customerId: string | null) => {
      if (!customerId) return null;
      const [c] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, customerId));
      return c
        ? { name: c.name, address: c.address, country: c.country }
        : null;
    };

    return {
      order,
      items: items.map((r) => ({
        ...r.item,
        productName: r.productName,
        packingName: r.packingName,
      })),
      terms,
      buyer: await partyById(order.customerId),
      consignee: await partyById(order.consigneeId),
      notifyParty: await partyById(order.notifyPartyId),
    };
  }

  async deleteProductionOrder(
    companyId: string,
    id: string,
    userId: string,
    username: string,
    reason?: string,
  ): Promise<{ message: string }> {
    if (!this.databaseService.isConnected) {
      throw new NotFoundException('Database not connected');
    }
    const [existing] = await this.databaseService.db
      .select()
      .from(productionOrders)
      .where(
        and(
          eq(productionOrders.id, id),
          eq(productionOrders.companyId, companyId),
          isNull(productionOrders.deletedAt),
        ),
      );
    if (!existing) throw new NotFoundException(`Production order ${id} not found`);

    await this.databaseService.db
      .update(productionOrders)
      .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: userId })
      .where(eq(productionOrders.id, id));

    await this.activityLogService.record({
      companyId,
      userId,
      username,
      action: 'DELETE',
      entityTable: 'production_orders',
      entityId: id,
      deletionReason: reason || 'Deleted from Production Orders screen',
      previousValues: { documentNumber: existing.documentNumber },
    });

    return { message: 'Production order deleted successfully' };
  }

  // -------------------------------------------------------------------------
  // COMMERCIAL INVOICES & PACKING LISTS (Customs & Bank Settlement)
  // -------------------------------------------------------------------------
  async createCommercialInvoice(
    companyId: string,
    companyCode: string,
    dto: CreateCommercialInvoiceDto,
    userId: string,
    username: string,
  ): Promise<CommercialInvoice> {
    const docDate = new Date(dto.documentDate);
    const fy = computeFinancialYear(docDate);

    // 1. Transactional number allocation: <CODE>/EX/<FY>/<no>
    const numbering = await this.numberingService.allocateNextNumber(
      companyId,
      companyCode,
      'COMMERCIAL_INVOICE',
      docDate,
    );

    // 2. Line calculation
    let totalFobAmount = 0;
    const lineCalculations = dto.items.map((item) => {
      const lineAmt = Math.round(item.quantityMt * item.ratePerMt * 100) / 100;
      totalFobAmount += lineAmt;
      return {
        productId: item.productId,
        packingTypeId: item.packingTypeId,
        quantityMt: item.quantityMt,
        ratePerMt: item.ratePerMt,
        specifications: item.specifications,
        amount: lineAmt,
      };
    });
    totalFobAmount = Math.round(totalFobAmount * 100) / 100;

    // 3. Rule 7: Incoterm shipping charges calculation
    const shipping = computeShippingCharges(
      dto.incoterm,
      dto.shippingCharges || {},
    );
    const oceanFreightAmount = shipping.oceanFreightCharge;
    const insuranceAmount = shipping.insuranceCharge;
    const totalInvoiceAmount =
      Math.round(
        (totalFobAmount + oceanFreightAmount + insuranceAmount) * 100,
      ) / 100;

    const currency = dto.currency || 'USD';
    const amountInWords = convertAmountToWords(totalInvoiceAmount, currency);

    if (!this.databaseService.isConnected) {
      return {
        id: 'mock-ci-uuid',
        companyId,
        documentNumber: numbering.documentNumber,
        documentDate: dto.documentDate,
        financialYear: fy,
        proformaInvoiceId: dto.proformaInvoiceId || null,
        productionOrderId: dto.productionOrderId || null,
        buyerPoNumber: dto.buyerPoNumber || null,
        customerId: dto.customerId,
        consigneeId: dto.consigneeId || null,
        notifyPartyId: dto.notifyPartyId || null,
        shippingBillNumber: dto.shippingBillNumber || null,
        shippingBillDate: null,
        blNumber: dto.blNumber || null,
        blDate: null,
        vesselFlightName: dto.vesselFlightName || null,
        voyageNumber: null,
        portOfLoading: dto.portOfLoading,
        portOfDischarge: dto.portOfDischarge,
        countryOfOrigin: 'India',
        countryOfDestination: dto.countryOfDestination,
        incoterm: dto.incoterm,
        currency,
        exchangeRate: '1.0000',
        totalFobAmount: totalFobAmount.toFixed(2),
        oceanFreightAmount: oceanFreightAmount.toFixed(2),
        insuranceAmount: insuranceAmount.toFixed(2),
        totalInvoiceAmount: totalInvoiceAmount.toFixed(2),
        amountInWords,
        lutNumber: null,
        bankDetailsId: dto.bankDetailsId || null,
        frozenTerms: 'Snapshotted Commercial Terms',
        status: 'ISSUED',
        version: 1,
        deletedAt: null,
        createdBy: userId,
        updatedBy: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    const db = this.databaseService.db;

    const createdInvoice = await db.transaction(async (tx) => {
      // If linked to production order, validate remaining balance
      if (dto.productionOrderId) {
        const [po] = await tx
          .select()
          .from(productionOrders)
          .where(eq(productionOrders.id, dto.productionOrderId))
          .for('update');

        if (!po) {
          throw new NotFoundException(
            `Production Order ${dto.productionOrderId} not found`,
          );
        }

        const totalPoQty = parseFloat(po.totalQuantityMt);
        const alreadyInvoiced = parseFloat(po.allocatedInvoiceMt);
        const remainingPoQty = totalPoQty - alreadyInvoiced;

        let totalInvQty = 0;
        for (const item of dto.items) {
          totalInvQty += item.quantityMt;
        }

        if (totalInvQty > remainingPoQty + 0.0001) {
          throw new BadRequestException(
            `Total invoice quantity ${totalInvQty.toFixed(
              3,
            )} MT exceeds remaining production order balance of ${remainingPoQty.toFixed(
              3,
            )} MT`,
          );
        }

        const newAllocatedInvoice = alreadyInvoiced + totalInvQty;
        await tx
          .update(productionOrders)
          .set({ allocatedInvoiceMt: newAllocatedInvoice.toFixed(3) })
          .where(eq(productionOrders.id, dto.productionOrderId));
      }

      // Insert Commercial Invoice
      const [invoice] = await tx
        .insert(commercialInvoices)
        .values({
          companyId,
          documentNumber: numbering.documentNumber,
          documentDate: dto.documentDate,
          financialYear: fy,
          proformaInvoiceId: dto.proformaInvoiceId || null,
          productionOrderId: dto.productionOrderId || null,
          buyerPoNumber: dto.buyerPoNumber || null,
          customerId: dto.customerId,
          consigneeId: dto.consigneeId || null,
          notifyPartyId: dto.notifyPartyId || null,
          shippingBillNumber: dto.shippingBillNumber || null,
          shippingBillDate: null,
          blNumber: dto.blNumber || null,
          blDate: null,
          vesselFlightName: dto.vesselFlightName || null,
          voyageNumber: null,
          portOfLoading: dto.portOfLoading,
          portOfDischarge: dto.portOfDischarge,
          countryOfOrigin: 'India',
          countryOfDestination: dto.countryOfDestination,
          incoterm: dto.incoterm,
          currency,
          exchangeRate: '1.0000',
          totalFobAmount: totalFobAmount.toFixed(2),
          oceanFreightAmount: oceanFreightAmount.toFixed(2),
          insuranceAmount: insuranceAmount.toFixed(2),
          totalInvoiceAmount: totalInvoiceAmount.toFixed(2),
          amountInWords,
          lutNumber: null,
          bankDetailsId: dto.bankDetailsId || null,
          frozenTerms: 'Snapshotted Commercial Terms',
          status: 'ISSUED',
          version: 1,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();

      // Insert Items
      for (const line of lineCalculations) {
        await tx.insert(invoiceItems).values({
          invoiceId: invoice.id,
          productId: line.productId,
          packingTypeId: line.packingTypeId,
          quantityMt: line.quantityMt.toFixed(3),
          ratePerMt: line.ratePerMt.toFixed(2),
          amount: line.amount.toFixed(2),
          specifications: line.specifications || null,
        });
      }

      // Insert Shipping Charges (Rule 7)
      await tx.insert(shippingCharges).values({
        invoiceId: invoice.id,
        incoterm: dto.incoterm,
        thcCharge: shipping.thcCharge.toFixed(2),
        blCharge: shipping.blCharge.toFixed(2),
        sealCharge: shipping.sealCharge.toFixed(2),
        mucCharge: shipping.mucCharge.toFixed(2),
        riskCharge: shipping.riskCharge.toFixed(2),
        repositionCharge: shipping.repositionCharge.toFixed(2),
        oceanFreightCharge: shipping.oceanFreightCharge.toFixed(2),
        insuranceCharge: shipping.insuranceCharge.toFixed(2),
        totalShippingCharge: shipping.totalShippingCharge.toFixed(2),
      });

      // Insert Packing List Containers if provided
      if (dto.containers && dto.containers.length > 0) {
        for (const c of dto.containers) {
          await tx.insert(containers).values({
            invoiceId: invoice.id,
            containerNumber: c.containerNumber,
            sealNumber: c.sealNumber,
            containerSize: c.containerSize || '20FT',
            totalBags: c.totalBags,
            grossWeightKg: c.grossWeightKg.toFixed(3),
            netWeightKg: c.netWeightKg.toFixed(3),
          });
        }
      }

      // Audit Log
      await this.activityLogService.record(
        {
          companyId,
          userId,
          username,
          action: 'CREATE',
          entityTable: 'commercial_invoices',
          entityId: invoice.id,
          newValues: {
            documentNumber: invoice.documentNumber,
            totalInvoiceAmount: invoice.totalInvoiceAmount,
            incoterm: invoice.incoterm,
          },
        },
        tx,
      );

      return invoice;
    });

    return createdInvoice;
  }

  async listCommercialInvoices(
    companyId: string,
  ): Promise<CommercialInvoice[]> {
    if (!this.databaseService.isConnected) return [];
    return this.databaseService.db
      .select()
      .from(commercialInvoices)
      .where(
        and(
          eq(commercialInvoices.companyId, companyId),
          isNull(commercialInvoices.deletedAt),
        ),
      )
      .orderBy(desc(commercialInvoices.documentDate));
  }

  async getCommercialInvoiceById(
    companyId: string,
    id: string,
  ): Promise<{
    invoice: CommercialInvoice;
    items: InvoiceItem[];
    shippingCharges: ShippingCharge | null;
    containers: Container[];
  }> {
    if (!this.databaseService.isConnected) {
      throw new NotFoundException('Database not connected in mock mode');
    }

    const [invoice] = await this.databaseService.db
      .select()
      .from(commercialInvoices)
      .where(
        and(
          eq(commercialInvoices.id, id),
          eq(commercialInvoices.companyId, companyId),
          isNull(commercialInvoices.deletedAt),
        ),
      );

    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    const items = await this.databaseService.db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, id));

    const [shipping] = await this.databaseService.db
      .select()
      .from(shippingCharges)
      .where(eq(shippingCharges.invoiceId, id));

    const containerList = await this.databaseService.db
      .select()
      .from(containers)
      .where(eq(containers.invoiceId, id));

    return {
      invoice,
      items,
      shippingCharges: shipping || null,
      containers: containerList,
    };
  }

  // -------------------------------------------------------------------------
  // RECEIPTS (Payment tracking against Commercial Invoices)
  // -------------------------------------------------------------------------
  async createReceipt(
    companyId: string,
    companyCode: string,
    dto: CreateReceiptDto,
    userId: string,
    username: string,
  ): Promise<Receipt> {
    const recDate = new Date(dto.receiptDate);
    const fy = computeFinancialYear(recDate);

    // Numbering allocation: REC-<CODE>/<FY>/<no>
    const numbering = await this.numberingService.allocateNextNumber(
      companyId,
      companyCode,
      'RECEIPT',
      recDate,
    );

    if (!this.databaseService.isConnected) {
      return {
        id: 'mock-receipt-uuid',
        companyId,
        receiptNumber: numbering.documentNumber,
        receiptDate: dto.receiptDate,
        financialYear: fy,
        commercialInvoiceId: dto.commercialInvoiceId,
        customerId: dto.customerId,
        amountReceived: dto.amountReceived.toFixed(2),
        currency: dto.currency || 'USD',
        exchangeRate: '1.0000',
        bankDetailsId: dto.bankDetailsId || null,
        paymentMode: dto.paymentMode,
        referenceNumber: dto.referenceNumber || null,
        remarks: dto.remarks || null,
        version: 1,
        deletedAt: null,
        createdBy: userId,
        updatedBy: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    const db = this.databaseService.db;

    const createdReceipt = await db.transaction(async (tx) => {
      // Verify Commercial Invoice belongs to company
      const [invoice] = await tx
        .select()
        .from(commercialInvoices)
        .where(
          and(
            eq(commercialInvoices.id, dto.commercialInvoiceId),
            eq(commercialInvoices.companyId, companyId),
            isNull(commercialInvoices.deletedAt),
          ),
        );

      if (!invoice) {
        throw new NotFoundException(
          `Commercial Invoice ${dto.commercialInvoiceId} not found for active company`,
        );
      }

      const [receipt] = await tx
        .insert(receipts)
        .values({
          companyId,
          receiptNumber: numbering.documentNumber,
          receiptDate: dto.receiptDate,
          financialYear: fy,
          commercialInvoiceId: dto.commercialInvoiceId,
          customerId: dto.customerId,
          amountReceived: dto.amountReceived.toFixed(2),
          currency: dto.currency || 'USD',
          exchangeRate: '1.0000',
          bankDetailsId: dto.bankDetailsId || null,
          paymentMode: dto.paymentMode,
          referenceNumber: dto.referenceNumber || null,
          remarks: dto.remarks || null,
          version: 1,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();

      await this.activityLogService.record(
        {
          companyId,
          userId,
          username,
          action: 'CREATE',
          entityTable: 'receipts',
          entityId: receipt.id,
          newValues: {
            receiptNumber: receipt.receiptNumber,
            amountReceived: receipt.amountReceived,
            invoiceNumber: invoice.documentNumber,
          },
        },
        tx,
      );

      return receipt;
    });

    return createdReceipt;
  }

  async listReceipts(companyId: string): Promise<Receipt[]> {
    if (!this.databaseService.isConnected) return [];
    return this.databaseService.db
      .select()
      .from(receipts)
      .where(
        and(eq(receipts.companyId, companyId), isNull(receipts.deletedAt)),
      )
      .orderBy(desc(receipts.receiptDate));
  }
}
