/**
 * Score Engine v6 — Indicator-based, sector-contextual, with percentile normalization.
 *
 * Three layers:
 *   1) Collect raw indicators per asset
 *   2) Classify sector group
 *   3) Normalize within sector-specific benchmarks + cross-portfolio percentiles
 */

import type { PortfolioAsset } from '@/hooks/usePortfolio';

// ─── Types ───────────────────────────────────────────────────

export type SectorGroup = 'financeiro' | 'utilities' | 'commodities' | 'tecnologia' | 'consumo' | 'base';

export type PillarKey = 'quality' | 'growth' | 'valuation' | 'risk' | 'dividends';
export const PILLAR_KEYS: PillarKey[] = ['quality', 'growth', 'valuation', 'risk', 'dividends'];

type Weights = Record<PillarKey, number>;

export const SECTOR_LABELS: Record<SectorGroup, string> = {
  base: 'Base (Padrão)',
  financeiro: 'Financeiro / Seguros',
  utilities: 'Utilities / Energia',
  tecnologia: 'Tecnologia / Growth',
  commodities: 'Commodities / Mineração',
  consumo: 'Consumo / Saúde',
};

export interface PillarScore {
  qualityNorm: number | null;
  growthNorm: number | null;
  valuationNorm: number | null;
  riskNorm: number | null;
  dividendsNorm: number | null;
  totalBase: number;
  totalAdjusted: number;
  sectorGroup: SectorGroup;
  sectorLabel: string;
  baseWeights: Weights;
  adjustedWeights: Weights;
  effectiveBaseWeights: Weights;
  effectiveAdjustedWeights: Weights;
  coverage: number;
  confidence: number;
  alerts: Array<{ text: string; category: AlertCategory; priority: 'high' | 'medium' | 'low' }>;
  rawInputs: Record<string, number | null>;
}

export type AlertCategory = 'quality' | 'growth' | 'valuation' | 'risk' | 'dividends' | 'data' | 'coherence';

// ─── Sector-adaptive weights ─────────────────────────────────

const SECTOR_WEIGHTS: Record<SectorGroup, Weights> = {
  base:        { quality: 25, growth: 20, valuation: 25, risk: 15, dividends: 15 },
  financeiro:  { quality: 30, growth: 10, valuation: 25, risk: 20, dividends: 15 },
  utilities:   { quality: 25, growth: 10, valuation: 20, risk: 25, dividends: 20 },
  tecnologia:  { quality: 20, growth: 35, valuation: 25, risk: 10, dividends: 10 },
  commodities: { quality: 20, growth: 10, valuation: 30, risk: 30, dividends: 10 },
  consumo:     { quality: 30, growth: 20, valuation: 20, risk: 15, dividends: 15 },
};

const BASE_WEIGHTS = SECTOR_WEIGHTS.base;

// ─── Sector detection ────────────────────────────────────────

function removeAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const TICKER_MAP: Array<[RegExp, SectorGroup]> = [
  [/^(ITUB|BBDC|BBAS|SANB|ITSA|BPAC|BRBI|BBSE|WIZC|PSSA|CXSE|IRBR|SULA|B3SA|ABCB|BMGB|BPAN|PINE)/, 'financeiro'],
  [/^(CMIG|ELET|ENBR|CPFE|EQTL|TAEE|ENGI|AURE|CPLE|NEOE|SAPR|SBSP|CESP|TRPL|AESB|CSMG|LIGT|ISAE|ALUP|OMGE|MEGA)/, 'utilities'],
  [/^(PETR|VALE|CSNA|GGBR|USIM|GOAU|CMIN|BRAP|SUZB|KLBN|DXCO|SOJA|SLCE|AGRO|PRIO|RECV|RRRP|VBBR|UGPA|CSAN)/, 'commodities'],
  [/^(TOTS|LWSA|POSI|CASH|MLAS|BMOB|NGRD|SQIA|INTB|LINX|MELI)/, 'tecnologia'],
  [/^(ABEV|NTCO|RADL|PCAR|AMER|LREN|MGLU|ARZZ|AZZA|ODPV|HAPV|RDOR|HYPE|FLRY|GRND|VULC|MDIA|RAIZ|VIVT|COGN|YDUQ|RENT|MOVI|CVCB)/, 'consumo'],
];

const TEXT_MAP: Array<[RegExp, SectorGroup]> = [
  [/bank|banco|financ|seguro|insurance|asset management|capital market|holding|brokerage/i, 'financeiro'],
  [/utilit|energy|energia|electric|eletric|saneamento|water|gas natural|power/i, 'utilities'],
  [/tech|software|internet|semiconduc|cloud|saas|digital|information/i, 'tecnologia'],
  [/commod|oil|gas|petrol|petroleo|mining|mineracao|steel|siderurg|papel|celulose|basic material|agri/i, 'commodities'],
  [/consumer|consumo|food|beverage|bebida|retail|varejo|farmac|pharma|health|saude|education|educa/i, 'consumo'],
];

export function detectSectorGroup(sector: string | null, industry: string | null, ticker?: string): SectorGroup {
  if (ticker) {
    const t = ticker.toUpperCase();
    for (const [re, group] of TICKER_MAP) {
      if (re.test(t)) return group;
    }
  }
  if (!sector && !industry) return 'base';
  const text = removeAccents(`${sector ?? ''} ${industry ?? ''}`.toLowerCase());
  for (const [re, group] of TEXT_MAP) {
    if (re.test(text)) return group;
  }
  return 'base';
}

// ─── Math helpers ────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
}
function clamp01(v: number): number { return clamp(v, 0, 1); }

/**
 * S-curve normalization:
 *   [low → 0, mid → 0.50, high → 0.90]
 * Uses concave (diminishing returns) above midpoint so scores rarely hit 1.0.
 */
function normS(value: number | null | undefined, low: number, mid: number, high: number, inverse = false): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  let v = inverse ? -value : value;
  const l = inverse ? -high : low;
  const m = inverse ? -mid : mid;
  const h = inverse ? -low : high;
  if (v <= l) return 0;
  if (v >= h) return 0.95; // hard cap below 1.0
  if (v <= m) return 0.50 * ((v - l) / (m - l));
  const t = (v - m) / (h - m);
  return 0.50 + 0.45 * (1 - Math.pow(1 - t, 1.6)); // concave curve, max ~0.95
}

/**
 * Band scoring for payout-like metrics:
 *   sweet-spot [goodMin, goodMax] → 0.80
 *   acceptable [okMin, okMax] → 0.50
 *   outside → 0.15
 */
function scoreBand(value: number | null | undefined, goodMin: number, goodMax: number, okMin: number, okMax: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= goodMin && value <= goodMax) return 0.80;
  if (value >= okMin && value <= okMax) return 0.50;
  return 0.15;
}

/**
 * Winsorize: log-dampen values above a reasonable threshold.
 * Returns a dampened value that's more conservative but never zeroed.
 */
function winsorize(value: number, reasonable: number): number {
  if (value <= reasonable) return value;
  const excess = value - reasonable;
  return reasonable + Math.log1p(excess) * (reasonable * 0.12);
}

/**
 * Percentile rank: where does this value sit within the array?
 * Returns 0-1. Used for cross-portfolio relative comparison.
 */
function percentileRank(value: number, population: number[]): number {
  if (population.length <= 1) return 0.5;
  const sorted = [...population].sort((a, b) => a - b);
  let rank = 0;
  for (const v of sorted) {
    if (v < value) rank++;
    else if (v === value) rank += 0.5;
  }
  return rank / sorted.length;
}

// ─── Weight redistribution for missing data ──────────────────

function redistributeWeights(base: Weights, norms: Record<PillarKey, number | null>): Weights {
  const available = PILLAR_KEYS.filter(k => norms[k] != null);
  const missing = PILLAR_KEYS.filter(k => norms[k] == null);
  if (available.length === 0) return base;
  const missingW = missing.reduce((s, k) => s + base[k], 0);
  const availW = available.reduce((s, k) => s + base[k], 0);
  const eff = { ...base };
  for (const k of missing) eff[k] = 0;
  for (const k of available) eff[k] = base[k] + (base[k] / availW) * missingW;
  return eff;
}

function computeWeightedTotal(norms: Record<PillarKey, number | null>, weights: Weights): { total: number; effWeights: Weights } {
  const effWeights = redistributeWeights(weights, norms);
  let total = 0;
  let anyData = false;
  for (const k of PILLAR_KEYS) {
    const n = norms[k];
    if (n != null && effWeights[k] > 0) {
      anyData = true;
      total += n * effWeights[k];
    }
  }
  return { total: anyData ? total : 0, effWeights };
}

/**
 * Compression: maps raw weighted 0–100 to a gentler curve capped at ~93.
 */
function compressScore(raw: number): number {
  if (raw <= 0) return 0;
  const x = clamp(raw, 0, 100);
  // Gentle power curve: 50→46, 60→55, 70→65, 80→74, 90→84, 95→89, 100→93
  return clamp(93 * Math.pow(x / 100, 1.06), 0, 93);
}

// ─── Sector-specific benchmark tables ────────────────────────

type Bench3 = [number, number, number]; // [low, mid, high]

const ROE_BENCH: Record<SectorGroup, Bench3> = {
  financeiro: [6, 16, 28], utilities: [5, 12, 22], commodities: [3, 12, 25],
  tecnologia: [5, 18, 35], consumo: [5, 15, 28], base: [5, 14, 26],
};
const MARGIN_BENCH: Record<SectorGroup, Bench3> = {
  financeiro: [10, 25, 45], utilities: [8, 18, 35], commodities: [5, 15, 30],
  tecnologia: [8, 20, 40], consumo: [5, 12, 25], base: [5, 15, 30],
};
const GROWTH_BENCH: Record<SectorGroup, Bench3> = {
  financeiro: [-2, 7, 16], utilities: [-2, 5, 13], commodities: [-3, 6, 18],
  tecnologia: [-2, 12, 28], consumo: [-2, 8, 20], base: [-2, 8, 20],
};
const GROWTH_REASONABLE: Record<SectorGroup, number> = {
  financeiro: 18, utilities: 15, commodities: 25, tecnologia: 35, consumo: 22, base: 22,
};
const PE_BENCH: Record<SectorGroup, Bench3> = {
  financeiro: [4, 9, 18], utilities: [5, 10, 20], commodities: [4, 8, 16],
  tecnologia: [8, 18, 35], consumo: [6, 14, 25], base: [6, 12, 22],
};
const PB_BENCH: Record<SectorGroup, Bench3> = {
  financeiro: [0.5, 1.3, 2.5], utilities: [0.5, 1.5, 3.0], commodities: [0.4, 1.2, 2.5],
  tecnologia: [1.0, 3.0, 7.0], consumo: [0.8, 2.5, 5.0], base: [0.6, 2.0, 4.5],
};
const EV_BENCH: Record<SectorGroup, Bench3> = {
  financeiro: [0, 0, 0], utilities: [4, 8, 14], commodities: [3, 6, 12],
  tecnologia: [6, 12, 22], consumo: [4, 9, 16], base: [4, 9, 16],
};

const SECTOR_STABILITY: Record<SectorGroup, number> = {
  utilities: 0.08, consumo: 0.06, financeiro: 0.04, base: 0, tecnologia: -0.04, commodities: -0.06,
};

// ─── Sub-weights per sector ──────────────────────────────────

const QUALITY_SUB: Record<SectorGroup, { roe: number; margin: number; debt: number }> = {
  financeiro: { roe: 0.60, margin: 0.40, debt: 0 },
  utilities: { roe: 0.35, margin: 0.25, debt: 0.40 },
  commodities: { roe: 0.35, margin: 0.30, debt: 0.35 },
  tecnologia: { roe: 0.45, margin: 0.35, debt: 0.20 },
  consumo: { roe: 0.45, margin: 0.30, debt: 0.25 },
  base: { roe: 0.45, margin: 0.30, debt: 0.25 },
};

const VAL_SUB: Record<SectorGroup, { pe: number; pb: number; ev: number }> = {
  financeiro: { pe: 0.35, pb: 0.65, ev: 0 },
  utilities: { pe: 0.30, pb: 0.25, ev: 0.45 },
  commodities: { pe: 0.20, pb: 0.25, ev: 0.55 },
  tecnologia: { pe: 0.40, pb: 0.20, ev: 0.40 },
  consumo: { pe: 0.40, pb: 0.25, ev: 0.35 },
  base: { pe: 0.35, pb: 0.25, ev: 0.40 },
};

const RISK_SUB: Record<SectorGroup, { vol: number; conc: number; debt: number; pred: number }> = {
  financeiro: { vol: 0.20, conc: 0.35, debt: 0, pred: 0.45 },
  utilities: { vol: 0.15, conc: 0.25, debt: 0.30, pred: 0.30 },
  commodities: { vol: 0.25, conc: 0.25, debt: 0.30, pred: 0.20 },
  tecnologia: { vol: 0.30, conc: 0.30, debt: 0.20, pred: 0.20 },
  consumo: { vol: 0.20, conc: 0.30, debt: 0.25, pred: 0.25 },
  base: { vol: 0.25, conc: 0.25, debt: 0.25, pred: 0.25 },
};

// ─── Alert helper ────────────────────────────────────────────

type Alert = PillarScore['alerts'][number];
function alert(text: string, category: AlertCategory, priority: 'high' | 'medium' | 'low' = 'medium'): Alert {
  return { text, category, priority };
}

// ─── Main engine ─────────────────────────────────────────────

export function computeScores(stocks: PortfolioAsset[], totalPortfolio: number): Map<string, PillarScore> {
  const map = new Map<string, PillarScore>();
  if (stocks.length === 0) return map;

  // ─ Phase 1: Collect raw indicators for all stocks ─
  interface RawIndicators {
    roe: number | null;
    margin: number | null;
    debtEbitda: number | null;
    revenueGrowth: number | null;
    payout: number | null;
    pe: number | null;
    pb: number | null;
    evEbitda: number | null;
    dy: number | null;
    lpa: number | null;
    volAbs: number | null;
    pctPortfolio: number;
    sectorGroup: SectorGroup;
  }

  const rawMap = new Map<string, RawIndicators>();
  // Collect populations for percentile ranking
  const populations: Record<string, number[]> = {
    roe: [], margin: [], debtEbitda: [], revenueGrowth: [], pe: [], pb: [], evEbitda: [], dy: [],
  };

  for (const stock of stocks) {
    const f = stock.fundamentals;
    const sg = detectSectorGroup(stock.sector, stock.industry, stock.ticker);
    const price = stock.last_price ?? stock.avg_price;
    const posVal = stock.quantity * (price || 0);
    const pctP = totalPortfolio > 0 ? (posVal / totalPortfolio) * 100 : 0;

    const roe = f?.roe ?? f?.roe_5y ?? null;
    const margin = f?.margin ?? null;
    const debtEbitda = f?.net_debt != null && f?.ebitda != null && Math.abs(f.ebitda) > 1000
      ? f.net_debt / f.ebitda : null;
    const revenueGrowth = f?.revenue_growth ?? null;
    const payout = f?.payout ?? null;
    const pe = f?.pe_ratio ?? null;
    const pb = f?.pb_ratio ?? null;
    const evEbitda = f?.ev != null && f?.ebitda != null && Math.abs(f.ebitda) > 1000 ? f.ev / f.ebitda : null;
    const dy = stock.effective_dy ?? null;
    const lpa = f?.lpa ?? null;
    const volAbs = stock.change_percent != null ? Math.abs(stock.change_percent) : null;

    const raw: RawIndicators = { roe, margin, debtEbitda, revenueGrowth, payout, pe, pb, evEbitda, dy, lpa, volAbs, pctPortfolio: pctP, sectorGroup: sg };
    rawMap.set(stock.id, raw);

    // Populate for percentile
    if (roe != null) populations.roe.push(roe);
    if (margin != null) populations.margin.push(margin);
    if (debtEbitda != null) populations.debtEbitda.push(debtEbitda);
    if (revenueGrowth != null) populations.revenueGrowth.push(revenueGrowth);
    if (pe != null && pe > 0 && pe < 200) populations.pe.push(pe);
    if (pb != null && pb > 0) populations.pb.push(pb);
    if (evEbitda != null && evEbitda > 0) populations.evEbitda.push(evEbitda);
    if (dy != null) populations.dy.push(dy);
  }

  // ─ Phase 2: Score each stock using indicators + sector benchmarks + percentiles ─
  for (const stock of stocks) {
    const raw = rawMap.get(stock.id)!;
    const sg = raw.sectorGroup;
    const sectorW = SECTOR_WEIGHTS[sg];
    const alerts: Alert[] = [];

    let metricsUsed = 0;
    let metricsTotal = 0;
    let dataQualityPenalty = 0;

    // ──── QUALITY ────
    const roeClamped = raw.roe != null ? clamp(raw.roe, -10, 80) : null;
    const roeN = normS(roeClamped, ...ROE_BENCH[sg]);
    const marginN = normS(raw.margin, ...MARGIN_BENCH[sg]);
    const debtN = sg === 'financeiro' ? null : (raw.debtEbitda != null ? normS(raw.debtEbitda, 0, 2.5, 5, true) : null);

    // Percentile blend: 70% sector benchmark, 30% relative rank
    const roeFinal = roeN != null && populations.roe.length >= 3
      ? roeN * 0.70 + percentileRank(raw.roe!, populations.roe) * 0.30
      : roeN;
    const marginFinal = marginN != null && populations.margin.length >= 3
      ? marginN * 0.70 + percentileRank(raw.margin!, populations.margin) * 0.30
      : marginN;

    if (raw.roe != null && raw.roe > 50) {
      alerts.push(alert(`ROE elevado (${raw.roe.toFixed(0)}%) — verificar sustentabilidade`, 'quality'));
      dataQualityPenalty += 0.03;
    }
    if (raw.roe != null && raw.roe > 0 && raw.roe < ROE_BENCH[sg][0]) {
      alerts.push(alert(`ROE baixo (${raw.roe.toFixed(1)}%) para ${SECTOR_LABELS[sg]}`, 'quality', 'low'));
    }
    if (raw.debtEbitda != null && raw.debtEbitda > 3.5) {
      alerts.push(alert(`Dívida/EBITDA elevada (${raw.debtEbitda.toFixed(1)}x)`, 'risk', 'high'));
    }

    metricsTotal += sg === 'financeiro' ? 2 : 3;
    if (roeFinal != null) metricsUsed++;
    if (marginFinal != null) metricsUsed++;
    if (debtN != null) metricsUsed++;

    const qSub = QUALITY_SUB[sg];
    const qParts = [{ w: qSub.roe, v: roeFinal }, { w: qSub.margin, v: marginFinal }, { w: qSub.debt, v: debtN }];
    const qW = qParts.filter(p => p.v != null && p.w > 0).reduce((s, p) => s + p.w, 0);
    const qualityNorm = qW > 0
      ? clamp01(qParts.filter(p => p.v != null && p.w > 0).reduce((s, p) => s + p.w * (p.v as number), 0) / qW)
      : null;

    // ──── GROWTH ────
    const payoutClamped = raw.payout != null ? clamp(raw.payout, 0, 120) : null;
    if (raw.payout != null && raw.payout > 100) {
      alerts.push(alert(`Payout acima de 100% (${raw.payout.toFixed(0)}%)`, 'dividends'));
      dataQualityPenalty += 0.03;
    }

    let revGrowthAdj = raw.revenueGrowth;
    let growthReliability = 1.0;
    const reasonable = GROWTH_REASONABLE[sg];

    if (revGrowthAdj != null && Math.abs(revGrowthAdj) > reasonable * 2) {
      alerts.push(alert(`Crescimento de receita atípico (${revGrowthAdj.toFixed(0)}%) — peso reduzido`, 'growth'));
      revGrowthAdj = winsorize(Math.abs(revGrowthAdj), reasonable) * Math.sign(revGrowthAdj);
      growthReliability = 0.55;
      dataQualityPenalty += 0.04;
    }

    const sustainableGrowth = roeClamped != null && roeClamped > 0 && payoutClamped != null
      ? roeClamped * Math.max(0, 1 - clamp(payoutClamped, 0, 100) / 100) : null;

    const [gLow, gMid, gHigh] = GROWTH_BENCH[sg];
    const sGrowN = sustainableGrowth != null ? normS(sustainableGrowth, gLow, gMid, gHigh) : null;
    const revGrowN = revGrowthAdj != null ? normS(revGrowthAdj, gLow, gMid, gHigh) : null;

    metricsTotal += 2;
    let growthNorm: number | null = null;
    if (sGrowN != null && revGrowN != null) {
      // Sustainable growth is more reliable than reported revenue growth
      const sW = 0.55;
      const rW = 0.45 * growthReliability;
      growthNorm = clamp01((sGrowN * sW + revGrowN * rW) / (sW + rW));
      metricsUsed += 2;
    } else if (revGrowN != null) {
      growthNorm = clamp01(revGrowN * growthReliability);
      metricsUsed++;
    } else if (sGrowN != null) {
      growthNorm = clamp01(Math.min(sGrowN, 0.65)); // cap when only sustainable available
      metricsUsed++;
    }

    // Coherence: if revenue >> sustainable, dampen
    if (sustainableGrowth != null && raw.revenueGrowth != null && raw.revenueGrowth > 0
      && sustainableGrowth >= 0 && raw.revenueGrowth > sustainableGrowth * 3 && growthNorm != null) {
      growthNorm = clamp01(growthNorm * 0.75);
      alerts.push(alert('Crescimento de receita muito acima do sustentável — score reduzido', 'coherence'));
    }
    // High-payout + high growth = incoherent
    if (payoutClamped != null && payoutClamped > 80 && growthNorm != null && growthNorm > 0.5) {
      growthNorm = clamp01(0.40 + (growthNorm - 0.40) * 0.45);
      alerts.push(alert('Payout alto limita crescimento sustentável', 'coherence', 'low'));
    }
    if (growthNorm == null) alerts.push(alert('Sem dados para pilar Crescimento', 'data', 'low'));

    // ──── VALUATION ────
    let peN: number | null = null;
    if (raw.pe != null && raw.pe > 0 && raw.pe < 200) {
      peN = normS(raw.pe, ...PE_BENCH[sg], true);
      // Suspiciously low P/E
      if (raw.pe < 3) { peN = (peN ?? 0) * 0.4; dataQualityPenalty += 0.03; alerts.push(alert(`P/L muito baixo (${raw.pe.toFixed(1)}) — possível distorção`, 'valuation', 'low')); }
      if (raw.pe > 50) { peN = (peN ?? 0) * 0.3; alerts.push(alert(`P/L muito alto (${raw.pe.toFixed(1)})`, 'valuation')); }
    }

    const pbN = raw.pb != null && raw.pb > 0 ? normS(clamp(raw.pb, 0.1, 15), ...PB_BENCH[sg], true) : null;

    let evN: number | null = null;
    if (sg !== 'financeiro' && raw.evEbitda != null && raw.evEbitda > 0) {
      evN = normS(clamp(raw.evEbitda, 1, 40), ...EV_BENCH[sg], true);
    }

    // Percentile blend for valuation too
    const peFinal = peN != null && populations.pe.length >= 3
      ? peN * 0.75 + (1 - percentileRank(raw.pe!, populations.pe)) * 0.25 // inverse: lower PE = better
      : peN;
    const pbFinal = pbN != null && populations.pb.length >= 3
      ? pbN * 0.75 + (1 - percentileRank(raw.pb!, populations.pb)) * 0.25
      : pbN;

    const vSub = VAL_SUB[sg];
    metricsTotal += sg === 'financeiro' ? 2 : 3;
    if (peFinal != null) metricsUsed++;
    if (pbFinal != null) metricsUsed++;
    if (evN != null) metricsUsed++;

    const vParts = [{ w: vSub.pe, v: peFinal }, { w: vSub.pb, v: pbFinal }, { w: vSub.ev, v: evN }].filter(p => p.w > 0);
    const vW = vParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const valuationNorm = vW > 0
      ? clamp01(vParts.filter(p => p.v != null).reduce((s, p) => s + p.w * (p.v as number), 0) / vW)
      : null;
    if (valuationNorm == null) alerts.push(alert('Sem dados suficientes para Valuation', 'data', 'low'));

    // ──── RISK ────
    const concN = normS(raw.pctPortfolio, 3, 10, 25, true) ?? 0.5;
    const volN = raw.volAbs != null ? normS(raw.volAbs, 0, 3, 8, true) : null;
    const debtRiskN = sg === 'financeiro' ? null : debtN;
    const predictabilityN = (roeFinal != null && marginFinal != null)
      ? clamp01((roeFinal + marginFinal) / 2 * 0.8 + 0.10) : null;

    const rSub = RISK_SUB[sg];
    metricsTotal += 2;
    if (volN != null) metricsUsed++;
    metricsUsed++; // concentration always available
    if (debtRiskN != null) metricsUsed++;
    if (predictabilityN != null) metricsUsed++;

    const rParts = [
      { w: rSub.vol, v: volN }, { w: rSub.conc, v: concN },
      { w: rSub.debt, v: debtRiskN }, { w: rSub.pred, v: predictabilityN },
    ].filter(p => p.w > 0);
    const rW = rParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    let riskNorm = rW > 0
      ? clamp01(rParts.filter(p => p.v != null).reduce((s, p) => s + p.w * (p.v as number), 0) / rW)
      : null;
    if (riskNorm != null) riskNorm = clamp01(riskNorm + SECTOR_STABILITY[sg]);
    if (raw.pctPortfolio > 15) alerts.push(alert(`Concentração elevada: ${raw.pctPortfolio.toFixed(1)}% da carteira`, 'risk', 'high'));

    // ──── DIVIDENDS ────
    const dyN = raw.dy != null ? normS(raw.dy, 0, 5, 12) : null;
    const payoutBandVal = scoreBand(payoutClamped, 25, 75, 10, 90);
    metricsTotal += 2;
    if (dyN != null) metricsUsed++;
    if (payoutBandVal != null) metricsUsed++;

    const dParts = [{ w: 0.65, v: dyN }, { w: 0.35, v: payoutBandVal }];
    const dW = dParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const dividendsNorm = dW > 0
      ? clamp01(dParts.filter(p => p.v != null).reduce((s, p) => s + p.w * (p.v as number), 0) / dW)
      : null;
    if (dividendsNorm == null) alerts.push(alert('Sem dados de Dividendos (DY)', 'data', 'low'));

    // Coherence: tech sector with high DY is unusual
    if (sg === 'tecnologia' && dividendsNorm != null && dividendsNorm > 0.7) {
      alerts.push(alert('DY alto para setor de crescimento', 'coherence', 'low'));
    }

    // ──── SANITY CHECKS ────
    // Avoid one outlier metric lifting entire score
    const norms: Record<PillarKey, number | null> = {
      quality: qualityNorm, growth: growthNorm, valuation: valuationNorm, risk: riskNorm, dividends: dividendsNorm,
    };

    // If only 1-2 pillars have data, compress harder
    const filledPillars = PILLAR_KEYS.filter(k => norms[k] != null).length;

    // ──── COMPUTE TOTALS ────
    const baseResult = computeWeightedTotal(norms, BASE_WEIGHTS);
    const adjResult = computeWeightedTotal(norms, sectorW);
    let totalBase = baseResult.total;
    let totalAdjusted = adjResult.total;

    const coverage = metricsTotal > 0 ? metricsUsed / metricsTotal : 0;
    const confidence = clamp01(coverage - dataQualityPenalty);

    // Coverage penalty
    if (coverage < 0.35) {
      const penalty = 0.50 + coverage;
      totalBase *= penalty;
      totalAdjusted *= penalty;
      alerts.push(alert(`Cobertura muito baixa (${Math.round(coverage * 100)}%) — score reduzido`, 'data', 'high'));
    } else if (coverage < 0.55) {
      const penalty = 0.75 + 0.25 * ((coverage - 0.35) / 0.2);
      totalBase *= penalty;
      totalAdjusted *= penalty;
    }

    // Pillar-count penalty
    if (filledPillars <= 2) {
      totalBase *= 0.80;
      totalAdjusted *= 0.80;
    }

    // Hard penalties for fundamentally broken companies
    if (raw.lpa != null && raw.lpa < 0) {
      totalBase *= 0.70; totalAdjusted *= 0.70;
      alerts.push(alert('LPA negativo — score penalizado', 'quality', 'high'));
    }
    if (raw.margin != null && raw.margin < 0) {
      totalBase *= 0.80; totalAdjusted *= 0.80;
      alerts.push(alert('Margem líquida negativa', 'quality', 'high'));
    }
    // Cap mediocre quality
    if (qualityNorm != null && qualityNorm < 0.15) {
      totalBase = Math.min(totalBase, 50);
      totalAdjusted = Math.min(totalAdjusted, 50);
    }

    // Compress
    totalBase = compressScore(totalBase);
    totalAdjusted = compressScore(totalAdjusted);

    // Debug
    if (import.meta.env.DEV) {
      console.log(
        `[SCORE v6] ${stock.ticker} (${sg}):\n` +
        `  Quality: ROE=${raw.roe?.toFixed(1) ?? 'n/a'}→${roeFinal?.toFixed(2) ?? 'n/a'}, Margin=${raw.margin?.toFixed(1) ?? 'n/a'}→${marginFinal?.toFixed(2) ?? 'n/a'}, D/E=${raw.debtEbitda?.toFixed(1) ?? 'n/a'}→${debtN?.toFixed(2) ?? 'n/a'} ⇒ ${qualityNorm?.toFixed(3) ?? 'null'}\n` +
        `  Growth: RevGr=${raw.revenueGrowth?.toFixed(1) ?? 'n/a'}(adj=${revGrowthAdj?.toFixed(1) ?? 'n/a'})→${revGrowN?.toFixed(2) ?? 'n/a'}, SustGr=${sustainableGrowth?.toFixed(1) ?? 'n/a'}→${sGrowN?.toFixed(2) ?? 'n/a'} ⇒ ${growthNorm?.toFixed(3) ?? 'null'}\n` +
        `  Valuation: P/L=${raw.pe?.toFixed(1) ?? 'n/a'}→${peFinal?.toFixed(2) ?? 'n/a'}, P/VP=${raw.pb?.toFixed(1) ?? 'n/a'}→${pbFinal?.toFixed(2) ?? 'n/a'}, EV/E=${raw.evEbitda?.toFixed(1) ?? 'n/a'}→${evN?.toFixed(2) ?? 'n/a'} ⇒ ${valuationNorm?.toFixed(3) ?? 'null'}\n` +
        `  Risk: vol=${raw.volAbs?.toFixed(1) ?? 'n/a'}, conc=${raw.pctPortfolio.toFixed(1)}%, stab=${SECTOR_STABILITY[sg]} ⇒ ${riskNorm?.toFixed(3) ?? 'null'}\n` +
        `  Div: DY=${raw.dy?.toFixed(1) ?? 'n/a'}, payout=${raw.payout?.toFixed(0) ?? 'n/a'} ⇒ ${dividendsNorm?.toFixed(3) ?? 'null'}\n` +
        `  TOTAL: base=${totalBase.toFixed(1)}, adj=${totalAdjusted.toFixed(1)}, cov=${(coverage * 100).toFixed(0)}%, conf=${(confidence * 100).toFixed(0)}%, pillars=${filledPillars}/5`
      );
    }

    map.set(stock.id, {
      qualityNorm, growthNorm, valuationNorm, riskNorm, dividendsNorm,
      totalBase: Math.round(totalBase * 10) / 10,
      totalAdjusted: Math.round(totalAdjusted * 10) / 10,
      sectorGroup: sg, sectorLabel: SECTOR_LABELS[sg],
      baseWeights: BASE_WEIGHTS, adjustedWeights: sectorW,
      effectiveBaseWeights: baseResult.effWeights, effectiveAdjustedWeights: adjResult.effWeights,
      coverage, confidence, alerts,
      rawInputs: {
        roe: raw.roe, margin: raw.margin, debtEbitda: raw.debtEbitda,
        revenueGrowth: raw.revenueGrowth, payout: raw.payout,
        pe: raw.pe, pb: raw.pb, evEbitda: raw.evEbitda, dy: raw.dy,
      },
    });
  }

  return map;
}

// ─── Display helpers ─────────────────────────────────────────

export function scoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-500';
  if (score >= 60) return 'text-blue-500';
  if (score >= 45) return 'text-yellow-500';
  return 'text-red-500';
}

export function scoreLabel(score: number): { text: string; className: string } {
  if (score >= 80) return { text: 'Excelente', className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' };
  if (score >= 65) return { text: 'Muito bom', className: 'bg-blue-500/15 text-blue-500 border-blue-500/30' };
  if (score >= 50) return { text: 'Bom', className: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' };
  if (score >= 35) return { text: 'Regular', className: 'bg-orange-500/15 text-orange-500 border-orange-500/30' };
  return { text: 'Fraco', className: 'bg-red-500/15 text-red-500 border-red-500/30' };
}
