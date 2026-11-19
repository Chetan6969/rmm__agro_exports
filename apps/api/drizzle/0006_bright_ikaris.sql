ALTER TABLE "packing_types" ADD COLUMN "container_capacity_mt" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "commercial_invoice_lines" ADD COLUMN "container_capacity_mt" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD COLUMN "container_capacity_mt" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD COLUMN "container_capacity_mt" numeric(12, 3);