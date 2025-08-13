-- Enable the pg_cron extension and pg_net if not already enabled
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Create cron job to process event registration emails every 15 seconds
select cron.schedule(
  'process-event_registrations-emails',
  '15 seconds', -- Run 15 seconds
  $$
  select
    net.http_get(
        url:='https://utbymunzemtumroucqga.supabase.co/functions/v1/process-event-registrations',
        headers:=jsonb_build_object(), 
        timeout_milliseconds:=5000
    );
  $$
);