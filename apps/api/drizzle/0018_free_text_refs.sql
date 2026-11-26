ALTER TABLE "certificates" ALTER COLUMN "buyer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoice_lines" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ALTER COLUMN "buyer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ocean_bills" ALTER COLUMN "buyer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "production_order_lines" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ALTER COLUMN "buyer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "consignee_id_text" text;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "buyer_id_text" text;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "notify_party_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoice_lines" ADD COLUMN "product_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoice_lines" ADD COLUMN "packing_type_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "consignee_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "buyer_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "notify_party_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "payment_term_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "origin_country_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "port_of_loading_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "port_of_discharge_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "destination_country_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "container_type_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "shipping_line_id_text" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "bank_account_id_text" text;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD COLUMN "consignee_id_text" text;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD COLUMN "buyer_id_text" text;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD COLUMN "notify_party_id_text" text;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD COLUMN "shipping_line_id_text" text;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD COLUMN "port_of_loading_id_text" text;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD COLUMN "port_of_discharge_id_text" text;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD COLUMN "destination_agent_id_text" text;--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD COLUMN "product_id_text" text;--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD COLUMN "packing_type_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "supplier_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "consignee_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "buyer_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "notify_party_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "payment_term_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "origin_country_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "port_of_loading_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "port_of_discharge_id_text" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "destination_country_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD COLUMN "product_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD COLUMN "packing_type_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "consignee_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "buyer_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "notify_party_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "payment_term_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "origin_country_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "port_of_loading_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "port_of_discharge_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "destination_country_id_text" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "bank_account_id_text" text;