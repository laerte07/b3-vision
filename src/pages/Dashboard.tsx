import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fadeUp, stagger } from '@/lib/motion-variants';
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
  Banknote,
  ChevronDown,
  ChevronUp,
  Gem,
  Crosshair,
  Eye,
  Layers,
  Wallet,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  BarChart, Bar,
} from 'recharts';
import { usePortfolio, useRefreshMarket } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useClassTargets } from '@/hooks/useClassTargets';
import { useContributions } from '@/hooks/useContributions';
import { useTransactions } from '@/hooks/useTransactions';
import { useBenchmarkHistory } from '@/hooks/useBenchmarkHistory';
import { buildUnifiedData } from '@/lib/return-engine';
import { formatBRL, formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

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

// ─── Skeleton component ─────────────────────────────────────
const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn('animate-pulse rounded-md bg-muted/40', className)} />
);

// ─── KPI Card ───────────────────────────────────────────────
const KPICard = ({ label, value, sub, icon: Icon, accent, glow }: {
  label: string; value: string; sub: string; icon: React.ElementType; accent?: boolean; glow?: boolean;
}) => (
  <motion.div
    whileHover={{ y: -3, transition: { duration: 0.2, ease: 'easeOut' } }}
    className={cn(
      'relative overflow-hidden rounded-xl border border-border/40 bg-card/70 backdrop-blur-sm p-5 transition-all duration-300',
      'hover:border-border/70 hover:bg-card/90',
      glow && 'shadow-[0_0_40px_-12px_hsl(239_84%_67%/0.2)]'
    )}
  >
    <div className="absolute top-0 right-0 w-24 h-24 opacity-[0.03]">
      <Icon className="w-full h-full" />
    </div>
    <div className="flex items-center gap-2 mb-3">
      <div className={cn('p-1.5 rounded-lg', accent ? 'bg-primary/10' : 'bg-muted/50')}>
        <Icon className={cn('h-3.5 w-3.5', accent ? 'text-primary' : 'text-muted-foreground')} />
      </div>
      <p className="kpi-label">{label}</p>
    </div>
    <p className={cn('text-2xl font-bold tracking-tight font-mono', accent && 'text-primary')}>
      {value}
    </p>
    <p className="text-xs text-muted-foreground mt-1.5 font-medium">{sub}</p>
  </motion.div>
);

// ─── Dashboard ──────────────────────────────────────────────
const Dashboard = () => {
  const { data: portfolio = [], isLoading } = usePortfolio();
  const { data: classes = [] } = useAssetClasses();
  const { data: targets = [] } = useClassTargets();
  const refreshMarket = useRefreshMarket();
  const { data: contributions = [] } = useContributions();
  const { data: transactions = [] } = useTransactions();
  const [showAllAssets, setShowAllAssets] = useState(false);

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

  // Monthly contributions sparkline data (last 6 months)
  const monthlyContribData = useMemo(() => {
    const months: { label: string; value: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const m = d.getMonth();
      const y = d.getFullYear();
      const total = contributions
        .filter(c => { const cd = new Date(c.contribution_date); return cd.getMonth() === m && cd.getFullYear() === y; })
        .reduce((s, c) => s + c.total_amount, 0);
      months.push({
        label: d.toLocaleString('pt-BR', { month: 'short' }).replace('.', ''),
        value: total,
      });
    }
    return months;
  }, [contributions, currentMonth, currentYear]);

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
      const pnlBRL = p.quantity * (price - p.avg_price);
      return { ...p, currentValue, pctPortfolio, pnlPct, pnlBRL };
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

  // ─── Realized profit from sales ───────────────────────────
  const realizedProfit = useMemo(() => {
    const avgPriceMap = new Map<string, number>();
    portfolio.forEach(p => avgPriceMap.set(p.id, p.avg_price));
    const sells = transactions.filter(t => t.type === 'venda' || t.type === 'sell');
    let total = 0;
    sells.forEach(t => {
      const avgPrice = avgPriceMap.get(t.asset_id) ?? 0;
      const profit = (t.price - avgPrice) * t.quantity - (t.fees || 0);
      total += profit;
    });
    return total;
  }, [transactions, portfolio]);

  // PnL latente total
  const totalLatentPnL = assetValues.reduce((s, a) => s + a.pnlBRL, 0);
  const totalLatentPnLPct = totalPatrimony > 0 ? (totalLatentPnL / (totalPatrimony - totalLatentPnL)) * 100 : 0;

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

  const problems: { text: string; context: string; type: 'warning' | 'danger' | 'info'; priority: 'alta' | 'média' | 'baixa' }[] = [];
  aboveBand.forEach((n) => problems.push({ text: `${n} acima da banda superior`, context: 'Considere rebalancear para reduzir exposição', type: 'warning', priority: 'média' }));
  belowBand.forEach((n) => problems.push({ text: `${n} abaixo da banda inferior`, context: 'A classe está sub-alocada em relação à meta', type: 'warning', priority: 'média' }));
  const hasEtfs = classAllocations.some((c) => c.slug === 'etfs');
  const hasRendaFixa = classAllocations.some((c) => c.slug === 'renda-fixa');
  if (!hasEtfs) problems.push({ text: 'Nenhuma exposição a ETFs internacionais', context: 'Diversificação global pode reduzir risco', type: 'info', priority: 'baixa' });
  if (!hasRendaFixa) problems.push({ text: 'Exposição zero a Renda Fixa', context: 'Pode impactar estabilidade em momentos de crise', type: 'info', priority: 'baixa' });
  if (concentrationRisk.length > 0) problems.push({ text: `${concentrationRisk.length} ativo(s) com mais de 15% da carteira`, context: `Concentração elevada: ${concentrationRisk.map(a => a.ticker).join(', ')}`, type: 'danger', priority: 'alta' });
  if (top3Pct > 50) problems.push({ text: `Top 3 ativos = ${top3Pct.toFixed(0)}% da carteira`, context: 'Alta dependência de poucos ativos aumenta risco', type: 'danger', priority: 'alta' });

  const pieData = classValues.map((c: any) => ({
    name: c.name,
    value: c.total,
    pct: totalPatrimony > 0 ? (c.total / totalPatrimony) * 100 : 0,
  }));

  // Smart insights with context
  const insights = useMemo(() => {
    const items: { icon: React.ElementType; label: string; value: string; detail: string; context: string; color: string }[] = [];

    if (topAsset) {
      const concentrationLevel = topAssetPct > 20 ? 'Concentração elevada' : topAssetPct > 10 ? 'Posição relevante' : 'Posição equilibrada';
      items.push({ icon: Crosshair, label: 'Maior Posição', value: topAsset.ticker, detail: `${topAssetPct.toFixed(1)}% · ${formatBRL(topAsset.currentValue)}`, context: concentrationLevel, color: 'text-chart-2' });
    }

    if (biggestGain && biggestGain.pnlPct !== 0) {
      items.push({ icon: TrendingUp, label: 'Melhor Performance', value: biggestGain.ticker, detail: `+${biggestGain.pnlPct.toFixed(1)}%`, context: `Lucro latente: ${formatBRL(biggestGain.pnlBRL ?? 0)}`, color: 'text-positive' });
    }

    if (biggestLoss && biggestLoss.pnlPct !== 0) {
      items.push({ icon: TrendingDown, label: 'Pior Performance', value: biggestLoss.ticker, detail: `${biggestLoss.pnlPct.toFixed(1)}%`, context: `Prejuízo latente: ${formatBRL(biggestLoss.pnlBRL ?? 0)}`, color: 'text-negative' });
    }

    if (classAllocations.length > 0) {
      const dominant = classAllocations[0];
      items.push({ icon: Layers, label: 'Classe Dominante', value: dominant.name, detail: `${dominant.pct.toFixed(1)}% da carteira`, context: dominant.pct > 50 ? 'Alta concentração em uma classe' : 'Distribuição saudável', color: 'text-chart-4' });
    }

    items.push({
      icon: Banknote,
      label: 'Lucro Realizado',
      value: formatBRL(realizedProfit),
      detail: realizedProfit !== 0 ? 'resultado em vendas' : 'sem vendas registradas',
      context: realizedProfit > 0 ? 'Resultado positivo acumulado' : realizedProfit < 0 ? 'Resultado negativo acumulado' : '',
      color: realizedProfit >= 0 ? 'text-positive' : 'text-negative',
    });

    return items;
  }, [topAsset, topAssetPct, biggestGain, biggestLoss, classAllocations, realizedProfit]);

  // ─── Performance chart data ─
  const perfChartData = useMemo(() => {
    const { chartData } = buildUnifiedData('real', '12m', transactions, portfolio, benchmarkData);
    return chartData.map(pt => ({
      ...pt,
      label: pt.label || pt.dateStr.slice(5).replace('-', '/'),
    }));
  }, [benchmarkData, portfolio, transactions]);

  const displayedAssets = showAllAssets ? assetValues : assetValues.slice(0, 3);
  const hasMoreAssets = assetValues.length > 3;

  // ─── Loading state ────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <Skeleton className="h-3 w-20 mb-2" />
            <Skeleton className="h-6 w-32" />
          </div>
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border/40 bg-card/70 p-5">
              <Skeleton className="h-3 w-20 mb-4" />
              <Skeleton className="h-7 w-28 mb-2" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-border/40 bg-card/70 p-5">
          <Skeleton className="h-[340px] w-full rounded-lg" />
        </div>
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
      {/* ══ Header ══ */}
      <motion.div variants={fadeUp} custom={0} className="flex items-end justify-between">
        <div>
          <p className="kpi-label mb-1">Visão Geral</p>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-xs h-8 border-border/50 hover:border-primary/30 hover:bg-primary/5"
          onClick={() => refreshMarket.mutate()}
          disabled={refreshMarket.isPending}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshMarket.isPending && 'animate-spin')} />
          Atualizar
        </Button>
      </motion.div>

      {/* ══ KPIs ══ */}
      <motion.div variants={fadeUp} custom={1} className="grid grid-cols-2 lg:grid-cols-4 gap-3 2xl:gap-4">
        <KPICard icon={Wallet} label="Patrimônio Total" value={formatBRL(totalPatrimony)} sub={`${totalAssets} ativos em carteira`} accent glow />
        <KPICard icon={DollarSign} label="Proventos 12m" value={formatBRL(totalDiv12m)} sub={`~${formatBRL(totalDiv12m / 12)}/mês`} />
        <KPICard icon={Gem} label="Dividend Yield" value={formatPct(avgDY)} sub="média ponderada da carteira" />
        <KPICard icon={TrendingUp} label="P&L Latente" value={formatBRL(totalLatentPnL)} sub={`${totalLatentPnLPct >= 0 ? '+' : ''}${totalLatentPnLPct.toFixed(1)}% sobre custo`} accent={totalLatentPnL >= 0} />
      </motion.div>

      {/* ══ Performance Chart ══ */}
      <motion.div variants={fadeUp} custom={2} className="rounded-xl border border-border/40 bg-card/70 backdrop-blur-sm overflow-hidden">
        <div className="p-5 pb-0 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Performance 12 meses</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Retorno acumulado · Carteira vs Benchmarks</p>
          </div>
          <div className="flex items-center gap-4">
            {PERF_SERIES.map(s => (
              <div key={s.key} className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-[11px] text-muted-foreground font-medium">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-5 pt-3">
          {perfChartData.length > 2 ? (
            <ResponsiveContainer width="100%" height={340}>
              <AreaChart data={perfChartData} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="gradCarteira" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                    <stop offset="50%" stopColor="hsl(var(--primary))" stopOpacity={0.08} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.2} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={45} />
                <RTooltip
                  contentStyle={{
                    backgroundColor: 'hsl(222 41% 6%)',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '10px',
                    color: 'hsl(var(--foreground))',
                    fontSize: '12px',
                    boxShadow: '0 12px 48px -8px rgba(0,0,0,0.7)',
                    padding: '12px 16px',
                  }}
                  formatter={(value: number, name: string) => [
                    `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`,
                    PERF_SERIES.find(s => s.key === name)?.label || name,
                  ]}
                  labelFormatter={(label) => label}
                />
                <Area type="monotone" dataKey="carteira" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#gradCarteira)" dot={false} animationDuration={1200} animationEasing="ease-out" />
                <Area type="monotone" dataKey="cdi" stroke="hsl(199, 89%, 48%)" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="5 5" animationDuration={1200} />
                <Area type="monotone" dataKey="ibov" stroke="hsl(270, 67%, 62%)" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="5 5" animationDuration={1200} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
              Sem dados suficientes para o gráfico de performance.
            </div>
          )}
        </div>
      </motion.div>

      {/* ══ Smart Insights ══ */}
      <motion.div variants={fadeUp} custom={3}>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <h2 className="text-sm font-semibold tracking-tight">Insights Inteligentes</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {insights.map((ins) => (
            <motion.div
              key={ins.label}
              whileHover={{ y: -3, scale: 1.01, transition: { duration: 0.2 } }}
              className="group relative rounded-xl border border-border/30 bg-card/50 backdrop-blur-sm p-4 transition-all duration-300 hover:border-border/60 hover:bg-card/80 hover:shadow-[0_4px_32px_-8px_hsl(222_47%_3%/0.5)]"
            >
              <div className="flex items-center gap-2 mb-2.5">
                <div className="p-1 rounded-md bg-muted/40">
                  <ins.icon className={cn('h-3.5 w-3.5', ins.color)} />
                </div>
                <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.1em]">{ins.label}</span>
              </div>
              <p className="text-base font-bold font-mono tracking-tight">{ins.value}</p>
              <p className={cn('text-xs font-mono mt-0.5', ins.color)}>{ins.detail}</p>
              {ins.context && (
                <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity duration-300">{ins.context}</p>
              )}
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ══ STRATEGIC CORE: Allocation + Income + Contributions ══ */}
      <motion.div variants={fadeUp} custom={4} className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ── LEFT: Allocation & Risk ── */}
        <div className="lg:col-span-7 rounded-xl border border-border/40 bg-card/70 backdrop-blur-sm overflow-hidden">
          <div className="p-5 pb-0 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <PieIcon className="h-3.5 w-3.5 text-primary" />
              </div>
              <h2 className="text-sm font-semibold tracking-tight">Alocação & Risco</h2>
            </div>
            <span className="text-[11px] text-muted-foreground font-mono">{classAllocations.length} classes</span>
          </div>
          <div className="p-5">
            {pieData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">Cadastre ativos para ver a alocação.</p>
            ) : (
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <div className="relative h-52 w-52 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={58}
                        outerRadius={88}
                        dataKey="value"
                        strokeWidth={2}
                        stroke="hsl(var(--background))"
                        animationDuration={800}
                        animationEasing="ease-out"
                      >
                        {pieData.map((_, i) => (<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, name: string) => [formatBRL(value), name]}
                        contentStyle={{
                          backgroundColor: 'hsl(222 41% 6%)',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          color: 'hsl(var(--foreground))',
                          fontSize: '12px',
                          boxShadow: '0 8px 32px -4px rgba(0,0,0,0.6)',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Center text */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Total</span>
                    <span className="text-sm font-bold font-mono">{formatBRL(totalPatrimony)}</span>
                  </div>
                </div>
                <div className="flex-1 w-full space-y-0">
                  {classAllocations.map((item, i) => {
                    const target = targets.find(t => t.class_id === item.id);
                    const isAbove = target && item.pct > target.upper_band;
                    const isBelow = target && item.pct < target.lower_band;
                    return (
                      <div key={item.name} className="flex items-center gap-3 py-2.5 border-b border-border/10 last:border-0 group hover:bg-muted/5 rounded-lg px-2 -mx-2 transition-all duration-150">
                        <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="text-sm text-foreground/80 flex-1 truncate">{item.name}</span>
                        <div className="w-20 h-1.5 rounded-full bg-border/20 overflow-hidden hidden sm:block">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                            initial={{ width: 0 }}
                            animate={{ width: `${item.pct}%` }}
                            transition={{ duration: 0.8, delay: i * 0.1 }}
                          />
                        </div>
                        <span className={cn(
                          'text-sm font-mono font-semibold w-14 text-right',
                          isAbove && 'text-warning',
                          isBelow && 'text-chart-2',
                        )}>
                          {item.pct.toFixed(1)}%
                        </span>
                        <span className="text-xs font-mono text-muted-foreground w-24 text-right hidden md:block">{formatBRL(item.value)}</span>
                        {(isAbove || isBelow) && (
                          <div className={cn('h-1.5 w-1.5 rounded-full shrink-0', isAbove ? 'bg-warning' : 'bg-chart-2')} title={isAbove ? 'Acima da banda' : 'Abaixo da banda'} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Income + Contributions ── */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Renda Passiva */}
          <motion.div
            whileHover={{ y: -2, transition: { duration: 0.2 } }}
            className="rounded-xl border border-border/40 bg-card/70 backdrop-blur-sm p-5 flex-1"
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="p-1.5 rounded-lg bg-positive/10">
                <DollarSign className="h-3.5 w-3.5 text-positive" />
              </div>
              <h2 className="text-sm font-semibold tracking-tight">Renda Passiva</h2>
            </div>
            <div className="mb-4">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1">Últimos 12 meses</p>
              <p className="text-2xl font-bold font-mono text-positive tracking-tight">{formatBRL(totalDiv12m)}</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-muted/20 border border-border/20">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Mensal</p>
                <p className="text-sm font-semibold font-mono mt-1">{formatBRL(totalDiv12m / 12)}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/20 border border-border/20">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Yield</p>
                <p className="text-sm font-semibold font-mono mt-1 text-primary">{formatPct(avgDY)}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/20 border border-border/20">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Pagadores</p>
                <p className="text-sm font-semibold font-mono mt-1">{portfolio.filter(p => (p.effective_dy ?? 0) > 0).length}</p>
              </div>
            </div>
          </motion.div>

          {/* Aportes */}
          <motion.div
            whileHover={{ y: -2, transition: { duration: 0.2 } }}
            className="rounded-xl border border-border/40 bg-card/70 backdrop-blur-sm p-5 flex-1"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-chart-2/10">
                  <BarChart3 className="h-3.5 w-3.5 text-chart-2" />
                </div>
                <h2 className="text-sm font-semibold tracking-tight">Aportes {currentYear}</h2>
              </div>
              {monthContribTotal > avgMonthlyContrib && avgMonthlyContrib > 0 && (
                <span className="text-[10px] font-semibold text-positive bg-positive/10 px-2 py-0.5 rounded-full">
                  Acima da média
                </span>
              )}
              {monthContribTotal < avgMonthlyContrib && avgMonthlyContrib > 0 && monthContribTotal > 0 && (
                <span className="text-[10px] font-semibold text-warning bg-warning/10 px-2 py-0.5 rounded-full">
                  Abaixo da média
                </span>
              )}
            </div>
            {/* Month progress */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Mês atual</span>
                <span className="text-base font-bold font-mono text-primary">{formatBRL(monthContribTotal)}</span>
              </div>
              <div className="w-full h-2 rounded-full bg-border/20 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${avgMonthlyContrib > 0 ? Math.min((monthContribTotal / avgMonthlyContrib) * 100, 100) : 0}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </div>
              {avgMonthlyContrib > 0 && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  {((monthContribTotal / avgMonthlyContrib) * 100).toFixed(0)}% da média mensal
                </p>
              )}
            </div>
            {/* Sparkline */}
            <div className="h-16">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyContribData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Bar dataKey="value" fill="hsl(var(--primary))" opacity={0.4} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/20">
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">Acumulado</p>
                <p className="text-sm font-semibold font-mono">{formatBRL(yearContribTotal)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground font-medium">Média/mês</p>
                <p className="text-sm font-semibold font-mono">{formatBRL(avgMonthlyContrib)}</p>
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* ══ Alerts ══ */}
      {problems.length > 0 && (
        <motion.div variants={fadeUp} custom={5}>
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="h-3.5 w-3.5 text-negative" />
            <h2 className="text-sm font-semibold tracking-tight">Diagnóstico da Carteira</h2>
            <span className="text-[10px] text-muted-foreground ml-auto font-mono">{problems.length} alerta{problems.length > 1 ? 's' : ''}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {problems.sort((a, b) => {
              const order = { alta: 0, média: 1, baixa: 2 };
              return order[a.priority] - order[b.priority];
            }).map((problem, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.05 }}
                className={cn(
                  'flex items-start gap-3 p-4 rounded-xl border transition-all duration-200 hover:bg-card/50',
                  problem.type === 'danger'
                    ? 'bg-negative/[0.04] border-negative/10'
                    : problem.type === 'warning'
                    ? 'bg-warning/[0.04] border-warning/10'
                    : 'bg-chart-2/[0.04] border-chart-2/10'
                )}
              >
                <div className={cn(
                  'p-1 rounded-md mt-0.5 shrink-0',
                  problem.type === 'danger' ? 'bg-negative/10' : problem.type === 'warning' ? 'bg-warning/10' : 'bg-chart-2/10'
                )}>
                  <AlertTriangle className={cn('h-3 w-3', problem.type === 'danger' ? 'text-negative' : problem.type === 'warning' ? 'text-warning' : 'text-chart-2')} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{problem.text}</span>
                    <span className={cn(
                      'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0',
                      problem.priority === 'alta' ? 'bg-negative/10 text-negative' :
                      problem.priority === 'média' ? 'bg-warning/10 text-warning' :
                      'bg-chart-2/10 text-chart-2'
                    )}>
                      {problem.priority}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{problem.context}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ══ Top Assets ══ */}
      {assetValues.length > 0 && (
        <motion.div variants={fadeUp} custom={6}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Eye className="h-3.5 w-3.5 text-primary" />
              <h2 className="text-sm font-semibold tracking-tight">Top Ativos</h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-muted-foreground font-mono">{assetValues.length} ativos</span>
              {hasMoreAssets && (
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-xs h-7 text-primary hover:text-primary hover:bg-primary/5">
                      Ver todos
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="w-full sm:max-w-lg bg-background border-border/40">
                    <SheetHeader>
                      <SheetTitle className="text-lg font-semibold">Todos os Ativos</SheetTitle>
                    </SheetHeader>
                    <div className="mt-4 overflow-y-auto max-h-[calc(100vh-120px)]">
                      {assetValues.map((asset, i) => (
                        <div key={asset.ticker} className={cn('flex items-center gap-3 py-3 px-2 border-b border-border/20 last:border-0 hover:bg-muted/10 rounded-lg transition-colors')}>
                          <span className="text-xs text-muted-foreground font-mono w-5">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-mono font-semibold text-sm">{asset.ticker}</p>
                            {asset.name && <p className="text-xs text-muted-foreground truncate">{asset.name}</p>}
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-mono font-semibold">{formatBRL(asset.currentValue)}</p>
                            <p className="text-xs text-muted-foreground font-mono">{asset.pctPortfolio.toFixed(1)}%</p>
                          </div>
                          <span className={cn('text-xs font-mono font-semibold w-16 text-right', asset.pnlPct >= 0 ? 'text-positive' : 'text-negative')}>
                            {asset.pnlPct >= 0 ? '+' : ''}{asset.pnlPct.toFixed(1)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </SheetContent>
                </Sheet>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-border/40 bg-card/70 backdrop-blur-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="text-left py-3 px-4 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                    <th className="text-left py-3 px-4 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Ativo</th>
                    <th className="text-right py-3 px-4 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Valor</th>
                    <th className="text-right py-3 px-4 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Peso</th>
                    <th className="text-right py-3 px-4 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {displayedAssets.map((asset, idx) => (
                      <motion.tr
                        key={asset.ticker}
                        className="border-b border-border/15 last:border-0 hover:bg-muted/5 transition-colors duration-150"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2, delay: idx * 0.03 }}
                      >
                        <td className="py-3 px-4 text-xs text-muted-foreground font-mono">{idx + 1}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-foreground">{asset.ticker}</span>
                            {asset.name && <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[120px]">{asset.name}</span>}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-sm font-medium">{formatBRL(asset.currentValue)}</td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-border/20 overflow-hidden hidden sm:block">
                              <motion.div
                                className="h-full rounded-full bg-primary/50"
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(asset.pctPortfolio, 100)}%` }}
                                transition={{ duration: 0.6, delay: idx * 0.1 }}
                              />
                            </div>
                            <span className="font-mono text-xs font-medium w-12 text-right">{asset.pctPortfolio.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className={cn('inline-flex items-center gap-1 font-mono text-xs font-semibold', asset.pnlPct >= 0 ? 'text-positive' : 'text-negative')}>
                            {asset.pnlPct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {asset.pnlPct >= 0 ? '+' : ''}{asset.pnlPct.toFixed(1)}%
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
            {hasMoreAssets && !showAllAssets && (
              <div className="border-t border-border/15 px-4 py-2.5">
                <button
                  onClick={() => setShowAllAssets(true)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors mx-auto font-medium"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  Expandir ({assetValues.length - 3} ativos)
                </button>
              </div>
            )}
            {showAllAssets && (
              <div className="border-t border-border/15 px-4 py-2.5">
                <button
                  onClick={() => setShowAllAssets(false)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors mx-auto font-medium"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                  Recolher
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};

export default Dashboard;
