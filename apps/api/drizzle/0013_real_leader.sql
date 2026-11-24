CREATE TABLE "charge_heads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"default_amount" numeric(15, 2),
	"is_active" boolean DEFAULT true NOT NULL,
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
CREATE TABLE "shipment_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"charge_head_id" uuid,
	"label" text NOT NULL,
	"qty" numeric(14, 3) DEFAULT '1' NOT NULL,
	"rate" numeric(15, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"proforma_invoice_id" uuid NOT NULL,
	"lot_no" integer NOT NULL,
	"market" text DEFAULT 'GULF' NOT NULL,
	"quantity_mt" numeric(14, 3) DEFAULT '0' NOT NULL,
	"container_count" integer DEFAULT 0 NOT NULL,
	"target_ship_date" date,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"notes" text,
	"production_order_id" uuid,
	"commercial_invoice_id" uuid,
	"ocean_bill_id" uuid,
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
ALTER TABLE "charge_heads" ADD CONSTRAINT "charge_heads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_charges" ADD CONSTRAINT "shipment_charges_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_charges" ADD CONSTRAINT "shipment_charges_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_proforma_invoice_id_proforma_invoices_id_fk" FOREIGN KEY ("proforma_invoice_id") REFERENCES "public"."proforma_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "charge_heads_code_uq" ON "charge_heads" USING btree ("company_id","code") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "charge_heads_company_idx" ON "charge_heads" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "shipment_charges_shipment_idx" ON "shipment_charges" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipments_company_idx" ON "shipments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "shipments_pi_idx" ON "shipments" USING btree ("proforma_invoice_id");