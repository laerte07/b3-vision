import type { SavedValuation } from '@/hooks/useSavedValuations';

export interface ConsensusRow {
  ticker: string;
  name: string | null;
  current_price: number | null;
  byModel: Record<string, SavedValuation | undefined>;
  bestModel: string | null;
  bestFairValue: number | null;
  bestUpside: number | null;
  avgUpside: number | null;
  consistency: number | null; // 0-100
  marginSafety: number | null; // 0-100 (avg)
  coverage: number; // count of valid methods
  score: number; // 0-100
  breakdown: { upside: number; consistency: number; safety: number; coverage: number };
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const normalizeUpside = (avgUpside: number) => {
  // 0% -> 0, 50%+ -> 100
  return clamp((avgUpside / 50) * 100, 0, 100);
};

const normalizeConsistency = (values: number[]) => {
  if (values.length < 2) return 50; // neutral when only 1 method
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (Math.abs(mean) < 1e-9) return 50;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  // Coefficient of variation; lower = more consistent
  const cv = std / Math.abs(mean);
  // cv 0 -> 100; cv >= 1 -> 0
  return clamp(100 - cv * 100, 0, 100);
};

const normalizeSafety = (fair: number, current: number) => {
  if (!current || !Number.isFinite(current) || current <= 0) return 0;
  const margin = ((fair - current) / current) * 100;
  if (margin <= 0) return 0;
  // 0% -> 0, 30%+ -> 100
  return clamp((margin / 30) * 100, 0, 100);
};

export const buildConsensus = (valuations: SavedValuation[], allModelKeys: string[]): ConsensusRow[] => {
  const byTicker = new Map<string, SavedValuation[]>();
  for (const v of valuations) {
    const arr = byTicker.get(v.ticker) || [];
    arr.push(v);
    byTicker.set(v.ticker, arr);
  }

  const rows: ConsensusRow[] = [];
  byTicker.forEach((items, ticker) => {
    // Keep most recent per model
    const byModel: Record<string, SavedValuation | undefined> = {};
    for (const m of allModelKeys) {
      const list = items.filter(i => i.model_type === m);
      if (list.length) {
        list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        byModel[m] = list[0];
      }
    }

    const sample = items[0];
    const current = sample.current_price;

    const fairValues: { model: string; fair: number; upside: number | null }[] = [];
    for (const m of allModelKeys) {
      const v = byModel[m];
      if (!v) continue;
      const fair = v.max_buy_price ?? v.fair_value;
      if (fair === null || !Number.isFinite(fair) || fair <= 0) continue;
      fairValues.push({ model: m, fair, upside: v.upside });
    }

    let bestModel: string | null = null;
    let bestFairValue: number | null = null;
    let bestUpside: number | null = null;
    if (fairValues.length) {
      const best = [...fairValues].sort((a, b) => b.fair - a.fair)[0];
      bestModel = best.model;
      bestFairValue = best.fair;
      bestUpside = best.upside;
    }

    const upsides = fairValues
      .map(f => f.upside)
      .filter((u): u is number => u !== null && Number.isFinite(u));
    const avgUpside = upsides.length ? upsides.reduce((a, b) => a + b, 0) / upsides.length : null;

    const upsideScore = avgUpside !== null ? normalizeUpside(avgUpside) : 0;
    const consistencyScore = upsides.length ? normalizeConsistency(upsides) : 0;
    const safetyScores = current
      ? fairValues.map(f => normalizeSafety(f.fair, current))
      : [];
    const safetyScore = safetyScores.length ? safetyScores.reduce((a, b) => a + b, 0) / safetyScores.length : 0;
    const coverageScore = clamp((fairValues.length / Math.max(allModelKeys.length, 1)) * 100, 0, 100);

    const score = Math.round(
      0.4 * upsideScore + 0.3 * consistencyScore + 0.2 * safetyScore + 0.1 * coverageScore
    );

    rows.push({
      ticker,
      name: sample.name,
      current_price: current,
      byModel,
      bestModel,
      bestFairValue,
      bestUpside,
      avgUpside,
      consistency: upsides.length ? Math.round(consistencyScore) : null,
      marginSafety: safetyScores.length ? Math.round(safetyScore) : null,
      coverage: fairValues.length,
      score,
      breakdown: {
        upside: Math.round(upsideScore),
        consistency: Math.round(consistencyScore),
        safety: Math.round(safetyScore),
        coverage: Math.round(coverageScore),
      },
    });
  });

  return rows.sort((a, b) => b.score - a.score);
};

export const scoreClassification = (score: number): { label: string; emoji: string; className: string } => {
  if (score >= 80) return { label: 'Excelente', emoji: '🟢', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' };
  if (score >= 60) return { label: 'Bom', emoji: '🔵', className: 'bg-blue-500/15 text-blue-600 border-blue-500/30' };
  if (score >= 40) return { label: 'Neutro', emoji: '🟡', className: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30' };
  return { label: 'Ruim', emoji: '🔴', className: 'bg-red-500/15 text-red-600 border-red-500/30' };
};
