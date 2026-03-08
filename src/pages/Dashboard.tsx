import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  BarChart3,
  PieChart as PieIcon,
  RefreshCw,
  AlertTriangle,
  Target,
  ShieldAlert,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend,
} from 'recharts';
import { usePortfolio, useRefreshMarket, PortfolioAsset } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useClassTargets } from '@/hooks/useClassTargets';
import { useContributions } from '@/hooks/useContributions';
import { useTransactions, Transaction } from '@/hooks/useTransactions';
import { useBenchmarkHistory, BenchmarkPoint } from '@/hooks/useBenchmarkHistory';
import { formatBRL, formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ─── Animation variants ─────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.06, duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] },
  }),
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

// ─── Chart colors ───────────────────────────────────────────
const CHART_COLORS = [
  'hsl(239, 84%, 67%)',
  'hsl(199, 89%, 48%)',
  'hsl(142, 71%, 45%)',
  'hsl(270, 67%, 62%)',
  'hsl(0, 84%, 60%)',
  'hsl(38, 92%, 50%)',
];

const PERF_SERIES = [
  { key: 'carteira', label: 'Carteira', color: 'hsl(var(--primary))' },
  { key: 'cdi', label: 'CDI', color: 'hsl(199, 89%, 48%)' },
  { key: 'ibov', label: 'IBOV', color: 'hsl(270, 67%, 62%)' },
] as const;

// ─── Helpers ────────────────────────────────────────────────
function toDateStr(d: Date): string { return d.toISOString().slice(0, 10); }

function buildDailyTimeline(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const cur = new Date(start); cur.setHours(0, 0, 0, 0);
  const endN = new Date(end); endN.setHours(0, 0, 0, 0);
  while (cur <= endN) { dates.push(toDateStr(cur)); cur.setDate(cur.getDate() + 1); }
  return dates;
}

function normalizeBenchmarks(
  data: BenchmarkPoint[], startStr: string,
): Record<string, Record<string, number>> {
  const grouped: Record<string, BenchmarkPoint[]> = {};
  for (const p of data) {
    if (!grouped[p.benchmark_code]) grouped[p.benchmark_code] = [];
    grouped[p.benchmark_code].push(p);
  }
  const result: Record<string, Record<string, number>> = {};
  for (const [code, points] of Object.entries(grouped)) {
    let base: number | null = null;
    for (const p of points) { if (p.date <= startStr) base = p.value; else break; }
    if (base === null && points.length > 0) base = points[0].value;
    if (!base || base === 0) continue;
    const daily: Record<string, number> = {};
    for (const p of points) {
      if (p.date < startStr) continue;
      daily[p.date] = ((p.value / base) - 1) * 100;
    }
    result[code] = daily;
  }
  return result;
}

const BENCHMARK_MAP: Record<string, string> = { CDI: 'cdi', IBOV: 'ibov' };

// ─── Dashboard ──────────────────────────────────────────────
const Dashboard = () => {
  const { data: portfolio = [], isLoading } = usePortfolio();
  const { data: classes = [] } = useAssetClasses();
  const { data: targets = [] } = useClassTargets();
  const refreshMarket = useRefreshMarket();
  const { data: contributions = [] } = useContributions();
  const { data: transactions = [] } = useTransactions();

  // Performance chart: last 12 months
  const startDate = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - 12); return d; }, []);
  const { data: benchmarkData = [] } = useBenchmarkHistory(['CDI', 'IBOV'], startDate);

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const monthContribTotal = contributions
    .filter(c => { const d = new Date(c.contribution_date); return d.getMonth() === currentMonth && d.getFullYear() === currentYear; })
    .reduce((s, c) => s + c.total_amount, 0);
  const yearContribTotal = contributions
    .filter(c => new Date(c.contribution_date).getFullYear() === currentYear)
    .reduce((s, c) => s + c.total_amount, 0);
  const yearContribCount = contributions.filter(c => new Date(c.contribution_date).getFullYear() === currentYear).length;
  const avgMonthlyContrib = yearContribCount > 0 ? yearContribTotal / Math.max(1, currentMonth + 1) : 0;

  const classValues = classes
    .map((cls) => {
      const positions = portfolio.filter((p) => p.class_id === cls.id);
      const total = positions.reduce((sum, p) => sum + p.quantity * (p.last_price ?? p.avg_price), 0);
      const div12m = positions.reduce((sum, p) => sum + p.quantity * (p.div_12m ?? 0), 0);
      const weightedDySum = positions.reduce((sum, p) => {
        const price = p.last_price ?? p.avg_price;
        const value = p.quantity * price;
        return sum + value * (p.effective_dy ?? 0);
      }, 0);
      return { ...cls, total, div12m, weightedDySum, positions };
    })
    .filter((c) => c.total > 0);

  const totalPatrimony = classValues.reduce((s, c) => s + c.total, 0);
  const totalDiv12m = classValues.reduce((s, c) => s + c.div12m, 0);
  const totalWeightedDy = classValues.reduce((s, c) => s + c.weightedDySum, 0);
  const avgDY = totalPatrimony > 0 ? totalWeightedDy / totalPatrimony : 0;
  const totalAssets = portfolio.length;

  const assetValues = portfolio
    .map((p) => {
      const price = p.last_price ?? p.avg_price;
      const currentValue = p.quantity * price;
      const pctPortfolio = totalPatrimony > 0 ? (currentValue / totalPatrimony) * 100 : 0;
      const pnlPct = p.avg_price > 0 ? ((price - p.avg_price) / p.avg_price) * 100 : 0;
      return { ...p, currentValue, pctPortfolio, pnlPct };
    })
    .sort((a, b) => b.currentValue - a.currentValue);

  const topAsset = assetValues[0];
  const topAssetPct = topAsset?.pctPortfolio ?? 0;

  const classAllocations = classValues
    .map((c) => ({
      name: c.name,
      pct: totalPatrimony > 0 ? (c.total / totalPatrimony) * 100 : 0,
      id: c.id,
      slug: (c as any).slug,
      value: c.total,
    }))
    .sort((a, b) => b.pct - a.pct);

  const topClassPct = classAllocations[0]?.pct ?? 0;

  const biggestGain = assetValues.reduce(
    (best, a) => (a.pnlPct > best.pnlPct ? a : best),
    assetValues[0] || ({ ticker: '-', pnlPct: 0 } as any)
  );
  const biggestLoss = assetValues.reduce(
    (worst, a) => (a.pnlPct < worst.pnlPct ? a : worst),
    assetValues[0] || ({ ticker: '-', pnlPct: 0 } as any)
  );

  // Alerts
  const aboveBand: string[] = [];
  const belowBand: string[] = [];
  classValues.forEach((cv: any) => {
    const target = targets.find((t) => t.class_id === cv.id);
    if (target && totalPatrimony > 0) {
      const pct = (cv.total / totalPatrimony) * 100;
      if (pct > target.upper_band) aboveBand.push(cv.name);
      if (pct < target.lower_band) belowBand.push(cv.name);
    }
  });
  const concentrationRisk = assetValues.filter((a) => a.pctPortfolio > 15);
  const top3Pct = assetValues.slice(0, 3).reduce((s, a) => s + a.pctPortfolio, 0);

  const problems: { text: string; type: 'warning' | 'danger' | 'info' }[] = [];
  aboveBand.forEach((n) => problems.push({ text: `${n} acima da banda superior`, type: 'warning' }));
  belowBand.forEach((n) => problems.push({ text: `${n} abaixo da banda inferior`, type: 'warning' }));
  const hasEtfs = classAllocations.some((c) => c.slug === 'etfs');
  const hasRendaFixa = classAllocations.some((c) => c.slug === 'renda-fixa');
  if (!hasEtfs) problems.push({ text: 'Nenhuma exposição a ETFs internacionais', type: 'info' });
  if (!hasRendaFixa) problems.push({ text: 'Exposição zero a Renda Fixa', type: 'info' });
  if (concentrationRisk.length > 0) problems.push({ text: `${concentrationRisk.length} ativo(s) com mais de 15% da carteira`, type: 'danger' });
  if (top3Pct > 50) problems.push({ text: `Top 3 ativos = ${top3Pct.toFixed(0)}% da carteira`, type: 'danger' });

  const pieData = classValues.map((c: any) => ({
    name: c.name,
    value: c.total,
    pct: totalPatrimony > 0 ? (c.total / totalPatrimony) * 100 : 0,
  }));

  const insights = [
    { icon: Target, label: 'Maior Posição', value: topAsset?.ticker || '-', detail: topAsset ? `${topAssetPct.toFixed(1)}%` : '', color: 'text-chart-2' },
    { icon: TrendingUp, label: 'Melhor Ativo', value: biggestGain?.ticker || '-', detail: biggestGain ? `${biggestGain.pnlPct > 0 ? '+' : ''}${biggestGain.pnlPct.toFixed(1)}%` : '', color: 'text-positive' },
    { icon: TrendingDown, label: 'Pior Ativo', value: biggestLoss?.ticker || '-', detail: biggestLoss ? `${biggestLoss.pnlPct.toFixed(1)}%` : '', color: 'text-negative' },
    { icon: PieIcon, label: 'Classe Dominante', value: classAllocations[0]?.name || '-', detail: classAllocations[0] ? `${topClassPct.toFixed(1)}%` : '', color: 'text-chart-4' },
  ];

  // ─── Build performance chart data ─────────────────────────
  const perfChartData = useMemo(() => {
    const startStr = toDateStr(startDate);
    const endStr = toDateStr(new Date());
    const timeline = buildDailyTimeline(startDate, new Date());
    if (timeline.length === 0) return [];

    const benchNorm = normalizeBenchmarks(benchmarkData, startStr);

    // Build simplified portfolio return using simulation approach
    const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
    const currentPriceMap: Record<string, number> = {};
    portfolio.forEach(a => { if (a.last_price != null) currentPriceMap[a.id] = a.last_price; });

    // Compute portfolio simulation return (single value, then interpolate linearly for now)
    const activeAssets = portfolio.filter(a => a.quantity > 0 && a.last_price != null);
    const totalVal = activeAssets.reduce((sum, a) => sum + a.quantity * (a.last_price ?? a.avg_price), 0);
    let portfolioReturnPct = 0;
    if (totalVal > 0) {
      for (const asset of activeAssets) {
        const weight = (asset.quantity * (asset.last_price ?? asset.avg_price)) / totalVal;
        const currentPrice = asset.last_price!;
        const assetTxs = sorted.filter(t => t.asset_id === asset.id);
        let startPrice: number | null = null;
        for (const t of assetTxs) {
          if (t.date <= startStr) startPrice = t.price; else break;
        }
        if (startPrice === null) {
          const firstAfter = assetTxs.find(t => t.date > startStr);
          if (firstAfter) startPrice = firstAfter.price;
        }
        if (!startPrice || startPrice <= 0) startPrice = asset.avg_price;
        if (startPrice <= 0) continue;
        portfolioReturnPct += weight * ((currentPrice / startPrice) - 1) * 100;
      }
    }

    // Sample ~90 points for smooth chart
    const step = Math.max(1, Math.floor(timeline.length / 90));
    const sampled = timeline.filter((_, i) => i % step === 0 || i === timeline.length - 1);

    return sampled.map((date, idx) => {
      const progress = sampled.length > 1 ? idx / (sampled.length - 1) : 1;
      const entry: Record<string, any> = {
        date,
        label: date.slice(5).replace('-', '/'),
        carteira: +(portfolioReturnPct * progress).toFixed(2),
      };
      // Add benchmarks
      for (const [code, daily] of Object.entries(benchNorm)) {
        const seriesKey = BENCHMARK_MAP[code];
        if (!seriesKey) continue;
        // Find closest date
        let val = daily[date];
        if (val === undefined) {
          // Use last known value
          const dates = Object.keys(daily).sort();
          const closest = dates.filter(d => d <= date).pop();
          val = closest ? daily[closest] : 0;
        }
        entry[seriesKey] = +val.toFixed(2);
      }
      return entry;
    });
  }, [benchmarkData, portfolio, transactions, startDate]);

  // ─── Render ───────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-3"
        >
          <Activity className="h-5 w-5 text-primary animate-pulse" />
          <span className="text-sm text-muted-foreground">Carregando portfólio...</span>
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div
      className="space-y-6"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      {/* Header */}
      <motion.div variants={fadeUp} custom={0} className="flex items-end justify-between">
        <div>
          <p className="kpi-label mb-1">Visão Geral</p>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-xs h-8"
          onClick={() => refreshMarket.mutate()}
          disabled={refreshMarket.isPending}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshMarket.isPending && 'animate-spin')} />
          Atualizar
        </Button>
      </motion.div>

      {/* KPIs */}
      <motion.div variants={fadeUp} custom={1} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Patrimônio Total', value: formatBRL(totalPatrimony), sub: `${totalAssets} ativos`, accent: true, glow: true },
          { label: 'Proventos 12m', value: formatBRL(totalDiv12m), sub: `~${formatBRL(totalDiv12m / 12)}/mês` },
          { label: 'Dividend Yield', value: formatPct(avgDY), sub: 'média ponderada' },
          { label: 'Aporte no Mês', value: formatBRL(monthContribTotal), sub: `média: ${formatBRL(avgMonthlyContrib)}/mês`, accent: true },
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            whileHover={{ y: -2, transition: { duration: 0.2 } }}
            className={cn('glass-card p-5', kpi.glow && 'glow-primary', i === 0 && 'col-span-2 lg:col-span-1')}
          >
            <p className="kpi-label">{kpi.label}</p>
            <p className={cn('text-xl font-semibold tracking-tight font-mono mt-2', kpi.accent && 'text-primary')}>
              {kpi.value}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{kpi.sub}</p>
          </motion.div>
        ))}
      </motion.div>

      {/* Performance Chart */}
      <motion.div variants={fadeUp} custom={2} className="glass-card overflow-hidden">
        <div className="p-5 pb-0 flex items-center justify-between">
          <div>
            <h2 className="section-title">Performance 12 meses</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Carteira vs benchmarks</p>
          </div>
          <div className="flex items-center gap-3">
            {PERF_SERIES.map(s => (
              <div key={s.key} className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-[11px] text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-5 pt-3">
          {perfChartData.length > 2 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={perfChartData} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="gradCarteira" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradCdi" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  strokeOpacity={0.3}
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  width={45}
                />
                <RTooltip
                  contentStyle={{
                    backgroundColor: 'hsl(222 41% 8%)',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    color: 'hsl(var(--foreground))',
                    fontSize: '12px',
                    boxShadow: '0 8px 32px -4px rgba(0,0,0,0.6)',
                    padding: '10px 14px',
                  }}
                  formatter={(value: number, name: string) => [
                    `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`,
                    PERF_SERIES.find(s => s.key === name)?.label || name,
                  ]}
                  labelFormatter={(label) => label}
                />
                <Area
                  type="monotone"
                  dataKey="carteira"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#gradCarteira)"
                  dot={false}
                  animationDuration={1200}
                  animationEasing="ease-out"
                />
                <Area
                  type="monotone"
                  dataKey="cdi"
                  stroke="hsl(199, 89%, 48%)"
                  strokeWidth={1.5}
                  fill="url(#gradCdi)"
                  dot={false}
                  strokeDasharray="4 4"
                  animationDuration={1200}
                  animationEasing="ease-out"
                />
                <Area
                  type="monotone"
                  dataKey="ibov"
                  stroke="hsl(270, 67%, 62%)"
                  strokeWidth={1.5}
                  fill="none"
                  dot={false}
                  strokeDasharray="4 4"
                  animationDuration={1200}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
              Sem dados suficientes para o gráfico de performance.
            </div>
          )}
        </div>
      </motion.div>

      {/* Smart Insights */}
      <motion.div variants={fadeUp} custom={3}>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <h2 className="section-title">Insights</h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {insights.map((ins, i) => (
            <motion.div
              key={ins.label}
              whileHover={{ y: -2, transition: { duration: 0.2 } }}
              className="insight-card"
            >
              <div className="flex items-center gap-2 mb-2">
                <ins.icon className={cn('h-3.5 w-3.5', ins.color)} />
                <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{ins.label}</span>
              </div>
              <p className="text-sm font-semibold font-mono">{ins.value}</p>
              <p className={cn('text-xs font-mono mt-0.5', ins.color)}>{ins.detail}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Main grid: Allocation + Sidebar */}
      <motion.div variants={fadeUp} custom={4} className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Allocation Donut */}
        <div className="lg:col-span-3 glass-card overflow-hidden">
          <div className="p-5 pb-0">
            <h2 className="section-title">Alocação por Classe</h2>
          </div>
          <div className="p-5">
            {pieData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">Cadastre ativos na Carteira para ver a alocação.</p>
            ) : (
              <div className="flex items-center gap-6">
                <div className="h-52 w-52 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" strokeWidth={2} stroke="hsl(var(--background))">
                        {pieData.map((_, i) => (<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) => formatBRL(value)}
                        contentStyle={{
                          backgroundColor: 'hsl(222 41% 8%)',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '6px',
                          color: 'hsl(var(--foreground))',
                          fontSize: '12px',
                          boxShadow: '0 8px 32px -4px rgba(0,0,0,0.5)',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-1.5">
                  {pieData.map((item, i) => (
                    <div key={item.name} className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="text-sm text-muted-foreground">{item.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono font-medium">{item.pct.toFixed(1)}%</span>
                        <span className="text-xs font-mono text-muted-foreground">{formatBRL(item.value)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-4">
          <motion.div whileHover={{ y: -2, transition: { duration: 0.2 } }} className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="h-3.5 w-3.5 text-primary" />
              <h2 className="section-title">Renda Passiva</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: '12 Meses', value: formatBRL(totalDiv12m) },
                { label: 'Mensal Médio', value: formatBRL(totalDiv12m / 12) },
                { label: 'Yield Médio', value: formatPct(avgDY), accent: true },
                { label: 'Nº de Ativos', value: String(totalAssets) },
              ].map(s => (
                <div key={s.label} className="stat-block">
                  <p className="kpi-label">{s.label}</p>
                  <p className={cn('text-base font-semibold font-mono mt-1', s.accent && 'text-primary')}>{s.value}</p>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div whileHover={{ y: -2, transition: { duration: 0.2 } }} className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-3.5 w-3.5 text-chart-2" />
              <h2 className="section-title">Aportes {currentYear}</h2>
            </div>
            <div className="space-y-2.5">
              {[
                { label: 'Mês atual', value: formatBRL(monthContribTotal), accent: true },
                { label: 'Acumulado no ano', value: formatBRL(yearContribTotal) },
                { label: 'Média mensal', value: formatBRL(avgMonthlyContrib) },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{row.label}</span>
                  <span className={cn('text-sm font-mono font-medium', row.accent && 'text-primary')}>{row.value}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Alerts */}
      {problems.length > 0 && (
        <motion.div variants={fadeUp} custom={5}>
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="h-3.5 w-3.5 text-negative" />
            <h2 className="section-title">Alertas</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {problems.map((problem, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.05 }}
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                  problem.type === 'danger'
                    ? 'bg-negative/[0.04] border-negative/10'
                    : problem.type === 'warning'
                    ? 'bg-warning/[0.04] border-warning/10'
                    : 'bg-chart-2/[0.04] border-chart-2/10'
                )}
              >
                <AlertTriangle className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', problem.type === 'danger' ? 'text-negative' : problem.type === 'warning' ? 'text-warning' : 'text-chart-2')} />
                <span className="text-sm">{problem.text}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Top Assets */}
      {assetValues.length > 0 && (
        <motion.div variants={fadeUp} custom={6}>
          <h2 className="section-title mb-3">Top Ativos</h2>
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="text-left py-3 px-4 kpi-label">Ativo</th>
                    <th className="text-right py-3 px-4 kpi-label">Valor</th>
                    <th className="text-right py-3 px-4 kpi-label">% Carteira</th>
                    <th className="text-right py-3 px-4 kpi-label">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {assetValues.slice(0, 8).map((asset) => (
                    <tr key={asset.ticker} className="data-row">
                      <td className="py-2.5 px-4">
                        <span className="font-mono font-medium text-foreground">{asset.ticker}</span>
                        {asset.name && <span className="text-xs text-muted-foreground ml-2">{asset.name}</span>}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-sm">{formatBRL(asset.currentValue)}</td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-14 h-1 rounded-full bg-border/50 overflow-hidden">
                            <div className="h-full rounded-full bg-primary/50" style={{ width: `${Math.min(asset.pctPortfolio, 100)}%` }} />
                          </div>
                          <span className="font-mono text-xs w-10 text-right">{asset.pctPortfolio.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <span className={cn('inline-flex items-center gap-1 font-mono text-xs font-medium', asset.pnlPct >= 0 ? 'text-positive' : 'text-negative')}>
                          {asset.pnlPct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                          {asset.pnlPct >= 0 ? '+' : ''}{asset.pnlPct.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};

export default Dashboard;
