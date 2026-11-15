CREATE TABLE "exchange_rates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"currency_code" text NOT NULL,
	"rate_to_inr" numeric(18, 6) NOT NULL,
	"rate_date" date NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_positive" CHECK ("exchange_rates"."rate_to_inr" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_code_source_date_uq" ON "exchange_rates" USING btree ("currency_code","source","rate_date");--> statement-breakpoint
CREATE INDEX "exchange_rates_code_fetched_idx" ON "exchange_rates" USING btree ("currency_code","fetched_at");