CREATE TABLE public.fii_valuations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  nome text,
  preco_atual numeric,
  dividendo_mensal numeric,
  crescimento_dividendo numeric,
  taxa_ntnb_real numeric,
  inflacao_esperada numeric,
  ir_ntnb numeric,
  premio_desejado numeric,
  margem_seguranca numeric,
  tributacao_fii numeric,
  prazo_ntnb text,
  preco_teto numeric,
  preco_premio_zero numeric,
  upside numeric,
  status text,
  anotacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fii_valuations TO authenticated;
GRANT ALL ON public.fii_valuations TO service_role;

ALTER TABLE public.fii_valuations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own FII valuations"
  ON public.fii_valuations FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_fii_valuations_user_ticker ON public.fii_valuations(user_id, ticker);

CREATE TRIGGER trg_fii_valuations_updated
  BEFORE UPDATE ON public.fii_valuations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();