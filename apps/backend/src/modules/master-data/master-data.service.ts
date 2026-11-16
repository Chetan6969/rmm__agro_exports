import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import {
  bankDetails,
  countries,
  customers,
  packingTypes,
  ports,
  products,
  shippingLines,
  termsAndConditions,
  type BankDetail,
  type Country,
  type Customer,
  type NewCustomer,
  type NewProduct,
  type PackingType,
  type Port,
  type Product,
  type ShippingLine,
  type TermsAndCondition,
} from '../../database/schema/index.js';
import { ActivityLogService } from '../activity-log/activity-log.service.js';
import type {
  CreateCustomerDto,
  UpdateCustomerDto,
} from './dto/customer.dto.js';
import type { CreateProductDto } from './dto/product.dto.js';
import type {
  CreateCountryDto,
  CreatePortDto,
  CreateShippingLineDto,
  CreateTermDto,
} from './dto/master-refs.dto.js';

@Injectable()
export class MasterDataService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly activityLogService: ActivityLogService,
  ) {}

  // ----------------------------------------------------
  // CUSTOMERS (Buyers, Consignees, Notify Parties)
  // ----------------------------------------------------
  async listCustomers(companyId: string): Promise<Customer[]> {
    if (!this.databaseService.isConnected) {
      return [];
    }

    return this.databaseService.db
      .select()
      .from(customers)
      .where(
        and(eq(customers.companyId, companyId), isNull(customers.deletedAt)),
      )
      .orderBy(customers.name);
  }

  async getCustomerById(companyId: string, id: string): Promise<Customer> {
    if (!this.databaseService.isConnected) {
      throw new NotFoundException(`Customer ${id} not found`);
    }

    const rows = await this.databaseService.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.id, id),
          eq(customers.companyId, companyId),
          isNull(customers.deletedAt),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException(`Customer ${id} not found`);
    }

    return rows[0];
  }

  async createCustomer(
    companyId: string,
    dto: CreateCustomerDto,
    userId: string,
    username: string,
  ): Promise<Customer> {
    if (!this.databaseService.isConnected) {
      return {
        id: 'mock-customer-id',
        companyId,
        name: dto.name,
        address: dto.address,
        country: dto.country,
        code: dto.code || null,
        contactPerson: dto.contactPerson || null,
        email: dto.email || null,
        phone: dto.phone || null,
        city: dto.city || null,
        taxId: dto.taxId || null,
        isBuyer: dto.isBuyer ?? true,
        isConsignee: dto.isConsignee ?? true,
        isNotifyParty: dto.isNotifyParty ?? true,
        version: 1,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    const newRecord: NewCustomer = {
      companyId,
      name: dto.name,
      code: dto.code || null,
      contactPerson: dto.contactPerson || null,
      email: dto.email || null,
      phone: dto.phone || null,
      address: dto.address,
      city: dto.city || null,
      country: dto.country,
      taxId: dto.taxId || null,
      isBuyer: dto.isBuyer ?? true,
      isConsignee: dto.isConsignee ?? true,
      isNotifyParty: dto.isNotifyParty ?? true,
      version: 1,
    };

    const inserted = await this.databaseService.db
      .insert(customers)
      .values(newRecord)
      .returning();

    const created = inserted[0];

    await this.activityLogService.record({
      companyId,
      userId,
      username,
      action: 'CREATE',
      entityTable: 'customers',
      entityId: created.id,
      newValues: { name: created.name, country: created.country },
    });

    return created;
  }

  async updateCustomer(
    companyId: string,
    id: string,
    dto: UpdateCustomerDto,
    userId: string,
    username: string,
  ): Promise<Customer> {
    if (!this.databaseService.isConnected) {
      return {
        id,
        companyId,
        name: dto.name,
        address: dto.address,
        country: dto.country,
        code: dto.code || null,
        contactPerson: dto.contactPerson || null,
        email: dto.email || null,
        phone: dto.phone || null,
        city: dto.city || null,
        taxId: dto.taxId || null,
        isBuyer: dto.isBuyer ?? true,
        isConsignee: dto.isConsignee ?? true,
        isNotifyParty: dto.isNotifyParty ?? true,
        version: dto.version + 1,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    const existing = await this.getCustomerById(companyId, id);

    // Optimistic Concurrency Control
    if (existing.version !== dto.version) {
      throw new ConflictException(
        'Record changed: another user has modified this customer. Please refresh and try again.',
      );
    }

    const updated = await this.databaseService.db
      .update(customers)
      .set({
        name: dto.name,
        code: dto.code || null,
        contactPerson: dto.contactPerson || null,
        email: dto.email || null,
        phone: dto.phone || null,
        address: dto.address,
        city: dto.city || null,
        country: dto.country,
        taxId: dto.taxId || null,
        isBuyer: dto.isBuyer ?? existing.isBuyer,
        isConsignee: dto.isConsignee ?? existing.isConsignee,
        isNotifyParty: dto.isNotifyParty ?? existing.isNotifyParty,
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customers.id, id),
          eq(customers.companyId, companyId),
          eq(customers.version, dto.version),
        ),
      )
      .returning();

    if (updated.length === 0) {
      throw new ConflictException(
        'Record changed: concurrent modification detected.',
      );
    }

    await this.activityLogService.record({
      companyId,
      userId,
      username,
      action: 'UPDATE',
      entityTable: 'customers',
      entityId: id,
      previousValues: { name: existing.name, version: existing.version },
      newValues: { name: updated[0].name, version: updated[0].version },
    });

    return updated[0];
  }

  async deleteCustomer(
    companyId: string,
    id: string,
    userId: string,
    username: string,
    reason?: string,
  ): Promise<{ message: string }> {
    if (!this.databaseService.isConnected) {
      return { message: 'Customer soft-deleted successfully' };
    }

    const existing = await this.getCustomerById(companyId, id);

    await this.databaseService.db
      .update(customers)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(customers.id, id), eq(customers.companyId, companyId)));

    await this.activityLogService.record({
      companyId,
      userId,
      username,
      action: 'DELETE',
      entityTable: 'customers',
      entityId: id,
      deletionReason: reason || 'Soft deleted from Master Data screen',
      previousValues: { name: existing.name },
    });

    return { message: 'Customer soft-deleted successfully' };
  }

  // ----------------------------------------------------
  // PRODUCTS (Basmati Rice Varieties, HSN Codes, Specs)
  // ----------------------------------------------------
  async listProducts(companyId: string): Promise<Product[]> {
    if (!this.databaseService.isConnected) {
      return [];
    }

    return this.databaseService.db
      .select()
      .from(products)
      .where(and(eq(products.companyId, companyId), isNull(products.deletedAt)))
      .orderBy(products.name);
  }

  async createProduct(
    companyId: string,
    dto: CreateProductDto,
    userId: string,
    username: string,
  ): Promise<Product> {
    if (!this.databaseService.isConnected) {
      return {
        id: 'mock-product-id',
        companyId,
        name: dto.name,
        code: dto.code || null,
        hsnCode: dto.hsnCode || '10063020',
        variety: dto.variety,
        processingType: dto.processingType,
        defaultBrokenPercentage: dto.defaultBrokenPercentage || '1.00',
        grainLengthMm: dto.grainLengthMm || '8.35',
        moistureMaxPercentage: dto.moistureMaxPercentage || '12.50',
        purityPercentage: dto.purityPercentage || '95.00',
        description: dto.description || null,
        version: 1,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    const newRecord: NewProduct = {
      companyId,
      name: dto.name,
      code: dto.code || null,
      hsnCode: dto.hsnCode || '10063020',
      variety: dto.variety,
      processingType: dto.processingType,
      defaultBrokenPercentage: dto.defaultBrokenPercentage || '1.00',
      grainLengthMm: dto.grainLengthMm || '8.35',
      moistureMaxPercentage: dto.moistureMaxPercentage || '12.50',
      purityPercentage: dto.purityPercentage || '95.00',
      description: dto.description || null,
      version: 1,
    };

    const inserted = await this.databaseService.db
      .insert(products)
      .values(newRecord)
      .returning();

    const created = inserted[0];

    await this.activityLogService.record({
      companyId,
      userId,
      username,
      action: 'CREATE',
      entityTable: 'products',
      entityId: created.id,
      newValues: { name: created.name, variety: created.variety },
    });

    return created;
  }

  // ----------------------------------------------------
  // PACKING TYPES, PORTS, SHIPPING LINES, BANKS, TERMS
  // ----------------------------------------------------
  async listPackingTypes(companyId: string): Promise<PackingType[]> {
    if (!this.databaseService.isConnected) return [];
    return this.databaseService.db
      .select()
      .from(packingTypes)
      .where(
        and(
          eq(packingTypes.companyId, companyId),
          isNull(packingTypes.deletedAt),
        ),
      )
      .orderBy(packingTypes.name);
  }

  async createPackingType(
    companyId: string,
    data: { name: string; material: string; weightKg: string },
  ): Promise<PackingType> {
    if (!this.databaseService.isConnected) {
      return {
        id: 'mock-packing-id',
        companyId,
        name: data.name,
        material: data.material,
        weightKg: data.weightKg,
        version: 1,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    const inserted = await this.databaseService.db
      .insert(packingTypes)
      .values({
        companyId,
        name: data.name,
        material: data.material,
        weightKg: data.weightKg,
        version: 1,
      })
      .returning();

    return inserted[0];
  }

  async listPorts(companyId: string): Promise<Port[]> {
    if (!this.databaseService.isConnected) return [];
    return this.databaseService.db
      .select()
      .from(ports)
      .where(and(eq(ports.companyId, companyId), isNull(ports.deletedAt)))
      .orderBy(ports.name);
  }

  async listShippingLines(companyId: string): Promise<ShippingLine[]> {
    if (!this.databaseService.isConnected) return [];
    return this.databaseService.db
      .select()
      .from(shippingLines)
      .where(
        and(
          eq(shippingLines.companyId, companyId),
          isNull(shippingLines.deletedAt),
        ),
      )
      .orderBy(shippingLines.name);
  }

  async listBankDetails(companyId: string): Promise<BankDetail[]> {
    if (!this.databaseService.isConnected) return [];
    return this.databaseService.db
      .select()
      .from(bankDetails)
      .where(
        and(eq(bankDetails.companyId, companyId), isNull(bankDetails.deletedAt)),
      )
      .orderBy(desc(bankDetails.isDefault), bankDetails.bankName);
  }

  async listTerms(
    companyId: string,
    documentType?: string,
  ): Promise<TermsAndCondition[]> {
    if (!this.databaseService.isConnected) return [];
    const query = this.databaseService.db
      .select()
      .from(termsAndConditions)
      .where(
        and(
          eq(termsAndConditions.companyId, companyId),
          isNull(termsAndConditions.deletedAt),
          documentType
            ? eq(termsAndConditions.documentType, documentType)
            : undefined,
        ),
      );

    return query.orderBy(desc(termsAndConditions.isDefault));
  }

  // ----------------------------------------------------
  // PORTS — CRUD
  // ----------------------------------------------------
  async createPort(companyId: string, dto: CreatePortDto): Promise<Port> {
    const [row] = await this.databaseService.db
      .insert(ports)
      .values({
        companyId,
        name: dto.name,
        code: dto.code || null,
        portType: dto.portType,
        country: dto.country,
        version: 1,
      })
      .returning();
    return row;
  }

  async updatePort(
    companyId: string,
    id: string,
    dto: CreatePortDto,
  ): Promise<Port> {
    const [row] = await this.databaseService.db
      .update(ports)
      .set({
        name: dto.name,
        code: dto.code || null,
        portType: dto.portType,
        country: dto.country,
        updatedAt: new Date(),
      })
      .where(and(eq(ports.id, id), eq(ports.companyId, companyId)))
      .returning();
    if (!row) throw new NotFoundException(`Port ${id} not found`);
    return row;
  }

  async deletePort(companyId: string, id: string): Promise<{ message: string }> {
    await this.databaseService.db
      .update(ports)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(ports.id, id), eq(ports.companyId, companyId)));
    return { message: 'Port deleted' };
  }

  // ----------------------------------------------------
  // SHIPPING LINES — CRUD
  // ----------------------------------------------------
  async createShippingLine(
    companyId: string,
    dto: CreateShippingLineDto,
  ): Promise<ShippingLine> {
    const [row] = await this.databaseService.db
      .insert(shippingLines)
      .values({
        companyId,
        name: dto.name,
        code: dto.code || null,
        contactDetails: dto.contactDetails || null,
        version: 1,
      })
      .returning();
    return row;
  }

  async updateShippingLine(
    companyId: string,
    id: string,
    dto: CreateShippingLineDto,
  ): Promise<ShippingLine> {
    const [row] = await this.databaseService.db
      .update(shippingLines)
      .set({
        name: dto.name,
        code: dto.code || null,
        contactDetails: dto.contactDetails || null,
        updatedAt: new Date(),
      })
      .where(and(eq(shippingLines.id, id), eq(shippingLines.companyId, companyId)))
      .returning();
    if (!row) throw new NotFoundException(`Shipping line ${id} not found`);
    return row;
  }

  async deleteShippingLine(
    companyId: string,
    id: string,
  ): Promise<{ message: string }> {
    await this.databaseService.db
      .update(shippingLines)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(shippingLines.id, id), eq(shippingLines.companyId, companyId)));
    return { message: 'Shipping line deleted' };
  }

  // ----------------------------------------------------
  // COUNTRIES — CRUD
  // ----------------------------------------------------
  async listCountries(companyId: string): Promise<Country[]> {
    if (!this.databaseService.isConnected) return [];
    return this.databaseService.db
      .select()
      .from(countries)
      .where(and(eq(countries.companyId, companyId), isNull(countries.deletedAt)))
      .orderBy(countries.name);
  }

  async createCountry(
    companyId: string,
    dto: CreateCountryDto,
  ): Promise<Country> {
    const [row] = await this.databaseService.db
      .insert(countries)
      .values({
        companyId,
        name: dto.name,
        code: dto.code || null,
        region: dto.region || null,
        isActive: dto.isActive ?? true,
        version: 1,
      })
      .returning();
    return row;
  }

  async updateCountry(
    companyId: string,
    id: string,
    dto: CreateCountryDto,
  ): Promise<Country> {
    const [row] = await this.databaseService.db
      .update(countries)
      .set({
        name: dto.name,
        code: dto.code || null,
        region: dto.region || null,
        isActive: dto.isActive ?? true,
        updatedAt: new Date(),
      })
      .where(and(eq(countries.id, id), eq(countries.companyId, companyId)))
      .returning();
    if (!row) throw new NotFoundException(`Country ${id} not found`);
    return row;
  }

  async deleteCountry(
    companyId: string,
    id: string,
  ): Promise<{ message: string }> {
    await this.databaseService.db
      .update(countries)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(countries.id, id), eq(countries.companyId, companyId)));
    return { message: 'Country deleted' };
  }

  // ----------------------------------------------------
  // TERMS & CONDITIONS — CRUD
  // ----------------------------------------------------
  async createTerm(
    companyId: string,
    dto: CreateTermDto,
  ): Promise<TermsAndCondition> {
    const [row] = await this.databaseService.db
      .insert(termsAndConditions)
      .values({
        companyId,
        title: dto.title,
        documentType: dto.documentType || 'PROFORMA',
        content: dto.content,
        isDefault: dto.isDefault ?? false,
        version: 1,
      })
      .returning();
    return row;
  }

  async updateTerm(
    companyId: string,
    id: string,
    dto: CreateTermDto,
  ): Promise<TermsAndCondition> {
    const [row] = await this.databaseService.db
      .update(termsAndConditions)
      .set({
        title: dto.title,
        documentType: dto.documentType || 'PROFORMA',
        content: dto.content,
        isDefault: dto.isDefault ?? false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(termsAndConditions.id, id),
          eq(termsAndConditions.companyId, companyId),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException(`Term ${id} not found`);
    return row;
  }

  async deleteTerm(
    companyId: string,
    id: string,
  ): Promise<{ message: string }> {
    await this.databaseService.db
      .update(termsAndConditions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(termsAndConditions.id, id),
          eq(termsAndConditions.companyId, companyId),
        ),
      );
    return { message: 'Term deleted' };
  }
}
