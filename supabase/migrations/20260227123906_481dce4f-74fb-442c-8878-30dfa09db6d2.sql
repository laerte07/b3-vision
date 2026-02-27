
-- Asset classes (seed table)
CREATE TABLE public.asset_classes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.asset_classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read asset_classes" ON public.asset_classes FOR SELECT USING (true);

INSERT INTO public.asset_classes (name, slug) VALUES
  ('Ações', 'acoes'),
  ('FIIs', 'fiis'),
  ('ETFs', 'etfs'),
  ('Renda Fixa', 'renda-fixa'),
  ('BDRs', 'bdrs'),
  ('Criptos', 'criptos');

-- Assets
CREATE TABLE public.assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT,
  class_id UUID NOT NULL REFERENCES public.asset_classes(id),
  exchange TEXT NOT NULL DEFAULT 'B3',
  currency TEXT NOT NULL DEFAULT 'BRL',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, ticker)
);
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own assets" ON public.assets FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Positions
CREATE TABLE public.positions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL DEFAULT 0,
  avg_price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own positions" ON public.positions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Transactions
CREATE TABLE public.transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  type TEXT NOT NULL CHECK (type IN ('BUY','SELL','DIVIDEND')),
  quantity NUMERIC NOT NULL DEFAULT 0,
  price NUMERIC NOT NULL DEFAULT 0,
  fees NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own transactions" ON public.transactions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Class targets
CREATE TABLE public.class_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  class_id UUID NOT NULL REFERENCES public.asset_classes(id),
  target_percent NUMERIC NOT NULL DEFAULT 0,
  lower_band NUMERIC NOT NULL DEFAULT 0,
  upper_band NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, class_id)
);
ALTER TABLE public.class_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own class_targets" ON public.class_targets FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Price cache
CREATE TABLE public.price_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE UNIQUE,
  last_price NUMERIC,
  change_percent NUMERIC,
  logo_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'manual'
);
ALTER TABLE public.price_cache ENABLE ROW LEVEL SECURITY;
-- Price cache is linked to assets which are already user-scoped; allow read/write if user owns the asset
CREATE POLICY "Users manage price_cache for own assets" ON public.price_cache FOR ALL
  USING (EXISTS (SELECT 1 FROM public.assets WHERE assets.id = price_cache.asset_id AND assets.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.assets WHERE assets.id = price_cache.asset_id AND assets.user_id = auth.uid()));

-- Dividends cache
CREATE TABLE public.dividends_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE UNIQUE,
  div_12m NUMERIC,
  dy_12m NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'manual'
);
ALTER TABLE public.dividends_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage dividends_cache for own assets" ON public.dividends_cache FOR ALL
  USING (EXISTS (SELECT 1 FROM public.assets WHERE assets.id = dividends_cache.asset_id AND assets.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.assets WHERE assets.id = dividends_cache.asset_id AND assets.user_id = auth.uid()));

-- Valuation models (premissas salvas)
CREATE TABLE public.valuation_models (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  model_type TEXT NOT NULL,
  json_params JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, asset_id, model_type)
);
ALTER TABLE public.valuation_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own valuation_models" ON public.valuation_models FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Valuation results
CREATE TABLE public.valuation_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  model_type TEXT NOT NULL,
  fair_value NUMERIC,
  upside NUMERIC,
  max_buy_price NUMERIC,
  json_breakdown JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, asset_id, model_type)
);
ALTER TABLE public.valuation_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own valuation_results" ON public.valuation_results FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Correlation matrix
CREATE TABLE public.correlation_matrix (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  item_a TEXT NOT NULL,
  item_b TEXT NOT NULL,
  corr_value NUMERIC NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, item_a, item_b)
);
ALTER TABLE public.correlation_matrix ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own correlation_matrix" ON public.correlation_matrix FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Updated_at triggers
CREATE TRIGGER update_valuation_models_updated_at BEFORE UPDATE ON public.valuation_models FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_valuation_results_updated_at BEFORE UPDATE ON public.valuation_results FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
