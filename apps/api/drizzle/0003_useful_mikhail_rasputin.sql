ALTER TABLE "commercial_invoice_lines" ADD COLUMN "pack_group" integer;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "invoice_stage" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "order_ref_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "pi_ref_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "include_lc" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "include_vessel" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "include_shipping_charges" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "locked_by" uuid;--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD COLUMN "pack_group" integer;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "locked_by" uuid;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD COLUMN "pack_group" integer;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "locked_by" uuid;