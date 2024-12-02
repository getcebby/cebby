create table "public"."event_slugs" (
    "slug" text not null,
    "event_id" bigint not null
);

CREATE UNIQUE INDEX event_slugs_pkey ON public.event_slugs USING btree (slug, event_id);
CREATE UNIQUE INDEX event_slugs_slug_key ON public.event_slugs USING btree (slug);

alter table "public"."event_slugs" add constraint "event_slugs_pkey" PRIMARY KEY using index "event_slugs_pkey";
alter table "public"."event_slugs" add constraint "event_slugs_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;
alter table "public"."event_slugs" validate constraint "event_slugs_event_id_fkey";
alter table "public"."event_slugs" add constraint "event_slugs_slug_key" UNIQUE using index "event_slugs_slug_key";

alter table "public"."event_slugs" enable row level security;

create policy "Enable read access for all users"
    on "public"."event_slugs" as PERMISSIVE
    for SELECT to public
    using (true);
