
CREATE TABLE public.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  window_start timestamp with time zone NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1
);

CREATE INDEX idx_rate_limits_user_endpoint ON public.rate_limits (user_id, endpoint, window_start);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Only the service role (edge functions) should access this table
-- No RLS policies for regular users — they can't read/write it directly

-- Cleanup function for old rate limit records
CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 hour';
END;
$$;

-- Rate check function - returns true if request is allowed
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _user_id uuid,
  _endpoint text,
  _max_requests integer,
  _window_minutes integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _window_start timestamp with time zone;
  _current_count integer;
BEGIN
  _window_start := date_trunc('minute', now()) - (extract(minute from now())::integer % _window_minutes) * interval '1 minute';
  
  SELECT request_count INTO _current_count
  FROM public.rate_limits
  WHERE user_id = _user_id AND endpoint = _endpoint AND window_start = _window_start;
  
  IF _current_count IS NULL THEN
    INSERT INTO public.rate_limits (user_id, endpoint, window_start, request_count)
    VALUES (_user_id, _endpoint, _window_start, 1)
    ON CONFLICT DO NOTHING;
    RETURN true;
  END IF;
  
  IF _current_count >= _max_requests THEN
    RETURN false;
  END IF;
  
  UPDATE public.rate_limits
  SET request_count = request_count + 1
  WHERE user_id = _user_id AND endpoint = _endpoint AND window_start = _window_start;
  
  RETURN true;
END;
$$;
