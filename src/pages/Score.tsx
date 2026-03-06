import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Brain, Save, Shield, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { usePortfolio, PortfolioAsset } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useScoreHistory, useSaveScoreSnapshot } from '@/hooks/useScoreHistory';

// ============================================================
// SECTOR WEIGHTS & MAPPING
// ============================================================

type SectorGroup = 'base' | 'financeiro' | 'utilities' | 'tecnologia' | 'commodities' | 'consumo';

const SECTOR_LABELS: Record<SectorGroup, string> = {
  base: 'Base (Padrão)',
  financeiro: 'Financeiro / Bancos',
  utilities: 'Utilities / Energia / Saneamento',
  tecnologia: 'Tecnologia / Growth',
  commodities: 'Commodities / Petróleo / Mineração',
  consumo: 'Consumo Defensivo',
};

type Weights = { quality: number; growth: number; valuation: number; risk: number; dividends: number };

const SECTOR_WEIGHTS: Record<SectorGroup, Weights> = {
  base:        { quality: 25, growth: 20, valuation: 25, risk: 15, dividends: 15 },
  financeiro:  { quality: 30, growth: 10, valuation: 30, risk: 15, dividends: 15 },
  utilities:   { quality: 30, growth: 10, valuation: 20, risk: 25, dividends: 15 },
  tecnologia:  { quality: 20, growth: 35, valuation: 25, risk: 10, dividends: 10 },
  commodities: { quality: 20, growth: 10, valuation: 35, risk: 25, dividends: 10 },
  consumo:     { quality: 30, growth: 20, valuation: 20, risk: 15, dividends: 15 },
};

const BASE_WEIGHTS = SECTOR_WEIGHTS.base;

function removeAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function detectSectorGroup(sector: string | null, industry: string | null, ticker?: string): SectorGroup {
  // Try ticker-based heuristic first for known BR tickers when API sector is missing
  if ((!sector && !industry) && ticker) {
    const t = ticker.toUpperCase();
    // Banks / financial holdings
    if (/^(ITUB|BBDC|BBAS|SANB|ITSA|BPAC|BRBI|BBSE|WIZC|PSSA|CXSE|IRBR|SULA|B3SA)/.test(t)) return 'financeiro';
    // Utilities / energy
    if (/^(CMIG|ELET|ENBR|CPFE|EQTL|TAEE|ENGI|AURE|CPLE|NEOE|SAPR|SBSP|CESP|TRPL|AESB|CSMG|LIGT)/.test(t)) return 'utilities';
    // Commodities / oil / mining / agro
    if (/^(PETR|VALE|CSNA|GGBR|USIM|GOAU|CMIN|BRAP|SUZB|KLBN|DXCO|SOJA|SLCE|AGRO|PRIO|RECV|RRRP|VBBR)/.test(t)) return 'commodities';
    // Tech
    if (/^(TOTS|LWSA|POSI|CASH|MLAS|BMOB|NGRD|SQIA|INTB)/.test(t)) return 'tecnologia';
    // Consumer defensive
    if (/^(ABEV|NTCO|RADL|PCAR|AMER|LREN|MGLU|ARZZ|AZZA|ODPV|HAPV|RDOR|HYPE|FLRY|GRND|VULC|MDIA|RAIZ)/.test(t)) return 'consumo';
  }

  if (!sector && !industry) return 'base';
  const text = removeAccents(`${sector ?? ''} ${industry ?? ''}`.toLowerCase());

  if (/bank|banco|financ|seguro|insurance|asset management|capital market|holding|brokerage/i.test(text)) return 'financeiro';
  if (/utilit|energy|energia|electric|eletric|saneamento|water|gas natural|power/i.test(text)) return 'utilities';
  if (/tech|software|internet|semiconduc|cloud|saas|digital|information/i.test(text)) return 'tecnologia';
  if (/commod|oil|gas|petrol|petroleo|mining|mineracao|steel|siderurg|papel|celulose|basic material|agri/i.test(text)) return 'commodities';
  if (/consumer defensive|consumo|food|beverage|bebida|retail|varejo|farmac|pharma|health|saude/i.test(text)) return 'consumo';

  return 'base';
}

// ============================================================
// SCORING ENGINE v3 — REALISTIC, SECTOR-AWARE, DEFLATED
// ============================================================

interface PillarScore {
  quality: number | null;
  growth: number | null;
  valuation: number | null;
  risk: number | null;
  dividends: number | null;
  totalBase: number;
  totalAdjusted: number;
  sectorGroup: SectorGroup;
  sectorLabel: string;
  baseWeights: Weights;
  adjustedWeights: Weights;
  coverage: number;
  confidence: number;
  alerts: string[];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
}

function clamp01(v: number): number { return clamp(v, 0, 1); }

/**
 * Smooth normalization with sigmoid-like curve.
 * Returns 0-1 where the midpoint gives 0.5.
 */
function normSmooth(value: number | null | undefined, low: number, high: number, inverse = false): number | null {
  if (value == null || !Number.isFinite(value) || high === low) return null;
  const v = inverse ? -value : value;
  const l = inverse ? -high : low;
  const h = inverse ? -low : high;
  const raw = (v - l) / (h - l);
  return clamp01(raw);
}

/**
 * Score band for payout-like metrics.
 */
function scoreBand(
  value: number | null | undefined,
  goodMin: number, goodMax: number,
  okMin: number, okMax: number
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= goodMin && value <= goodMax) return 0.85; // not 1.0 — harder to get perfect
  if (value >= okMin && value <= okMax) return 0.55;
  return 0.2;
}

function redistributeWeights(base: Weights, pillars: Record<keyof Weights, number | null>): Weights {
  const available = (Object.keys(pillars) as (keyof Weights)[]).filter(k => pillars[k] != null);
  const missing = (Object.keys(pillars) as (keyof Weights)[]).filter(k => pillars[k] == null);
  if (available.length === 0) return base;

  const missingWeight = missing.reduce((s, k) => s + base[k], 0);
  const availableWeight = available.reduce((s, k) => s + base[k], 0);

  const eff = { ...base };
  for (const k of missing) eff[k] = 0;
  for (const k of available) eff[k] = base[k] + (base[k] / availableWeight) * missingWeight;
  return eff;
}

function computeTotal(pillars: Record<keyof Weights, number | null>, weights: Weights): number {
  const effW = redistributeWeights(weights, pillars);
  let total = 0;
  let haveAny = false;
  (Object.keys(pillars) as (keyof Weights)[]).forEach(k => {
    const s = pillars[k];
    if (s != null && weights[k] > 0) {
      haveAny = true;
      const norm = s / weights[k]; // 0..1
      total += norm * effW[k];
    }
  });
  return haveAny ? total : 0;
}

/**
 * Compression curve: makes scores above 75 progressively harder.
 * Maps [0,100] → [0,100] but compresses the top end.
 * 50 → ~48, 70 → ~65, 80 → ~73, 90 → ~82, 100 → ~92
 */
function compressScore(raw: number): number {
  if (raw <= 0) return 0;
  const x = clamp(raw, 0, 100);
  // Piecewise: linear below 60, compressed above
  if (x <= 60) return x * 0.9; // 60 raw → 54
  // Logarithmic compression above 60
  const excess = x - 60;
  const compressed = 54 + excess * (0.95 - excess * 0.005); // diminishing returns
  return clamp(compressed, 0, 95); // hard cap at 95
}

function computeScores(stocks: PortfolioAsset[], totalPortfolio: number): Map<string, PillarScore> {
  const map = new Map<string, PillarScore>();
  if (stocks.length === 0) return map;

  for (const stock of stocks) {
    const f = stock.fundamentals;
    const alerts: string[] = [];
    const sectorGroup = detectSectorGroup(stock.sector, stock.industry, stock.ticker);
    const sectorLabel = SECTOR_LABELS[sectorGroup];
    const sectorW = SECTOR_WEIGHTS[sectorGroup];

    const price = stock.last_price ?? stock.avg_price;
    const positionValue = stock.quantity * (price || 0);
    const pctPortfolio = totalPortfolio > 0 ? (positionValue / totalPortfolio) * 100 : 0;

    let metricsUsed = 0;
    let metricsTotal = 0;
    let outlierCount = 0;

    // =========== QUALITY ===========
    const roe = f?.roe ?? f?.roe_5y ?? null;
    const margin = f?.margin ?? null;
    const debtEbitda = f?.net_debt != null && f?.ebitda != null && Math.abs(f.ebitda) > 1000
      ? f.net_debt / f.ebitda : null;

    // ROE: clamp at 60%
    const roeClamped = roe != null ? clamp(roe, -10, 60) : null;
    if (roe != null && roe > 60) { alerts.push(`ROE outlier (${roe.toFixed(0)}%) — limitado a 60%`); outlierCount++; }
    if (roe != null && roe < 5) alerts.push('ROE baixo (<5%) — qualidade pressionada');

    // Normalize ROE: 0% → 0, 20% → 0.8, 25%+ → 1.0
    const roeN = normSmooth(roeClamped, 0, 25);
    // Margin: adjust benchmark by sector
    const marginBench = sectorGroup === 'commodities' ? 20 : sectorGroup === 'financeiro' ? 30 : 25;
    const marginW = sectorGroup === 'commodities' ? 0.15 : 0.30;
    const marginN = normSmooth(margin, 0, marginBench);
    // Debt/EBITDA: skip for financeiro (not meaningful)
    const debtN = sectorGroup === 'financeiro' ? null : normSmooth(debtEbitda, 0, 4, true);

    if (debtEbitda != null && debtEbitda > 4) alerts.push('Dívida/EBITDA alto (>4) — atenção ao risco');
    if (sectorGroup !== 'financeiro' && f?.ebitda != null && Math.abs(f.ebitda) <= 1000) alerts.push('EBITDA muito pequeno — Dívida/EBITDA ignorado');

    metricsTotal += sectorGroup === 'financeiro' ? 2 : 3;
    if (roeN != null) metricsUsed++;
    if (marginN != null) metricsUsed++;
    if (debtN != null) metricsUsed++;

    const qParts = [
      { w: 0.50, v: roeN },
      { w: marginW, v: marginN },
      { w: sectorGroup === 'financeiro' ? 0 : 0.20, v: debtN },
    ];
    const qW = qParts.filter(p => p.v != null && p.w > 0).reduce((s, p) => s + p.w, 0);
    const qualityNorm = qW > 0
      ? qParts.filter(p => p.v != null && p.w > 0).reduce((s, p) => s + p.w * (p.v as number), 0) / qW
      : null;
    const qualityScore = qualityNorm != null ? qualityNorm * BASE_WEIGHTS.quality : null;

    // =========== GROWTH ===========
    const payout = f?.payout ?? null;
    const payoutClamped = payout != null ? clamp(payout, 0, 100) : null;
    if (payout != null && payout > 100) { alerts.push(`Payout outlier (${payout.toFixed(0)}%) — distribuindo mais do que lucra`); outlierCount++; }
    if (payout != null && payout > 90) alerts.push('Payout > 90% — dividendo pode ser insustentável');

    let revenueGrowth = f?.revenue_growth ?? null;
    // BRAPI returns revenue_growth as ratio * 100 which can be inflated.
    // Cap at 50% — anything above is likely data error or exceptional one-off
    if (revenueGrowth != null && revenueGrowth > 50) {
      alerts.push(`Revenue growth (${revenueGrowth.toFixed(0)}%) parece inflado — limitado a 50%`);
      revenueGrowth = 50;
      outlierCount++;
    }

    const sustainableGrowth = roeClamped != null && payoutClamped != null
      ? roeClamped * (1 - payoutClamped / 100) : null;

    // Conservative benchmarks by sector
    const growthBenchMax = sectorGroup === 'financeiro' ? 12
      : sectorGroup === 'utilities' ? 8
      : sectorGroup === 'commodities' ? 10
      : sectorGroup === 'consumo' ? 15
      : 20; // tecnologia / base

    const sGrowN = normSmooth(sustainableGrowth, -2, growthBenchMax);
    const revGrowN = revenueGrowth != null ? normSmooth(revenueGrowth, -5, growthBenchMax) : null;

    metricsTotal += 2;
    let growthNorm: number | null = null;
    if (sGrowN != null && revGrowN != null) {
      // Both available: weighted combo (sustainable growth is more reliable)
      growthNorm = sGrowN * 0.55 + revGrowN * 0.45;
      metricsUsed += 2;
    } else if (sGrowN != null) {
      growthNorm = sGrowN;
      metricsUsed++;
    } else if (revGrowN != null) {
      growthNorm = revGrowN;
      metricsUsed++;
    }

    const growthScore = growthNorm != null ? growthNorm * BASE_WEIGHTS.growth : null;
    if (growthScore == null) alerts.push('Sem dados para pilar Crescimento');

    // Unsustainable growth check
    if (sustainableGrowth != null && roeClamped != null && revenueGrowth != null) {
      if (revenueGrowth > (sustainableGrowth + 5)) {
        alerts.push(`Crescimento possivelmente insustentável (${revenueGrowth.toFixed(1)}% > sustentável ${sustainableGrowth.toFixed(1)}%)`);
      }
    }

    // =========== VALUATION ===========
    const pe = f?.pe_ratio ?? null;
    const pb = f?.pb_ratio ?? null;
    const evEbitda = f?.ev != null && f?.ebitda != null && Math.abs(f.ebitda) > 1000
      ? f.ev / f.ebitda : null;

    // Outlier detection
    if (pe != null && (pe < 3 || pe > 60)) {
      alerts.push(`P/L fora do padrão (${pe.toFixed(1)}) — peso reduzido`);
      outlierCount++;
    }
    if (pb != null && pb > 10) {
      alerts.push(`P/VP muito alto (${pb.toFixed(1)}) — possível distorção`);
      outlierCount++;
    }

    // P/L: wider ranges, sector-dependent
    const peBenchMax = sectorGroup === 'financeiro' ? 15 : sectorGroup === 'utilities' ? 18 : sectorGroup === 'tecnologia' ? 30 : 20;
    const peBenchMin = 4;
    const peN = pe != null && pe > 0 ? normSmooth(clamp(pe, 3, 80), peBenchMin, peBenchMax, true) : null;

    // P/VP: sector-dependent ranges
    const pbBenchMax = sectorGroup === 'financeiro' ? 2.5 : sectorGroup === 'commodities' ? 2 : 3.5;
    const pbN = pb != null && pb > 0 ? normSmooth(clamp(pb, 0.3, 10), 0.5, pbBenchMax, true) : null;

    // EV/EBITDA: skip for financeiro entirely (meaningless)
    const evN = sectorGroup === 'financeiro' ? null
      : (evEbitda != null && evEbitda > 0 ? normSmooth(clamp(evEbitda, 2, 30), 4, 14, true) : null);

    // Sector-specific sub-weights
    let peW: number, pbW: number, evW: number;
    if (sectorGroup === 'financeiro') {
      peW = 0.30; pbW = 0.70; evW = 0; // ignore EV/EBITDA
    } else if (sectorGroup === 'commodities') {
      peW = 0.25; pbW = 0.25; evW = 0.50;
    } else if (sectorGroup === 'utilities') {
      peW = 0.35; pbW = 0.25; evW = 0.40;
    } else {
      peW = 0.40; pbW = 0.25; evW = 0.35;
    }

    // Reduce P/L weight if outlier
    if (pe != null && (pe < 3 || pe > 60)) peW *= 0.4;

    metricsTotal += sectorGroup === 'financeiro' ? 2 : 3;
    if (peN != null) metricsUsed++;
    if (pbN != null) metricsUsed++;
    if (evN != null) metricsUsed++;

    const vParts = [
      { w: peW, v: peN },
      { w: pbW, v: pbN },
      { w: evW, v: evN },
    ].filter(p => p.w > 0);
    const vW = vParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const valuationNorm = vW > 0
      ? vParts.filter(p => p.v != null).reduce((s, p) => s + p.w * (p.v as number), 0) / vW
      : null;
    const valuationScore = valuationNorm != null ? valuationNorm * BASE_WEIGHTS.valuation : null;
    if (valuationScore == null) alerts.push('Sem dados para pilar Valuation');

    // =========== RISK ===========
    const changePercent = stock.change_percent ?? null;
    const volAbs = changePercent != null ? Math.abs(changePercent) : null;

    // Progressive concentration penalty (steeper)
    const concN = pctPortfolio <= 5 ? 0.9
      : pctPortfolio <= 10 ? 0.7
      : pctPortfolio <= 15 ? 0.45
      : pctPortfolio <= 25 ? 0.2
      : 0.05;

    const volN = normSmooth(volAbs, 0, 6, true);
    const debtRiskW = sectorGroup === 'utilities' ? 0.40 : 0.25;
    const volW2 = sectorGroup === 'utilities' ? 0.15 : 0.30;

    metricsTotal += sectorGroup === 'financeiro' ? 2 : 3;
    if (volN != null) metricsUsed++;
    metricsUsed++; // concentration always available
    if (sectorGroup !== 'financeiro' && debtN != null) metricsUsed++;

    const rParts = [
      { w: volW2, v: volN },
      { w: 0.40, v: concN },
      { w: sectorGroup === 'financeiro' ? 0 : debtRiskW, v: sectorGroup === 'financeiro' ? null : debtN },
    ].filter(p => p.w > 0);
    const rW = rParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const riskNorm = rW > 0
      ? rParts.filter(p => p.v != null).reduce((s, p) => s + p.w * (p.v as number), 0) / rW
      : null;
    const riskScore = riskNorm != null ? riskNorm * BASE_WEIGHTS.risk : null;

    if (pctPortfolio > 15) alerts.push(`Concentração elevada: ${pctPortfolio.toFixed(1)}% da carteira`);
    else if (pctPortfolio > 10) alerts.push(`Atenção concentração: ${pctPortfolio.toFixed(1)}% da carteira`);

    // =========== DIVIDENDS ===========
    const dy = stock.effective_dy ?? null;
    const dyN = normSmooth(dy, 0, 10); // 10% DY = max score (harder than 12%)
    const payoutBandVal = scoreBand(payoutClamped, 30, 70, 15, 85);

    metricsTotal += 2;
    if (dyN != null) metricsUsed++;
    if (payoutBandVal != null) metricsUsed++;

    const dParts = [
      { w: 0.65, v: dyN },
      { w: 0.35, v: payoutBandVal },
    ];
    const dW = dParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const divNorm = dW > 0
      ? dParts.filter(p => p.v != null).reduce((s, p) => s + p.w * (p.v as number), 0) / dW
      : null;
    const dividendsScore = divNorm != null ? divNorm * BASE_WEIGHTS.dividends : null;

    if (dividendsScore == null) {
      alerts.push('Sem dados de Dividendos (DY). Preencha em Fundamentos.');
    }

    // Smart alerts
    if (sectorGroup === 'tecnologia' && dividendsScore != null && divNorm != null && divNorm > 0.7) {
      alerts.push('Score inflado por Dividendos em setor de crescimento');
    }
    if (growthNorm != null && growthNorm > 0.7 && riskNorm != null && riskNorm < 0.4) {
      alerts.push('Crescimento alto mas Risco alto (concentração/dívida)');
    }

    // =========== TOTALS ===========
    const pillars = {
      quality: qualityScore,
      growth: growthScore,
      valuation: valuationScore,
      risk: riskScore,
      dividends: dividendsScore,
    } as const;

    let totalBase = computeTotal(pillars, BASE_WEIGHTS);
    let totalAdjusted = computeTotal(pillars, sectorW);

    // Coverage & confidence
    const coverage = metricsTotal > 0 ? metricsUsed / metricsTotal : 0;
    const confidence = clamp01(coverage - outlierCount * 0.05);

    // Low coverage penalty (steeper)
    if (coverage < 0.6) {
      const penalty = 0.75 + 0.25 * coverage; // at 0.3 coverage → 0.825 penalty
      totalBase *= penalty;
      totalAdjusted *= penalty;
      alerts.push(`Baixa cobertura (${Math.round(coverage * 100)}%) → score penalizado`);
    } else if (coverage < 0.4) {
      totalBase *= 0.7;
      totalAdjusted *= 0.7;
      alerts.push(`Cobertura muito baixa (${Math.round(coverage * 100)}%) → score muito penalizado`);
    }

    // ROE < 5% or low quality caps
    if (roeClamped != null && roeClamped < 5) {
      totalBase = Math.min(totalBase, 60);
      totalAdjusted = Math.min(totalAdjusted, 60);
    }
    if (qualityNorm != null && qualityNorm < 0.25) {
      totalBase = Math.min(totalBase, 65);
      totalAdjusted = Math.min(totalAdjusted, 65);
    }

    // Negative earnings penalty
    if (f?.lpa != null && f.lpa < 0) {
      totalBase *= 0.70;
      totalAdjusted *= 0.70;
      alerts.push('Lucro por ação negativo — score penalizado');
    }

    // Negative margin penalty
    if (margin != null && margin < 0) {
      totalBase *= 0.80;
      totalAdjusted *= 0.80;
      alerts.push('Margem negativa — score penalizado');
    }

    // ===== COMPRESSION: make 85+ rare =====
    totalBase = compressScore(totalBase);
    totalAdjusted = compressScore(totalAdjusted);

    // Debug logging (dev only)
    if (import.meta.env.DEV) {
      console.log(
        `[SCORE DEBUG] ${stock.ticker}:\n` +
        `  sector=${stock.sector ?? 'null'} | industry=${stock.industry ?? 'null'} | mapped=${sectorGroup}\n` +
        `  GROWTH: revenueGrowth=${f?.revenue_growth?.toFixed(1) ?? 'null'} (capped=${revenueGrowth?.toFixed(1) ?? 'null'}), ` +
        `sustainableGrowth=${sustainableGrowth?.toFixed(1) ?? 'null'}, sGrowN=${sGrowN?.toFixed(3) ?? 'null'}, revGrowN=${revGrowN?.toFixed(3) ?? 'null'}, growthNorm=${growthNorm?.toFixed(3) ?? 'null'}\n` +
        `  VALUATION: pe=${pe?.toFixed(1) ?? 'null'}, pb=${pb?.toFixed(1) ?? 'null'}, evEbitda=${evEbitda?.toFixed(1) ?? 'null'}, peN=${peN?.toFixed(3) ?? 'null'}, pbN=${pbN?.toFixed(3) ?? 'null'}, evN=${evN?.toFixed(3) ?? 'null'}\n` +
        `  SCORES: quality=${qualityScore?.toFixed(1) ?? 'N/D'}, growth=${growthScore?.toFixed(1) ?? 'N/D'}, val=${valuationScore?.toFixed(1) ?? 'N/D'}, risk=${riskScore?.toFixed(1) ?? 'N/D'}, div=${dividendsScore?.toFixed(1) ?? 'N/D'}\n` +
        `  TOTAL: base=${totalBase.toFixed(1)}, adjusted=${totalAdjusted.toFixed(1)}, coverage=${(coverage*100).toFixed(0)}%, DY=${stock.effective_dy ?? 'null'}`
      );
    }

    map.set(stock.id, {
      quality: qualityScore != null ? Math.round(qualityScore * 10) / 10 : null,
      growth: growthScore != null ? Math.round(growthScore * 10) / 10 : null,
      valuation: valuationScore != null ? Math.round(valuationScore * 10) / 10 : null,
      risk: riskScore != null ? Math.round(riskScore * 10) / 10 : null,
      dividends: dividendsScore != null ? Math.round(dividendsScore * 10) / 10 : null,
      totalBase: Math.round(totalBase * 10) / 10,
      totalAdjusted: Math.round(totalAdjusted * 10) / 10,
      sectorGroup,
      sectorLabel,
      baseWeights: BASE_WEIGHTS,
      adjustedWeights: sectorW,
      coverage,
      confidence,
      alerts,
    });
  }

  return map;
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-500';
  if (score >= 65) return 'text-blue-500';
  if (score >= 50) return 'text-yellow-500';
  return 'text-red-500';
}

function scoreBadgeEl(score: number) {
  if (score >= 80) return <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30">Excelente</Badge>;
  if (score >= 65) return <Badge className="bg-blue-500/15 text-blue-500 border-blue-500/30">Muito bom</Badge>;
  if (score >= 50) return <Badge className="bg-yellow-500/15 text-yellow-500 border-yellow-500/30">Bom</Badge>;
  if (score >= 35) return <Badge className="bg-orange-500/15 text-orange-500 border-orange-500/30">Regular</Badge>;
  return <Badge className="bg-red-500/15 text-red-500 border-red-500/30">Fraco</Badge>;
}

// ============================================================
// MAIN COMPONENT
// ============================================================
const ACOES_SLUG = 'acoes';

type SortKey = 'totalAdjusted' | 'totalBase' | 'quality' | 'growth' | 'valuation' | 'risk' | 'dividends' | 'ticker' | 'sector' | 'delta';
type SortDir = 'asc' | 'desc';

const Score = () => {
  const { data: portfolio = [], isLoading } = usePortfolio();
  const { data: classes = [] } = useAssetClasses();
  const saveSnapshot = useSaveScoreSnapshot();

  const acoesClassId = classes.find(c => c.slug === ACOES_SLUG)?.id ?? null;

  const stocks = useMemo(
    () => portfolio.filter(p => (acoesClassId ? p.class_id === acoesClassId : false) && p.quantity > 0),
    [portfolio, acoesClassId]
  );

  const totalPortfolio = useMemo(
    () => portfolio.reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0),
    [portfolio]
  );

  const scoreMap = useMemo(() => computeScores(stocks, totalPortfolio), [stocks, totalPortfolio]);

  const [sortKey, setSortKey] = useState<SortKey>('totalAdjusted');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const ranking = useMemo(() => {
    const items = stocks
      .map(s => ({ ...s, score: scoreMap.get(s.id)! }))
      .filter(s => !!s.score);

    items.sort((a, b) => {
      let va: any, vb: any;
      switch (sortKey) {
        case 'ticker': va = a.ticker; vb = b.ticker; break;
        case 'sector': va = a.score.sectorLabel; vb = b.score.sectorLabel; break;
        case 'totalBase': va = a.score.totalBase; vb = b.score.totalBase; break;
        case 'totalAdjusted': va = a.score.totalAdjusted; vb = b.score.totalAdjusted; break;
        case 'delta': va = a.score.totalAdjusted - a.score.totalBase; vb = b.score.totalAdjusted - b.score.totalBase; break;
        case 'quality': va = a.score.quality ?? -1; vb = b.score.quality ?? -1; break;
        case 'growth': va = a.score.growth ?? -1; vb = b.score.growth ?? -1; break;
        case 'valuation': va = a.score.valuation ?? -1; vb = b.score.valuation ?? -1; break;
        case 'risk': va = a.score.risk ?? -1; vb = b.score.risk ?? -1; break;
        case 'dividends': va = a.score.dividends ?? -1; vb = b.score.dividends ?? -1; break;
        default: va = a.score.totalAdjusted; vb = b.score.totalAdjusted;
      }
      if (typeof va === 'string') {
        const cmp = va.localeCompare(vb);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return items;
  }, [stocks, scoreMap, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />;
    return sortDir === 'desc' ? <ChevronDown className="h-3 w-3 ml-1" /> : <ChevronUp className="h-3 w-3 ml-1" />;
  };

  const [selectedId, setSelectedId] = useState<string>('');
  const fallbackId = ranking[0]?.id ?? '';
  const effectiveSelectedId = selectedId || fallbackId;
  const selectedStock = stocks.find(s => s.id === effectiveSelectedId);
  const selectedScore = effectiveSelectedId ? scoreMap.get(effectiveSelectedId) : null;
  const selectedTicker = selectedStock?.ticker ?? '';

  const { data: history = [] } = useScoreHistory(effectiveSelectedId || undefined);

  const radarData = selectedScore
    ? [
        { pillar: 'Qualidade', value: selectedScore.quality != null ? (selectedScore.quality / BASE_WEIGHTS.quality) * 100 : 0, fullMark: 100 },
        { pillar: 'Crescimento', value: selectedScore.growth != null ? (selectedScore.growth / BASE_WEIGHTS.growth) * 100 : 0, fullMark: 100 },
        { pillar: 'Valuation', value: selectedScore.valuation != null ? (selectedScore.valuation / BASE_WEIGHTS.valuation) * 100 : 0, fullMark: 100 },
        { pillar: 'Risco', value: selectedScore.risk != null ? (selectedScore.risk / BASE_WEIGHTS.risk) * 100 : 0, fullMark: 100 },
        { pillar: 'Dividendos', value: selectedScore.dividends != null ? (selectedScore.dividends / BASE_WEIGHTS.dividends) * 100 : 0, fullMark: 100 },
      ]
    : [];

  const historyChart = (history ?? []).map((h: any) => ({
    date: new Date(h.snapshot_date).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
    score: Number(h.score_total),
  }));

  const handleSaveSnapshot = () => {
    const entries = ranking.map(r => ({
      asset_id: r.id,
      score_total: r.score.totalAdjusted,
      score_quality: r.score.quality ?? 0,
      score_growth: r.score.growth ?? 0,
      score_valuation: r.score.valuation ?? 0,
      score_risk: r.score.risk ?? 0,
      score_dividends: r.score.dividends ?? 0,
      json_details: {
        alerts: r.score.alerts,
        coverage: r.score.coverage,
        sectorGroup: r.score.sectorGroup,
        totalBase: r.score.totalBase,
        totalAdjusted: r.score.totalAdjusted,
      },
    }));
    saveSnapshot.mutate(entries);
  };

  const allAlerts = ranking.flatMap(r => r.score.alerts.map(a => `${r.ticker}: ${a}`));

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div>;

  if (!acoesClassId) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Não encontrei a classe <span className="font-mono">acoes</span>. Verifique o slug da classe no banco.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" /> Score Interno
          </h1>
          <p className="text-sm text-muted-foreground">
            Análise quantitativa de ações (0–100) • Cobertura: {selectedScore ? Math.round(selectedScore.coverage * 100) : 0}%
            • Confiança: {selectedScore ? Math.round(selectedScore.confidence * 100) : 0}%
          </p>
        </div>
        <Button
          variant="outline" size="sm" className="gap-2"
          onClick={handleSaveSnapshot}
          disabled={saveSnapshot.isPending || ranking.length === 0}
        >
          <Save className="h-4 w-4" /> Salvar Snapshot
        </Button>
      </div>

      {stocks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma ação encontrada na carteira.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Radar */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Radar do Ativo</CardTitle>
                  <Select value={effectiveSelectedId} onValueChange={setSelectedId}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {ranking.map(r => (
                        <SelectItem key={r.id} value={r.id}>{r.ticker}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {radarData.length > 0 ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                        <PolarGrid stroke="hsl(var(--border))" />
                        <PolarAngleAxis dataKey="pillar" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                        <Radar name={selectedTicker} dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.25} strokeWidth={2} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">Selecione um ativo</p>
                )}
              </CardContent>
            </Card>

            {/* Score detail */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Score Total</CardTitle>
              </CardHeader>
              <CardContent>
                {selectedScore ? (
                  <div className="space-y-4">
                    {/* Sector badge */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">{selectedScore.sectorLabel}</Badge>
                      <Badge variant="outline" className="text-xs bg-muted/50">
                        Cobertura {Math.round(selectedScore.coverage * 100)}%
                      </Badge>
                    </div>

                    {/* Base vs Adjusted */}
                    <div className="flex items-end gap-6 justify-center">
                      <div className="text-center">
                        <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Base</p>
                        <span className={`text-3xl font-bold font-mono ${scoreColor(selectedScore.totalBase)}`}>
                          {selectedScore.totalBase.toFixed(1)}
                        </span>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Ajustado</p>
                        <span className={`text-5xl font-bold font-mono ${scoreColor(selectedScore.totalAdjusted)}`}>
                          {selectedScore.totalAdjusted.toFixed(1)}
                        </span>
                        <span className="text-2xl text-muted-foreground"> / 100</span>
                      </div>
                      {(() => {
                        const delta = selectedScore.totalAdjusted - selectedScore.totalBase;
                        if (Math.abs(delta) < 0.1) return null;
                        return (
                          <div className="text-center">
                            <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Δ</p>
                            <span className={`text-lg font-mono font-bold ${delta > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="text-center">{scoreBadgeEl(selectedScore.totalAdjusted)}</div>

                    {/* Weights applied */}
                    <div className="mt-4 p-3 rounded-lg bg-muted/30 border border-border/50">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase mb-2">Pesos Aplicados ({selectedScore.sectorGroup !== 'base' ? 'Setor' : 'Padrão'})</p>
                      <div className="grid grid-cols-5 gap-1 text-center text-[10px]">
                        {(['quality', 'growth', 'valuation', 'risk', 'dividends'] as const).map(k => (
                          <div key={k}>
                            <div className="text-muted-foreground capitalize">{k === 'quality' ? 'Qual' : k === 'growth' ? 'Cresc' : k === 'valuation' ? 'Val' : k === 'risk' ? 'Risco' : 'Div'}</div>
                            <div className="font-mono font-bold">{selectedScore.adjustedWeights[k]}%</div>
                            {selectedScore.adjustedWeights[k] !== selectedScore.baseWeights[k] && (
                              <div className="text-muted-foreground">({selectedScore.baseWeights[k]})</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Pillar bars */}
                    <div className="space-y-2 mt-4">
                      {([
                        ['Qualidade', selectedScore.quality, BASE_WEIGHTS.quality],
                        ['Crescimento', selectedScore.growth, BASE_WEIGHTS.growth],
                        ['Valuation', selectedScore.valuation, BASE_WEIGHTS.valuation],
                        ['Risco', selectedScore.risk, BASE_WEIGHTS.risk],
                        ['Dividendos', selectedScore.dividends, BASE_WEIGHTS.dividends],
                      ] as [string, number | null, number][]).map(([label, val, max]) => (
                        <div key={label} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-24">{label}</span>
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${val == null ? 0 : (val / max) * 100}%` }} />
                          </div>
                          <span className="text-xs font-mono w-20 text-right">
                            {val == null ? 'N/D' : `${val.toFixed(1)} / ${max}`}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Alerts */}
                    {selectedScore.alerts.length > 0 && (
                      <div className="mt-4 space-y-1">
                        <p className="text-xs font-medium text-muted-foreground uppercase">Alertas</p>
                        {selectedScore.alerts.map((a, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs p-2 rounded bg-destructive/5 border border-destructive/15">
                            <AlertTriangle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                            <span>{a}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">Nenhum dado</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* History */}
          {historyChart.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Histórico de Score – {selectedTicker}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historyChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                      <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
                      <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Ranking */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ranking da Carteira</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('ticker')}>
                      <span className="flex items-center">Ativo <SortIcon col="ticker" /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('sector')}>
                      <span className="flex items-center">Setor <SortIcon col="sector" /></span>
                    </TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleSort('totalBase')}>
                      <span className="flex items-center justify-center">Base <SortIcon col="totalBase" /></span>
                    </TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleSort('totalAdjusted')}>
                      <span className="flex items-center justify-center">Ajustado <SortIcon col="totalAdjusted" /></span>
                    </TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleSort('delta')}>
                      <span className="flex items-center justify-center">Δ <SortIcon col="delta" /></span>
                    </TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleSort('quality')}>
                      <span className="flex items-center justify-center">Qual <SortIcon col="quality" /></span>
                    </TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleSort('growth')}>
                      <span className="flex items-center justify-center">Cresc <SortIcon col="growth" /></span>
                    </TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleSort('valuation')}>
                      <span className="flex items-center justify-center">Val <SortIcon col="valuation" /></span>
                    </TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleSort('risk')}>
                      <span className="flex items-center justify-center">Risco <SortIcon col="risk" /></span>
                    </TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleSort('dividends')}>
                      <span className="flex items-center justify-center">Div <SortIcon col="dividends" /></span>
                    </TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ranking.map((r, idx) => {
                    const delta = r.score.totalAdjusted - r.score.totalBase;
                    return (
                      <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedId(r.id)}>
                        <TableCell className="font-mono text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-medium">{r.ticker}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                            {r.score.sectorLabel.split(' / ')[0]}
                          </Badge>
                        </TableCell>
                        <TableCell className={`text-center font-mono text-xs ${scoreColor(r.score.totalBase)}`}>
                          {r.score.totalBase.toFixed(1)}
                        </TableCell>
                        <TableCell className={`text-center font-bold font-mono ${scoreColor(r.score.totalAdjusted)}`}>
                          {r.score.totalAdjusted.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-center font-mono text-xs">
                          {Math.abs(delta) < 0.1 ? '—' : (
                            <span className={delta > 0 ? 'text-emerald-500' : 'text-red-500'}>
                              {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center font-mono text-xs">{r.score.quality == null ? 'N/D' : r.score.quality.toFixed(1)}</TableCell>
                        <TableCell className="text-center font-mono text-xs">{r.score.growth == null ? 'N/D' : r.score.growth.toFixed(1)}</TableCell>
                        <TableCell className="text-center font-mono text-xs">{r.score.valuation == null ? 'N/D' : r.score.valuation.toFixed(1)}</TableCell>
                        <TableCell className="text-center font-mono text-xs">{r.score.risk == null ? 'N/D' : r.score.risk.toFixed(1)}</TableCell>
                        <TableCell className="text-center font-mono text-xs">{r.score.dividends == null ? 'N/D' : r.score.dividends.toFixed(1)}</TableCell>
                        <TableCell className="text-center">{scoreBadgeEl(r.score.totalAdjusted)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Alerts */}
          {allAlerts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4 text-destructive" /> Alertas Inteligentes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {allAlerts.slice(0, 30).map((alert, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/5 border border-destructive/15">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                      <span className="text-xs">{alert}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default Score;
