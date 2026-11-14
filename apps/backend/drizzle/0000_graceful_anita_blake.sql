CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" varchar(128) NOT NULL,
	"legal_name" varchar(255) NOT NULL,
	"gstin" varchar(15),
	"iec_code" varchar(32),
	"pan_number" varchar(10),
	"lut_number" varchar(64),
	"ad_code" varchar(32),
	"address_line1" varchar(255) NOT NULL,
	"address_line2" varchar(255),
	"city" varchar(64) NOT NULL,
	"state" varchar(64) NOT NULL,
	"country" varchar(64) DEFAULT 'India' NOT NULL,
	"pincode" varchar(16) NOT NULL,
	"contact_phone" varchar(32),
	"contact_email" varchar(128),
	"logo_path" varchar(255),
	"signature_path" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(64) NOT NULL,
	"email" varchar(128) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"full_name" varchar(128) NOT NULL,
	"role" varchar(32) DEFAULT 'ordinary_user' NOT NULL,
	"allowed_screens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_companies" (
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_companies_user_id_company_id_pk" PRIMARY KEY("user_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "document_counters" (
	"company_id" uuid NOT NULL,
	"document_type" varchar(32) NOT NULL,
	"financial_year" varchar(16) NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"prefix" varchar(32) NOT NULL,
	"suffix" varchar(32) DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_counters_company_id_document_type_financial_year_pk" PRIMARY KEY("company_id","document_type","financial_year")
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"user_id" uuid,
	"username" varchar(64) NOT NULL,
	"action" varchar(32) NOT NULL,
	"entity_table" varchar(64) NOT NULL,
	"entity_id" varchar(64) NOT NULL,
	"changed_fields" jsonb,
	"previous_values" jsonb,
	"new_values" jsonb,
	"deletion_reason" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(64),
	"contact_person" varchar(128),
	"email" varchar(128),
	"phone" varchar(32),
	"address" text NOT NULL,
	"city" varchar(64),
	"country" varchar(64) NOT NULL,
	"tax_id" varchar(64),
	"is_buyer" boolean DEFAULT true NOT NULL,
	"is_consignee" boolean DEFAULT true NOT NULL,
	"is_notify_party" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"code" varchar(64),
	"hsn_code" varchar(16) DEFAULT '10063020' NOT NULL,
	"variety" varchar(64) NOT NULL,
	"processing_type" varchar(32) NOT NULL,
	"default_broken_percentage" numeric(5, 2) DEFAULT '1.00' NOT NULL,
	"grain_length_mm" numeric(5, 2) DEFAULT '8.35',
	"moisture_max_percentage" numeric(5, 2) DEFAULT '12.50',
	"purity_percentage" numeric(5, 2) DEFAULT '95.00',
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"supplier_type" varchar(32) NOT NULL,
	"contact_person" varchar(128),
	"phone" varchar(32),
	"email" varchar(128),
	"address" text,
	"city" varchar(64),
	"state" varchar(64),
	"gstin" varchar(15),
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packing_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"material" varchar(32) NOT NULL,
	"weight_kg" numeric(8, 3) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"code" varchar(32),
	"port_type" varchar(16) NOT NULL,
	"country" varchar(64) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"code" varchar(32),
	"contact_details" text,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_name" varchar(128) NOT NULL,
	"account_name" varchar(128) NOT NULL,
	"account_number" varchar(64) NOT NULL,
	"ifsc_code" varchar(16),
	"swift_code" varchar(16) NOT NULL,
	"ad_code" varchar(32) NOT NULL,
	"branch_address" text NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms_and_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" varchar(128) NOT NULL,
	"document_type" varchar(32) NOT NULL,
	"content" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proforma_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_number" varchar(64) NOT NULL,
	"document_date" date NOT NULL,
	"financial_year" varchar(16) NOT NULL,
	"customer_id" uuid NOT NULL,
	"consignee_id" uuid,
	"notify_party_id" uuid,
	"incoterm" varchar(16) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"exchange_rate" numeric(12, 4) DEFAULT '1.0000' NOT NULL,
	"port_of_loading" varchar(128) NOT NULL,
	"port_of_discharge" varchar(128) NOT NULL,
	"final_destination" varchar(128) NOT NULL,
	"payment_terms" text NOT NULL,
	"frozen_terms" text,
	"bank_details_id" uuid,
	"total_quantity_mt" numeric(12, 3) DEFAULT '0.000' NOT NULL,
	"total_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"status" varchar(32) DEFAULT 'CONFIRMED' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proforma_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proforma_invoice_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"packing_type_id" uuid NOT NULL,
	"quantity_mt" numeric(12, 3) NOT NULL,
	"allocated_production_mt" numeric(12, 3) DEFAULT '0.000' NOT NULL,
	"rate_per_mt" numeric(15, 2) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"specifications" text
);
--> statement-breakpoint
CREATE TABLE "production_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_order_id" uuid NOT NULL,
	"proforma_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"packing_type_id" uuid NOT NULL,
	"quantity_mt" numeric(12, 3) NOT NULL,
	"allocated_invoice_mt" numeric(12, 3) DEFAULT '0.000' NOT NULL,
	"specifications" text
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_number" varchar(64) NOT NULL,
	"document_date" date NOT NULL,
	"proforma_invoice_id" uuid NOT NULL,
	"buyer_po_number" varchar(64),
	"supplier_mill_id" uuid,
	"milling_instructions" text,
	"packaging_instructions" text,
	"dispatch_schedule" date,
	"total_quantity_mt" numeric(12, 3) DEFAULT '0.000' NOT NULL,
	"allocated_invoice_mt" numeric(12, 3) DEFAULT '0.000' NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_number" varchar(64) NOT NULL,
	"document_date" date NOT NULL,
	"financial_year" varchar(16) NOT NULL,
	"proforma_invoice_id" uuid,
	"production_order_id" uuid,
	"buyer_po_number" varchar(64),
	"customer_id" uuid NOT NULL,
	"consignee_id" uuid,
	"notify_party_id" uuid,
	"shipping_bill_number" varchar(64),
	"shipping_bill_date" date,
	"bl_number" varchar(64),
	"bl_date" date,
	"vessel_flight_name" varchar(128),
	"voyage_number" varchar(64),
	"port_of_loading" varchar(128) NOT NULL,
	"port_of_discharge" varchar(128) NOT NULL,
	"country_of_origin" varchar(64) DEFAULT 'India' NOT NULL,
	"country_of_destination" varchar(64) NOT NULL,
	"incoterm" varchar(16) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"exchange_rate" numeric(12, 4) DEFAULT '1.0000' NOT NULL,
	"total_fob_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"ocean_freight_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"insurance_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"total_invoice_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"amount_in_words" text NOT NULL,
	"lut_number" varchar(64),
	"bank_details_id" uuid,
	"frozen_terms" text,
	"status" varchar(32) DEFAULT 'ISSUED' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"container_number" varchar(32) NOT NULL,
	"seal_number" varchar(32) NOT NULL,
	"container_size" varchar(16) DEFAULT '20FT' NOT NULL,
	"total_bags" integer NOT NULL,
	"gross_weight_kg" numeric(12, 3) NOT NULL,
	"net_weight_kg" numeric(12, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"packing_type_id" uuid NOT NULL,
	"quantity_mt" numeric(12, 3) NOT NULL,
	"rate_per_mt" numeric(15, 2) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"specifications" text
);
--> statement-breakpoint
CREATE TABLE "shipping_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"incoterm" varchar(16) NOT NULL,
	"thc_charge" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"bl_charge" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"seal_charge" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"muc_charge" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"risk_charge" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"reposition_charge" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"ocean_freight_charge" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"insurance_charge" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"total_shipping_charge" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	CONSTRAINT "shipping_charges_invoice_id_unique" UNIQUE("invoice_id")
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"receipt_number" varchar(64) NOT NULL,
	"receipt_date" date NOT NULL,
	"financial_year" varchar(16) NOT NULL,
	"commercial_invoice_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount_received" numeric(15, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"exchange_rate" numeric(12, 4) DEFAULT '1.0000' NOT NULL,
	"bank_details_id" uuid,
	"payment_mode" varchar(32) NOT NULL,
	"reference_number" varchar(64),
	"remarks" text,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_hub_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_order_id" uuid NOT NULL,
	"lot_id" uuid,
	"document_type" varchar(64) NOT NULL,
	"classification" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"file_path" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_number" varchar(64) NOT NULL,
	"order_date" date NOT NULL,
	"proforma_invoice_id" uuid,
	"buyer_po_number" varchar(64),
	"lc_number" varchar(64),
	"lc_date" date,
	"lc_expiry_date" date,
	"issuing_bank" varchar(128),
	"total_quantity_mt" numeric(12, 3) NOT NULL,
	"status" varchar(32) DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_order_id" uuid NOT NULL,
	"lot_number" integer NOT NULL,
	"quantity_mt" numeric(12, 3) NOT NULL,
	"commercial_invoice_id" uuid,
	"status" varchar(32) DEFAULT 'PLANNED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_types" ADD CONSTRAINT "packing_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ports" ADD CONSTRAINT "ports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_lines" ADD CONSTRAINT "shipping_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_details" ADD CONSTRAINT "bank_details_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_and_conditions" ADD CONSTRAINT "terms_and_conditions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_consignee_id_customers_id_fk" FOREIGN KEY ("consignee_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_notify_party_id_customers_id_fk" FOREIGN KEY ("notify_party_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_bank_details_id_bank_details_id_fk" FOREIGN KEY ("bank_details_id") REFERENCES "public"."bank_details"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_items" ADD CONSTRAINT "proforma_items_proforma_invoice_id_proforma_invoices_id_fk" FOREIGN KEY ("proforma_invoice_id") REFERENCES "public"."proforma_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_items" ADD CONSTRAINT "proforma_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_items" ADD CONSTRAINT "proforma_items_packing_type_id_packing_types_id_fk" FOREIGN KEY ("packing_type_id") REFERENCES "public"."packing_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD CONSTRAINT "production_order_items_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD CONSTRAINT "production_order_items_proforma_item_id_proforma_items_id_fk" FOREIGN KEY ("proforma_item_id") REFERENCES "public"."proforma_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD CONSTRAINT "production_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD CONSTRAINT "production_order_items_packing_type_id_packing_types_id_fk" FOREIGN KEY ("packing_type_id") REFERENCES "public"."packing_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_proforma_invoice_id_proforma_invoices_id_fk" FOREIGN KEY ("proforma_invoice_id") REFERENCES "public"."proforma_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_supplier_mill_id_suppliers_id_fk" FOREIGN KEY ("supplier_mill_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_proforma_invoice_id_proforma_invoices_id_fk" FOREIGN KEY ("proforma_invoice_id") REFERENCES "public"."proforma_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_consignee_id_customers_id_fk" FOREIGN KEY ("consignee_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_notify_party_id_customers_id_fk" FOREIGN KEY ("notify_party_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_bank_details_id_bank_details_id_fk" FOREIGN KEY ("bank_details_id") REFERENCES "public"."bank_details"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_invoice_id_commercial_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."commercial_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_commercial_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."commercial_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_packing_type_id_packing_types_id_fk" FOREIGN KEY ("packing_type_id") REFERENCES "public"."packing_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_charges" ADD CONSTRAINT "shipping_charges_invoice_id_commercial_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."commercial_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_commercial_invoice_id_commercial_invoices_id_fk" FOREIGN KEY ("commercial_invoice_id") REFERENCES "public"."commercial_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_bank_details_id_bank_details_id_fk" FOREIGN KEY ("bank_details_id") REFERENCES "public"."bank_details"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_hub_items" ADD CONSTRAINT "document_hub_items_master_order_id_master_orders_id_fk" FOREIGN KEY ("master_order_id") REFERENCES "public"."master_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_hub_items" ADD CONSTRAINT "document_hub_items_lot_id_order_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."order_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_proforma_invoice_id_proforma_invoices_id_fk" FOREIGN KEY ("proforma_invoice_id") REFERENCES "public"."proforma_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lots" ADD CONSTRAINT "order_lots_master_order_id_master_orders_id_fk" FOREIGN KEY ("master_order_id") REFERENCES "public"."master_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lots" ADD CONSTRAINT "order_lots_commercial_invoice_id_commercial_invoices_id_fk" FOREIGN KEY ("commercial_invoice_id") REFERENCES "public"."commercial_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pi_company_number" ON "proforma_invoices" USING btree ("company_id","document_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_po_company_number" ON "production_orders" USING btree ("company_id","document_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inv_company_fy_number" ON "commercial_invoices" USING btree ("company_id","financial_year","document_number");