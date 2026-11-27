ALTER TABLE "commercial_invoices" ADD COLUMN "show_value_summary" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "show_freight" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "show_insurance" boolean DEFAULT true NOT NULL;