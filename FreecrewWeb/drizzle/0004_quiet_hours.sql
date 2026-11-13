ALTER TABLE "profiles" ADD COLUMN "unavailable_before" time;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "unavailable_after" time;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_unavailable_order" CHECK ("profiles"."unavailable_before" is null or "profiles"."unavailable_after" is null or "profiles"."unavailable_after" > "profiles"."unavailable_before");