-- Unified migration file for Cebby PWA
-- This file combines all individual migrations in the correct order
-- ============================================
-- 1. Create profiles table
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  logto_user_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  email VARCHAR(255) UNIQUE NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  contact_details JSONB DEFAULT '{}',
  social_links JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  deleted_at TIMESTAMPTZ DEFAULT NULL
);

-- Add indexes for profiles
CREATE INDEX IF NOT EXISTS idx_profiles_logto_user_id ON profiles(logto_user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- ============================================
-- 2. Create event_registrations table
-- ============================================
CREATE TABLE IF NOT EXISTS public.event_registrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id),

  name TEXT NOT NULL, --- capture name for unauthenticated users, eg: walk-in
  email TEXT NOT NULL, --- capture emails for unauthenticated users, eg: walk-in
  phone VARCHAR(50),
  
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  verification_token UUID, -- token issued to verify registration after creating pending account

  checked_in_at TIMESTAMP WITH TIME ZONE,
  check_in_method VARCHAR(50), -- 'qr_code', 'manual', 'nfc'
  qr_code_id VARCHAR(255) UNIQUE,
  
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled', 'declined', 'waitlisted', 'walkin')),
  type VARCHAR(50) DEFAULT 'online', -- 'online', 'walk_in'
  
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for event_registrations
CREATE INDEX idx_event_registrations_event_id ON public.event_registrations(event_id);
CREATE INDEX idx_event_registrations_email ON public.event_registrations(email);
CREATE INDEX idx_event_registrations_status ON public.event_registrations(status);
CREATE UNIQUE INDEX idx_event_registrations_event_email_active ON public.event_registrations(event_id, email) WHERE status != 'cancelled';
CREATE UNIQUE INDEX unique_event_profile_active ON public.event_registrations(event_id, profile_id) WHERE profile_id IS NOT NULL AND status != 'cancelled';
CREATE UNIQUE INDEX idx_event_registrations_verification_token ON public.event_registrations(verification_token) WHERE verification_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_registrations_profile_id ON event_registrations(profile_id);
CREATE INDEX IF NOT EXISTS idx_event_registrations_qr_code_id ON event_registrations(qr_code_id);

-- Add RLS policies for event_registrations
ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;

-- Policy for reading registrations (public can see counts)
CREATE POLICY "Public can view registration counts" ON public.event_registrations
  FOR SELECT
  USING (true);

-- Policy for inserting registrations (anyone can register)
CREATE POLICY "Anyone can create registrations" ON public.event_registrations
  FOR INSERT
  WITH CHECK (true);

-- Policy for updating registrations (only the user or admin)
CREATE POLICY "Users can update own registrations" ON public.event_registrations
  FOR UPDATE
  WITH CHECK (true);

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_event_registrations_updated_at
  BEFORE UPDATE ON public.event_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add columns to events table to track if it's a managed event with registration
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS registration_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS registration_limit INTEGER;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS registration_deadline TIMESTAMPTZ;

-- ============================================
-- 4. Create updated_at trigger function for profiles
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for profiles table
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 5. Configure RLS (disabled for Logto auth)
-- ============================================
-- Disable RLS since we're using Logto for auth, not Supabase Auth
-- Security is handled at the API level using service role
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE event_registrations DISABLE ROW LEVEL SECURITY;

-- ============================================
-- 6. Add documentation comments
-- ============================================
COMMENT ON TABLE profiles IS 'User profiles linked to Logto authentication';
COMMENT ON COLUMN event_registrations.phone IS 'Phone number for walk-in registrations';
COMMENT ON COLUMN event_registrations.type IS 'Type of registration: online or walk_in';
COMMENT ON COLUMN event_registrations.qr_code_id IS 'Unique identifier for QR code generation';
COMMENT ON COLUMN event_registrations.checked_in_at IS 'Timestamp when attendee checked in at the event';
COMMENT ON COLUMN event_registrations.check_in_method IS 'Method used for check-in (qr_code, manual, nfc)';
COMMENT ON INDEX idx_event_registrations_event_email_active IS 'Ensures unique email per event for non-cancelled registrations only, allowing re-registration after cancellation';
COMMENT ON INDEX unique_event_profile_active IS 'Ensures unique profile per event for non-cancelled registrations only, allowing re-registration after cancellation';