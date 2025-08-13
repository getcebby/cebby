-- Setup email queue system using PGMQ
-- This migration creates the necessary infrastructure for automatic email sending after RSVP

-- ============================================
-- 1. Enable PGMQ extension and create queue
-- ============================================

-- Enable PGMQ extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pgmq;

-- Create the email-event_registrations-confirmation queue
SELECT pgmq.create('email-event_registrations-confirmation');

-- ============================================
-- 2. Create function to enqueue email confirmation jobs
-- ============================================

CREATE OR REPLACE FUNCTION public.enqueue_email_event_registrations_confirmation(
  p_registration_id UUID,
  p_event_id BIGINT
) RETURNS BIGINT AS $$
DECLARE
  message_id BIGINT;
BEGIN
  -- Enqueue the email confirmation job
  SELECT pgmq.send(
    'email-event_registrations-confirmation',
    jsonb_build_object(
      'type', 'registration_confirmation',
      'registration_id', p_registration_id,
      'event_id', p_event_id,
      'timestamp', extract(epoch from now())
    )
  ) INTO message_id;
  
  RETURN message_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. Create trigger function for automatic email queueing
-- ============================================

CREATE OR REPLACE FUNCTION public.trigger_email_confirmation()
RETURNS TRIGGER AS $$
BEGIN
  -- Only enqueue email for confirmed registrations
  IF NEW.status = 'confirmed' AND (TG_OP = 'INSERT' OR OLD.status != 'confirmed') THEN
    -- Enqueue email confirmation job
    PERFORM public.enqueue_email_event_registrations_confirmation(NEW.id, NEW.event_id);
    
    -- Log the action
    RAISE NOTICE 'Email confirmation job enqueued for registration % and event %', NEW.id, NEW.event_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. Create trigger on event_registrations table
-- ============================================

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_email_confirmation_on_registration ON public.event_registrations;

-- Create trigger that fires after INSERT or UPDATE
CREATE TRIGGER trigger_email_confirmation_on_registration
  AFTER INSERT OR UPDATE OF status ON public.event_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_email_confirmation();

-- ============================================
-- 5. Grant necessary permissions
-- ============================================

-- Grant permissions to execute the functions
GRANT EXECUTE ON FUNCTION public.enqueue_email_event_registrations_confirmation(UUID, BIGINT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.trigger_email_confirmation() TO authenticated, anon, service_role;

-- ============================================
-- 6. Add documentation
-- ============================================

COMMENT ON FUNCTION public.enqueue_email_event_registrations_confirmation(UUID, BIGINT) IS 'Enqueues an email confirmation job for a registration';
COMMENT ON FUNCTION public.trigger_email_confirmation() IS 'Trigger function that automatically enqueues email confirmation jobs when registrations are confirmed';
COMMENT ON TRIGGER trigger_email_confirmation_on_registration ON public.event_registrations IS 'Automatically enqueues email confirmation when registration status becomes confirmed';