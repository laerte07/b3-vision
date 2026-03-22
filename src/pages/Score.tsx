import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { fadeUp, stagger } from '@/lib/motion-variants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Brain, Save, Shield, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
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
type PillarKey = keyof Weights;
const PILLAR_KEYS: PillarKey[] = ['quality', 'growth', 'valuation', 'risk', 'dividends'];

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
  if ((!sector && !industry) && ticker) {
    const t = ticker.toUpperCase();
    if (/^(ITUB|BBDC|BBAS|SANB|ITSA|BPAC|BRBI|BBSE|WIZC|PSSA|CXSE|IRBR|SULA|B3SA)/.test(t)) return 'financeiro';
    if (/^(CMIG|ELET|ENBR|CPFE|EQTL|TAEE|ENGI|AURE|CPLE|NEOE|SAPR|SBSP|CESP|TRPL|AESB|CSMG|LIGT)/.test(t)) return 'utilities';
    if (/^(PETR|VALE|CSNA|GGBR|USIM|GOAU|CMIN|BRAP|SUZB|KLBN|DXCO|SOJA|SLCE|AGRO|PRIO|RECV|RRRP|VBBR)/.test(t)) return 'commodities';
    if (/^(TOTS|LWSA|POSI|CASH|MLAS|BMOB|NGRD|SQIA|INTB)/.test(t)) return 'tecnologia';
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
// SCORING ENGINE v5 — REALISTIC, CONTEXT-AWARE
// ============================================================

interface PillarScore {
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
  alerts: string[];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
}
function clamp01(v: number): number { return clamp(v, 0, 1); }

/**
 * S-curve normalization with diminishing returns above midpoint.
 * [low→0, mid→0.5, high→1.0] with concave shape above mid.
 */
function normSigmoid(value: number | null | undefined, low: number, mid: number, high: number, inverse = false): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const v = inverse ? -value : value;
  const l = inverse ? -high : low;
  const m = inverse ? -mid : mid;
  const h = inverse ? -low : high;
  if (v <= l) return 0;
  if (v >= h) return 1;
  if (v <= m) {
    return 0.5 * ((v - l) / (m - l));
  }
  const t = (v - m) / (h - m);
  return 0.5 + 0.5 * (1 - Math.pow(1 - t, 1.5));
}

/** Winsorize extreme values via log-dampening above a reasonable threshold. */
function winsorize(value: number, reasonable: number): number {
  if (value <= reasonable) return value;
  const excess = value - reasonable;
  return reasonable + Math.log1p(excess) * (reasonable * 0.15);
}

function scoreBand(
  value: number | null | undefined,
  goodMin: number, goodMax: number,
  okMin: number, okMax: number
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= goodMin && value <= goodMax) return 0.80;
  if (value >= okMin && value <= okMax) return 0.50;
  return 0.15;
}

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
 * v5 compression: gentler curve, max ~95.
 * 40→37, 50→46, 60→55, 70→64, 80→74, 90→84, 100→93
 */
function compressScore(raw: number): number {
  if (raw <= 0) return 0;
  const x = clamp(raw, 0, 100);
  return clamp(95 * Math.pow(x / 100, 1.08), 0, 95);
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
    let dataQualityPenalty = 0;

    // =========== QUALITY (v5) — sector-specific S-curves ===========
    const roe = f?.roe ?? f?.roe_5y ?? null;
    const margin = f?.margin ?? null;
    const debtEbitda = f?.net_debt != null && f?.ebitda != null && Math.abs(f.ebitda) > 1000
      ? f.net_debt / f.ebitda : null;

    const roeBench: Record<SectorGroup, [number, number, number]> = {
      financeiro: [5, 15, 30], utilities: [5, 12, 22], commodities: [3, 12, 25],
      tecnologia: [5, 18, 35], consumo: [5, 15, 30], base: [5, 15, 28],
    };
    const [roeLow, roeMid, roeHigh] = roeBench[sectorGroup];
    const roeClamped = roe != null ? clamp(roe, -10, 80) : null;
    const roeN = roeClamped != null ? normSigmoid(roeClamped, roeLow, roeMid, roeHigh) : null;

    if (roe != null && roe > 50) { alerts.push(`ROE elevado (${roe.toFixed(0)}%) — verificar sustentabilidade`); dataQualityPenalty += 0.03; }
    if (roe != null && roe > 0 && roe < roeLow) alerts.push(`ROE baixo (${roe.toFixed(1)}%) para o setor`);

    const marginBenchMap: Record<SectorGroup, [number, number, number]> = {
      financeiro: [10, 25, 45], utilities: [8, 18, 35], commodities: [5, 15, 30],
      tecnologia: [8, 20, 40], consumo: [5, 12, 25], base: [5, 15, 30],
    };
    const [mLow, mMid, mHigh] = marginBenchMap[sectorGroup];
    const marginN = margin != null ? normSigmoid(margin, mLow, mMid, mHigh) : null;

    const debtN = sectorGroup === 'financeiro' ? null
      : (debtEbitda != null ? normSigmoid(debtEbitda, 0, 2.5, 5, true) : null);
    if (debtEbitda != null && debtEbitda > 3.5) alerts.push(`Dívida/EBITDA elevado (${debtEbitda.toFixed(1)}x)`);

    metricsTotal += sectorGroup === 'financeiro' ? 2 : 3;
    if (roeN != null) metricsUsed++;
    if (marginN != null) metricsUsed++;
    if (debtN != null) metricsUsed++;

    const qualitySubW: Record<SectorGroup, { roe: number; margin: number; debt: number }> = {
      financeiro: { roe: 0.65, margin: 0.35, debt: 0 }, utilities: { roe: 0.40, margin: 0.25, debt: 0.35 },
      commodities: { roe: 0.40, margin: 0.30, debt: 0.30 }, tecnologia: { roe: 0.45, margin: 0.35, debt: 0.20 },
      consumo: { roe: 0.45, margin: 0.30, debt: 0.25 }, base: { roe: 0.50, margin: 0.30, debt: 0.20 },
    };
    const qSub = qualitySubW[sectorGroup];
    const qParts = [{ w: qSub.roe, v: roeN }, { w: qSub.margin, v: marginN }, { w: qSub.debt, v: debtN }];
    const qW = qParts.filter(p => p.v != null && p.w > 0).reduce((s, p) => s + p.w, 0);
    const qualityNorm = qW > 0
      ? qParts.filter(p => p.v != null && p.w > 0).reduce((s, p) => s + p.w * (p.v as number), 0) / qW
      : null;

    // =========== GROWTH (v5) — winsorized, coherence-checked ===========
    const payout = f?.payout ?? null;
    const payoutClamped = payout != null ? clamp(payout, 0, 120) : null;
    if (payout != null && payout > 100) { alerts.push(`Payout acima de 100% (${payout.toFixed(0)}%)`); dataQualityPenalty += 0.05; }

    let revenueGrowth = f?.revenue_growth ?? null;
    const growthReasonable: Record<SectorGroup, number> = {
      financeiro: 15, utilities: 12, commodities: 20, tecnologia: 30, consumo: 20, base: 20,
    };
    const reasonable = growthReasonable[sectorGroup];
    let growthDataReliability = 1.0;
    if (revenueGrowth != null && Math.abs(revenueGrowth) > reasonable * 2) {
      alerts.push(`Crescimento de receita atípico (${revenueGrowth.toFixed(0)}%) — peso reduzido`);
      revenueGrowth = winsorize(Math.abs(revenueGrowth), reasonable) * Math.sign(revenueGrowth);
      growthDataReliability = 0.6;
      dataQualityPenalty += 0.05;
    }

    const sustainableGrowth = roeClamped != null && roeClamped > 0 && payoutClamped != null
      ? roeClamped * Math.max(0, 1 - clamp(payoutClamped, 0, 100) / 100) : null;

    const growthBench: Record<SectorGroup, [number, number, number]> = {
      financeiro: [-2, 6, 15], utilities: [-2, 5, 12], commodities: [-3, 6, 18],
      tecnologia: [-2, 12, 30], consumo: [-2, 8, 20], base: [-2, 8, 20],
    };
    const [gLow, gMid, gHigh] = growthBench[sectorGroup];
    const sGrowN = sustainableGrowth != null ? normSigmoid(sustainableGrowth, gLow, gMid, gHigh) : null;
    const revGrowN = revenueGrowth != null ? normSigmoid(revenueGrowth, gLow, gMid, gHigh) : null;

    metricsTotal += 2;
    let growthNorm: number | null = null;
    if (sGrowN != null && revGrowN != null) {
      const sW2 = 0.55;
      const rW2 = 0.45 * growthDataReliability;
      growthNorm = (sGrowN * sW2 + revGrowN * rW2) / (sW2 + rW2);
      metricsUsed += 2;
    } else if (revGrowN != null) {
      growthNorm = revGrowN * growthDataReliability;
      metricsUsed++;
    } else if (sGrowN != null) {
      growthNorm = Math.min(sGrowN, 0.70);
      metricsUsed++;
    }

    // Coherence: revenue >> sustainable → dampen
    if (sustainableGrowth != null && revenueGrowth != null && revenueGrowth > 0 && sustainableGrowth >= 0 && revenueGrowth > sustainableGrowth * 3) {
      growthNorm = growthNorm != null ? growthNorm * 0.80 : null;
      alerts.push('Crescimento de receita muito acima do sustentável');
    }
    // Mature high-payout: compress growth
    if (payoutClamped != null && payoutClamped > 80 && growthNorm != null && growthNorm > 0.5) {
      growthNorm = 0.4 + (growthNorm - 0.4) * 0.5;
    }
    if (growthNorm == null) alerts.push('Sem dados para pilar Crescimento');

    // =========== VALUATION (v5) — sector S-curves ===========
    const pe = f?.pe_ratio ?? null;
    const pb = f?.pb_ratio ?? null;
    const evEbitda = f?.ev != null && f?.ebitda != null && Math.abs(f.ebitda) > 1000 ? f.ev / f.ebitda : null;

    const peBench: Record<SectorGroup, [number, number, number]> = {
      financeiro: [4, 9, 18], utilities: [5, 10, 20], commodities: [4, 8, 16],
      tecnologia: [8, 18, 35], consumo: [6, 14, 25], base: [6, 12, 22],
    };
    const [peLow, peMid, peHigh] = peBench[sectorGroup];
    let peN: number | null = null;
    if (pe != null && pe > 0 && pe < 200) {
      peN = normSigmoid(pe, peLow, peMid, peHigh, true);
      if (pe < 3) { peN = (peN ?? 0) * 0.5; dataQualityPenalty += 0.03; }
      if (pe > 60) { peN = (peN ?? 0) * 0.3; alerts.push(`P/L muito alto (${pe.toFixed(1)})`); }
    }

    const pbBench: Record<SectorGroup, [number, number, number]> = {
      financeiro: [0.5, 1.3, 2.5], utilities: [0.5, 1.5, 3.0], commodities: [0.4, 1.2, 2.5],
      tecnologia: [1.0, 3.0, 7.0], consumo: [0.8, 2.5, 5.0], base: [0.6, 2.0, 4.5],
    };
    const [pbLow, pbMid, pbHigh] = pbBench[sectorGroup];
    const pbN = pb != null && pb > 0 ? normSigmoid(clamp(pb, 0.1, 15), pbLow, pbMid, pbHigh, true) : null;

    const evBench: Record<SectorGroup, [number, number, number]> = {
      financeiro: [0, 0, 0], utilities: [4, 8, 14], commodities: [3, 6, 12],
      tecnologia: [6, 12, 22], consumo: [4, 9, 16], base: [4, 9, 16],
    };
    const [evLow, evMid, evHigh] = evBench[sectorGroup];
    const evN = sectorGroup === 'financeiro' ? null
      : (evEbitda != null && evEbitda > 0 ? normSigmoid(clamp(evEbitda, 1, 40), evLow, evMid, evHigh, true) : null);

    const valSubW: Record<SectorGroup, { pe: number; pb: number; ev: number }> = {
      financeiro: { pe: 0.30, pb: 0.70, ev: 0 }, utilities: { pe: 0.30, pb: 0.25, ev: 0.45 },
      commodities: { pe: 0.20, pb: 0.25, ev: 0.55 }, tecnologia: { pe: 0.45, pb: 0.20, ev: 0.35 },
      consumo: { pe: 0.40, pb: 0.25, ev: 0.35 }, base: { pe: 0.35, pb: 0.25, ev: 0.40 },
    };
    const vSub = valSubW[sectorGroup];
    metricsTotal += sectorGroup === 'financeiro' ? 2 : 3;
    if (peN != null) metricsUsed++;
    if (pbN != null) metricsUsed++;
    if (evN != null) metricsUsed++;

    const vParts = [{ w: vSub.pe, v: peN }, { w: vSub.pb, v: pbN }, { w: vSub.ev, v: evN }].filter(p => p.w > 0);
    const vW = vParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const valuationNorm = vW > 0
      ? vParts.filter(p => p.v != null).reduce((s, p) => s + p.w * (p.v as number), 0) / vW
      : null;
    if (valuationNorm == null) alerts.push('Sem dados suficientes para Valuation');

    // =========== RISK (v5) — multi-dimensional with stability ===========
    const changePercent = stock.change_percent ?? null;
    const volAbs = changePercent != null ? Math.abs(changePercent) : null;
    const concN = normSigmoid(pctPortfolio, 3, 10, 25, true) ?? 0.5;
    const volN = volAbs != null ? normSigmoid(volAbs, 0, 3, 8, true) : null;

    const sectorStabilityBonus: Record<SectorGroup, number> = {
      utilities: 0.10, consumo: 0.08, financeiro: 0.05, base: 0, tecnologia: -0.05, commodities: -0.05,
    };
    const stabilityAdj = sectorStabilityBonus[sectorGroup];
    const debtRiskN = sectorGroup === 'financeiro' ? null : debtN;
    const predictabilityN = (roeN != null && marginN != null) ? clamp01((roeN + marginN) / 2 * 0.8 + 0.1) : null;

    const riskSubW: Record<SectorGroup, { vol: number; conc: number; debt: number; pred: number }> = {
      financeiro: { vol: 0.25, conc: 0.35, debt: 0, pred: 0.40 }, utilities: { vol: 0.15, conc: 0.30, debt: 0.30, pred: 0.25 },
      commodities: { vol: 0.25, conc: 0.30, debt: 0.25, pred: 0.20 }, tecnologia: { vol: 0.30, conc: 0.30, debt: 0.20, pred: 0.20 },
      consumo: { vol: 0.20, conc: 0.30, debt: 0.25, pred: 0.25 }, base: { vol: 0.25, conc: 0.30, debt: 0.25, pred: 0.20 },
    };
    const rSub = riskSubW[sectorGroup];
    metricsTotal += 2;
    if (volN != null) metricsUsed++;
    metricsUsed++;
    if (debtRiskN != null) metricsUsed++;
    if (predictabilityN != null) metricsUsed++;

    const rParts = [{ w: rSub.vol, v: volN }, { w: rSub.conc, v: concN }, { w: rSub.debt, v: debtRiskN }, { w: rSub.pred, v: predictabilityN }].filter(p => p.w > 0);
    const rW = rParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    let riskNorm = rW > 0
      ? rParts.filter(p => p.v != null).reduce((s, p) => s + p.w * (p.v as number), 0) / rW
      : null;
    if (riskNorm != null) riskNorm = clamp01(riskNorm + stabilityAdj);
    if (pctPortfolio > 15) alerts.push(`Concentração elevada: ${pctPortfolio.toFixed(1)}% da carteira`);

    // =========== DIVIDENDS (v5) ===========
    const dy = stock.effective_dy ?? null;
    const dyN = dy != null ? normSigmoid(dy, 0, 5, 12) : null;
    const payoutBandVal = scoreBand(payoutClamped, 25, 75, 10, 90);
    metricsTotal += 2;
    if (dyN != null) metricsUsed++;
    if (payoutBandVal != null) metricsUsed++;

    const dParts = [{ w: 0.65, v: dyN }, { w: 0.35, v: payoutBandVal }];
    const dW = dParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const dividendsNorm = dW > 0
      ? dParts.filter(p => p.v != null).reduce((s, p) => s + p.w * (p.v as number), 0) / dW
      : null;
    if (dividendsNorm == null) alerts.push('Sem dados de Dividendos (DY)');

    // Sanity checks
    if (sectorGroup === 'tecnologia' && dividendsNorm != null && dividendsNorm > 0.7) alerts.push('DY alto para setor de crescimento');
    if (growthNorm != null && growthNorm > 0.7 && payoutClamped != null && payoutClamped > 85) alerts.push('Crescimento alto com payout elevado');

    // =========== COMPUTE TOTALS ===========
    const norms: Record<PillarKey, number | null> = { quality: qualityNorm, growth: growthNorm, valuation: valuationNorm, risk: riskNorm, dividends: dividendsNorm };
    const baseResult = computeWeightedTotal(norms, BASE_WEIGHTS);
    const adjResult = computeWeightedTotal(norms, sectorW);
    let totalBase = baseResult.total;
    let totalAdjusted = adjResult.total;

    const coverage = metricsTotal > 0 ? metricsUsed / metricsTotal : 0;
    const confidence = clamp01(coverage - dataQualityPenalty);

    if (coverage < 0.4) {
      const penalty = 0.55 + coverage * 0.5;
      totalBase *= penalty;
      totalAdjusted *= penalty;
      alerts.push(`Cobertura baixa (${Math.round(coverage * 100)}%) — score reduzido`);
    } else if (coverage < 0.6) {
      const penalty = 0.80 + 0.20 * (coverage - 0.4) / 0.2;
      totalBase *= penalty;
      totalAdjusted *= penalty;
    }

    if (f?.lpa != null && f.lpa < 0) { totalBase *= 0.70; totalAdjusted *= 0.70; alerts.push('LPA negativo — score penalizado'); }
    if (margin != null && margin < 0) { totalBase *= 0.80; totalAdjusted *= 0.80; alerts.push('Margem negativa — score penalizado'); }
    if (qualityNorm != null && qualityNorm < 0.15) { totalBase = Math.min(totalBase, 55); totalAdjusted = Math.min(totalAdjusted, 55); }

    totalBase = compressScore(totalBase);
    totalAdjusted = compressScore(totalAdjusted);

    if (import.meta.env.DEV) {
      console.log(
        `[SCORE v5] ${stock.ticker} (${sectorGroup}):\n` +
        `  Quality: ROE=${roe?.toFixed(1) ?? 'n/a'}→${roeN?.toFixed(2) ?? 'n/a'}, Margin=${margin?.toFixed(1) ?? 'n/a'}→${marginN?.toFixed(2) ?? 'n/a'}, D/E=${debtEbitda?.toFixed(1) ?? 'n/a'}→${debtN?.toFixed(2) ?? 'n/a'} ⇒ ${qualityNorm?.toFixed(3) ?? 'null'}\n` +
        `  Growth: RevGr=${f?.revenue_growth?.toFixed(1) ?? 'n/a'}(win=${revenueGrowth?.toFixed(1) ?? 'n/a'})→${revGrowN?.toFixed(2) ?? 'n/a'}, SustGr=${sustainableGrowth?.toFixed(1) ?? 'n/a'}→${sGrowN?.toFixed(2) ?? 'n/a'} ⇒ ${growthNorm?.toFixed(3) ?? 'null'}\n` +
        `  Valuation: P/L=${pe?.toFixed(1) ?? 'n/a'}→${peN?.toFixed(2) ?? 'n/a'}, P/VP=${pb?.toFixed(1) ?? 'n/a'}→${pbN?.toFixed(2) ?? 'n/a'}, EV/E=${evEbitda?.toFixed(1) ?? 'n/a'}→${evN?.toFixed(2) ?? 'n/a'} ⇒ ${valuationNorm?.toFixed(3) ?? 'null'}\n` +
        `  Risk: vol=${volAbs?.toFixed(1) ?? 'n/a'}, conc=${pctPortfolio.toFixed(1)}%, stab=${stabilityAdj} ⇒ ${riskNorm?.toFixed(3) ?? 'null'}\n` +
        `  Div: DY=${dy?.toFixed(1) ?? 'n/a'}, payout=${payout?.toFixed(0) ?? 'n/a'} ⇒ ${dividendsNorm?.toFixed(3) ?? 'null'}\n` +
        `  TOTAL: base=${totalBase.toFixed(1)}, adj=${totalAdjusted.toFixed(1)}, cov=${(coverage*100).toFixed(0)}%, conf=${(confidence*100).toFixed(0)}%`
      );
    }

    map.set(stock.id, {
      qualityNorm, growthNorm, valuationNorm, riskNorm, dividendsNorm,
      totalBase: Math.round(totalBase * 10) / 10,
      totalAdjusted: Math.round(totalAdjusted * 10) / 10,
      sectorGroup, sectorLabel,
      baseWeights: BASE_WEIGHTS, adjustedWeights: sectorW,
      effectiveBaseWeights: baseResult.effWeights, effectiveAdjustedWeights: adjResult.effWeights,
      coverage, confidence, alerts,
    });
  }

  return map;
}

function scoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-500';
  if (score >= 60) return 'text-blue-500';
  if (score >= 45) return 'text-yellow-500';
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
        case 'quality': va = a.score.qualityNorm ?? -1; vb = b.score.qualityNorm ?? -1; break;
        case 'growth': va = a.score.growthNorm ?? -1; vb = b.score.growthNorm ?? -1; break;
        case 'valuation': va = a.score.valuationNorm ?? -1; vb = b.score.valuationNorm ?? -1; break;
        case 'risk': va = a.score.riskNorm ?? -1; vb = b.score.riskNorm ?? -1; break;
        case 'dividends': va = a.score.dividendsNorm ?? -1; vb = b.score.dividendsNorm ?? -1; break;
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
        { pillar: 'Qualidade', value: (selectedScore.qualityNorm ?? 0) * 100, fullMark: 100 },
        { pillar: 'Crescimento', value: (selectedScore.growthNorm ?? 0) * 100, fullMark: 100 },
        { pillar: 'Valuation', value: (selectedScore.valuationNorm ?? 0) * 100, fullMark: 100 },
        { pillar: 'Risco', value: (selectedScore.riskNorm ?? 0) * 100, fullMark: 100 },
        { pillar: 'Dividendos', value: (selectedScore.dividendsNorm ?? 0) * 100, fullMark: 100 },
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
      score_quality: (r.score.qualityNorm ?? 0) * 25,
      score_growth: (r.score.growthNorm ?? 0) * 20,
      score_valuation: (r.score.valuationNorm ?? 0) * 25,
      score_risk: (r.score.riskNorm ?? 0) * 15,
      score_dividends: (r.score.dividendsNorm ?? 0) * 15,
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

  // Helper to format norm as percentage
  const fmtNorm = (n: number | null) => n == null ? 'N/D' : `${(n * 100).toFixed(0)}%`;

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
    <motion.div className="space-y-6" initial="hidden" animate="visible" variants={stagger}>
      <motion.div variants={fadeUp} custom={0} className="flex items-center justify-between">
        <div>
          <p className="kpi-label mb-1">Análise Quantitativa</p>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            Score Interno
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Cobertura: {selectedScore ? Math.round(selectedScore.coverage * 100) : 0}% • Confiança: {selectedScore ? Math.round(selectedScore.confidence * 100) : 0}%
          </p>
        </div>
        <Button
          variant="outline" size="sm" className="gap-2"
          onClick={handleSaveSnapshot}
          disabled={saveSnapshot.isPending || ranking.length === 0}
        >
          <Save className="h-4 w-4" /> Salvar Snapshot
        </Button>
      </motion.div>

      {stocks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma ação encontrada na carteira.
          </CardContent>
        </Card>
      ) : (
        <>
          <motion.div variants={fadeUp} custom={1} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                <CardTitle className="text-base">Score Total — {selectedTicker}</CardTitle>
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

                    {/* Weights applied — show both base and adjusted */}
                    <div className="mt-4 p-3 rounded-lg bg-muted/30 border border-border/50">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase mb-2">
                        Pesos: Base → Ajustado ({selectedScore.sectorGroup !== 'base' ? selectedScore.sectorLabel.split(' / ')[0] : 'Padrão'})
                      </p>
                      <div className="grid grid-cols-5 gap-1 text-center text-[10px]">
                        {PILLAR_KEYS.map(k => {
                          const bw = selectedScore.effectiveBaseWeights[k];
                          const aw = selectedScore.effectiveAdjustedWeights[k];
                          const diff = aw - bw;
                          return (
                            <div key={k}>
                              <div className="text-muted-foreground capitalize">
                                {k === 'quality' ? 'Qual' : k === 'growth' ? 'Cresc' : k === 'valuation' ? 'Val' : k === 'risk' ? 'Risco' : 'Div'}
                              </div>
                              <div className="font-mono font-bold">{bw.toFixed(0)} → {aw.toFixed(0)}</div>
                              {Math.abs(diff) >= 0.5 && (
                                <div className={`font-mono text-[9px] ${diff > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                  {diff > 0 ? '+' : ''}{diff.toFixed(0)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Pillar bars — show norms as % */}
                    <div className="space-y-2 mt-4">
                      {([
                        ['Qualidade', selectedScore.qualityNorm],
                        ['Crescimento', selectedScore.growthNorm],
                        ['Valuation', selectedScore.valuationNorm],
                        ['Risco', selectedScore.riskNorm],
                        ['Dividendos', selectedScore.dividendsNorm],
                      ] as [string, number | null][]).map(([label, norm]) => (
                        <div key={label} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-24">{label}</span>
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${norm == null ? 0 : norm * 100}%` }} />
                          </div>
                          <span className="text-xs font-mono w-12 text-right">{fmtNorm(norm)}</span>
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
          </motion.div>

          {/* History */}
          {historyChart.length > 1 && (
            <motion.div variants={fadeUp} custom={2}><Card>
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
            </Card></motion.div>
          )}

          {/* Ranking */}
          <motion.div variants={fadeUp} custom={3}><Card>
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
                        <TableCell className="text-center font-mono text-xs">{fmtNorm(r.score.qualityNorm)}</TableCell>
                        <TableCell className="text-center font-mono text-xs">{fmtNorm(r.score.growthNorm)}</TableCell>
                        <TableCell className="text-center font-mono text-xs">{fmtNorm(r.score.valuationNorm)}</TableCell>
                        <TableCell className="text-center font-mono text-xs">{fmtNorm(r.score.riskNorm)}</TableCell>
                        <TableCell className="text-center font-mono text-xs">{fmtNorm(r.score.dividendsNorm)}</TableCell>
                        <TableCell className="text-center">{scoreBadgeEl(r.score.totalAdjusted)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card></motion.div>

          {/* Alerts */}
          {allAlerts.length > 0 && (
            <motion.div variants={fadeUp} custom={4}><Card>
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
            </Card></motion.div>
          )}
        </>
      )}
    </motion.div>
  );
};

export default Score;
