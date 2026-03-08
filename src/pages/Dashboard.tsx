import { Card, CardContent } from '@/components/ui/card';
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
  'hsl(239, 84%, 67%)',
  'hsl(199, 89%, 48%)',
  'hsl(142, 71%, 45%)',
  'hsl(270, 67%, 62%)',
  'hsl(0, 84%, 60%)',
  'hsl(38, 92%, 50%)',
];

const Dashboard = () => {
  const { data: portfolio = [], isLoading } = usePortfolio();
  const { data: classes = [] } = useAssetClasses();
  const { data: targets = [] } = useClassTargets();
  const refreshMarket = useRefreshMarket();
  const { data: contributions = [] } = useContributions();

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Activity className="h-5 w-5 text-primary animate-pulse" />
          <span className="text-sm text-muted-foreground">Carregando portfólio...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-end justify-between">
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
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="col-span-2 lg:col-span-1 glass-card p-5 glow-primary">
          <p className="kpi-label">Patrimônio Total</p>
          <p className="text-2xl font-semibold tracking-tight font-mono mt-2 text-primary">
            {formatBRL(totalPatrimony)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{totalAssets} ativos</p>
        </div>

        <div className="glass-card p-5">
          <p className="kpi-label">Proventos 12m</p>
          <p className="text-xl font-semibold tracking-tight font-mono mt-2">{formatBRL(totalDiv12m)}</p>
          <p className="text-xs text-muted-foreground mt-1">~{formatBRL(totalDiv12m / 12)}/mês</p>
        </div>

        <div className="glass-card p-5">
          <p className="kpi-label">Dividend Yield</p>
          <p className="text-xl font-semibold tracking-tight font-mono mt-2">{formatPct(avgDY)}</p>
          <p className="text-xs text-muted-foreground mt-1">média ponderada</p>
        </div>

        <div className="glass-card p-5">
          <p className="kpi-label">Aporte no Mês</p>
          <p className="text-xl font-semibold tracking-tight font-mono mt-2 text-primary">{formatBRL(monthContribTotal)}</p>
          <p className="text-xs text-muted-foreground mt-1">média: {formatBRL(avgMonthlyContrib)}/mês</p>
        </div>
      </div>

      {/* Smart Insights */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <h2 className="section-title">Insights</h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {insights.map((ins) => (
            <div key={ins.label} className="insight-card">
              <div className="flex items-center gap-2 mb-2">
                <ins.icon className={cn('h-3.5 w-3.5', ins.color)} />
                <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{ins.label}</span>
              </div>
              <p className="text-sm font-semibold font-mono">{ins.value}</p>
              <p className={cn('text-xs font-mono mt-0.5', ins.color)}>{ins.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
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
                          border: '1px solid hsl(222 20% 14%)',
                          borderRadius: '6px',
                          color: 'hsl(220 13% 91%)',
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
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="h-3.5 w-3.5 text-primary" />
              <h2 className="section-title">Renda Passiva</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="stat-block">
                <p className="kpi-label">12 Meses</p>
                <p className="text-base font-semibold font-mono mt-1">{formatBRL(totalDiv12m)}</p>
              </div>
              <div className="stat-block">
                <p className="kpi-label">Mensal Médio</p>
                <p className="text-base font-semibold font-mono mt-1">{formatBRL(totalDiv12m / 12)}</p>
              </div>
              <div className="stat-block">
                <p className="kpi-label">Yield Médio</p>
                <p className="text-base font-semibold font-mono mt-1 text-primary">{formatPct(avgDY)}</p>
              </div>
              <div className="stat-block">
                <p className="kpi-label">Nº de Ativos</p>
                <p className="text-base font-semibold font-mono mt-1">{totalAssets}</p>
              </div>
            </div>
          </div>

          <div className="glass-card p-5">
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
          </div>
        </div>
      </div>

      {/* Alerts */}
      {problems.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="h-3.5 w-3.5 text-negative" />
            <h2 className="section-title">Alertas</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {problems.map((problem, i) => (
              <div
                key={i}
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
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Assets */}
      {assetValues.length > 0 && (
        <div>
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
        </div>
      )}
    </div>
  );
};

export default Dashboard;
