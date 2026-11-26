ALTER TABLE "proforma_invoice_lines" ADD COLUMN "destination_port_id" uuid;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD COLUMN "dispatch_by" date;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD COLUMN "buyer_item_code" text;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "order_source" text DEFAULT 'Our PI' NOT NULL;--> statement-breakpoint
ALTER TABLE "proforma_invoice_lines" ADD CONSTRAINT "proforma_invoice_lines_destination_port_id_ports_id_fk" FOREIGN KEY ("destination_port_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;