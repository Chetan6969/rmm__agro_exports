CREATE TABLE "letterheads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"letterhead_file_id" uuid NOT NULL,
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
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"signature_file_id" uuid NOT NULL,
	"signatory_name" text,
	"signatory_designation" text,
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
ALTER TABLE "certificates" ADD COLUMN "letterhead_id" uuid;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "signature_id" uuid;--> statement-breakpoint
ALTER TABLE "letterheads" ADD CONSTRAINT "letterheads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "letterheads_company_idx" ON "letterheads" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "signatures_company_idx" ON "signatures" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_letterhead_id_letterheads_id_fk" FOREIGN KEY ("letterhead_id") REFERENCES "public"."letterheads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_signature_id_signatures_id_fk" FOREIGN KEY ("signature_id") REFERENCES "public"."signatures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certificates_letterhead_id_idx" ON "certificates" USING btree ("letterhead_id");--> statement-breakpoint
CREATE INDEX "certificates_signature_id_idx" ON "certificates" USING btree ("signature_id");