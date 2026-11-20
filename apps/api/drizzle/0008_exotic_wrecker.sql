CREATE TABLE "certificate_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"buyer_id" uuid,
	"show_shipment_table" boolean DEFAULT true NOT NULL,
	"body" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
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
CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_number" text NOT NULL,
	"document_date" date NOT NULL,
	"status" text NOT NULL,
	"commercial_invoice_id" uuid,
	"ocean_bill_id" uuid,
	"certificate_template_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"consignee_id" uuid,
	"notify_party_id" uuid,
	"remark" text,
	"amount_in_words" text,
	"locked" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
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
CREATE TABLE "ocean_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_number" text NOT NULL,
	"document_date" date NOT NULL,
	"status" text NOT NULL,
	"commercial_invoice_id" uuid,
	"buyer_id" uuid NOT NULL,
	"consignee_id" uuid,
	"notify_party_id" uuid,
	"bl_number" text,
	"bl_date" date,
	"shipping_bill_number" text,
	"shipping_bill_date" date,
	"vessel_name" text,
	"voyage_no" text,
	"shipping_line_id" uuid,
	"port_of_loading_id" uuid,
	"port_of_discharge_id" uuid,
	"place_of_receipt" text,
	"place_of_delivery" text,
	"final_destination" text,
	"destination_agent_id" uuid,
	"destination_agent_address" text,
	"lc_number" text,
	"lc_date" date,
	"lc_applicant_emails" text,
	"shipping_marks" text,
	"goods_description" text,
	"packing" text,
	"brand" text,
	"crop_year" text,
	"year_of_production" text,
	"net_weight_mt" numeric(12, 3),
	"gross_weight_mt" numeric(12, 3),
	"total_bags" integer,
	"no_of_containers" integer,
	"invoice_value" text,
	"amount_in_words" text,
	"locked" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
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
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_buyer_id_customers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_commercial_invoice_id_commercial_invoices_id_fk" FOREIGN KEY ("commercial_invoice_id") REFERENCES "public"."commercial_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_ocean_bill_id_ocean_bills_id_fk" FOREIGN KEY ("ocean_bill_id") REFERENCES "public"."ocean_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_certificate_template_id_certificate_templates_id_fk" FOREIGN KEY ("certificate_template_id") REFERENCES "public"."certificate_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_buyer_id_customers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_consignee_id_customers_id_fk" FOREIGN KEY ("consignee_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_notify_party_id_customers_id_fk" FOREIGN KEY ("notify_party_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD CONSTRAINT "ocean_bills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD CONSTRAINT "ocean_bills_commercial_invoice_id_commercial_invoices_id_fk" FOREIGN KEY ("commercial_invoice_id") REFERENCES "public"."commercial_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD CONSTRAINT "ocean_bills_buyer_id_customers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD CONSTRAINT "ocean_bills_consignee_id_customers_id_fk" FOREIGN KEY ("consignee_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD CONSTRAINT "ocean_bills_notify_party_id_customers_id_fk" FOREIGN KEY ("notify_party_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD CONSTRAINT "ocean_bills_shipping_line_id_shipping_lines_id_fk" FOREIGN KEY ("shipping_line_id") REFERENCES "public"."shipping_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD CONSTRAINT "ocean_bills_port_of_loading_id_ports_id_fk" FOREIGN KEY ("port_of_loading_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD CONSTRAINT "ocean_bills_port_of_discharge_id_ports_id_fk" FOREIGN KEY ("port_of_discharge_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocean_bills" ADD CONSTRAINT "ocean_bills_destination_agent_id_service_providers_id_fk" FOREIGN KEY ("destination_agent_id") REFERENCES "public"."service_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_templates_code_uq" ON "certificate_templates" USING btree ("company_id","code") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "certificate_templates_buyer_id_idx" ON "certificate_templates" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "certificate_templates_company_idx" ON "certificate_templates" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_number_uq" ON "certificates" USING btree ("company_id","document_number") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "certificates_company_date_idx" ON "certificates" USING btree ("company_id","document_date");--> statement-breakpoint
CREATE INDEX "certificates_commercial_invoice_id_idx" ON "certificates" USING btree ("commercial_invoice_id");--> statement-breakpoint
CREATE INDEX "certificates_ocean_bill_id_idx" ON "certificates" USING btree ("ocean_bill_id");--> statement-breakpoint
CREATE INDEX "certificates_certificate_template_id_idx" ON "certificates" USING btree ("certificate_template_id");--> statement-breakpoint
CREATE INDEX "certificates_buyer_id_idx" ON "certificates" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "certificates_consignee_id_idx" ON "certificates" USING btree ("consignee_id");--> statement-breakpoint
CREATE INDEX "certificates_notify_party_id_idx" ON "certificates" USING btree ("notify_party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ocean_bills_number_uq" ON "ocean_bills" USING btree ("company_id","document_number") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "ocean_bills_company_date_idx" ON "ocean_bills" USING btree ("company_id","document_date");--> statement-breakpoint
CREATE INDEX "ocean_bills_commercial_invoice_id_idx" ON "ocean_bills" USING btree ("commercial_invoice_id");--> statement-breakpoint
CREATE INDEX "ocean_bills_buyer_id_idx" ON "ocean_bills" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "ocean_bills_consignee_id_idx" ON "ocean_bills" USING btree ("consignee_id");--> statement-breakpoint
CREATE INDEX "ocean_bills_notify_party_id_idx" ON "ocean_bills" USING btree ("notify_party_id");--> statement-breakpoint
CREATE INDEX "ocean_bills_shipping_line_id_idx" ON "ocean_bills" USING btree ("shipping_line_id");--> statement-breakpoint
CREATE INDEX "ocean_bills_port_of_loading_id_idx" ON "ocean_bills" USING btree ("port_of_loading_id");--> statement-breakpoint
CREATE INDEX "ocean_bills_port_of_discharge_id_idx" ON "ocean_bills" USING btree ("port_of_discharge_id");--> statement-breakpoint
CREATE INDEX "ocean_bills_destination_agent_id_idx" ON "ocean_bills" USING btree ("destination_agent_id");