-- Enable authentication for existing events and accounts tables
ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY;

-- Create comprehensive RLS policies for events
CREATE POLICY "Events are viewable by everyone" ON "public"."events"
    AS PERMISSIVE FOR SELECT TO public USING (true);

-- Only authenticated users can insert/update/delete events
CREATE POLICY "Authenticated users can insert events" ON "public"."events"
    AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update events" ON "public"."events"
    AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete events" ON "public"."events"
    AS PERMISSIVE FOR DELETE TO authenticated USING (true);

-- Account policies - only authenticated users can manage accounts
CREATE POLICY "Accounts are viewable by authenticated users" ON "public"."accounts"
    AS PERMISSIVE FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert accounts" ON "public"."accounts"
    AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update accounts" ON "public"."accounts"
    AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete accounts" ON "public"."accounts"
    AS PERMISSIVE FOR DELETE TO authenticated USING (true);

-- Update RLS policies for junction tables to allow authenticated users to manage them
CREATE POLICY "Authenticated users can manage event categories" ON "public"."event_categories"
    AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage event organizers" ON "public"."event_organizers"
    AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage event sources" ON "public"."event_sources"
    AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Update RLS policies for core tables to allow authenticated users to manage them
CREATE POLICY "Authenticated users can manage locations" ON "public"."locations"
    AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage categories" ON "public"."categories"
    AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage organizers" ON "public"."organizers"
    AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Source tables - authenticated users can manage, public can read
CREATE POLICY "Authenticated users can manage facebook sources" ON "public"."facebook_source"
    AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage meetup sources" ON "public"."meetup_source"
    AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage custom sources" ON "public"."custom_source"
    AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Create user profile table for additional user information
CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    "email" TEXT,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "is_admin" BOOLEAN DEFAULT FALSE NOT NULL,
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Enable RLS for user profiles
ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;

-- Users can view all profiles but only update their own
CREATE POLICY "Profiles are viewable by everyone" ON "public"."user_profiles"
    AS PERMISSIVE FOR SELECT TO public USING (true);

CREATE POLICY "Users can insert their own profile" ON "public"."user_profiles"
    AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON "public"."user_profiles"
    AS PERMISSIVE FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Grant permissions for user profiles
GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";

-- Add trigger for user profiles updated_at
CREATE TRIGGER update_user_profiles_updated_at 
    BEFORE UPDATE ON "public"."user_profiles" 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, display_name)
    VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'display_name');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically create profile on user signup
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();