ALTER TABLE "certificates" ALTER COLUMN "buyer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoice_lines" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ALTER COLUMN "buyer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ocean_bills" ALTER COLUMN "buyer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "production_order_lines" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ALTER COLUMN "buyer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN IF NOT EXISTS "consignee_id_text" text;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN IF NOT EXISTS "buyer_id_text" text;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN IF NOT EXISTS "notify_party_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoice_lines" ADD COLUMN IF NOT EXISTS "product_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoice_lines" ADD COLUMN IF NOT EXISTS "packing_type_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN IF NOT EXISTS "consignee_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN IF NOT EXISTS "buyer_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN IF NOT EXISTS "notify_party_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN IF NOT EXISTS "payment_term_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN IF NOT EXISTS "origin_country_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN IF NOT EXISTS "port_of_loading_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN IF NOT EXISTS "port_of_discharge_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN IF NOT EXISTS "destination_country_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN IF NOT EXISTS "container_type_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN IF NOT EXISTS "shipping_line_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN IF NOT EXISTS "bank_account_id_text" text;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD COLUMN IF NOT EXISTS "consignee_id_text" text;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD COLUMN IF NOT EXISTS "buyer_id_text" text;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD COLUMN IF NOT EXISTS "notify_party_id_text" text;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD COLUMN IF NOT EXISTS "shipping_line_id_text" text;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD COLUMN IF NOT EXISTS "port_of_loading_id_text" text;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD COLUMN IF NOT EXISTS "port_of_discharge_id_text" text;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD COLUMN IF NOT EXISTS "destination_agent_id_text" text;--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD COLUMN IF NOT EXISTS "product_id_text" text;--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD COLUMN IF NOT EXISTS "packing_type_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "supplier_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "consignee_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "buyer_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "notify_party_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "payment_term_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "origin_country_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "port_of_loading_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "port_of_discharge_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "destination_country_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD COLUMN IF NOT EXISTS "product_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD COLUMN IF NOT EXISTS "packing_type_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD COLUMN IF NOT EXISTS "destination_port_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN IF NOT EXISTS "consignee_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN IF NOT EXISTS "buyer_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN IF NOT EXISTS "notify_party_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN IF NOT EXISTS "payment_term_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN IF NOT EXISTS "origin_country_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN IF NOT EXISTS "port_of_loading_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN IF NOT EXISTS "port_of_discharge_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN IF NOT EXISTS "destination_country_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN IF NOT EXISTS "bank_account_id_text" text;--> statement-breakpoint
UPDATE "production_orders" SET "pre_carriage_by" = upper(regexp_replace(trim("pre_carriage_by"), '^by[[:space:]]+', '', 'i')) WHERE upper(regexp_replace(trim("pre_carriage_by"), '^by[[:space:]]+', '', 'i')) IN ('ROAD', 'TRAIN');--> statement-breakpoint
UPDATE "commercial_invoices" SET "pre_carriage_by" = upper(regexp_replace(trim("pre_carriage_by"), '^by[[:space:]]+', '', 'i')) WHERE upper(regexp_replace(trim("pre_carriage_by"), '^by[[:space:]]+', '', 'i')) IN ('ROAD', 'TRAIN');
--> statement-breakpoint
-- Freight got its own permission (freight.quotations). The old names are no longer valid and would block saving a role.
DELETE FROM "role_permissions" WHERE "permission" LIKE 'sales.freight:%';
