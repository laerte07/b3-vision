import type { Fundamentals, PortfolioAsset } from '@/hooks/usePortfolio';
import type { OverrideJson } from '@/hooks/useFundamentalsOverride';

export type FieldSource = 'manual' | 'api' | 'nd';

export interface EffectiveFundamentals {
  values: Record<string, number | null>;
  sources: Record<string, FieldSource>;
}

const FIELD_MAP: Array<{ key: string; apiKey: keyof Fundamentals }> = [
  { key: 'dividend_yield', apiKey: 'dividend_yield' },
  { key: 'lpa', apiKey: 'lpa' },
  { key: 'vpa', apiKey: 'vpa' },
  { key: 'roe', apiKey: 'roe' },
  { key: 'pb_ratio', apiKey: 'pb_ratio' },
  { key: 'pe_ratio', apiKey: 'pe_ratio' },
  { key: 'ev', apiKey: 'ev' },
  { key: 'ebitda', apiKey: 'ebitda' },
  { key: 'net_debt', apiKey: 'net_debt' },
  { key: 'payout', apiKey: 'payout' },
  { key: 'margin', apiKey: 'margin' },
  { key: 'revenue_growth', apiKey: 'revenue_growth' },
];

const COVERAGE_KEYS = [
  'roe', 'pe_ratio', 'pb_ratio', 'ev', 'ebitda', 'net_debt',
  'dividend_yield', 'payout', 'margin', 'revenue_growth',
];

export function getEffectiveFundamentals(
  asset: PortfolioAsset,
  overrides: OverrideJson
): EffectiveFundamentals {
  const values: Record<string, number | null> = {};
  const sources: Record<string, FieldSource> = {};

  for (const { key, apiKey } of FIELD_MAP) {
    const manualVal = overrides[key as keyof OverrideJson];
    const apiVal = asset.fundamentals?.[apiKey] ?? null;

    if (manualVal != null && typeof manualVal === 'number') {
      values[key] = manualVal;
      sources[key] = 'manual';
    } else if (apiVal != null) {
      values[key] = apiVal as number;
      sources[key] = 'api';
    } else {
      values[key] = null;
      sources[key] = 'nd';
    }
  }

  // Extra fields only in overrides
  const extraKeys = ['div_12m', 'market_cap', 'net_income_ttm', 'equity'] as const;
  for (const key of extraKeys) {
    const manualVal = overrides[key];
    if (manualVal != null && typeof manualVal === 'number') {
      values[key] = manualVal;
      sources[key] = 'manual';
    } else {
      // div_12m comes from asset directly
      if (key === 'div_12m' && asset.div_12m != null) {
        values[key] = asset.div_12m;
        sources[key] = 'api';
      } else {
        values[key] = null;
        sources[key] = 'nd';
      }
    }
  }

  return { values, sources };
}

export function computeCoverage(eff: EffectiveFundamentals): number {
  const filled = COVERAGE_KEYS.filter(k => eff.values[k] != null).length;
  return Math.round((filled / COVERAGE_KEYS.length) * 100);
}

export function coverageBadge(pct: number): { label: string; className: string } {
  if (pct >= 80) return { label: 'Alta', className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' };
  if (pct >= 55) return { label: 'Média', className: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' };
  if (pct >= 1) return { label: 'Baixa', className: 'bg-red-500/15 text-red-500 border-red-500/30' };
  return { label: 'Sem dados', className: 'bg-muted text-muted-foreground border-muted' };
}
