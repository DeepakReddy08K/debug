-- Add syntax_check column for storing syntax analysis results separately
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS syntax_check jsonb DEFAULT NULL;

-- Change ai_diagnosis from text to jsonb for cleaner storage
ALTER TABLE public.runs ALTER COLUMN ai_diagnosis TYPE jsonb USING ai_diagnosis::jsonb;