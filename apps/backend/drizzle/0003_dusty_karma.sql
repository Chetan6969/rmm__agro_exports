CREATE TABLE "invoice_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"term_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commercial_invoices" ALTER COLUMN "port_of_loading" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ALTER COLUMN "port_of_discharge" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ALTER COLUMN "country_of_destination" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ALTER COLUMN "amount_in_words" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ALTER COLUMN "packing_type_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "invoice_type" varchar(16) DEFAULT 'WHITE' NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "lc_number" varchar(64);--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "lc_date" date;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "shipping_line_id" uuid;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "pre_carriage_by" varchar(128);--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "place_of_receipt" varchar(128);--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "container_no" varchar(64);--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "seal_no" varchar(64);--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "lading_bl_number" varchar(64);--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "lading_bl_date" date;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "terms_of" varchar(128);--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "payment_term" varchar(255);--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "brand" varchar(128);--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "marks_numbers" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "goods_description" text;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "gross_wt_mt" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "fcl" varchar(32);--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "freight_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "total_charges_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD COLUMN "show_signature" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "line_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "packing_text" text;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "hs_code" varchar(16);--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "no_of_bags" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "gross_wt_mt" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "cgst" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "sgst" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "igst" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "broken_below" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "fcl" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_terms" ADD CONSTRAINT "invoice_terms_invoice_id_commercial_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."commercial_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_terms" ADD CONSTRAINT "invoice_terms_term_id_terms_and_conditions_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms_and_conditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_shipping_line_id_shipping_lines_id_fk" FOREIGN KEY ("shipping_line_id") REFERENCES "public"."shipping_lines"("id") ON DELETE no action ON UPDATE no action;