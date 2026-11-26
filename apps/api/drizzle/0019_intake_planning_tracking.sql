CREATE TABLE "extraction_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"field" text NOT NULL,
	"anchor" text NOT NULL,
	"position" text NOT NULL,
	"uses" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_kind" text NOT NULL,
	"sha256" text NOT NULL,
	"source_path" text,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"kind" text,
	"kind_confidence" numeric(4, 2),
	"read_method" text,
	"ocr_confidence" integer,
	"pages" integer,
	"text" text,
	"fingerprint" text,
	"fields" jsonb,
	"lines" jsonb,
	"refs" jsonb,
	"order_id" uuid,
	"shipment_id" uuid,
	"result" text,
	"error" text,
	"read_ms" integer,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "packaging_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"proforma_invoice_id" uuid NOT NULL,
	"component" text NOT NULL,
	"label" text NOT NULL,
	"packing_type_id" uuid,
	"packing_name" text NOT NULL,
	"bags" integer NOT NULL,
	"per_bag" numeric(8, 3) NOT NULL,
	"free_pct" numeric(6, 2) DEFAULT '0' NOT NULL,
	"quantity" integer NOT NULL,
	"supplier_id" uuid,
	"rate" numeric(12, 4),
	"status" text DEFAULT 'TO_ORDER' NOT NULL,
	"vendor_po_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"file_id" uuid,
	"inbox_item_id" uuid,
	"ref_no" text,
	"doc_date" date,
	"note" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"order_line_id" uuid,
	"label" text NOT NULL,
	"packing_type_id" uuid,
	"packing_name" text,
	"pack_kg" numeric(10, 3) DEFAULT '0' NOT NULL,
	"inner_packs" integer DEFAULT 1 NOT NULL,
	"port_id" uuid,
	"port_name" text,
	"quantity_mt" numeric(14, 3) NOT NULL,
	"bags" integer DEFAULT 0 NOT NULL,
	"containers" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_pos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"po_date" date NOT NULL,
	"supplier_id" uuid NOT NULL,
	"proforma_invoice_id" uuid,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"delivery_by" date,
	"lines" jsonb NOT NULL,
	"total_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"printed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "period" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "shipping_line" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "booking_no" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "vessel" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "etd" date;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "eta" date;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "invoice_amount" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "bl_number" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "bl_date" date;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "bl_status" text DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "sb_number" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "sb_date" date;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "leo_date" date;--> statement-breakpoint
ALTER TABLE "extraction_templates" ADD CONSTRAINT "extraction_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_items" ADD CONSTRAINT "packaging_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_documents" ADD CONSTRAINT "shipment_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_documents" ADD CONSTRAINT "shipment_documents_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_pos" ADD CONSTRAINT "vendor_pos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_templates_uq" ON "extraction_templates" USING btree ("company_id","fingerprint","field");--> statement-breakpoint
CREATE INDEX "inbox_items_company_idx" ON "inbox_items" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX "inbox_items_sha_idx" ON "inbox_items" USING btree ("company_id","sha256");--> statement-breakpoint
CREATE INDEX "packaging_items_order_idx" ON "packaging_items" USING btree ("proforma_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_documents_uq" ON "shipment_documents" USING btree ("shipment_id","kind");--> statement-breakpoint
CREATE INDEX "shipment_lines_shipment_idx" ON "shipment_lines" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_pos_number_uq" ON "vendor_pos" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "vendor_pos_order_idx" ON "vendor_pos" USING btree ("proforma_invoice_id");