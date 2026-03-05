CREATE TABLE "ai_training_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_message" text NOT NULL,
	"human_reply" text NOT NULL,
	"intent" text NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"quality_score" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_training_examples" ADD CONSTRAINT "ai_training_examples_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;