DROP INDEX "sharing_uq";--> statement-breakpoint
ALTER TABLE "sharing_policies" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sharing_policies" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "sharing_policies" ADD COLUMN "delete_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "sharing_uq" ON "sharing_policies" USING btree ("entity","source_company_id","target_company_id") WHERE deleted_at is null;