
CREATE TABLE public.benchmark_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_code text NOT NULL,
  benchmark_name text NOT NULL,
  date date NOT NULL,
  value numeric NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (benchmark_code, date)
);

ALTER TABLE public.benchmark_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read benchmark_history"
  ON public.benchmark_history FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX idx_benchmark_history_code_date ON public.benchmark_history (benchmark_code, date);
