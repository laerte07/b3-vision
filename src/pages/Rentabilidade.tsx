import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { fadeUp, stagger } from '@/lib/motion-variants';
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
  ArrowUpRight, ArrowDownRight, Activity, PlayCircle, Info, RefreshCw, Globe,
} from 'lucide-react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useTransactions } from '@/hooks/useTransactions';
import { useBenchmarkHistory } from '@/hooks/useBenchmarkHistory';
import {
  ALL_SERIES, SERIES_TO_BENCHMARK, BENCHMARK_TO_SERIES,
  getPeriodStartDate, getPeriodMonths, buildUnifiedData,
  type SeriesKey, type SeriesDef, type PeriodKey, type Mode,
} from '@/lib/return-engine';

// ─── Local config ───────────────────────────────────────────
const DEFAULT_VISIBLE: SeriesKey[] = ['carteira', 'cdi'];

const PRESETS: { label: string; icon: React.ReactNode; keys: SeriesKey[] }[] = [
  { label: 'Inflação', icon: <Flame className="h-3 w-3" />, keys: ['carteira', 'cdi', 'ipca'] },
  { label: 'Renda Variável', icon: <BarChart3 className="h-3 w-3" />, keys: ['carteira', 'ibov'] },
  { label: 'Internacional', icon: <Globe className="h-3 w-3" />, keys: ['carteira', 'sp500', 'ibov'] },
];

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'mtd', label: 'Mês atual' },
  { key: '6m', label: '6 meses' },
  { key: '12m', label: '12 meses' },
  { key: '24m', label: '2 anos' },
  { key: '60m', label: '5 anos' },
  { key: 'all', label: 'Desde o início' },
];

const LS_KEY = 'fortuna:rentabilidade:series';
const LS_MODE_KEY = 'fortuna:rentabilidade:mode';

function loadSavedSeries(): SeriesKey[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as SeriesKey[];
      // Filter out removed series like 'ifix'
      const valid = p.filter(k => ALL_SERIES.some(s => s.key === k));
      if (valid.length > 0) return valid;
    }
  } catch { /* ignore */ }
  return DEFAULT_VISIBLE;
}
function saveSeries(keys: SeriesKey[]) { localStorage.setItem(LS_KEY, JSON.stringify(keys)); }
function loadMode(): Mode {
  try { const v = localStorage.getItem(LS_MODE_KEY); if (v === 'real' || v === 'simulacao') return v; } catch {}
  return 'real';
}
function saveMode(m: Mode) { localStorage.setItem(LS_MODE_KEY, m); }

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

  // Benchmark codes to fetch (always include CDI as reference)
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
  // Real mode has data if there are transactions OR positions with prices
  const hasRealData = transactions.length > 0 || portfolio.some(a => a.quantity > 0 && a.last_price != null);
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

  const modeInfoText = useMemo(() => {
    if (mode === 'real') {
      if (transactions.length > 0) {
        return `Modo Real — baseado em ${transactions.length} lançamentos (TWR)`;
      }
      if (hasRealData) {
        return `Modo Real — calculado com preço médio × preço atual (sem lançamentos individuais)`;
      }
      return 'Modo Real — nenhum ativo com posição encontrado. Registre aportes para ver a rentabilidade real.';
    }
    return 'Modo Simulação — composição atual simulada no período histórico selecionado';
  }, [mode, transactions.length, hasRealData]);

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
    <motion.div className="space-y-6" initial="hidden" animate="visible" variants={stagger}>
      <motion.div variants={fadeUp} custom={0}>
        <p className="kpi-label mb-1">Performance</p>
        <h1 className="text-xl font-semibold tracking-tight">Rentabilidade</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Compare a performance da sua carteira com benchmarks</p>
      </motion.div>

      {/* Mode + Period + Series controls */}
      <motion.div variants={fadeUp} custom={1} className="flex flex-wrap items-center gap-3">
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
      </motion.div>

      {/* Mode info badge */}
      <div className="flex items-center gap-2">
        <div className={`inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border ${
          mode === 'real'
            ? 'border-primary/30 bg-primary/5 text-primary'
            : 'border-[hsl(var(--chart-2))]/30 bg-[hsl(var(--chart-2))]/5 text-[hsl(var(--chart-2))]'
        }`}>
          <Info className="h-3 w-3" />
          {modeInfoText}
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
            <h3 className="text-lg font-semibold mb-1">Nenhuma posição encontrada</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              No modo Real, a rentabilidade é calculada com base nas suas posições e operações.
              Adicione ativos à carteira ou registre aportes para começar.
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
    </motion.div>
  );
};

export default Rentabilidade;
