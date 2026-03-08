import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { usePortfolio, useRefreshMarket } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useClassTargets } from '@/hooks/useClassTargets';
import { useContributions } from '@/hooks/useContributions';
import { formatBRL, formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';

const CHART_COLORS = [
  'hsl(42, 78%, 56%)',   // gold
  'hsl(213, 80%, 62%)',  // blue
  'hsl(152, 60%, 48%)',  // green
  'hsl(268, 60%, 62%)',  // purple
  'hsl(0, 72%, 55%)',    // red
  'hsl(38, 92%, 50%)',   // orange
];

const Dashboard = () => {
  const { data: portfolio = [], isLoading } = usePortfolio();
  const { data: classes = [] } = useAssetClasses();
  const { data: targets = [] } = useClassTargets();
  const refreshMarket = useRefreshMarket();
  const { data: contributions = [] } = useContributions();

  // Contribution stats
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

  // Class values
  const classValues = classes
    .map((cls) => {
      const positions = portfolio.filter((p) => p.class_id === cls.id);
      const total = positions.reduce((sum, p) => sum + p.quantity * (p.last_price ?? p.avg_price), 0);
      const div12m = positions.reduce((sum, p) => sum + p.quantity * (p.div_12m ?? 0), 0);
      const weightedDySum = positions.reduce((sum, p) => {
        const price = p.last_price ?? p.avg_price;
        const value = p.quantity * price;
        const dy = p.effective_dy ?? 0;
        return sum + value * dy;
      }, 0);
      return { ...cls, total, div12m, weightedDySum, positions };
    })
    .filter((c) => c.total > 0);

  const totalPatrimony = classValues.reduce((s, c) => s + c.total, 0);
  const totalDiv12m = classValues.reduce((s, c) => s + c.div12m, 0);
  const totalWeightedDy = classValues.reduce((s, c) => s + c.weightedDySum, 0);
  const avgDY = totalPatrimony > 0 ? totalWeightedDy / totalPatrimony : 0;
  const totalAssets = portfolio.length;

  // Per-asset analytics
  const assetValues = portfolio
    .map((p) => {
      const price = p.last_price ?? p.avg_price;
      const currentValue = p.quantity * price;
      const costBasis = p.quantity * p.avg_price;
      const pctPortfolio = totalPatrimony > 0 ? (currentValue / totalPatrimony) * 100 : 0;
      const pnlPct = p.avg_price > 0 ? ((price - p.avg_price) / p.avg_price) * 100 : 0;
      return { ...p, currentValue, costBasis, pctPortfolio, pnlPct };
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

  // Band analysis
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

  // Problems / Insights
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

  // Smart insights
  const insights = [
    {
      icon: Target,
      label: 'Maior Posição',
      value: topAsset ? topAsset.ticker : '-',
      detail: topAsset ? `${topAssetPct.toFixed(1)}% do portfólio` : '',
      color: 'text-chart-2',
    },
    {
      icon: TrendingUp,
      label: 'Melhor Ativo',
      value: biggestGain?.ticker || '-',
      detail: biggestGain ? `${biggestGain.pnlPct > 0 ? '+' : ''}${biggestGain.pnlPct.toFixed(1)}%` : '',
      color: 'text-positive',
    },
    {
      icon: TrendingDown,
      label: 'Pior Ativo',
      value: biggestLoss?.ticker || '-',
      detail: biggestLoss ? `${biggestLoss.pnlPct.toFixed(1)}%` : '',
      color: 'text-negative',
    },
    {
      icon: PieIcon,
      label: 'Classe Dominante',
      value: classAllocations[0]?.name || '-',
      detail: classAllocations[0] ? `${topClassPct.toFixed(1)}%` : '',
      color: 'text-chart-4',
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Activity className="h-6 w-6 text-primary animate-pulse" />
          <span className="text-sm text-muted-foreground">Carregando portfólio...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest mb-1">Visão Geral</p>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-xs h-8 border-border/50 hover:border-primary/30 hover:text-primary"
          onClick={() => refreshMarket.mutate()}
          disabled={refreshMarket.isPending}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshMarket.isPending && 'animate-spin')} />
          Atualizar
        </Button>
      </div>

      {/* ═══════ HERO KPIs ═══════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Patrimônio Total — Hero */}
        <div className="col-span-2 lg:col-span-1 glass-card rounded-xl p-5 glow-gold">
          <p className="kpi-label">Patrimônio Total</p>
          <p className="text-3xl font-bold tracking-tight font-mono mt-2 text-gradient-gold">
            {formatBRL(totalPatrimony)}
          </p>
          <p className="text-xs text-muted-foreground mt-1.5">{totalAssets} ativos</p>
        </div>

        {/* Dividendos 12m */}
        <div className="glass-card rounded-xl p-5">
          <p className="kpi-label">Proventos 12m</p>
          <p className="text-2xl font-bold tracking-tight font-mono mt-2">{formatBRL(totalDiv12m)}</p>
          <p className="text-xs text-muted-foreground mt-1.5">~{formatBRL(totalDiv12m / 12)}/mês</p>
        </div>

        {/* DY Médio */}
        <div className="glass-card rounded-xl p-5">
          <p className="kpi-label">Dividend Yield</p>
          <p className="text-2xl font-bold tracking-tight font-mono mt-2">{formatPct(avgDY)}</p>
          <p className="text-xs text-muted-foreground mt-1.5">média ponderada</p>
        </div>

        {/* Aporte */}
        <div className="glass-card rounded-xl p-5">
          <p className="kpi-label">Aporte no Mês</p>
          <p className="text-2xl font-bold tracking-tight font-mono mt-2 text-primary">{formatBRL(monthContribTotal)}</p>
          <p className="text-xs text-muted-foreground mt-1.5">média: {formatBRL(avgMonthlyContrib)}/mês</p>
        </div>
      </div>

      {/* ═══════ SMART INSIGHTS ═══════ */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold tracking-tight">Insights Rápidos</h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {insights.map((ins) => (
            <div key={ins.label} className="insight-card group">
              <div className="flex items-center gap-2 mb-2">
                <ins.icon className={cn('h-3.5 w-3.5', ins.color)} />
                <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{ins.label}</span>
              </div>
              <p className="text-base font-bold font-mono">{ins.value}</p>
              <p className={cn('text-xs font-mono mt-0.5', ins.color)}>{ins.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ═══════ MAIN CONTENT GRID ═══════ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Allocation Donut — 3 cols */}
        <div className="lg:col-span-3 glass-card rounded-xl overflow-hidden">
          <div className="p-5 pb-0">
            <h2 className="text-sm font-semibold tracking-tight">Alocação por Classe</h2>
          </div>
          <div className="p-5">
            {pieData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                Cadastre ativos na Carteira para ver a alocação.
              </p>
            ) : (
              <div className="flex items-center gap-6">
                <div className="h-56 w-56 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        dataKey="value"
                        strokeWidth={2}
                        stroke="hsl(var(--background))"
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) => formatBRL(value)}
                        contentStyle={{
                          backgroundColor: 'hsl(222 16% 9%)',
                          border: '1px solid hsl(220 10% 15%)',
                          borderRadius: '8px',
                          color: 'hsl(220 15% 90%)',
                          fontSize: '12px',
                          boxShadow: '0 8px 32px -4px rgba(0,0,0,0.5)',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-2">
                  {pieData.map((item, i) => (
                    <div key={item.name} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                      <div className="flex items-center gap-2.5">
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

        {/* Dividendos + Aportes — 2 cols */}
        <div className="lg:col-span-2 space-y-4">
          {/* Dividendos Block */}
          <div className="glass-card rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold tracking-tight">Renda Passiva</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="kpi-label">12 Meses</p>
                <p className="text-lg font-bold font-mono mt-1">{formatBRL(totalDiv12m)}</p>
              </div>
              <div>
                <p className="kpi-label">Mensal Médio</p>
                <p className="text-lg font-bold font-mono mt-1">{formatBRL(totalDiv12m / 12)}</p>
              </div>
              <div>
                <p className="kpi-label">Yield Médio</p>
                <p className="text-lg font-bold font-mono mt-1 text-primary">{formatPct(avgDY)}</p>
              </div>
              <div>
                <p className="kpi-label">Nº de Ativos</p>
                <p className="text-lg font-bold font-mono mt-1">{totalAssets}</p>
              </div>
            </div>
          </div>

          {/* Aportes Block */}
          <div className="glass-card rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-4 w-4 text-chart-2" />
              <h2 className="text-sm font-semibold tracking-tight">Aportes {currentYear}</h2>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Mês atual</span>
                <span className="text-sm font-mono font-semibold text-primary">{formatBRL(monthContribTotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Acumulado no ano</span>
                <span className="text-sm font-mono font-semibold">{formatBRL(yearContribTotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Média mensal</span>
                <span className="text-sm font-mono font-semibold">{formatBRL(avgMonthlyContrib)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════ ALERTS / PROBLEMS ═══════ */}
      {problems.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="h-4 w-4 text-negative" />
            <h2 className="text-sm font-semibold tracking-tight">Alertas</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {problems.map((problem, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-start gap-3 p-3.5 rounded-lg border transition-colors',
                  problem.type === 'danger'
                    ? 'bg-negative/[0.04] border-negative/10 hover:border-negative/20'
                    : problem.type === 'warning'
                    ? 'bg-warning/[0.04] border-warning/10 hover:border-warning/20'
                    : 'bg-chart-2/[0.04] border-chart-2/10 hover:border-chart-2/20'
                )}
              >
                <AlertTriangle
                  className={cn(
                    'h-3.5 w-3.5 mt-0.5 shrink-0',
                    problem.type === 'danger' ? 'text-negative' : problem.type === 'warning' ? 'text-warning' : 'text-chart-2'
                  )}
                />
                <span className="text-sm">{problem.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top 5 Assets */}
      {assetValues.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold tracking-tight mb-3">Top Ativos</h2>
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-3 px-4 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Ativo</th>
                    <th className="text-right py-3 px-4 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Valor</th>
                    <th className="text-right py-3 px-4 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">% Carteira</th>
                    <th className="text-right py-3 px-4 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {assetValues.slice(0, 8).map((asset) => (
                    <tr key={asset.ticker} className="border-b border-border/20 last:border-0 hover:bg-card/50 transition-colors">
                      <td className="py-2.5 px-4">
                        <span className="font-mono font-semibold text-foreground">{asset.ticker}</span>
                        {asset.name && <span className="text-xs text-muted-foreground ml-2">{asset.name}</span>}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono">{formatBRL(asset.currentValue)}</td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1 rounded-full bg-border/50 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary/60"
                              style={{ width: `${Math.min(asset.pctPortfolio, 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs w-12 text-right">{asset.pctPortfolio.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <span className={cn(
                          'inline-flex items-center gap-1 font-mono text-xs font-medium',
                          asset.pnlPct >= 0 ? 'text-positive' : 'text-negative'
                        )}>
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
        </div>
      )}
    </div>
  );
};

export default Dashboard;
