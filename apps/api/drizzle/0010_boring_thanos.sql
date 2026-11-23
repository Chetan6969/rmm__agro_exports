ALTER TABLE "certificates" ADD COLUMN "sort_order" double precision;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "sort_order" double precision;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD COLUMN "sort_order" double precision;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "sort_order" double precision;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "sort_order" double precision;--> statement-breakpoint
UPDATE "certificates" SET "sort_order" = extract(epoch from created_at) * 1000 WHERE "sort_order" IS NULL;--> statement-breakpoint
UPDATE "commercial_invoices" SET "sort_order" = extract(epoch from created_at) * 1000 WHERE "sort_order" IS NULL;--> statement-breakpoint
UPDATE "ocean_bills" SET "sort_order" = extract(epoch from created_at) * 1000 WHERE "sort_order" IS NULL;--> statement-breakpoint
UPDATE "production_orders" SET "sort_order" = extract(epoch from created_at) * 1000 WHERE "sort_order" IS NULL;--> statement-breakpoint
UPDATE "proforma_invoices" SET "sort_order" = extract(epoch from created_at) * 1000 WHERE "sort_order" IS NULL;