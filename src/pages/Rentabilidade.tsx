import { useState, useMemo, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
  ResponsiveContainer, Legend,
} from 'recharts';
import {
  TrendingUp, ChevronDown, Check, RotateCcw, Layers, Flame, BarChart3,
  ArrowUpRight, ArrowDownRight, Activity, PlayCircle, Info, RefreshCw,
} from 'lucide-react';
import { usePortfolio, PortfolioAsset } from '@/hooks/usePortfolio';
import { useTransactions, Transaction } from '@/hooks/useTransactions';
import { useBenchmarkHistory, BenchmarkPoint } from '@/hooks/useBenchmarkHistory';

// ─── Series definitions ─────────────────────────────────────
type SeriesKey = 'carteira' | 'cdi' | 'ipca' | 'ifix' | 'ibov';

interface SeriesDef { key: SeriesKey; label: string; color: string }

const ALL_SERIES: SeriesDef[] = [
  { key: 'carteira', label: 'Carteira', color: 'hsl(43, 85%, 55%)' },
  { key: 'cdi',      label: 'CDI',      color: 'hsl(200, 80%, 55%)' },
  { key: 'ipca',     label: 'IPCA',     color: 'hsl(30, 90%, 55%)' },
  { key: 'ifix',     label: 'IFIX',     color: 'hsl(142, 70%, 45%)' },
  { key: 'ibov',     label: 'IBOV',     color: 'hsl(280, 70%, 60%)' },
];

const DEFAULT_VISIBLE: SeriesKey[] = ['carteira', 'cdi'];

const PRESETS: { label: string; icon: React.ReactNode; keys: SeriesKey[] }[] = [
  { label: 'Inflação', icon: <Flame className="h-3 w-3" />, keys: ['carteira', 'cdi', 'ipca'] },
  { label: 'Renda Variável BR', icon: <BarChart3 className="h-3 w-3" />, keys: ['carteira', 'ibov', 'ifix'] },
  { label: 'Dividendos', icon: <TrendingUp className="h-3 w-3" />, keys: ['carteira', 'ifix'] },
];

type PeriodKey = 'mtd' | '6m' | '12m' | '24m' | '60m' | 'all';
const PERIODS: { key: PeriodKey; label: string; months: number }[] = [
  { key: 'mtd', label: 'Mês atual', months: -1 },
  { key: '6m', label: '6 meses', months: 6 },
  { key: '12m', label: '12 meses', months: 12 },
  { key: '24m', label: '2 anos', months: 24 },
  { key: '60m', label: '5 anos', months: 60 },
  { key: 'all', label: 'Desde o início', months: 0 },
];

type Mode = 'real' | 'simulacao';

const LS_KEY = 'fortuna:rentabilidade:series';
const LS_MODE_KEY = 'fortuna:rentabilidade:mode';

function loadSavedSeries(): SeriesKey[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { const p = JSON.parse(raw) as SeriesKey[]; if (Array.isArray(p) && p.length > 0) return p; }
  } catch { /* ignore */ }
  return DEFAULT_VISIBLE;
}
function saveSeries(keys: SeriesKey[]) { localStorage.setItem(LS_KEY, JSON.stringify(keys)); }
function loadMode(): Mode {
  try { const v = localStorage.getItem(LS_MODE_KEY); if (v === 'real' || v === 'simulacao') return v; } catch {}
  return 'real';
}
function saveMode(m: Mode) { localStorage.setItem(LS_MODE_KEY, m); }

// ─── Benchmark code mapping ─────────────────────────────────
const SERIES_TO_BENCHMARK: Partial<Record<SeriesKey, string>> = {
  cdi: 'CDI',
  ipca: 'IPCA',
  ibov: 'IBOV',
  ifix: 'IFIX',
};
const BENCHMARK_TO_SERIES: Record<string, SeriesKey> = {
  CDI: 'cdi',
  IPCA: 'ipca',
  IBOV: 'ibov',
  IFIX: 'ifix',
};

// ─── Date helpers ───────────────────────────────────────────
function toDateStr(d: Date): string { return d.toISOString().slice(0, 10); }

function getPeriodStartDate(period: PeriodKey, transactions: Transaction[]): Date {
  const now = new Date();
  if (period === 'mtd') return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === 'all' && transactions.length > 0) return new Date(transactions[0].date);
  const monthsMap: Record<string, number> = { '6m': 6, '12m': 12, '24m': 24, '60m': 60 };
  const m = monthsMap[period] ?? 12;
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return d;
}

function getPeriodMonths(period: PeriodKey, transactions: Transaction[]): number {
  if (period === 'mtd') return 1;
  if (period === 'all' && transactions.length > 0) {
    const first = new Date(transactions[0].date);
    const now = new Date();
    return Math.max(1, (now.getFullYear() - first.getFullYear()) * 12 + (now.getMonth() - first.getMonth()) + 1);
  }
  const monthsMap: Record<string, number> = { '6m': 6, '12m': 12, '24m': 24, '60m': 60 };
  return monthsMap[period] ?? 12;
}

// ─── Build daily timeline ───────────────────────────────────
function buildDailyTimeline(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endNorm = new Date(end);
  endNorm.setHours(0, 0, 0, 0);
  while (cur <= endNorm) {
    dates.push(toDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// ─── Normalize benchmarks to daily % return from base ───────
function normalizeBenchmarkDaily(
  benchmarkData: BenchmarkPoint[],
  periodStartStr: string,
): Record<string, Record<string, number>> {
  // Group by code
  const grouped: Record<string, BenchmarkPoint[]> = {};
  for (const p of benchmarkData) {
    if (!grouped[p.benchmark_code]) grouped[p.benchmark_code] = [];
    grouped[p.benchmark_code].push(p);
  }

  const result: Record<string, Record<string, number>> = {};

  for (const [code, points] of Object.entries(grouped)) {
    // Find base: last point on or before periodStart
    let baseValue: number | null = null;
    for (const p of points) {
      if (p.date <= periodStartStr) baseValue = p.value;
      else break;
    }
    if (baseValue === null && points.length > 0) baseValue = points[0].value;
    if (!baseValue || baseValue === 0) {
      if (import.meta.env.DEV) console.warn(`[Benchmark ${code}] No base value found, skipping`);
      continue;
    }

    const daily: Record<string, number> = {};
    let lastPct = 0;
    for (const p of points) {
      if (p.date < periodStartStr) continue;
      const pct = ((p.value / baseValue) - 1) * 100;
      daily[p.date] = pct;
      lastPct = pct;
    }

    result[code] = daily;

    if (import.meta.env.DEV) {
      const keys = Object.keys(daily);
      console.log(`[Benchmark ${code}] base=${baseValue.toFixed(2)}, points=${keys.length}, first=${daily[keys[0]]?.toFixed(4) ?? 'N/A'}%, last=${lastPct.toFixed(4)}%`);
    }
  }

  return result;
}

// ─── Simulation mode: weighted return by current composition ─
function computeSimulationReturn(
  portfolio: PortfolioAsset[],
  transactions: Transaction[],
  periodStartStr: string,
  periodEndStr: string,
  benchmarkRawData: BenchmarkPoint[],
): number | null {
  const activeAssets = portfolio.filter(a => a.quantity > 0 && a.last_price != null);
  const totalValue = activeAssets.reduce((sum, a) => sum + a.quantity * (a.last_price ?? a.avg_price), 0);
  if (totalValue <= 0) return null;

  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  if (import.meta.env.DEV) {
    console.group('[Simulação Carteira] Cálculo detalhado');
    console.log('periodStart:', periodStartStr);
    console.log('periodEnd:', periodEndStr);
    console.log('assetsCount:', activeAssets.length);
    console.log('totalPortfolioValue:', totalValue.toFixed(2));
  }

  let portfolioReturn = 0;
  let totalWeight = 0;
  const assetDetails: { ticker: string; weight: number; startPrice: number; startDateUsed: string; endPrice: number; endDateUsed: string; returnPct: number; contributionPct: number; startSource: string }[] = [];

  for (const asset of activeAssets) {
    const weight = (asset.quantity * (asset.last_price ?? asset.avg_price)) / totalValue;
    totalWeight += weight;
    const currentPrice = asset.last_price!;

    // Find start price: best available price near period start
    // Priority: last transaction price on or before periodStart, then first transaction after
    let startPrice: number | null = null;
    let startDateUsed = periodStartStr;
    let startSource = '';

    // Look through transactions for this asset
    const assetTxs = sorted.filter(t => t.asset_id === asset.id);

    // Last transaction on or before period start
    for (const t of assetTxs) {
      if (t.date <= periodStartStr) {
        startPrice = t.price;
        startDateUsed = t.date;
        startSource = 'tx_before';
      } else break;
    }

    // If no transaction before, use first transaction after period start
    if (startPrice === null) {
      const firstAfter = assetTxs.find(t => t.date > periodStartStr);
      if (firstAfter) {
        startPrice = firstAfter.price;
        startDateUsed = firstAfter.date;
        startSource = 'tx_after';
      }
    }

    // Fallback to avg_price
    if (!startPrice || startPrice <= 0) {
      startPrice = asset.avg_price;
      startDateUsed = 'avg_price';
      startSource = 'avg_price';
    }

    if (startPrice <= 0) continue;

    const ret = (currentPrice / startPrice) - 1;
    const contribution = weight * ret;
    portfolioReturn += contribution;

    assetDetails.push({
      ticker: asset.ticker,
      weight: weight * 100,
      startPrice,
      startDateUsed,
      endPrice: currentPrice,
      endDateUsed: periodEndStr,
      returnPct: ret * 100,
      contributionPct: contribution * 100,
      startSource,
    });
  }

  if (import.meta.env.DEV) {
    console.log('totalWeight:', (totalWeight * 100).toFixed(2) + '%');
    console.table(assetDetails.map(a => ({
      ticker: a.ticker,
      'peso%': a.weight.toFixed(2),
      'preçoInício': a.startPrice.toFixed(2),
      'dataInício': a.startDateUsed,
      'fonte': a.startSource,
      'preçoFim': a.endPrice.toFixed(2),
      'retorno%': a.returnPct.toFixed(2),
      'contribuição%': a.contributionPct.toFixed(2),
    })));
    console.log(`Retorno simulado final: ${(portfolioReturn * 100).toFixed(4)}%`);
    console.groupEnd();
  }

  return portfolioReturn * 100;
}

// ─── Real mode: TWR (Time-Weighted Return) ──────────────────
function computeRealTWR(
  transactions: Transaction[],
  portfolio: PortfolioAsset[],
  periodStartStr: string,
  nowStr: string,
): number | null {
  if (portfolio.length === 0) return null;

  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const currentPriceMap: Record<string, number> = {};
  portfolio.forEach(a => { if (a.last_price != null) currentPriceMap[a.id] = a.last_price; });

  // Build positions up to period start
  const positions: Record<string, { qty: number; avgPrice: number }> = {};
  const lastKnownPrice: Record<string, number> = {};

  const updatePosition = (tx: Transaction) => {
    if (!positions[tx.asset_id]) positions[tx.asset_id] = { qty: 0, avgPrice: 0 };
    const pos = positions[tx.asset_id];
    if (tx.type === 'compra' || tx.type === 'buy') {
      const newQty = pos.qty + tx.quantity;
      if (newQty > 0) {
        pos.avgPrice = ((pos.qty * pos.avgPrice) + (tx.quantity * tx.price)) / newQty;
      } else {
        pos.avgPrice = tx.price;
      }
      pos.qty = newQty;
    } else {
      pos.qty = Math.max(0, pos.qty - tx.quantity);
    }
  };

  for (const tx of sorted) {
    if (tx.date > periodStartStr) break;
    updatePosition(tx);
    lastKnownPrice[tx.asset_id] = tx.price;
  }
  for (const [id, pos] of Object.entries(positions)) {
    if (!lastKnownPrice[id] && pos.avgPrice > 0) lastKnownPrice[id] = pos.avgPrice;
  }

  const valuate = (): number => {
    let total = 0;
    for (const [id, pos] of Object.entries(positions)) {
      if (pos.qty <= 0) continue;
      total += pos.qty * (lastKnownPrice[id] ?? 0);
    }
    return total;
  };

  const inPeriodTxs = sorted.filter(tx => tx.date > periodStartStr && tx.date <= nowStr);
  let twrProduct = 1;
  let prevValue = valuate();

  if (import.meta.env.DEV) {
    console.group('[Real TWR] Cálculo');
    console.log('Período:', periodStartStr, '→', nowStr);
    console.log('Posições no início:', JSON.parse(JSON.stringify(positions)));
    console.log('Patrimônio inicial:', prevValue.toFixed(2));
    console.log('Transações no período:', inPeriodTxs.length);
  }

  for (const tx of inPeriodTxs) {
    lastKnownPrice[tx.asset_id] = tx.price;
    const valueBeforeFlow = valuate();

    if (prevValue > 0) {
      const subReturn = (valueBeforeFlow / prevValue) - 1;
      twrProduct *= (1 + subReturn);
      if (import.meta.env.DEV) {
        console.log(`  Fluxo ${tx.date} | ${tx.type} ${tx.quantity}x ${portfolio.find(a => a.id === tx.asset_id)?.ticker ?? '?'} @ ${tx.price.toFixed(2)} | Pat: ${prevValue.toFixed(2)}→${valueBeforeFlow.toFixed(2)} | Sub: ${(subReturn * 100).toFixed(4)}%`);
      }
    }

    updatePosition(tx);
    prevValue = valuate();
  }

  // Final sub-period with current prices
  for (const [id, price] of Object.entries(currentPriceMap)) {
    lastKnownPrice[id] = price;
  }
  const finalValue = valuate();
  if (prevValue > 0) {
    const finalSub = (finalValue / prevValue) - 1;
    twrProduct *= (1 + finalSub);
    if (import.meta.env.DEV) {
      console.log(`  Final: Pat ${prevValue.toFixed(2)}→${finalValue.toFixed(2)} | Sub: ${(finalSub * 100).toFixed(4)}%`);
    }
  }

  const totalTWR = (twrProduct - 1) * 100;

  if (import.meta.env.DEV) {
    console.log(`TWR Total: ${totalTWR.toFixed(4)}%`);
    console.groupEnd();
  }

  // If no initial value and no transactions in period → no real data
  if (prevValue === 0 && inPeriodTxs.length === 0) return null;

  return totalTWR;
}

// ═══════════════════════════════════════════════════════════════
// UNIFIED DATA PIPELINE
// Chart, tooltip, and summary ALL consume this single object
// ═══════════════════════════════════════════════════════════════
interface UnifiedChartPoint {
  dateStr: string;  // YYYY-MM-DD (for sorting)
  label: string;    // display label
  carteira?: number;
  cdi?: number;
  ipca?: number;
  ibov?: number;
  ifix?: number;
}

interface UnifiedResult {
  chartData: UnifiedChartPoint[];
  finalValues: Partial<Record<SeriesKey, number>>; // final % for each series
  hasCarteiraData: boolean;
}

function computeEffectiveEndDate(
  benchmarkRawData: BenchmarkPoint[],
): string {
  const today = toDateStr(new Date());
  // Find the latest date across all benchmark data
  let latestBenchmark = '';
  for (const p of benchmarkRawData) {
    if (p.date > latestBenchmark && p.date <= today) latestBenchmark = p.date;
  }
  // Use the latest benchmark date if available, otherwise today
  return latestBenchmark || today;
}

function buildUnifiedData(
  mode: Mode,
  period: PeriodKey,
  transactions: Transaction[],
  portfolio: PortfolioAsset[],
  benchmarkRawData: BenchmarkPoint[],
): UnifiedResult {
  const periodStart = getPeriodStartDate(period, transactions);
  const requestedEnd = new Date();
  const periodStartStr = toDateStr(periodStart);
  const requestedEndStr = toDateStr(requestedEnd);

  // ── Effective end date: last date with real data ──
  const effectiveEndStr = computeEffectiveEndDate(benchmarkRawData);
  const effectiveEnd = new Date(effectiveEndStr + 'T00:00:00');

  // 1. Compute portfolio return (use effectiveEnd)
  let carteiraFinal: number | null = null;
  if (mode === 'real') {
    carteiraFinal = computeRealTWR(transactions, portfolio, periodStartStr, effectiveEndStr);
  } else {
    carteiraFinal = computeSimulationReturn(portfolio, transactions, periodStartStr);
  }

  const hasCarteiraData = carteiraFinal !== null;

  // 2. Normalize benchmarks to daily % returns
  const benchmarkDaily = normalizeBenchmarkDaily(benchmarkRawData, periodStartStr);

  // 3. Build timeline up to effectiveEnd (not today)
  const allDays = buildDailyTimeline(periodStart, effectiveEnd);
  const useDaily = allDays.length <= 200;

  let timelineDays: string[];
  if (useDaily) {
    timelineDays = allDays;
  } else {
    timelineDays = [allDays[0]];
    for (let i = 7; i < allDays.length - 1; i += 7) {
      timelineDays.push(allDays[i]);
    }
    if (timelineDays[timelineDays.length - 1] !== allDays[allDays.length - 1]) {
      timelineDays.push(allDays[allDays.length - 1]);
    }
  }

  // 4. Format labels
  const formatLabel = (dateStr: string): string => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (useDaily) {
      return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    }
    return dt.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
  };

  // 5. Build chart points
  const totalDays = allDays.length - 1;
  const chartData: UnifiedChartPoint[] = [];
  const finalValues: Partial<Record<SeriesKey, number>> = {};

  for (const dateStr of timelineDays) {
    const dayIndex = allDays.indexOf(dateStr);
    const fraction = totalDays > 0 ? dayIndex / totalDays : 1;

    const point: UnifiedChartPoint = {
      dateStr,
      label: formatLabel(dateStr),
    };

    // Carteira (interpolated)
    if (carteiraFinal !== null) {
      const totalReturnDec = carteiraFinal / 100;
      const interpPct = totalReturnDec >= -1
        ? (Math.pow(1 + totalReturnDec, fraction) - 1) * 100
        : carteiraFinal * fraction;
      point.carteira = +interpPct.toFixed(2);
    }

    // Benchmarks (use actual daily data with forward-fill)
    for (const [code, daily] of Object.entries(benchmarkDaily)) {
      const seriesKey = BENCHMARK_TO_SERIES[code];
      if (!seriesKey) continue;

      let val: number | undefined;
      if (daily[dateStr] !== undefined) {
        val = daily[dateStr];
      } else {
        let lastVal = 0;
        for (const d of allDays) {
          if (d > dateStr) break;
          if (daily[d] !== undefined) lastVal = daily[d];
        }
        val = lastVal;
      }

      (point as any)[seriesKey] = +val.toFixed(2);
    }

    chartData.push(point);
  }

  // 6. Collect final values from LAST chart point
  const lastPoint = chartData[chartData.length - 1];
  if (lastPoint) {
    for (const s of ALL_SERIES) {
      const v = (lastPoint as any)[s.key] as number | undefined;
      if (v !== undefined) finalValues[s.key] = v;
    }
  }

  if (import.meta.env.DEV) {
    // Per-benchmark last valid date
    const benchLastDates: Record<string, string> = {};
    for (const [code, daily] of Object.entries(benchmarkDaily)) {
      const dates = Object.keys(daily);
      benchLastDates[code] = dates.length > 0 ? dates[dates.length - 1] : 'N/A';
    }

    console.group('[UnifiedData] Resultado');
    console.log('Modo:', mode, '| Período:', period);
    console.log('requestedEndDate:', requestedEndStr);
    console.log('effectiveEndDate:', effectiveEndStr);
    console.log('periodStartStr:', periodStartStr);
    console.log('lastValidDate por benchmark:', benchLastDates);
    console.log('Pontos no gráfico:', chartData.length);
    console.log('Valores finais:', finalValues);
    console.log('Tem dados carteira:', hasCarteiraData);
    console.groupEnd();
  }

  return { chartData, finalValues, hasCarteiraData };
}

// ─── Component ──────────────────────────────────────────────
const Rentabilidade = () => {
  const [visibleSeries, setVisibleSeries] = useState<SeriesKey[]>(loadSavedSeries);
  const [period, setPeriod] = useState<PeriodKey>('12m');
  const [mode, setMode] = useState<Mode>(loadMode);
  const [hoveredSeries, setHoveredSeries] = useState<SeriesKey | null>(null);

  const { data: portfolio = [], isLoading: portfolioLoading } = usePortfolio();
  const { data: transactions = [], isLoading: txLoading } = useTransactions();

  useEffect(() => { saveSeries(visibleSeries); }, [visibleSeries]);
  useEffect(() => { saveMode(mode); }, [mode]);

  // Compute period start date for benchmark fetching (with padding)
  const periodStartDate = useMemo(() => {
    const d = getPeriodStartDate(period, transactions);
    const padded = new Date(d);
    padded.setMonth(padded.getMonth() - 1);
    return padded;
  }, [period, transactions]);

  // Benchmark codes to fetch
  const benchmarkCodes = useMemo(() => {
    const codes: string[] = [];
    for (const s of visibleSeries) {
      const code = SERIES_TO_BENCHMARK[s];
      if (code) codes.push(code);
    }
    if (!codes.includes('CDI')) codes.push('CDI');
    return codes;
  }, [visibleSeries]);

  const {
    data: benchmarkRawData,
    isLoading: benchmarkLoading,
    isSyncing: benchmarkSyncing,
    triggerSync,
  } = useBenchmarkHistory(benchmarkCodes, periodStartDate);

  // ═══ SINGLE SOURCE OF TRUTH ═══
  const unified = useMemo(() => {
    return buildUnifiedData(mode, period, transactions, portfolio, benchmarkRawData);
  }, [mode, period, transactions, portfolio, benchmarkRawData]);

  const { chartData, finalValues, hasCarteiraData } = unified;

  const isLoading = portfolioLoading || txLoading;
  const hasRealData = transactions.length > 0;
  const periodMonths = getPeriodMonths(period, transactions);

  // Summary rows derived from finalValues (same source as chart)
  const carteiraReturn = finalValues.carteira ?? 0;
  const summaryRows = useMemo(() => {
    return ALL_SERIES
      .filter(s => visibleSeries.includes(s.key))
      .map(s => {
        const ret = finalValues[s.key];
        if (ret === undefined) return null;
        const diff = s.key === 'carteira' ? null : ret - carteiraReturn;
        const effectiveMonths = periodMonths || 12;
        const annualized = effectiveMonths > 0
          ? (Math.pow(1 + ret / 100, 12 / effectiveMonths) - 1) * 100
          : ret;
        return { ...s, ret, annualized, diff };
      })
      .filter(Boolean) as (SeriesDef & { ret: number; annualized: number; diff: number | null })[];
  }, [finalValues, visibleSeries, carteiraReturn, periodMonths]);

  const toggleSeries = useCallback((key: SeriesKey) => {
    setVisibleSeries(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      return next.length === 0 ? [key] : next;
    });
  }, []);

  const selectAll = () => setVisibleSeries(ALL_SERIES.map(s => s.key));
  const clearSelection = () => setVisibleSeries(['carteira']);
  const applyPreset = (keys: SeriesKey[]) => setVisibleSeries(keys);

  // ─── Determine UI state ───────────────────────────────────
  const showEmptyState = !isLoading && mode === 'real' && !hasRealData;
  const showChart = !isLoading && !showEmptyState && chartData.length > 1;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-popover p-3 shadow-xl text-sm">
        <p className="text-muted-foreground text-xs font-medium mb-2">{label}</p>
        <div className="space-y-1">
          {payload
            .filter((e: any) => e.value !== undefined && e.value !== null)
            .sort((a: any, b: any) => (b.value ?? 0) - (a.value ?? 0))
            .map((entry: any) => {
              const def = ALL_SERIES.find(s => s.key === entry.dataKey);
              return (
                <div key={entry.dataKey} className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                    <span className="text-foreground">{def?.label ?? entry.dataKey}</span>
                  </div>
                  <span className="font-mono font-medium" style={{ color: entry.color }}>
                    {entry.value >= 0 ? '+' : ''}{Number(entry.value).toFixed(2)}%
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Rentabilidade</h1>
        <p className="text-sm text-muted-foreground">Compare a performance da sua carteira com benchmarks do mercado</p>
      </div>

      {/* Mode + Period + Series controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Mode selector */}
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 bg-muted/30">
          <Button
            variant={mode === 'real' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 text-xs px-3 gap-1.5"
            onClick={() => setMode('real')}
          >
            <Activity className="h-3 w-3" />
            Real
          </Button>
          <Button
            variant={mode === 'simulacao' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 text-xs px-3 gap-1.5"
            onClick={() => setMode('simulacao')}
          >
            <PlayCircle className="h-3 w-3" />
            Simulação
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* Period selector */}
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 bg-muted/30">
          {PERIODS.filter(p => mode === 'real' || p.key !== 'all').map(p => (
            <Button
              key={p.key}
              variant={period === p.key ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs px-3"
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* Series selector popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 h-8">
              <Layers className="h-3.5 w-3.5" />
              Comparativos ({visibleSeries.length})
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <div className="p-3 border-b border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Séries visíveis</p>
              <div className="flex gap-2 mt-2">
                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={selectAll}>
                  <Check className="h-3 w-3 mr-1" /> Todos
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={clearSelection}>
                  <RotateCcw className="h-3 w-3 mr-1" /> Limpar
                </Button>
              </div>
            </div>
            <div className="p-2 space-y-0.5 max-h-[280px] overflow-y-auto">
              {ALL_SERIES.map(s => (
                <label
                  key={s.key}
                  className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <Checkbox checked={visibleSeries.includes(s.key)} onCheckedChange={() => toggleSeries(s.key)} />
                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-sm">{s.label}</span>
                </label>
              ))}
            </div>
            <div className="p-3 border-t border-border">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Presets rápidos</p>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map(pr => (
                  <Button key={pr.label} variant="outline" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={() => applyPreset(pr.keys)}>
                    {pr.icon} {pr.label}
                  </Button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Sync status / manual refresh */}
        {benchmarkSyncing && (
          <Badge variant="outline" className="text-[10px] gap-1 animate-pulse">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Atualizando benchmarks…
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs px-2 gap-1"
          onClick={() => triggerSync()}
          disabled={benchmarkSyncing}
          title="Forçar atualização dos benchmarks"
        >
          <RefreshCw className={`h-3 w-3 ${benchmarkSyncing ? 'animate-spin' : ''}`} />
        </Button>

        {/* Active series badges */}
        <div className="flex flex-wrap gap-1.5">
          {ALL_SERIES.filter(s => visibleSeries.includes(s.key)).map(s => (
            <Badge
              key={s.key}
              variant="outline"
              className="text-[10px] gap-1.5 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => toggleSeries(s.key)}
              onMouseEnter={() => setHoveredSeries(s.key)}
              onMouseLeave={() => setHoveredSeries(null)}
            >
              <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
              <span className="text-muted-foreground">×</span>
            </Badge>
          ))}
        </div>
      </div>

      {/* Mode info badge */}
      <div className="flex items-center gap-2">
        <div className={`inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border ${
          mode === 'real'
            ? 'border-primary/30 bg-primary/5 text-primary'
            : 'border-[hsl(var(--chart-2))]/30 bg-[hsl(var(--chart-2))]/5 text-[hsl(var(--chart-2))]'
        }`}>
          <Info className="h-3 w-3" />
          {mode === 'real'
            ? hasRealData
              ? `Modo Real — baseado em ${transactions.length} lançamentos (TWR)`
              : 'Modo Real — nenhum lançamento encontrado. Registre aportes para ver a rentabilidade real.'
            : 'Modo Simulação — composição atual simulada no período histórico selecionado'
          }
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <Card>
          <CardContent className="py-8 space-y-4">
            <Skeleton className="h-[420px] w-full" />
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {showEmptyState && (
        <Card>
          <CardContent className="py-12 text-center">
            <Activity className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="text-lg font-semibold mb-1">Nenhum lançamento encontrado</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              No modo Real, a rentabilidade é calculada com base nas suas operações (compras e vendas).
              Registre ao menos um aporte para começar.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Chart */}
      {showChart && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Rentabilidade Acumulada (%)
              <Badge variant="outline" className="text-[10px] ml-2">
                {mode === 'real' ? 'REAL' : 'SIMULAÇÃO'}
              </Badge>
              {benchmarkLoading && (
                <Badge variant="outline" className="text-[10px] ml-1 animate-pulse">
                  Carregando…
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={55}
                  />
                  <RTooltip content={<CustomTooltip />} />
                  {ALL_SERIES.filter(s => visibleSeries.includes(s.key)).map(s => (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      stroke={s.color}
                      strokeWidth={hoveredSeries === s.key ? 3 : s.key === 'carteira' ? 2.5 : 1.5}
                      dot={false}
                      opacity={hoveredSeries && hoveredSeries !== s.key ? 0.3 : 1}
                      connectNulls
                      strokeDasharray={mode === 'simulacao' && s.key === 'carteira' ? '8 4' : undefined}
                    />
                  ))}
                  <Legend
                    content={({ payload }) => (
                      <div className="flex flex-wrap justify-center gap-3 mt-3">
                        {payload?.map((entry: any) => {
                          const def = ALL_SERIES.find(s => s.key === entry.dataKey);
                          if (!def) return null;
                          return (
                            <button
                              key={def.key}
                              className={`flex items-center gap-1.5 text-xs transition-all cursor-pointer hover:opacity-100 ${
                                visibleSeries.includes(def.key) ? 'opacity-100' : 'opacity-40'
                              }`}
                              onClick={() => toggleSeries(def.key)}
                              onMouseEnter={() => setHoveredSeries(def.key)}
                              onMouseLeave={() => setHoveredSeries(null)}
                            >
                              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: def.color }} />
                              <span className="text-muted-foreground">{def.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Performance summary table */}
      {showChart && summaryRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              Resumo de Performance
              <Badge variant="outline" className="text-[10px] ml-1">
                {mode === 'real' ? 'REAL' : 'SIMULAÇÃO'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Série</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">No período</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Anualizada</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">vs. Carteira</th>
                    <th className="text-center py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map(row => (
                    <tr
                      key={row.key}
                      className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                      onMouseEnter={() => setHoveredSeries(row.key)}
                      onMouseLeave={() => setHoveredSeries(null)}
                    >
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                          <span className="font-medium">{row.label}</span>
                        </div>
                      </td>
                      <td className="text-right py-2.5 px-3 font-mono">
                        <span className={row.ret >= 0 ? 'text-[hsl(var(--positive))]' : 'text-[hsl(var(--negative))]'}>
                          {row.ret >= 0 ? '+' : ''}{row.ret.toFixed(2)}%
                        </span>
                      </td>
                      <td className="text-right py-2.5 px-3 font-mono text-muted-foreground">
                        {row.annualized >= 0 ? '+' : ''}{row.annualized.toFixed(2)}%
                      </td>
                      <td className="text-right py-2.5 px-3 font-mono">
                        {row.diff === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className={row.diff <= 0 ? 'text-[hsl(var(--positive))]' : 'text-[hsl(var(--negative))]'}>
                            {row.diff <= 0 ? '+' : ''}{(-row.diff).toFixed(2)} p.p.
                          </span>
                        )}
                      </td>
                      <td className="text-center py-2.5 px-3">
                        {row.diff === null ? (
                          <Badge variant="outline" className="text-[10px]">REF</Badge>
                        ) : row.diff <= 0 ? (
                          <Badge variant="outline" className="text-[10px] border-[hsl(var(--positive))]/40 bg-[hsl(var(--positive))]/10 text-[hsl(var(--positive))]">
                            <ArrowUpRight className="h-3 w-3 mr-0.5" /> Acima
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-[hsl(var(--negative))]/40 bg-[hsl(var(--negative))]/10 text-[hsl(var(--negative))]">
                            <ArrowDownRight className="h-3 w-3 mr-0.5" /> Abaixo
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Comparison highlights */}
            {summaryRows.filter(r => r.diff !== null).length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {summaryRows.filter(r => r.diff !== null).map(r => {
                  const above = (r.diff ?? 0) <= 0;
                  const pp = Math.abs(r.diff ?? 0).toFixed(2);
                  return (
                    <div
                      key={r.key}
                      className={`text-xs px-3 py-1.5 rounded-lg border ${
                        above
                          ? 'border-[hsl(var(--positive))]/20 bg-[hsl(var(--positive))]/5 text-[hsl(var(--positive))]'
                          : 'border-[hsl(var(--negative))]/20 bg-[hsl(var(--negative))]/5 text-[hsl(var(--negative))]'
                      }`}
                    >
                      Carteira {above ? '+' : '-'}{pp} p.p. {above ? 'acima' : 'abaixo'} do {r.label}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Rentabilidade;
