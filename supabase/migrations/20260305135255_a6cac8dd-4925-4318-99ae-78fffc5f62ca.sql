ALTER TABLE public.price_cache ADD COLUMN IF NOT EXISTS sector text DEFAULT NULL;
ALTER TABLE public.price_cache ADD COLUMN IF NOT EXISTS industry text DEFAULT NULL;