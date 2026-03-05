CREATE TABLE "faq_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"intent" text NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"confidence_score" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "faq_entries" ADD CONSTRAINT "faq_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;