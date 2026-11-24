CREATE TABLE "pipeline_templates" (
	"company_id" uuid NOT NULL,
	"market" text NOT NULL,
	"steps" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "pipeline_templates_company_id_market_pk" PRIMARY KEY("company_id","market")
);
--> statement-breakpoint
ALTER TABLE "shipment_stages" ADD COLUMN "skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment_stages" ADD COLUMN "skip_reason" text;--> statement-breakpoint
ALTER TABLE "shipment_stages" ADD COLUMN "file_id" uuid;--> statement-breakpoint
ALTER TABLE "shipment_stages" ADD COLUMN "done_by" uuid;--> statement-breakpoint
ALTER TABLE "pipeline_templates" ADD CONSTRAINT "pipeline_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;