ALTER TABLE "commercial_invoice_lines" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "commercial_invoice_lines" ADD COLUMN "packing_note" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "said_to_contain" text;--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD COLUMN "packing_note" text;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD COLUMN "packing_note" text;