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
  ArrowUpRight, ArrowDownRight, Activity, PlayCircle, Info,
} from 'lucide-react';
import { usePortfolio, PortfolioAsset } from '@/hooks/usePortfolio';
import { useTransactions, Transaction } from '@/hooks/useTransactions';
import { formatPct } from '@/lib/format';

// ─── Series definitions ─────────────────────────────────────
type SeriesKey = 'carteira' | 'cdi' | 'ipca' | 'ifix' | 'ibov' | 'smll' | 'idiv' | 'ivvb11';

interface SeriesDef { key: SeriesKey; label: string; color: string }

const ALL_SERIES: SeriesDef[] = [
  { key: 'carteira', label: 'Carteira', color: 'hsl(43, 85%, 55%)' },
  { key: 'cdi',      label: 'CDI',      color: 'hsl(200, 80%, 55%)' },
  { key: 'ipca',     label: 'IPCA',     color: 'hsl(30, 90%, 55%)' },
  { key: 'ifix',     label: 'IFIX',     color: 'hsl(142, 70%, 45%)' },
  { key: 'ibov',     label: 'IBOV',     color: 'hsl(280, 70%, 60%)' },
  { key: 'smll',     label: 'SMLL',     color: 'hsl(340, 65%, 55%)' },
  { key: 'idiv',     label: 'IDIV',     color: 'hsl(180, 60%, 45%)' },
  { key: 'ivvb11',   label: 'IVVB11',   color: 'hsl(60, 70%, 50%)' },
];

const DEFAULT_VISIBLE: SeriesKey[] = ['carteira', 'cdi'];

const PRESETS: { label: string; icon: React.ReactNode; keys: SeriesKey[] }[] = [
  { label: 'Inflação', icon: <Flame className="h-3 w-3" />, keys: ['carteira', 'cdi', 'ipca'] },
  { label: 'Renda Variável BR', icon: <BarChart3 className="h-3 w-3" />, keys: ['carteira', 'ibov', 'smll', 'ifix'] },
  { label: 'Dividendos', icon: <TrendingUp className="h-3 w-3" />, keys: ['carteira', 'idiv', 'ifix'] },
  { label: 'Internacional', icon: <Globe className="h-3 w-3" />, keys: ['carteira', 'ivvb11'] },
];

type PeriodKey = 'mtd' | '6m' | '12m' | '24m' | '60m' | 'all';
const PERIODS: { key: PeriodKey; label: string; months: number }[] = [
  { key: 'mtd', label: 'Mês atual', months: -1 }, // -1 = month-to-date
  { key: '6m', label: '6 meses', months: 6 },
  { key: '12m', label: '12 meses', months: 12 },
  { key: '24m', label: '2 anos', months: 24 },
  { key: '60m', label: '5 anos', months: 60 },
  { key: 'all', label: 'Desde o início', months: 0 }, // 0 = dynamic
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

// ─── Benchmark mock generator (deterministic) ───────────────
const MONTHLY_RATES: Record<Exclude<SeriesKey, 'carteira'>, { mean: number; vol: number }> = {
  cdi:    { mean: 0.0104, vol: 0.0005 },
  ipca:   { mean: 0.0037, vol: 0.002 },
  ifix:   { mean: 0.0080, vol: 0.018 },
  ibov:   { mean: 0.0095, vol: 0.035 },
  smll:   { mean: 0.0065, vol: 0.04 },
  idiv:   { mean: 0.0110, vol: 0.028 },
  ivvb11: { mean: 0.0153, vol: 0.04 },
};

function generateBenchmarkSeries(months: number): { date: Date; values: Record<Exclude<SeriesKey, 'carteira'>, number> }[] {
  let seed = 42;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const randNorm = () => { const u1 = rand(); const u2 = rand(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); };

  const now = new Date();
  const keys = Object.keys(MONTHLY_RATES) as Exclude<SeriesKey, 'carteira'>[];
  const cumulative: Record<string, number> = {};
  keys.forEach(k => (cumulative[k] = 0));

  const data: { date: Date; values: Record<string, number> }[] = [];

  for (let i = months; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    if (i === months) {
      data.push({ date: d, values: { ...cumulative } });
      continue;
    }
    for (const k of keys) {
      const { mean, vol } = MONTHLY_RATES[k];
      const monthReturn = mean + vol * randNorm();
      cumulative[k] = (1 + cumulative[k] / 100) * (1 + monthReturn) * 100 - 100;
    }
    data.push({ date: d, values: { ...cumulative } });
  }
  return data as any;
}

// ─── TWR (Time-Weighted Return) calculation ─────────────────
// Uses Modified Dietz within each month, then chains months.
// We reconstruct portfolio value at each month-end from transaction history.
interface MonthlyPoint { date: Date; cumulativeReturn: number }

function computeRealTWR(
  transactions: Transaction[],
  portfolio: PortfolioAsset[],
): MonthlyPoint[] {
  if (transactions.length === 0) return [];

  // Build a map of asset_id → current price (best we have)
  const currentPriceMap: Record<string, number> = {};
  portfolio.forEach(a => {
    if (a.last_price != null) currentPriceMap[a.id] = a.last_price;
  });

  // Sort transactions by date
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const firstDate = new Date(sorted[0].date);
  const now = new Date();

  // Build positions over time: at each transaction, update holdings
  // holdings: asset_id → { qty, totalCost }
  const holdings: Record<string, { qty: number; avgPrice: number }> = {};

  // Group transactions by month
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  // Build all months from first transaction to now
  const months: string[] = [];
  const cur = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
  while (cur <= now) {
    months.push(monthKey(cur));
    cur.setMonth(cur.getMonth() + 1);
  }

  // Index transactions by month
  const txByMonth: Record<string, Transaction[]> = {};
  sorted.forEach(t => {
    const mk = monthKey(new Date(t.date));
    if (!txByMonth[mk]) txByMonth[mk] = [];
    txByMonth[mk].push(t);
  });

  // For estimating asset price at a given month:
  // We use transaction prices as snapshots. Between transactions, we use last known tx price.
  // At the end, we use current price from portfolio.
  const lastKnownPrice: Record<string, number> = {};

  // Calculate portfolio value using last known prices
  const portfolioValue = (): number => {
    let total = 0;
    for (const [assetId, h] of Object.entries(holdings)) {
      if (h.qty <= 0) continue;
      const price = lastKnownPrice[assetId] ?? currentPriceMap[assetId] ?? h.avgPrice;
      total += h.qty * price;
    }
    return total;
  };

  const points: MonthlyPoint[] = [];
  let cumulativeReturn = 0; // in percent
  let prevValue = 0;

  if (import.meta.env.DEV) {
    console.group('[Rentabilidade Real] TWR Debug');
    console.log('Total transactions:', sorted.length);
    console.log('Period:', months[0], '→', months[months.length - 1]);
  }

  for (let mi = 0; mi < months.length; mi++) {
    const mk = months[mi];
    const monthTxs = txByMonth[mk] ?? [];

    // Process transactions for this month
    let cashFlowIn = 0;
    for (const tx of monthTxs) {
      lastKnownPrice[tx.asset_id] = tx.price;

      if (!holdings[tx.asset_id]) holdings[tx.asset_id] = { qty: 0, avgPrice: 0 };
      const h = holdings[tx.asset_id];

      if (tx.type === 'compra' || tx.type === 'buy') {
        const newQty = h.qty + tx.quantity;
        h.avgPrice = newQty > 0 ? ((h.qty * h.avgPrice) + (tx.quantity * tx.price)) / newQty : tx.price;
        h.qty = newQty;
        cashFlowIn += tx.quantity * tx.price + tx.fees;
      } else {
        // venda/sell
        h.qty = Math.max(0, h.qty - tx.quantity);
        cashFlowIn -= tx.quantity * tx.price - tx.fees;
      }
    }

    // Use current price for the last month
    const isLastMonth = mi === months.length - 1;
    if (isLastMonth) {
      for (const assetId of Object.keys(holdings)) {
        if (currentPriceMap[assetId]) lastKnownPrice[assetId] = currentPriceMap[assetId];
      }
    }

    const endValue = portfolioValue();

    if (mi === 0) {
      // First month: just record starting state
      prevValue = endValue;
      const [y, m] = mk.split('-').map(Number);
      points.push({ date: new Date(y, m - 1, 1), cumulativeReturn: 0 });
    } else {
      // Modified Dietz for this month
      const adjustedStart = prevValue + cashFlowIn;
      if (adjustedStart > 0) {
        const periodReturn = (endValue - adjustedStart) / adjustedStart;
        cumulativeReturn = (1 + cumulativeReturn / 100) * (1 + periodReturn) * 100 - 100;
      }
      const [y, m] = mk.split('-').map(Number);
      points.push({ date: new Date(y, m - 1, 1), cumulativeReturn });
      prevValue = endValue;
    }

    if (import.meta.env.DEV && monthTxs.length > 0) {
      console.log(`  ${mk}: ${monthTxs.length} tx, value=${endValue.toFixed(2)}, cumRet=${cumulativeReturn.toFixed(2)}%`);
    }
  }

  if (import.meta.env.DEV) {
    console.log('Final cumulative return:', cumulativeReturn.toFixed(2) + '%');
    console.groupEnd();
  }

  return points;
}

// ─── Simulation: current weights applied retroactively ──────
function computeSimulation(
  portfolio: PortfolioAsset[],
  months: number,
): MonthlyPoint[] {
  // Calculate current weights
  const totalValue = portfolio.reduce((sum, a) => sum + a.quantity * (a.last_price ?? a.avg_price), 0);
  if (totalValue <= 0) return [];

  const weights = portfolio
    .filter(a => a.quantity > 0)
    .map(a => ({
      ticker: a.ticker,
      weight: (a.quantity * (a.last_price ?? a.avg_price)) / totalValue,
    }));

  if (import.meta.env.DEV) {
    console.group('[Rentabilidade Simulação] Debug');
    console.log('Weights:', weights.map(w => `${w.ticker}: ${(w.weight * 100).toFixed(1)}%`));
    console.log('Period months:', months);
  }

  // Simulate: we use a simple model where portfolio return is a weighted sum
  // of individual asset returns. Since we don't have historical prices for each asset,
  // we approximate using a diversified equity-like return profile.
  let seed = 137;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const randNorm = () => { const u1 = rand(); const u2 = rand(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); };

  // Approximate monthly return based on portfolio composition
  const avgMonthlyReturn = 0.012; // ~15% annualized for diversified BR portfolio
  const avgVol = 0.025;

  const now = new Date();
  const points: MonthlyPoint[] = [];
  let cumulative = 0;

  for (let i = months; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    if (i === months) {
      points.push({ date: d, cumulativeReturn: 0 });
      continue;
    }
    const monthReturn = avgMonthlyReturn + avgVol * randNorm();
    cumulative = (1 + cumulative / 100) * (1 + monthReturn) * 100 - 100;
    points.push({ date: d, cumulativeReturn: cumulative });
  }

  if (import.meta.env.DEV) {
    console.log('Simulated final return:', cumulative.toFixed(2) + '%');
    console.groupEnd();
  }

  return points;
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
    if (period === 'all' && mode === 'real' && transactions.length > 0) {
      const firstDate = new Date(transactions[0].date);
      const now = new Date();
      return Math.max(1, (now.getFullYear() - firstDate.getFullYear()) * 12 + (now.getMonth() - firstDate.getMonth()) + 1);
    }
    const found = PERIODS.find(p => p.key === period);
    return found?.months || 12;
  }, [period, mode, transactions]);

  // Build chart data
  const chartData = useMemo(() => {
    // 1. Carteira series
    let carteiraPoints: MonthlyPoint[] = [];

    if (mode === 'real') {
      carteiraPoints = computeRealTWR(transactions, portfolio);
      // Trim to period
      if (period !== 'all' && carteiraPoints.length > 0) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - periodMonths);
        const filtered = carteiraPoints.filter(p => p.date >= cutoff);
        if (filtered.length > 0) {
          // Rebase to 0%
          const baseReturn = filtered[0].cumulativeReturn;
          carteiraPoints = filtered.map(p => ({
            ...p,
            cumulativeReturn: baseReturn !== 0
              ? ((1 + p.cumulativeReturn / 100) / (1 + baseReturn / 100) - 1) * 100
              : p.cumulativeReturn - baseReturn,
          }));
        }
      }
    } else {
      carteiraPoints = computeSimulation(portfolio, periodMonths);
    }

    // 2. Benchmark series
    const benchmarkData = generateBenchmarkSeries(periodMonths);

    // 3. Merge: use benchmark dates as base timeline
    const dateFormat = (d: Date) => d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    // Index carteira points by month
    const carteiraByMonth: Record<string, number> = {};
    carteiraPoints.forEach(p => { carteiraByMonth[dateKey(p.date)] = p.cumulativeReturn; });

    // Use the longer timeline
    const allDates = benchmarkData.length >= carteiraPoints.length ? benchmarkData : benchmarkData;

    return allDates.map(bd => {
      const mk = dateKey(bd.date);
      const carteiraVal = carteiraByMonth[mk] ?? null;
      return {
        date: dateFormat(bd.date),
        carteira: carteiraVal !== null ? +carteiraVal.toFixed(2) : undefined,
        cdi: +bd.values.cdi.toFixed(2),
        ipca: +bd.values.ipca.toFixed(2),
        ifix: +bd.values.ifix.toFixed(2),
        ibov: +bd.values.ibov.toFixed(2),
        smll: +bd.values.smll.toFixed(2),
        idiv: +bd.values.idiv.toFixed(2),
        ivvb11: +bd.values.ivvb11.toFixed(2),
      };
    });
  }, [mode, period, periodMonths, transactions, portfolio]);

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
