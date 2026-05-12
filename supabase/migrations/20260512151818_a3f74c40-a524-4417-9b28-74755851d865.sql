
ALTER TABLE public.watchlist
  ADD COLUMN last_price numeric,
  ADD COLUMN change_percent numeric,
  ADD COLUMN dy_12m numeric,
  ADD COLUMN price_updated_at timestamptz;
