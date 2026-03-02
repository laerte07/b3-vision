
-- Score history table for monthly snapshots
CREATE TABLE public.score_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  score_total numeric NOT NULL DEFAULT 0,
  score_quality numeric NOT NULL DEFAULT 0,
  score_growth numeric NOT NULL DEFAULT 0,
  score_valuation numeric NOT NULL DEFAULT 0,
  score_risk numeric NOT NULL DEFAULT 0,
  score_dividends numeric NOT NULL DEFAULT 0,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  json_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, asset_id, snapshot_date)
);

ALTER TABLE public.score_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own score_history"
ON public.score_history
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
