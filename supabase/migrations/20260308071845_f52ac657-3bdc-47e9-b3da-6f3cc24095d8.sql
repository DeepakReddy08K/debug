CREATE POLICY "Users can update test cases for own runs"
ON public.test_cases
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM runs WHERE runs.id = test_cases.run_id AND runs.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM runs WHERE runs.id = test_cases.run_id AND runs.user_id = auth.uid()
  )
);