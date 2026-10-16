DROP INDEX "users_email_unique";--> statement-breakpoint
CREATE INDEX "tickets_created_at_idx" ON "tickets" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_body_nonempty" CHECK (length(btrim("comments"."body")) > 0);--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_body_length" CHECK (char_length("comments"."body") <= 5000);--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_title_nonempty" CHECK (length(btrim("tickets"."title")) > 0);--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_title_length" CHECK (char_length("tickets"."title") <= 200);
--> statement-breakpoint
-- Triggers are maintained here because Drizzle Kit does not model them.
CREATE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := GREATEST(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER tickets_set_updated_at BEFORE UPDATE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER comments_set_updated_at BEFORE UPDATE ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
