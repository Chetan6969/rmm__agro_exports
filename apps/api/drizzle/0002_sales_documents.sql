CREATE TABLE "commercial_invoice_containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"container_number" text NOT NULL,
	"seal_number" text NOT NULL,
	"container_size" text NOT NULL,
	"total_bags" integer NOT NULL,
	"net_weight_kg" numeric(12, 3) NOT NULL,
	"gross_weight_kg" numeric(12, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"packing_type_id" uuid,
	"packing_text" text,
	"hs_code" text,
	"crop_year" text,
	"no_of_bags" integer,
	"quantity_mt" numeric(12, 3) NOT NULL,
	"gross_wt_mt" numeric(12, 3),
	"rate_per_mt" numeric(15, 2) NOT NULL,
	"broken_below" boolean DEFAULT false NOT NULL,
	"fcl" boolean DEFAULT false NOT NULL,
	"broken_pct" numeric(5, 2),
	"cgst" numeric(15, 2),
	"sgst" numeric(15, 2),
	"igst" numeric(15, 2),
	"specifications" text,
	"amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"source_line_id" uuid
);
--> statement-breakpoint
CREATE TABLE "commercial_invoice_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"tc_template_id" uuid,
	"content" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_number" text NOT NULL,
	"document_date" date NOT NULL,
	"status" text NOT NULL,
	"invoice_type" text,
	"production_order_id" uuid,
	"proforma_invoice_id" uuid,
	"buyer_id" uuid NOT NULL,
	"consignee_id" uuid,
	"notify_party_id" uuid,
	"buyer_po_ref" text,
	"po_date" date,
	"lc_number" text,
	"lc_date" date,
	"incoterm" text NOT NULL,
	"currency_id" uuid NOT NULL,
	"exchange_rate" numeric(12, 4) NOT NULL,
	"payment_term_id" uuid,
	"payment_terms" text,
	"lut_number" text,
	"origin_country_id" uuid,
	"port_of_loading_id" uuid,
	"port_of_discharge_id" uuid,
	"destination_country_id" uuid,
	"final_destination" text,
	"shipping_line_id" uuid,
	"vessel_flight_name" text,
	"voyage_number" text,
	"pre_carriage_by" text,
	"place_of_receipt" text,
	"terms_of" text,
	"bl_number" text,
	"bl_date" date,
	"shipping_bill_number" text,
	"shipping_bill_date" date,
	"fcl" text,
	"brand" text,
	"marks_numbers" text,
	"goods_description" text,
	"thc_charge" numeric(12, 2),
	"bl_charge" numeric(12, 2),
	"seal_charge" numeric(12, 2),
	"muc_charge" numeric(12, 2),
	"risk_charge" numeric(12, 2),
	"reposition_charge" numeric(12, 2),
	"ocean_freight_charge" numeric(12, 2),
	"insurance_charge" numeric(12, 2),
	"bank_account_id" uuid,
	"show_signature" boolean DEFAULT true NOT NULL,
	"total_quantity_mt" numeric(18, 3) DEFAULT '0' NOT NULL,
	"total_bags" numeric(18, 0) DEFAULT '0' NOT NULL,
	"total_gross_wt_mt" numeric(18, 3) DEFAULT '0' NOT NULL,
	"fob_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"gst_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"ocean_freight_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"insurance_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_shipping_charge" numeric(18, 2) DEFAULT '0' NOT NULL,
	"invoice_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"amount_in_words" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "production_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"packing_type_id" uuid,
	"packing_text" text,
	"hs_code" text,
	"crop_year" text,
	"no_of_bags" integer,
	"quantity_mt" numeric(12, 3) NOT NULL,
	"gross_wt_mt" numeric(12, 3),
	"rate_per_mt" numeric(15, 2),
	"broken_below" boolean DEFAULT false NOT NULL,
	"fcl" boolean DEFAULT false NOT NULL,
	"broken_pct" numeric(5, 2),
	"cgst" numeric(15, 2),
	"sgst" numeric(15, 2),
	"igst" numeric(15, 2),
	"specifications" text,
	"amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"source_line_id" uuid
);
--> statement-breakpoint
CREATE TABLE "production_order_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"tc_template_id" uuid,
	"content" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_number" text NOT NULL,
	"document_date" date NOT NULL,
	"status" text NOT NULL,
	"proforma_invoice_id" uuid,
	"supplier_id" uuid,
	"dispatch_schedule" date,
	"buyer_id" uuid,
	"consignee_id" uuid,
	"notify_party_id" uuid,
	"buyer_po_ref" text,
	"po_date" date,
	"lc_number" text,
	"lc_date" date,
	"incoterm" text NOT NULL,
	"currency_id" uuid NOT NULL,
	"exchange_rate" numeric(12, 4) NOT NULL,
	"payment_term_id" uuid,
	"payment_terms" text,
	"freight_amount" numeric(15, 2),
	"insurance_amount" numeric(15, 2),
	"origin_country_id" uuid,
	"port_of_loading_id" uuid,
	"port_of_discharge_id" uuid,
	"destination_country_id" uuid,
	"final_destination" text,
	"pre_carriage_by" text,
	"place_of_receipt" text,
	"vessel_flight_no" text,
	"terms_of" text,
	"fcl" text,
	"brand" text,
	"transport" text,
	"vehicle_no" text,
	"milling_instructions" text,
	"packaging_instructions" text,
	"order_remark" text,
	"spec_variety" text,
	"spec_avg_length_mm" numeric(6, 2),
	"spec_moisture_pct" numeric(5, 2),
	"spec_broken_pct" numeric(5, 2),
	"spec_crop_year" text,
	"show_signature" boolean DEFAULT true NOT NULL,
	"total_quantity_mt" numeric(18, 3) DEFAULT '0' NOT NULL,
	"total_bags" numeric(18, 0) DEFAULT '0' NOT NULL,
	"total_gross_wt_mt" numeric(18, 3) DEFAULT '0' NOT NULL,
	"goods_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"gst_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"amount_in_words" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "proforma_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"packing_type_id" uuid,
	"packing_text" text,
	"hs_code" text,
	"crop_year" text,
	"no_of_bags" integer,
	"quantity_mt" numeric(12, 3) NOT NULL,
	"gross_wt_mt" numeric(12, 3),
	"rate_per_mt" numeric(15, 2) NOT NULL,
	"broken_pct" numeric(5, 2),
	"cgst" numeric(15, 2),
	"sgst" numeric(15, 2),
	"igst" numeric(15, 2),
	"specifications" text,
	"amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"source_line_id" uuid
);
--> statement-breakpoint
CREATE TABLE "proforma_invoice_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"tc_template_id" uuid,
	"content" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proforma_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_number" text NOT NULL,
	"document_date" date NOT NULL,
	"status" text NOT NULL,
	"buyer_id" uuid NOT NULL,
	"consignee_id" uuid,
	"notify_party_id" uuid,
	"buyer_po_ref" text,
	"po_date" date,
	"lc_number" text,
	"lc_date" date,
	"incoterm" text NOT NULL,
	"currency_id" uuid NOT NULL,
	"exchange_rate" numeric(12, 4) NOT NULL,
	"payment_term_id" uuid,
	"payment_terms" text,
	"delivery_timeline" text,
	"origin_country_id" uuid,
	"port_of_loading_id" uuid,
	"port_of_discharge_id" uuid,
	"destination_country_id" uuid,
	"final_destination" text,
	"mode_of_shipment" text,
	"brand" text,
	"blend" text,
	"spec_variety" text,
	"spec_avg_length_mm" numeric(6, 2),
	"spec_moisture_pct" numeric(5, 2),
	"spec_broken_pct" numeric(5, 2),
	"spec_crop_year" text,
	"freight_amount" numeric(15, 2),
	"insurance_amount" numeric(15, 2),
	"discount_amount" numeric(15, 2),
	"bank_account_id" uuid,
	"show_notify_party" boolean DEFAULT true NOT NULL,
	"show_shipping_details" boolean DEFAULT true NOT NULL,
	"show_specification" boolean DEFAULT true NOT NULL,
	"show_lc_details" boolean DEFAULT true NOT NULL,
	"show_bank_details" boolean DEFAULT true NOT NULL,
	"show_terms_conditions" boolean DEFAULT true NOT NULL,
	"show_signature_block" boolean DEFAULT true NOT NULL,
	"total_quantity_mt" numeric(18, 3) DEFAULT '0' NOT NULL,
	"total_bags" numeric(18, 0) DEFAULT '0' NOT NULL,
	"goods_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"gst_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"amount_in_words" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
ALTER TABLE "commercial_invoice_containers" ADD CONSTRAINT "commercial_invoice_containers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoice_containers" ADD CONSTRAINT "commercial_invoice_containers_document_id_commercial_invoices_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."commercial_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoice_lines" ADD CONSTRAINT "commercial_invoice_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoice_lines" ADD CONSTRAINT "commercial_invoice_lines_document_id_commercial_invoices_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."commercial_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoice_lines" ADD CONSTRAINT "commercial_invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoice_lines" ADD CONSTRAINT "commercial_invoice_lines_packing_type_id_packing_types_id_fk" FOREIGN KEY ("packing_type_id") REFERENCES "public"."packing_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoice_terms" ADD CONSTRAINT "commercial_invoice_terms_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoice_terms" ADD CONSTRAINT "commercial_invoice_terms_document_id_commercial_invoices_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."commercial_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoice_terms" ADD CONSTRAINT "commercial_invoice_terms_tc_template_id_tc_templates_id_fk" FOREIGN KEY ("tc_template_id") REFERENCES "public"."tc_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_proforma_invoice_id_proforma_invoices_id_fk" FOREIGN KEY ("proforma_invoice_id") REFERENCES "public"."proforma_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_buyer_id_customers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_consignee_id_customers_id_fk" FOREIGN KEY ("consignee_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_notify_party_id_customers_id_fk" FOREIGN KEY ("notify_party_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_payment_term_id_payment_terms_id_fk" FOREIGN KEY ("payment_term_id") REFERENCES "public"."payment_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_origin_country_id_countries_id_fk" FOREIGN KEY ("origin_country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_port_of_loading_id_ports_id_fk" FOREIGN KEY ("port_of_loading_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_port_of_discharge_id_ports_id_fk" FOREIGN KEY ("port_of_discharge_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_destination_country_id_countries_id_fk" FOREIGN KEY ("destination_country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_shipping_line_id_shipping_lines_id_fk" FOREIGN KEY ("shipping_line_id") REFERENCES "public"."shipping_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_invoices" ADD CONSTRAINT "commercial_invoices_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_document_id_production_orders_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."production_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_packing_type_id_packing_types_id_fk" FOREIGN KEY ("packing_type_id") REFERENCES "public"."packing_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_terms" ADD CONSTRAINT "production_order_terms_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_terms" ADD CONSTRAINT "production_order_terms_document_id_production_orders_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."production_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_terms" ADD CONSTRAINT "production_order_terms_tc_template_id_tc_templates_id_fk" FOREIGN KEY ("tc_template_id") REFERENCES "public"."tc_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_proforma_invoice_id_proforma_invoices_id_fk" FOREIGN KEY ("proforma_invoice_id") REFERENCES "public"."proforma_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_buyer_id_customers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_consignee_id_customers_id_fk" FOREIGN KEY ("consignee_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_notify_party_id_customers_id_fk" FOREIGN KEY ("notify_party_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_payment_term_id_payment_terms_id_fk" FOREIGN KEY ("payment_term_id") REFERENCES "public"."payment_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_origin_country_id_countries_id_fk" FOREIGN KEY ("origin_country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_port_of_loading_id_ports_id_fk" FOREIGN KEY ("port_of_loading_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_port_of_discharge_id_ports_id_fk" FOREIGN KEY ("port_of_discharge_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_destination_country_id_countries_id_fk" FOREIGN KEY ("destination_country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD CONSTRAINT "proforma_invoice_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD CONSTRAINT "proforma_invoice_lines_document_id_proforma_invoices_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."proforma_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD CONSTRAINT "proforma_invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD CONSTRAINT "proforma_invoice_lines_packing_type_id_packing_types_id_fk" FOREIGN KEY ("packing_type_id") REFERENCES "public"."packing_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoice_terms" ADD CONSTRAINT "proforma_invoice_terms_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoice_terms" ADD CONSTRAINT "proforma_invoice_terms_document_id_proforma_invoices_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."proforma_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoice_terms" ADD CONSTRAINT "proforma_invoice_terms_tc_template_id_tc_templates_id_fk" FOREIGN KEY ("tc_template_id") REFERENCES "public"."tc_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_buyer_id_customers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_consignee_id_customers_id_fk" FOREIGN KEY ("consignee_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_notify_party_id_customers_id_fk" FOREIGN KEY ("notify_party_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_payment_term_id_payment_terms_id_fk" FOREIGN KEY ("payment_term_id") REFERENCES "public"."payment_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_origin_country_id_countries_id_fk" FOREIGN KEY ("origin_country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_port_of_loading_id_ports_id_fk" FOREIGN KEY ("port_of_loading_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_port_of_discharge_id_ports_id_fk" FOREIGN KEY ("port_of_discharge_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_destination_country_id_countries_id_fk" FOREIGN KEY ("destination_country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commercial_invoice_containers_document_idx" ON "commercial_invoice_containers" USING btree ("document_id","position");--> statement-breakpoint
CREATE INDEX "commercial_invoice_lines_document_idx" ON "commercial_invoice_lines" USING btree ("document_id","position");--> statement-breakpoint
CREATE INDEX "commercial_invoice_terms_document_idx" ON "commercial_invoice_terms" USING btree ("document_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_invoices_number_uq" ON "commercial_invoices" USING btree ("company_id","document_number") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "commercial_invoices_company_date_idx" ON "commercial_invoices" USING btree ("company_id","document_date");--> statement-breakpoint
CREATE INDEX "commercial_invoices_production_order_id_idx" ON "commercial_invoices" USING btree ("production_order_id");--> statement-breakpoint
CREATE INDEX "commercial_invoices_proforma_invoice_id_idx" ON "commercial_invoices" USING btree ("proforma_invoice_id");--> statement-breakpoint
CREATE INDEX "commercial_invoices_buyer_id_idx" ON "commercial_invoices" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "commercial_invoices_consignee_id_idx" ON "commercial_invoices" USING btree ("consignee_id");--> statement-breakpoint
CREATE INDEX "commercial_invoices_notify_party_id_idx" ON "commercial_invoices" USING btree ("notify_party_id");--> statement-breakpoint
CREATE INDEX "commercial_invoices_currency_id_idx" ON "commercial_invoices" USING btree ("currency_id");--> statement-breakpoint
CREATE INDEX "commercial_invoices_payment_term_id_idx" ON "commercial_invoices" USING btree ("payment_term_id");--> statement-breakpoint
CREATE INDEX "commercial_invoices_origin_country_id_idx" ON "commercial_invoices" USING btree ("origin_country_id");--> statement-breakpoint
CREATE INDEX "commercial_invoices_port_of_loading_id_idx" ON "commercial_invoices" USING btree ("port_of_loading_id");--> statement-breakpoint
CREATE INDEX "commercial_invoices_port_of_discharge_id_idx" ON "commercial_invoices" USING btree ("port_of_discharge_id");--> statement-breakpoint
CREATE INDEX "commercial_invoices_destination_country_id_idx" ON "commercial_invoices" USING btree ("destination_country_id");--> statement-breakpoint
CREATE INDEX "commercial_invoices_shipping_line_id_idx" ON "commercial_invoices" USING btree ("shipping_line_id");--> statement-breakpoint
CREATE INDEX "commercial_invoices_bank_account_id_idx" ON "commercial_invoices" USING btree ("bank_account_id");--> statement-breakpoint
CREATE INDEX "production_order_lines_document_idx" ON "production_order_lines" USING btree ("document_id","position");--> statement-breakpoint
CREATE INDEX "production_order_terms_document_idx" ON "production_order_terms" USING btree ("document_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "production_orders_number_uq" ON "production_orders" USING btree ("company_id","document_number") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "production_orders_company_date_idx" ON "production_orders" USING btree ("company_id","document_date");--> statement-breakpoint
CREATE INDEX "production_orders_proforma_invoice_id_idx" ON "production_orders" USING btree ("proforma_invoice_id");--> statement-breakpoint
CREATE INDEX "production_orders_supplier_id_idx" ON "production_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "production_orders_buyer_id_idx" ON "production_orders" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "production_orders_consignee_id_idx" ON "production_orders" USING btree ("consignee_id");--> statement-breakpoint
CREATE INDEX "production_orders_notify_party_id_idx" ON "production_orders" USING btree ("notify_party_id");--> statement-breakpoint
CREATE INDEX "production_orders_currency_id_idx" ON "production_orders" USING btree ("currency_id");--> statement-breakpoint
CREATE INDEX "production_orders_payment_term_id_idx" ON "production_orders" USING btree ("payment_term_id");--> statement-breakpoint
CREATE INDEX "production_orders_origin_country_id_idx" ON "production_orders" USING btree ("origin_country_id");--> statement-breakpoint
CREATE INDEX "production_orders_port_of_loading_id_idx" ON "production_orders" USING btree ("port_of_loading_id");--> statement-breakpoint
CREATE INDEX "production_orders_port_of_discharge_id_idx" ON "production_orders" USING btree ("port_of_discharge_id");--> statement-breakpoint
CREATE INDEX "production_orders_destination_country_id_idx" ON "production_orders" USING btree ("destination_country_id");--> statement-breakpoint
CREATE INDEX "proforma_invoice_lines_document_idx" ON "proforma_invoice_lines" USING btree ("document_id","position");--> statement-breakpoint
CREATE INDEX "proforma_invoice_terms_document_idx" ON "proforma_invoice_terms" USING btree ("document_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "proforma_invoices_number_uq" ON "proforma_invoices" USING btree ("company_id","document_number") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "proforma_invoices_company_date_idx" ON "proforma_invoices" USING btree ("company_id","document_date");--> statement-breakpoint
CREATE INDEX "proforma_invoices_buyer_id_idx" ON "proforma_invoices" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "proforma_invoices_consignee_id_idx" ON "proforma_invoices" USING btree ("consignee_id");--> statement-breakpoint
CREATE INDEX "proforma_invoices_notify_party_id_idx" ON "proforma_invoices" USING btree ("notify_party_id");--> statement-breakpoint
CREATE INDEX "proforma_invoices_currency_id_idx" ON "proforma_invoices" USING btree ("currency_id");--> statement-breakpoint
CREATE INDEX "proforma_invoices_payment_term_id_idx" ON "proforma_invoices" USING btree ("payment_term_id");--> statement-breakpoint
CREATE INDEX "proforma_invoices_origin_country_id_idx" ON "proforma_invoices" USING btree ("origin_country_id");--> statement-breakpoint
CREATE INDEX "proforma_invoices_port_of_loading_id_idx" ON "proforma_invoices" USING btree ("port_of_loading_id");--> statement-breakpoint
CREATE INDEX "proforma_invoices_port_of_discharge_id_idx" ON "proforma_invoices" USING btree ("port_of_discharge_id");--> statement-breakpoint
CREATE INDEX "proforma_invoices_destination_country_id_idx" ON "proforma_invoices" USING btree ("destination_country_id");--> statement-breakpoint
CREATE INDEX "proforma_invoices_bank_account_id_idx" ON "proforma_invoices" USING btree ("bank_account_id");