
-- Create contributions table
CREATE TABLE public.contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  contribution_date date NOT NULL DEFAULT CURRENT_DATE,
  total_amount numeric NOT NULL DEFAULT 0,
  allocation_mode text NOT NULL DEFAULT 'manual',
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own contributions"
  ON public.contributions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create contribution_items table
CREATE TABLE public.contribution_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id uuid NOT NULL REFERENCES public.contributions(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  quantity numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contribution_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own contribution_items"
  ON public.contribution_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contributions c
      WHERE c.id = contribution_items.contribution_id
      AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.contributions c
      WHERE c.id = contribution_items.contribution_id
      AND c.user_id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX idx_contributions_user_date ON public.contributions(user_id, contribution_date);
CREATE INDEX idx_contribution_items_contribution ON public.contribution_items(contribution_id);
CREATE INDEX idx_contribution_items_asset ON public.contribution_items(asset_id);
