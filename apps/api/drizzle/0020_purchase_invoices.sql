CREATE TABLE "purchase_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_no" text NOT NULL,
	"invoice_date" date NOT NULL,
	"supplier_id" uuid NOT NULL,
	"vendor_po_id" uuid,
	"proforma_invoice_id" uuid,
	"shipment_id" uuid,
	"category" text DEFAULT 'PACKAGING' NOT NULL,
	"description" text,
	"quantity" numeric(16, 3),
	"unit" text,
	"taxable_amount" numeric(15, 2),
	"gst_amount" numeric(15, 2),
	"total_amount" numeric(15, 2) NOT NULL,
	"paid_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"due_date" date,
	"file_id" uuid,
	"inbox_item_id" uuid,
	"notes" text,
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
ALTER TABLE "vendor_pos" ADD COLUMN "category" text DEFAULT 'PACKAGING' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoices_supplier_no_uq" ON "purchase_invoices" USING btree ("company_id","supplier_id",lower("invoice_no")) WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "purchase_invoices_order_idx" ON "purchase_invoices" USING btree ("proforma_invoice_id");--> statement-breakpoint
CREATE INDEX "purchase_invoices_company_date_idx" ON "purchase_invoices" USING btree ("company_id","invoice_date");