
-- Cache de dados fundamentalistas por ativo
CREATE TABLE public.fundamentals_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id UUID NOT NULL UNIQUE REFERENCES public.assets(id) ON DELETE CASCADE,
  lpa NUMERIC,
  vpa NUMERIC,
  roe NUMERIC,
  roe_5y NUMERIC,
  payout NUMERIC,
  payout_5y NUMERIC,
  pe_ratio NUMERIC,
  pb_ratio NUMERIC,
  ev NUMERIC,
  ebitda NUMERIC,
  net_debt NUMERIC,
  total_shares BIGINT,
  dividend_yield NUMERIC,
  margin NUMERIC,
  revenue_growth NUMERIC,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'manual'
);

ALTER TABLE public.fundamentals_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage fundamentals_cache for own assets"
ON public.fundamentals_cache FOR ALL
USING (EXISTS (SELECT 1 FROM assets WHERE assets.id = fundamentals_cache.asset_id AND assets.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM assets WHERE assets.id = fundamentals_cache.asset_id AND assets.user_id = auth.uid()));
