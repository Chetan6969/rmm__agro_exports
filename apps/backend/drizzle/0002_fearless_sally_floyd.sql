CREATE TABLE "production_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_order_id" uuid NOT NULL,
	"term_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "production_order_items" ALTER COLUMN "proforma_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "production_order_items" ALTER COLUMN "packing_type_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "production_orders" ALTER COLUMN "proforma_invoice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD COLUMN "line_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD COLUMN "packing_text" text;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD COLUMN "hs_code" varchar(16);--> statement-breakpoint
ALTER TABLE "production_order_items" ADD COLUMN "crop_year" varchar(16);--> statement-breakpoint
ALTER TABLE "production_order_items" ADD COLUMN "no_of_bags" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD COLUMN "gross_wt_mt" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "production_order_items" ADD COLUMN "rate_per_mt" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD COLUMN "amount" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD COLUMN "cgst" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD COLUMN "sgst" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD COLUMN "igst" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD COLUMN "broken_below" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "production_order_items" ADD COLUMN "fcl" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "buyer_po_ref" varchar(128);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "po_date" date;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "consignee_id" uuid;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "notify_party_id" uuid;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "incoterm" varchar(16) DEFAULT 'FOB' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "currency" varchar(8) DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "exchange_rate" numeric(12, 4) DEFAULT '1.0000' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "lc_number" varchar(64);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "lc_date" date;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "freight_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "insurance_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "fcl" varchar(32);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "pre_carriage_by" varchar(128);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "place_of_receipt" varchar(128);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "country_of_origin" varchar(64) DEFAULT 'India' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "country_final_destination" varchar(64);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "vessel_flight_no" varchar(128);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "port_of_loading" varchar(128);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "port_of_discharge" varchar(128);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "destination_country" varchar(64);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "terms_of" varchar(128);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "payment_term" varchar(255);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "brand" varchar(128);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "transport" varchar(128);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "vehicle_no" varchar(64);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "order_remark" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "spec_variety" varchar(128);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "spec_avg_length_mm" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "spec_moisture_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "spec_broken_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "spec_crop_year" varchar(16);--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "total_bags" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "total_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "show_signature" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "frozen_terms" text;--> statement-breakpoint
ALTER TABLE "production_terms" ADD CONSTRAINT "production_terms_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_terms" ADD CONSTRAINT "production_terms_term_id_terms_and_conditions_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms_and_conditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_consignee_id_customers_id_fk" FOREIGN KEY ("consignee_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_notify_party_id_customers_id_fk" FOREIGN KEY ("notify_party_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;