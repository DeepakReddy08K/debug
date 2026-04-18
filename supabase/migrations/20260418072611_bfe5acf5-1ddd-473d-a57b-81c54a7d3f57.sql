-- Remove user-writable policies on rate_limits (writes happen via SECURITY DEFINER function with service role)
DROP POLICY IF EXISTS "Users can insert their own rate limits" ON public.rate_limits;
DROP POLICY IF EXISTS "Users can update their own rate limits" ON public.rate_limits;

-- Tighten chat_messages INSERT to also verify run ownership
DROP POLICY IF EXISTS "Users can insert own chat messages" ON public.chat_messages;
CREATE POLICY "Users can insert own chat messages"
ON public.chat_messages
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.runs
    WHERE runs.id = chat_messages.run_id
      AND runs.user_id = auth.uid()
  )
);