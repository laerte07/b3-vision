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
  TrendingUp, ChevronDown, Check, RotateCcw, Layers, Flame, Globe, BarChart3, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useContributions } from '@/hooks/useContributions';
import { formatPct } from '@/lib/format';

// ─── Series definitions ─────────────────────────────────────
type SeriesKey = 'carteira' | 'cdi' | 'ipca' | 'ifix' | 'ibov' | 'smll' | 'idiv' | 'ivvb11';

interface SeriesDef {
  key: SeriesKey;
  label: string;
  color: string;
}

const ALL_SERIES: SeriesDef[] = [
  { key: 'carteira', label: 'Carteira', color: 'hsl(43, 85%, 55%)' },
  { key: 'cdi', label: 'CDI', color: 'hsl(200, 80%, 55%)' },
  { key: 'ipca', label: 'IPCA', color: 'hsl(30, 90%, 55%)' },
  { key: 'ifix', label: 'IFIX', color: 'hsl(142, 70%, 45%)' },
  { key: 'ibov', label: 'IBOV', color: 'hsl(280, 70%, 60%)' },
  { key: 'smll', label: 'SMLL', color: 'hsl(340, 65%, 55%)' },
  { key: 'idiv', label: 'IDIV', color: 'hsl(180, 60%, 45%)' },
  { key: 'ivvb11', label: 'IVVB11', color: 'hsl(60, 70%, 50%)' },
];

const DEFAULT_VISIBLE: SeriesKey[] = ['carteira', 'cdi'];

const PRESETS: { label: string; icon: React.ReactNode; keys: SeriesKey[] }[] = [
  { label: 'Inflação', icon: <Flame className="h-3 w-3" />, keys: ['carteira', 'cdi', 'ipca'] },
  { label: 'Renda Variável BR', icon: <BarChart3 className="h-3 w-3" />, keys: ['carteira', 'ibov', 'smll', 'ifix'] },
  { label: 'Dividendos', icon: <TrendingUp className="h-3 w-3" />, keys: ['carteira', 'idiv', 'ifix'] },
  { label: 'Internacional', icon: <Globe className="h-3 w-3" />, keys: ['carteira', 'ivvb11'] },
];

type PeriodKey = '6m' | '12m' | '24m' | 'all';
const PERIODS: { key: PeriodKey; label: string; months: number }[] = [
  { key: '6m', label: '6 meses', months: 6 },
  { key: '12m', label: '12 meses', months: 12 },
  { key: '24m', label: '24 meses', months: 24 },
  { key: 'all', label: 'Desde o início', months: 60 },
];

const LS_KEY = 'fortuna:rentabilidade:series';

function loadSavedSeries(): SeriesKey[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SeriesKey[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_VISIBLE;
}
function saveSeries(keys: SeriesKey[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(keys));
}

// ─── Mock benchmark data generator ──────────────────────────
// Generates monthly cumulative returns for demonstration.
// In production, this would come from an API or edge function.
function generateMockSeries(months: number): Record<string, { date: string; values: Record<SeriesKey, number> }[]> {
  // Monthly returns (annualized approx): CDI ~13.25%, IPCA ~4.5%, IBOV ~12%, IFIX ~10%, SMLL ~8%, IDIV ~14%, IVVB11 ~20%, Carteira ~17%
  const monthlyRates: Record<SeriesKey, { mean: number; vol: number }> = {
    carteira: { mean: 0.0132, vol: 0.025 },
    cdi: { mean: 0.0104, vol: 0.0005 },
    ipca: { mean: 0.0037, vol: 0.002 },
    ifix: { mean: 0.0080, vol: 0.018 },
    ibov: { mean: 0.0095, vol: 0.035 },
    smll: { mean: 0.0065, vol: 0.04 },
    idiv: { mean: 0.0110, vol: 0.028 },
    ivvb11: { mean: 0.0153, vol: 0.04 },
  };

  // Seed-based pseudo-random for consistency
  let seed = 42;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const randNorm = () => { const u1 = rand(); const u2 = rand(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); };

  const now = new Date();
  const data: { date: string; values: Record<SeriesKey, number> }[] = [];
  const cumulative: Record<SeriesKey, number> = {} as any;
  for (const k of ALL_SERIES) cumulative[k.key] = 0;

  for (let i = months; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const dateStr = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });

    if (i === months) {
      // Starting point = 0%
      data.push({ date: dateStr, values: { ...cumulative } });
      continue;
    }

    for (const s of ALL_SERIES) {
      const { mean, vol } = monthlyRates[s.key];
      const monthReturn = mean + vol * randNorm();
      cumulative[s.key] = (1 + cumulative[s.key] / 100) * (1 + monthReturn) * 100 - 100;
    }
    data.push({ date: dateStr, values: { ...cumulative } });
  }

  return { data } as any;
}

// ─── Component ──────────────────────────────────────────────
const Rentabilidade = () => {
  const [visibleSeries, setVisibleSeries] = useState<SeriesKey[]>(loadSavedSeries);
  const [period, setPeriod] = useState<PeriodKey>('12m');
  const [hoveredSeries, setHoveredSeries] = useState<SeriesKey | null>(null);

  useEffect(() => { saveSeries(visibleSeries); }, [visibleSeries]);

  const periodMonths = PERIODS.find(p => p.key === period)?.months ?? 12;

  const chartData = useMemo(() => {
    const raw = generateMockSeries(periodMonths) as any;
    // Flatten for Recharts
    return (raw.data as { date: string; values: Record<SeriesKey, number> }[]).map(d => ({
      date: d.date,
      ...d.values,
    }));
  }, [periodMonths]);

  const toggleSeries = useCallback((key: SeriesKey) => {
    setVisibleSeries(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      return next.length === 0 ? [key] : next; // keep at least one
    });
  }, []);

  const selectAll = () => setVisibleSeries(ALL_SERIES.map(s => s.key));
  const clearSelection = () => setVisibleSeries(['carteira']);
  const applyPreset = (keys: SeriesKey[]) => setVisibleSeries(keys);

  // Performance summary from last data point
  const lastPoint = chartData[chartData.length - 1];
  const carteiraReturn = lastPoint?.carteira ?? 0;

  const summaryRows = useMemo(() => {
    if (!lastPoint) return [];
    return ALL_SERIES
      .filter(s => visibleSeries.includes(s.key))
      .map(s => {
        const ret = (lastPoint as any)[s.key] as number;
        const diff = s.key === 'carteira' ? null : ret - carteiraReturn;
        // Rough annualized (compound): (1+r/100)^(12/months) - 1
        const annualized = periodMonths > 0 ? (Math.pow(1 + ret / 100, 12 / periodMonths) - 1) * 100 : ret;
        return { ...s, ret, annualized, diff };
      });
  }, [lastPoint, visibleSeries, carteiraReturn, periodMonths]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-popover p-3 shadow-xl text-sm">
        <p className="text-muted-foreground text-xs font-medium mb-2">{label}</p>
        <div className="space-y-1">
          {payload
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

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Period selector */}
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 bg-muted/30">
          {PERIODS.map(p => (
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
                  <Checkbox
                    checked={visibleSeries.includes(s.key)}
                    onCheckedChange={() => toggleSeries(s.key)}
                  />
                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-sm">{s.label}</span>
                </label>
              ))}
            </div>
            <div className="p-3 border-t border-border">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Presets rápidos</p>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map(pr => (
                  <Button
                    key={pr.label}
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] gap-1 px-2"
                    onClick={() => applyPreset(pr.keys)}
                  >
                    {pr.icon}
                    {pr.label}
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

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Rentabilidade Acumulada (%)
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
                    strokeDasharray={s.key === 'carteira' ? undefined : undefined}
                  />
                ))}
                <Legend
                  content={({ payload }) => (
                    <div className="flex flex-wrap justify-center gap-3 mt-3">
                      {payload?.map((entry: any) => {
                        const def = ALL_SERIES.find(s => s.key === entry.dataKey);
                        if (!def) return null;
                        const isActive = visibleSeries.includes(def.key);
                        return (
                          <button
                            key={def.key}
                            className={`flex items-center gap-1.5 text-xs transition-all cursor-pointer hover:opacity-100 ${
                              isActive ? 'opacity-100' : 'opacity-40'
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
          <CardTitle className="text-base">Resumo de Performance</CardTitle>
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
