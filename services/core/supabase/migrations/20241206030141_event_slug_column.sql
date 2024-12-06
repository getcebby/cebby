alter table "public"."events" add column "slug" text;

CREATE UNIQUE INDEX events_slug_key ON public.events USING btree (slug);

alter table "public"."events" add constraint "events_slug_key" UNIQUE using index "events_slug_key";


