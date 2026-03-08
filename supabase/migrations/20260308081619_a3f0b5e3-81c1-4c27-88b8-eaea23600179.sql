
-- Enable pg_cron and pg_net for scheduled auto-deletion
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Function to delete runs (and cascading test_cases) older than 3 months
CREATE OR REPLACE FUNCTION public.cleanup_old_runs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Delete test_cases for old runs first
  DELETE FROM public.test_cases
  WHERE run_id IN (
    SELECT id FROM public.runs
    WHERE created_at < now() - interval '3 months'
  );
  
  -- Delete old runs
  DELETE FROM public.runs
  WHERE created_at < now() - interval '3 months';
END;
$$;
