CREATE TABLE "proforma_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proforma_invoice_id" uuid NOT NULL,
	"term_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "buyer_po_ref" varchar(128);--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "po_date" date;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "lc_number" varchar(64);--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "lc_date" date;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "delivery_timeline" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "country_of_origin" varchar(64) DEFAULT 'India' NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "goods_country" varchar(64);--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "mode_of_shipment" varchar(64) DEFAULT 'By sea, FCL container' NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "brand" varchar(128);--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "blend" varchar(128);--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "spec_variety" varchar(64);--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "spec_avg_length_mm" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "spec_moisture_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "spec_broken_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "spec_crop_year" varchar(16);--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "freight_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "insurance_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "discount_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "grand_total" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "amount_in_words" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "show_notify_party" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "show_shipping_details" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "show_specification" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "show_bank_details" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "show_lc_details" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "show_terms_conditions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "show_signature_block" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_items" ADD COLUMN "line_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_items" ADD COLUMN "packing_text" text;--> statement-breakpoint
ALTER TABLE "proforma_items" ADD COLUMN "hs_code" varchar(16);--> statement-breakpoint
ALTER TABLE "proforma_items" ADD COLUMN "crop_year" varchar(16);--> statement-breakpoint
ALTER TABLE "proforma_items" ADD COLUMN "broken_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "proforma_items" ADD COLUMN "cgst" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_items" ADD COLUMN "sgst" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_items" ADD COLUMN "igst" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_terms" ADD CONSTRAINT "proforma_terms_proforma_invoice_id_proforma_invoices_id_fk" FOREIGN KEY ("proforma_invoice_id") REFERENCES "public"."proforma_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_terms" ADD CONSTRAINT "proforma_terms_term_id_terms_and_conditions_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms_and_conditions"("id") ON DELETE no action ON UPDATE no action;