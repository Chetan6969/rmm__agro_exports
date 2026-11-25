CREATE TABLE "freight_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"party_type" text NOT NULL,
	"shipping_line_id" uuid,
	"service_provider_id" uuid,
	"company_name" text,
	"phone" text,
	"ports" text,
	"markets" text,
	"notes" text,
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
CREATE TABLE "mail_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
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
CREATE TABLE "freight_enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"enquiry_date" date NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"shipment_id" uuid,
	"proforma_invoice_id" uuid,
	"port_of_loading" text NOT NULL,
	"port_of_discharge" text NOT NULL,
	"container_type" text NOT NULL,
	"container_count" integer NOT NULL,
	"commodity" text,
	"gross_weight_mt" numeric(12, 3),
	"ready_date" date,
	"free_days_wanted" integer,
	"incoterm" text,
	"reply_by" date,
	"reminder_hours" integer DEFAULT 48 NOT NULL,
	"notes" text,
	"awarded_thread_id" uuid,
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
CREATE TABLE "freight_mail_index" (
	"message_id" text PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"message_id" text NOT NULL,
	"in_reply_to" text,
	"references" text,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text,
	"attachments" jsonb,
	"sent_by_user_id" uuid,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"message_id" uuid,
	"revision" integer NOT NULL,
	"currency" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"per_container" boolean DEFAULT true NOT NULL,
	"surcharges" numeric(14, 2),
	"free_days" integer,
	"transit_days" integer,
	"valid_until" date,
	"notes" text,
	"auto" boolean DEFAULT false NOT NULL,
	"evidence" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"contact_id" uuid,
	"contact_name" text,
	"contact_email" text NOT NULL,
	"carrier" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"status" text DEFAULT 'SENT' NOT NULL,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"last_outbound_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"unread" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"provider" text DEFAULT 'other' NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer NOT NULL,
	"smtp_secure" boolean NOT NULL,
	"imap_host" text NOT NULL,
	"imap_port" integer NOT NULL,
	"imap_secure" boolean NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"status" text DEFAULT 'unverified' NOT NULL,
	"last_error" text,
	"last_sync_at" timestamp with time zone,
	"imap_uid_validity" text,
	"imap_last_uid" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "freight_contacts" ADD CONSTRAINT "freight_contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_contacts" ADD CONSTRAINT "freight_contacts_shipping_line_id_shipping_lines_id_fk" FOREIGN KEY ("shipping_line_id") REFERENCES "public"."shipping_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_contacts" ADD CONSTRAINT "freight_contacts_service_provider_id_service_providers_id_fk" FOREIGN KEY ("service_provider_id") REFERENCES "public"."service_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_templates" ADD CONSTRAINT "mail_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_enquiries" ADD CONSTRAINT "freight_enquiries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_messages" ADD CONSTRAINT "freight_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_messages" ADD CONSTRAINT "freight_messages_thread_id_freight_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."freight_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_quotes" ADD CONSTRAINT "freight_quotes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_quotes" ADD CONSTRAINT "freight_quotes_thread_id_freight_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."freight_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_threads" ADD CONSTRAINT "freight_threads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_threads" ADD CONSTRAINT "freight_threads_enquiry_id_freight_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."freight_enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "freight_contacts_shipping_line_id_idx" ON "freight_contacts" USING btree ("shipping_line_id");--> statement-breakpoint
CREATE INDEX "freight_contacts_service_provider_id_idx" ON "freight_contacts" USING btree ("service_provider_id");--> statement-breakpoint
CREATE INDEX "freight_contacts_company_idx" ON "freight_contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "mail_templates_company_idx" ON "mail_templates" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "freight_enquiries_number_uq" ON "freight_enquiries" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "freight_enquiries_company_idx" ON "freight_enquiries" USING btree ("company_id","enquiry_date");--> statement-breakpoint
CREATE INDEX "freight_messages_thread_idx" ON "freight_messages" USING btree ("thread_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "freight_messages_mid_uq" ON "freight_messages" USING btree ("company_id","message_id");--> statement-breakpoint
CREATE INDEX "freight_quotes_thread_idx" ON "freight_quotes" USING btree ("thread_id","revision");--> statement-breakpoint
CREATE INDEX "freight_threads_enquiry_idx" ON "freight_threads" USING btree ("enquiry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_accounts_user_uq" ON "mail_accounts" USING btree ("user_id");