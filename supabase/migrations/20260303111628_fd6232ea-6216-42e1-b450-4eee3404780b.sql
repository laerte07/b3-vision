
CREATE TABLE public.fundamentals_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  override_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, asset_id)
);

ALTER TABLE public.fundamentals_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own fundamentals_overrides"
  ON public.fundamentals_overrides
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
