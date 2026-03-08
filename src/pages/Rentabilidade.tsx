import { useState, useMemo, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
  ResponsiveContainer, Legend,
} from 'recharts';
import {
  TrendingUp, ChevronDown, Check, RotateCcw, Layers, Flame, Globe, BarChart3,
  ArrowUpRight, ArrowDownRight, Activity, PlayCircle, Info, RefreshCw,
} from 'lucide-react';
import { usePortfolio, PortfolioAsset } from '@/hooks/usePortfolio';
import { useTransactions, Transaction } from '@/hooks/useTransactions';
import { useBenchmarkHistory, BenchmarkPoint } from '@/hooks/useBenchmarkHistory';
import { formatPct } from '@/lib/format';

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

// ─── Helper: get start-of-period date ───────────────────────
function getPeriodStartDate(period: PeriodKey, periodMonths: number, transactions: Transaction[]): Date {
  const now = new Date();
  if (period === 'mtd') {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  if (period === 'all' && transactions.length > 0) {
    return new Date(transactions[0].date);
  }
  const d = new Date();
  d.setMonth(d.getMonth() - periodMonths);
  return d;
}

// ─── Helper: find price for an asset at a given date ────────
function findStartPrice(
  assetId: string,
  periodStart: Date,
  transactions: Transaction[],
  avgPriceMap: Record<string, number>,
): number | null {
  const dateStr = periodStart.toISOString().slice(0, 10);
  let best: Transaction | null = null;
  for (const t of transactions) {
    if (t.asset_id !== assetId) continue;
    if (t.date <= dateStr) {
      if (!best || t.date > best.date) best = t;
    }
  }
  if (best) return best.price;
  if (avgPriceMap[assetId]) return avgPriceMap[assetId];
  return null;
}

// ─── Real mode: True TWR (Time-Weighted Return) ────────────
interface MonthlyPoint { date: Date; cumulativeReturn: number }

function computeRealReturn(
  transactions: Transaction[],
  portfolio: PortfolioAsset[],
  period: PeriodKey,
  periodMonths: number,
): MonthlyPoint[] {
  if (portfolio.length === 0) return [];

  const periodStart = getPeriodStartDate(period, periodMonths, transactions);
  const now = new Date();
  const periodStartStr = periodStart.toISOString().slice(0, 10);
  const nowStr = now.toISOString().slice(0, 10);

  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  const currentPriceMap: Record<string, number> = {};
  portfolio.forEach(a => { if (a.last_price != null) currentPriceMap[a.id] = a.last_price; });

  const positions: Record<string, { qty: number; avgPrice: number }> = {};

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
  }

  const lastKnownPrice: Record<string, number> = {};
  for (const tx of sorted) {
    if (tx.date > periodStartStr) break;
    lastKnownPrice[tx.asset_id] = tx.price;
  }
  for (const [id, pos] of Object.entries(positions)) {
    if (!lastKnownPrice[id] && pos.avgPrice > 0) lastKnownPrice[id] = pos.avgPrice;
  }

  const valuate = (): number => {
    let total = 0;
    for (const [id, pos] of Object.entries(positions)) {
      if (pos.qty <= 0) continue;
      const price = lastKnownPrice[id] ?? 0;
      total += pos.qty * price;
    }
    return total;
  };

  const inPeriodTxs = sorted.filter(tx => tx.date > periodStartStr && tx.date <= nowStr);

  let twrProduct = 1;
  let prevValue = valuate();

  if (import.meta.env.DEV) {
    console.group('[Rentabilidade Real TWR] Cálculo');
    console.log('Período:', periodStartStr, '→', nowStr);
    console.log('Posições no início:', JSON.parse(JSON.stringify(positions)));
    console.log('Patrimônio inicial:', prevValue.toFixed(2));
  }

  const monthlySnapshots: { date: string; twrCumulative: number }[] = [];
  const addSnapshot = (dateStr: string) => {
    monthlySnapshots.push({ date: dateStr, twrCumulative: (twrProduct - 1) * 100 });
  };

  addSnapshot(periodStartStr);
  let currentMonth = periodStartStr.slice(0, 7);

  for (const tx of inPeriodTxs) {
    lastKnownPrice[tx.asset_id] = tx.price;
    const valueBeforeFlow = valuate();

    if (prevValue > 0) {
      const subReturn = (valueBeforeFlow / prevValue) - 1;
      twrProduct *= (1 + subReturn);

      if (import.meta.env.DEV) {
        console.log(`  Fluxo ${tx.date} | ${tx.type} ${tx.quantity}x ${portfolio.find(a => a.id === tx.asset_id)?.ticker ?? tx.asset_id} @ ${tx.price.toFixed(2)}`);
        console.log(`    Patrimônio antes: ${prevValue.toFixed(2)} → ${valueBeforeFlow.toFixed(2)} | Retorno sub-período: ${(subReturn * 100).toFixed(4)}% | TWR acumulado: ${((twrProduct - 1) * 100).toFixed(4)}%`);
      }
    }

    const txMonth = tx.date.slice(0, 7);
    while (currentMonth < txMonth) {
      const [y, m] = currentMonth.split('-').map(Number);
      const nextM = m === 12 ? 1 : m + 1;
      const nextY = m === 12 ? y + 1 : y;
      currentMonth = `${nextY}-${String(nextM).padStart(2, '0')}`;
      if (currentMonth <= txMonth) {
        addSnapshot(`${currentMonth}-01`);
      }
    }

    updatePosition(tx);
    prevValue = valuate();

    if (import.meta.env.DEV) {
      console.log(`    Patrimônio depois do fluxo: ${prevValue.toFixed(2)}`);
    }
  }

  for (const [id, price] of Object.entries(currentPriceMap)) {
    lastKnownPrice[id] = price;
  }
  const finalValue = valuate();

  if (prevValue > 0) {
    const finalSubReturn = (finalValue / prevValue) - 1;
    twrProduct *= (1 + finalSubReturn);

    if (import.meta.env.DEV) {
      console.log(`  Final: Patrimônio ${prevValue.toFixed(2)} → ${finalValue.toFixed(2)} | Retorno: ${(finalSubReturn * 100).toFixed(4)}%`);
    }
  }

  const totalTWR = (twrProduct - 1) * 100;

  if (import.meta.env.DEV) {
    console.log(`TWR Total: ${totalTWR.toFixed(4)}%`);
    console.groupEnd();
  }

  const nowMonth = nowStr.slice(0, 7);
  while (currentMonth < nowMonth) {
    const [y, m] = currentMonth.split('-').map(Number);
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    currentMonth = `${nextY}-${String(nextM).padStart(2, '0')}`;
    addSnapshot(`${currentMonth}-01`);
  }
  addSnapshot(nowStr);

  if (monthlySnapshots.length > 0) {
    monthlySnapshots[monthlySnapshots.length - 1].twrCumulative = totalTWR;
  }

  const points: MonthlyPoint[] = [];
  const startDate = new Date(periodStartStr);
  const totalDays = (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  if (totalDays <= 0) return [];

  const cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const snapshotMap: Record<string, number> = {};
  monthlySnapshots.forEach(s => {
    const key = s.date.slice(0, 7);
    snapshotMap[key] = s.twrCumulative;
  });

  points.push({ date: new Date(cur), cumulativeReturn: 0 });

  const totalMonths = (endMonth.getFullYear() - cur.getFullYear()) * 12 + (endMonth.getMonth() - cur.getMonth());

  if (totalMonths <= 1) {
    points.push({ date: now, cumulativeReturn: totalTWR });
  } else {
    for (let i = 1; i <= totalMonths; i++) {
      const d = new Date(cur.getFullYear(), cur.getMonth() + i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (snapshotMap[mk] !== undefined) {
        points.push({ date: d, cumulativeReturn: snapshotMap[mk] });
      } else {
        const fraction = i / totalMonths;
        const interpReturn = (Math.pow(twrProduct, fraction) - 1) * 100;
        points.push({ date: d, cumulativeReturn: interpReturn });
      }
    }
    if (points[points.length - 1].cumulativeReturn !== totalTWR) {
      points.push({ date: now, cumulativeReturn: totalTWR });
    }
  }

  return points;
}

// ─── Simulation: current weights applied retroactively ──────
function computeSimulation(
  portfolio: PortfolioAsset[],
  period: PeriodKey,
  periodMonths: number,
  transactions: Transaction[],
): MonthlyPoint[] {
  const activeAssets = portfolio.filter(a => a.quantity > 0 && a.last_price != null);
  const totalValue = activeAssets.reduce((sum, a) => sum + a.quantity * (a.last_price ?? a.avg_price), 0);
  if (totalValue <= 0) return [];

  const periodStart = getPeriodStartDate(period, periodMonths, transactions);
  const avgPriceMap: Record<string, number> = {};
  portfolio.forEach(a => { avgPriceMap[a.id] = a.avg_price; });

  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  if (import.meta.env.DEV) {
    console.group('[Rentabilidade Simulação] Debug');
    console.log('Período:', periodStart.toISOString().slice(0, 10));
  }

  let portfolioReturn = 0;

  for (const asset of activeAssets) {
    const weight = (asset.quantity * (asset.last_price ?? asset.avg_price)) / totalValue;
    const currentPrice = asset.last_price!;
    const startPrice = findStartPrice(asset.id, periodStart, sorted, avgPriceMap) ?? asset.avg_price;
    
    if (startPrice <= 0) continue;
    const ret = (currentPrice / startPrice) - 1;
    portfolioReturn += weight * ret;

    if (import.meta.env.DEV) {
      console.log(`  ${asset.ticker}: peso=${(weight * 100).toFixed(1)}%, preço_início=${startPrice.toFixed(2)}, preço_atual=${currentPrice.toFixed(2)}, ret=${(ret * 100).toFixed(2)}%`);
    }
  }

  const portfolioReturnPct = portfolioReturn * 100;

  if (import.meta.env.DEV) {
    console.log(`Retorno simulado: ${portfolioReturnPct.toFixed(2)}%`);
    console.groupEnd();
  }

  const now = new Date();
  const points: MonthlyPoint[] = [];
  const cur = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);
  const totalMonths = Math.max(1, (now.getFullYear() - cur.getFullYear()) * 12 + (now.getMonth() - cur.getMonth()));

  points.push({ date: new Date(cur), cumulativeReturn: 0 });

  if (totalMonths <= 1) {
    points.push({ date: new Date(now.getFullYear(), now.getMonth(), now.getDate()), cumulativeReturn: portfolioReturnPct });
  } else {
    for (let i = 1; i <= totalMonths; i++) {
      const d = new Date(cur.getFullYear(), cur.getMonth() + i, 1);
      const fraction = i / totalMonths;
      const interpReturn = (Math.pow(1 + portfolioReturn, fraction) - 1) * 100;
      points.push({ date: d, cumulativeReturn: interpReturn });
    }
  }

  return points;
}

// ─── Benchmark normalization helper ─────────────────────────
// Takes raw benchmark data and normalizes to cumulative % return from period start
function normalizeBenchmarks(
  benchmarkData: BenchmarkPoint[],
  periodStart: Date,
): Record<string, { date: string; pctReturn: number }[]> {
  const grouped: Record<string, BenchmarkPoint[]> = {};
  for (const p of benchmarkData) {
    if (!grouped[p.benchmark_code]) grouped[p.benchmark_code] = [];
    grouped[p.benchmark_code].push(p);
  }

  const result: Record<string, { date: string; pctReturn: number }[]> = {};
  const periodStartStr = periodStart.toISOString().slice(0, 10);

  for (const [code, points] of Object.entries(grouped)) {
    // Find base value: first point on or before periodStart
    // Points are sorted by date ascending
    let baseValue: number | null = null;
    for (const p of points) {
      if (p.date <= periodStartStr) {
        baseValue = p.value;
      } else {
        break;
      }
    }
    // If no point before period start, use first available
    if (baseValue === null && points.length > 0) {
      baseValue = points[0].value;
    }
    if (baseValue === null || baseValue === 0) continue;

    const normalized = points
      .filter(p => p.date >= periodStartStr)
      .map(p => ({
        date: p.date,
        pctReturn: ((p.value / baseValue!) - 1) * 100,
      }));

    result[code] = normalized;

    if (import.meta.env.DEV) {
      console.log(`[Benchmark ${code}] base=${baseValue.toFixed(2)}, points=${normalized.length}, last=${normalized[normalized.length - 1]?.pctReturn.toFixed(2) ?? 'N/A'}%`);
    }
  }

  return result;
}

// ─── Component ──────────────────────────────────────────────
const Rentabilidade = () => {
  const [visibleSeries, setVisibleSeries] = useState<SeriesKey[]>(loadSavedSeries);
  const [period, setPeriod] = useState<PeriodKey>('12m');
  const [mode, setMode] = useState<Mode>(loadMode);
  const [hoveredSeries, setHoveredSeries] = useState<SeriesKey | null>(null);

  const { data: portfolio = [] } = usePortfolio();
  const { data: transactions = [] } = useTransactions();

  useEffect(() => { saveSeries(visibleSeries); }, [visibleSeries]);
  useEffect(() => { saveMode(mode); }, [mode]);

  // Determine period months
  const periodMonths = useMemo(() => {
    if (period === 'mtd') return 1;
    if (period === 'all' && mode === 'real' && transactions.length > 0) {
      const firstDate = new Date(transactions[0].date);
      const now = new Date();
      return Math.max(1, (now.getFullYear() - firstDate.getFullYear()) * 12 + (now.getMonth() - firstDate.getMonth()) + 1);
    }
    const found = PERIODS.find(p => p.key === period);
    return found?.months || 12;
  }, [period, mode, transactions]);

  // Compute period start date for benchmark fetching
  const periodStartDate = useMemo(() => {
    // Fetch a bit more data than needed for base value lookup
    const d = getPeriodStartDate(period, periodMonths, transactions);
    // Go back 1 extra month to ensure we find a base value
    const padded = new Date(d);
    padded.setMonth(padded.getMonth() - 1);
    return padded;
  }, [period, periodMonths, transactions]);

  // Benchmark codes to fetch (from visible series)
  const benchmarkCodes = useMemo(() => {
    const codes: string[] = [];
    for (const s of visibleSeries) {
      const code = SERIES_TO_BENCHMARK[s];
      if (code) codes.push(code);
    }
    // Always fetch CDI for reference even if not visible
    if (!codes.includes('CDI')) codes.push('CDI');
    return codes;
  }, [visibleSeries]);

  // Fetch real benchmark data
  const {
    data: benchmarkRawData,
    isLoading: benchmarkLoading,
    isSyncing: benchmarkSyncing,
    triggerSync,
  } = useBenchmarkHistory(benchmarkCodes, periodStartDate);

  // Build chart data
  const chartData = useMemo(() => {
    // 1. Carteira series
    let carteiraPoints: MonthlyPoint[] = [];

    if (mode === 'real') {
      carteiraPoints = computeRealReturn(transactions, portfolio, period, periodMonths);
    } else {
      carteiraPoints = computeSimulation(portfolio, period, periodMonths, transactions);
    }

    // 2. Normalize benchmark data
    const actualPeriodStart = getPeriodStartDate(period, periodMonths, transactions);
    const normalizedBenchmarks = normalizeBenchmarks(benchmarkRawData, actualPeriodStart);

    // 3. Build unified timeline (monthly)
    const dateFormat = (d: Date) => d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    // Index carteira points by month
    const carteiraByMonth: Record<string, number> = {};
    carteiraPoints.forEach(p => { carteiraByMonth[dateKey(p.date)] = p.cumulativeReturn; });

    // Index benchmark points by month (use last value in each month)
    const benchmarkByMonth: Record<string, Record<string, number>> = {};
    for (const [code, points] of Object.entries(normalizedBenchmarks)) {
      benchmarkByMonth[code] = {};
      for (const p of points) {
        const mk = p.date.slice(0, 7); // YYYY-MM
        benchmarkByMonth[code][mk] = p.pctReturn; // last value wins
      }
    }

    // Build timeline from period start to now
    const now = new Date();
    const start = new Date(actualPeriodStart.getFullYear(), actualPeriodStart.getMonth(), 1);
    const months: { date: Date; mk: string; label: string }[] = [];
    const cur = new Date(start);
    while (cur <= now) {
      months.push({
        date: new Date(cur),
        mk: dateKey(cur),
        label: dateFormat(cur),
      });
      cur.setMonth(cur.getMonth() + 1);
    }
    // Add current month if not already there
    const nowMk = dateKey(now);
    if (!months.find(m => m.mk === nowMk)) {
      months.push({ date: now, mk: nowMk, label: dateFormat(now) });
    }

    // Helper: forward-fill benchmark values for months with no data
    const forwardFill = (benchCode: string): Record<string, number> => {
      const raw = benchmarkByMonth[benchCode] ?? {};
      const filled: Record<string, number> = {};
      let lastVal = 0; // Start at 0%
      for (const m of months) {
        if (raw[m.mk] !== undefined) {
          lastVal = raw[m.mk];
        }
        filled[m.mk] = lastVal;
      }
      return filled;
    };

    // Build filled series for each benchmark
    const filledCdi = forwardFill('CDI');
    const filledIpca = forwardFill('IPCA');
    const filledIbov = forwardFill('IBOV');
    const filledIfix = forwardFill('IFIX');

    return months.map(m => {
      const carteiraVal = carteiraByMonth[m.mk];
      return {
        date: m.label,
        carteira: carteiraVal !== undefined ? +carteiraVal.toFixed(2) : undefined,
        cdi: filledCdi[m.mk] !== undefined ? +filledCdi[m.mk].toFixed(2) : undefined,
        ipca: filledIpca[m.mk] !== undefined ? +filledIpca[m.mk].toFixed(2) : undefined,
        ibov: filledIbov[m.mk] !== undefined ? +filledIbov[m.mk].toFixed(2) : undefined,
        ifix: filledIfix[m.mk] !== undefined ? +filledIfix[m.mk].toFixed(2) : undefined,
      };
    });
  }, [mode, period, periodMonths, transactions, portfolio, benchmarkRawData]);

  const toggleSeries = useCallback((key: SeriesKey) => {
    setVisibleSeries(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      return next.length === 0 ? [key] : next;
    });
  }, []);

  const selectAll = () => setVisibleSeries(ALL_SERIES.map(s => s.key));
  const clearSelection = () => setVisibleSeries(['carteira']);
  const applyPreset = (keys: SeriesKey[]) => setVisibleSeries(keys);

  // Performance summary
  const lastPoint = chartData[chartData.length - 1];
  const carteiraReturn = lastPoint?.carteira ?? 0;

  const summaryRows = useMemo(() => {
    if (!lastPoint) return [];
    return ALL_SERIES
      .filter(s => visibleSeries.includes(s.key))
      .map(s => {
        const ret = (lastPoint as any)[s.key] as number | undefined;
        if (ret === undefined) return null;
        const diff = s.key === 'carteira' ? null : ret - carteiraReturn;
        const effectiveMonths = periodMonths || 12;
        const annualized = effectiveMonths > 0 ? (Math.pow(1 + ret / 100, 12 / effectiveMonths) - 1) * 100 : ret;
        return { ...s, ret, annualized, diff };
      })
      .filter(Boolean) as (SeriesDef & { ret: number; annualized: number; diff: number | null })[];
  }, [lastPoint, visibleSeries, carteiraReturn, periodMonths]);

  const hasRealData = transactions.length > 0;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-popover p-3 shadow-xl text-sm">
        <p className="text-muted-foreground text-xs font-medium mb-2">{label}</p>
        <div className="space-y-1">
          {payload
            .filter((e: any) => e.value !== undefined)
            .sort((a: any, b: any) => b.value - a.value)
            .map((entry: any) => {
              const def = ALL_SERIES.find(s => s.key === entry.dataKey);
              return (
                <div key={entry.dataKey} className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                    <span className="text-foreground">{def?.label ?? entry.dataKey}</span>
                  </div>
                  <span className="font-mono font-medium" style={{ color: entry.color }}>
                    {entry.value >= 0 ? '+' : ''}{entry.value.toFixed(2)}%
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

      {/* Mode badge */}
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

      {/* Chart */}
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
                  dataKey="date"
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={50}
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
                    connectNulls={false}
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

      {/* Performance summary table */}
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
    </div>
  );
};

export default Rentabilidade;
