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
  financeiro:  { quality: 30, growth: 15, valuation: 20, risk: 15, dividends: 20 },
  utilities:   { quality: 30, growth: 10, valuation: 20, risk: 25, dividends: 15 },
  tecnologia:  { quality: 20, growth: 35, valuation: 25, risk: 10, dividends: 10 },
  commodities: { quality: 20, growth: 15, valuation: 35, risk: 20, dividends: 10 },
  consumo:     { quality: 30, growth: 20, valuation: 20, risk: 15, dividends: 15 },
};

const BASE_WEIGHTS = SECTOR_WEIGHTS.base;

function removeAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function detectSectorGroup(sector: string | null, industry: string | null): SectorGroup {
  if (!sector && !industry) return 'base';
  const text = removeAccents(`${sector ?? ''} ${industry ?? ''}`.toLowerCase());

  // Financeiro
  if (/bank|banco|financ|seguro|insurance|asset management|capital market/i.test(text)) return 'financeiro';
  // Utilities
  if (/utilit|energy|energia|electric|eletric|saneamento|water|gas natural|power/i.test(text)) return 'utilities';
  // Tecnologia
  if (/tech|software|internet|semiconduc|cloud|saas|digital|information/i.test(text)) return 'tecnologia';
  // Commodities
  if (/commod|oil|gas|petrol|petroleo|mining|mineracao|steel|siderurg|papel|celulose|basic material|agri/i.test(text)) return 'commodities';
  // Consumo defensivo
  if (/consumer defensive|consumo|food|beverage|bebida|retail|varejo|farmac|pharma|health|saude/i.test(text)) return 'consumo';

  return 'base';
}

// ============================================================
// SCORING ENGINE v2 — REALISTIC & SECTOR-AWARE
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

function normBetween(value: number | null | undefined, min: number, max: number, inverse = false): number | null {
  if (value == null || !Number.isFinite(value) || max === min) return null;
  const raw = inverse ? (max - value) / (max - min) : (value - min) / (max - min);
  return clamp01(raw);
}

function scoreBand(
  value: number | null | undefined,
  goodMin: number, goodMax: number,
  okMin: number, okMax: number
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= goodMin && value <= goodMax) return 1;
  if (value >= okMin && value <= okMax) return 0.7;
  return 0.3;
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

function computeScores(stocks: PortfolioAsset[], totalPortfolio: number): Map<string, PillarScore> {
  const map = new Map<string, PillarScore>();
  if (stocks.length === 0) return map;

  for (const stock of stocks) {
    const f = stock.fundamentals;
    const alerts: string[] = [];
    const sectorGroup = detectSectorGroup(stock.sector, stock.industry);
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

    // ROE: clamp at 60% to avoid outlier inflation
    const roeClamped = roe != null ? clamp(roe, -10, 60) : null;
    if (roe != null && roe > 60) { alerts.push(`ROE outlier (${roe.toFixed(0)}%) — limitado a 60% no score`); outlierCount++; }
    if (roe != null && roe < 5) alerts.push('ROE baixo (<5%) — qualidade pressionada');

    const roeN = normBetween(roeClamped, 0, 25);
    // Margin: commodities get lower weight internally
    const marginW = sectorGroup === 'commodities' ? 0.15 : 0.35;
    const marginN = normBetween(margin, 0, 30);
    const debtN = normBetween(debtEbitda, 0, 4, true);

    if (debtEbitda != null && debtEbitda > 4) alerts.push('Dívida/EBITDA alto (>4) — atenção ao risco financeiro');
    if (f?.ebitda != null && Math.abs(f.ebitda) <= 1000) alerts.push('EBITDA muito pequeno — Dívida/EBITDA ignorado');

    metricsTotal += 3;
    if (roeN != null) metricsUsed++;
    if (marginN != null) metricsUsed++;
    if (debtN != null) metricsUsed++;

    const qParts = [
      { w: 0.45, v: roeN },
      { w: marginW, v: marginN },
      { w: 0.20, v: debtN },
    ];
    const qW = qParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const qualityNorm = qW > 0
      ? qParts.filter(p => p.v != null).reduce((s, p) => s + p.w * (p.v as number), 0) / qW
      : null;
    const qualityScore = qualityNorm != null ? qualityNorm * BASE_WEIGHTS.quality : null;

    // =========== GROWTH ===========
    const payout = f?.payout ?? null;
    const payoutClamped = payout != null ? clamp(payout, 0, 100) : null;
    if (payout != null && payout > 100) { alerts.push(`Payout outlier (${payout.toFixed(0)}%) — distribuindo mais do que lucra`); outlierCount++; }
    if (payout != null && payout > 90) alerts.push('Payout > 90% — dividendo pode ser pouco sustentável');

    const revenueGrowth = f?.revenue_growth ?? null;
    const sustainableGrowth = roeClamped != null && payoutClamped != null
      ? roeClamped * (1 - payoutClamped / 100) : null;

    // For banks, use more conservative benchmark
    const growthBenchMax = sectorGroup === 'financeiro' ? 15 : 20;
    const sGrowN = normBetween(sustainableGrowth, 0, growthBenchMax);
    const revGrowN = normBetween(revenueGrowth, -10, growthBenchMax);

    metricsTotal += 2;
    if (sGrowN != null) metricsUsed++;
    if (revGrowN != null) metricsUsed++;

    const gParts = [
      { w: 0.60, v: sGrowN },
      { w: 0.40, v: revGrowN },
    ];
    const gW = gParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const growthNorm = gW > 0
      ? gParts.filter(p => p.v != null).reduce((s, p) => s + p.w * (p.v as number), 0) / gW
      : null;
    const growthScore = growthNorm != null ? growthNorm * BASE_WEIGHTS.growth : null;
    if (growthScore == null) alerts.push('Sem dados suficientes para Crescimento');

    // Check unsustainable growth
    if (sustainableGrowth != null && roeClamped != null) {
      const sustainableLimit = roeClamped * (1 - (payoutClamped ?? 0) / 100) + 5;
      if (revenueGrowth != null && revenueGrowth > sustainableLimit) {
        alerts.push(`Crescimento pode ser insustentável (revenue ${revenueGrowth.toFixed(1)}% > ROE sustentável + 5%)`);
      }
    }

    // =========== VALUATION ===========
    const pe = f?.pe_ratio ?? null;
    const pb = f?.pb_ratio ?? null;
    const evEbitda = f?.ev != null && f?.ebitda != null && Math.abs(f.ebitda) > 1000
      ? f.ev / f.ebitda : null;

    // Outlier detection
    if (pe != null && (pe < 3 || pe > 60)) {
      alerts.push(`P/L fora do padrão (${pe.toFixed(1)}) — peso reduzido no cálculo`);
      outlierCount++;
    }

    const peN = pe != null && pe > 0 ? normBetween(clamp(pe, 3, 60), 5, 25, true) : null;
    const pbN = pb != null && pb > 0 ? normBetween(pb, 0.8, 3, true) : null;
    const evN = evEbitda != null && evEbitda > 0 ? normBetween(evEbitda, 4, 12, true) : null;

    // Sector-specific sub-weights for valuation internals
    let peW = 0.45, pbW = 0.25, evW = 0.30;
    if (sectorGroup === 'financeiro') { peW = 0.30; pbW = 0.50; evW = 0.20; }
    if (sectorGroup === 'commodities') { peW = 0.25; pbW = 0.25; evW = 0.50; }

    // Reduce P/L weight if outlier
    if (pe != null && (pe < 3 || pe > 60)) peW *= 0.5;

    metricsTotal += 3;
    if (peN != null) metricsUsed++;
    if (pbN != null) metricsUsed++;
    if (evN != null) metricsUsed++;

    const vParts = [
      { w: peW, v: peN },
      { w: pbW, v: pbN },
      { w: evW, v: evN },
    ];
    const vW = vParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const valuationNorm = vW > 0
      ? vParts.filter(p => p.v != null).reduce((s, p) => s + p.w * (p.v as number), 0) / vW
      : null;
    const valuationScore = valuationNorm != null ? valuationNorm * BASE_WEIGHTS.valuation : null;
    if (valuationScore == null) alerts.push('Sem dados suficientes para Valuation');

    // =========== RISK ===========
    const changePercent = stock.change_percent ?? null;
    const volAbs = changePercent != null ? Math.abs(changePercent) : null;

    // Progressive concentration penalty
    const concN = pctPortfolio <= 5 ? 1.0
      : pctPortfolio <= 10 ? 0.85
      : pctPortfolio <= 15 ? 0.65
      : pctPortfolio <= 25 ? 0.35
      : 0.1;

    const volN = normBetween(volAbs, 0, 8, true);
    // Debt/EBITDA has higher weight for utilities
    const debtRiskW = sectorGroup === 'utilities' ? 0.40 : 0.25;
    const volW2 = sectorGroup === 'utilities' ? 0.20 : 0.35;

    metricsTotal += 3;
    if (volN != null) metricsUsed++;
    metricsUsed++; // concentration always available
    if (debtN != null) metricsUsed++;

    const rParts = [
      { w: volW2, v: volN },
      { w: 0.35, v: concN },
      { w: debtRiskW, v: debtN },
    ];
    const rW = rParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const riskNorm = rW > 0
      ? rParts.filter(p => p.v != null).reduce((s, p) => s + p.w * (p.v as number), 0) / rW
      : null;
    const riskScore = riskNorm != null ? riskNorm * BASE_WEIGHTS.risk : null;

    if (pctPortfolio > 15) alerts.push(`Concentração elevada: ${pctPortfolio.toFixed(1)}% da carteira`);
    if (pctPortfolio > 10) alerts.push(`Atenção concentração: ${pctPortfolio.toFixed(1)}% da carteira`);

    // =========== DIVIDENDS ===========
    const dy = stock.effective_dy ?? null;
    const dyN = normBetween(dy, 0, 12);
    const payoutBandVal = scoreBand(payoutClamped, 30, 70, 20, 80);

    metricsTotal += 2;
    if (dyN != null) metricsUsed++;
    if (payoutBandVal != null) metricsUsed++;

    const dParts = [
      { w: 0.60, v: dyN },
      { w: 0.40, v: payoutBandVal },
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
    if (sectorGroup === 'tecnologia' && dividendsScore != null && dividendsScore > BASE_WEIGHTS.dividends * 0.7) {
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

    // Low coverage penalty
    if (coverage < 0.6) {
      const penalty = 0.85 + 0.15 * coverage;
      totalBase *= penalty;
      totalAdjusted *= penalty;
      alerts.push(`Baixa cobertura (${Math.round(coverage * 100)}%) → score penalizado`);
    }

    // ROE < 5% or low quality caps
    if (roeClamped != null && roeClamped < 5) {
      totalBase = Math.min(totalBase, 70);
      totalAdjusted = Math.min(totalAdjusted, 70);
    }
    if (qualityNorm != null && qualityNorm < 0.3) {
      totalBase = Math.min(totalBase, 70);
      totalAdjusted = Math.min(totalAdjusted, 70);
    }

    // Negative earnings penalty
    if (f?.lpa != null && f.lpa < 0) {
      totalBase *= 0.75;
      totalAdjusted *= 0.75;
      alerts.push('Lucro por ação negativo — score penalizado');
    }

    // Negative margin of safety
    if (margin != null && margin < 0) {
      totalBase *= 0.85;
      totalAdjusted *= 0.85;
      alerts.push('Margem negativa — score penalizado');
    }

    // Debug in dev
    if (import.meta.env.DEV) {
      console.log(`[SCORE] ${stock.ticker}: sector=${sectorGroup}, coverage=${(coverage*100).toFixed(0)}%, ` +
        `base=${totalBase.toFixed(1)}, adj=${totalAdjusted.toFixed(1)}, ` +
        `DY=${stock.effective_dy}, ROE=${roe}, payout=${payout}`);
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
  if (score >= 85) return 'text-emerald-500';
  if (score >= 70) return 'text-blue-500';
  if (score >= 55) return 'text-yellow-500';
  return 'text-red-500';
}

function scoreBadgeEl(score: number) {
  if (score >= 85) return <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30">Excelente</Badge>;
  if (score >= 70) return <Badge className="bg-blue-500/15 text-blue-500 border-blue-500/30">Muito bom</Badge>;
  if (score >= 55) return <Badge className="bg-yellow-500/15 text-yellow-500 border-yellow-500/30">Bom</Badge>;
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
                            {r.score.sectorGroup !== 'base' ? r.score.sectorLabel.split(' / ')[0] : '—'}
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
