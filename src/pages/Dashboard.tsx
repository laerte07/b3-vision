import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DollarSign,
  TrendingUp,
  BarChart3,
  PieChart as PieIcon,
  RefreshCw,
  AlertTriangle,
  Target,
  ShieldAlert,
  TrendingDown,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { usePortfolio, useRefreshMarket } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useClassTargets } from '@/hooks/useClassTargets';
import { useContributions } from '@/hooks/useContributions';
import { formatBRL, formatPct } from '@/lib/format';

const COLORS = [
  'hsl(43, 85%, 55%)',
  'hsl(200, 80%, 55%)',
  'hsl(142, 70%, 45%)',
  'hsl(280, 70%, 60%)',
  'hsl(0, 72%, 51%)',
  'hsl(38, 92%, 50%)',
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

  // --- Computed values (per class) ---
  const classValues = classes
    .map((cls) => {
      const positions = portfolio.filter((p) => p.class_id === cls.id);

      const total = positions.reduce(
        (sum, p) => sum + p.quantity * (p.last_price ?? p.avg_price),
        0
      );

      // ✅ Proventos 12m em R$: usa div_12m (R$/ação/cota) * quantidade
      const div12m = positions.reduce((sum, p) => sum + p.quantity * (p.div_12m ?? 0), 0);

      // ✅ Soma ponderada de DY (%): valor * dy
      const weightedDySum = positions.reduce((sum, p) => {
        const price = p.last_price ?? p.avg_price;
        const value = p.quantity * price;
        const dy = p.effective_dy ?? 0; // %
        return sum + value * dy;
      }, 0);

      return { ...cls, total, div12m, weightedDySum, positions };
    })
    .filter((c) => c.total > 0);

  const totalPatrimony = classValues.reduce((s, c) => s + c.total, 0);

  // ✅ Total de proventos 12m (R$)
  const totalDiv12m = classValues.reduce((s, c) => s + c.div12m, 0);

  // ✅ DY médio (%): média ponderada por valor (mais correto)
  const totalWeightedDy = classValues.reduce((s, c) => s + c.weightedDySum, 0);
  const avgDY = totalPatrimony > 0 ? totalWeightedDy / totalPatrimony : 0;

  const totalAssets = portfolio.length;

  // --- Per-asset analytics ---
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

  // Most concentrated asset
  const topAsset = assetValues[0];
  const topAssetPct = topAsset?.pctPortfolio ?? 0;

  // Most concentrated class
  const classAllocations = classValues
    .map((c) => ({
      name: c.name,
      pct: totalPatrimony > 0 ? (c.total / totalPatrimony) * 100 : 0,
      id: c.id,
      slug: (c as any).slug,
    }))
    .sort((a, b) => b.pct - a.pct);

  const topClassPct = classAllocations[0]?.pct ?? 0;

  // Biggest gain/loss
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
  let valueAboveBand = 0;
  let valueBelowBand = 0;

  classValues.forEach((cv: any) => {
    const target = targets.find((t) => t.class_id === cv.id);
    if (target && totalPatrimony > 0) {
      const pct = (cv.total / totalPatrimony) * 100;
      if (pct > target.upper_band) {
        aboveBand.push(cv.name);
        valueAboveBand += cv.total;
      }
      if (pct < target.lower_band) {
        belowBand.push(cv.name);
        valueBelowBand += cv.total;
      }
    }
  });

  const pctAboveBand = totalPatrimony > 0 ? (valueAboveBand / totalPatrimony) * 100 : 0;
  const pctBelowBand = totalPatrimony > 0 ? (valueBelowBand / totalPatrimony) * 100 : 0;

  // Concentration risk
  const concentrationRisk = assetValues.filter((a) => a.pctPortfolio > 15);
  const top3Pct = assetValues.slice(0, 3).reduce((s, a) => s + a.pctPortfolio, 0);

  // --- Problems ---
  const problems: string[] = [];
  aboveBand.forEach((n) => problems.push(`${n} acima da banda superior`));
  belowBand.forEach((n) => problems.push(`${n} abaixo da banda inferior`));

  // Check for missing classes (por slug)
  const hasEtfs = classAllocations.some((c) => c.slug === 'etfs');
  const hasRendaFixa = classAllocations.some((c) => c.slug === 'renda-fixa');
  if (!hasEtfs) problems.push('Nenhuma exposição a ETFs internacionais');
  if (!hasRendaFixa) problems.push('Exposição zero a Renda Fixa');
  if (concentrationRisk.length > 0) problems.push(`${concentrationRisk.length} ativo(s) com mais de 15% da carteira`);
  if (top3Pct > 50) problems.push(`Top 3 ativos representam ${top3Pct.toFixed(0)}% da carteira`);

  const pieData = classValues.map((c: any) => ({
    name: c.name,
    value: c.total,
    pct: totalPatrimony > 0 ? (c.total / totalPatrimony) * 100 : 0,
  }));

  const diagCards = [
    { label: 'Patrimônio Total', value: formatBRL(totalPatrimony), icon: DollarSign },
    { label: 'Proventos 12m', value: formatBRL(totalDiv12m), icon: TrendingUp },
    { label: 'DY Médio', value: formatPct(avgDY), icon: BarChart3 },
    { label: 'Total de Ativos', value: String(totalAssets), icon: PieIcon },
  ];

  const diagCards2 = [
    { label: 'Ativo + Concentrado', value: topAsset ? `${topAsset.ticker} (${topAssetPct.toFixed(1)}%)` : '-', icon: Target },
    { label: 'Classe + Concentrada', value: classAllocations[0] ? `${classAllocations[0].name} (${topClassPct.toFixed(1)}%)` : '-', icon: PieIcon },
    { label: 'Maior Lucro Latente', value: biggestGain ? `${biggestGain.ticker} (${biggestGain.pnlPct > 0 ? '+' : ''}${biggestGain.pnlPct.toFixed(1)}%)` : '-', icon: TrendingUp, positive: true },
    { label: 'Maior Prejuízo Latente', value: biggestLoss ? `${biggestLoss.ticker} (${biggestLoss.pnlPct.toFixed(1)}%)` : '-', icon: TrendingDown, negative: true },
  ];

  const diagCards3 = [
    { label: '% Acima da Banda', value: formatPct(pctAboveBand) },
    { label: '% Abaixo da Banda', value: formatPct(pctBelowBand) },
    { label: 'Risco Concentração', value: concentrationRisk.length > 0 ? `${concentrationRisk.length} ativo(s)` : 'OK' },
  ];

  const contribCards = [
    { label: 'Aporte do mês', value: formatBRL(monthContribTotal) },
    { label: 'Aporte no ano', value: formatBRL(yearContribTotal) },
    { label: 'Média mensal', value: formatBRL(avgMonthlyContrib) },
  ];

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Diagnóstico real da sua carteira</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => refreshMarket.mutate()}
          disabled={refreshMarket.isPending}
        >
          <RefreshCw className={`h-4 w-4 ${refreshMarket.isPending ? 'animate-spin' : ''}`} />
          Atualizar Mercado
        </Button>
      </div>

      {/* Row 1: Main KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {diagCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{card.label}</p>
                  <p className="text-xl font-bold mt-1 font-mono">{card.value}</p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-primary">
                  <card.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Row 2: Diagnostic KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {diagCards2.map((card) => (
          <Card key={card.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{card.label}</p>
                  <p
                    className={`text-sm font-bold mt-1 font-mono ${
                      (card as any).positive ? 'text-emerald-500' : (card as any).negative ? 'text-red-500' : ''
                    }`}
                  >
                    {card.value}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
                  <card.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Row 3: Band + Concentration */}
      <div className="grid grid-cols-3 gap-4">
        {diagCards3.map((card) => (
          <Card key={card.label}>
            <CardContent className="pt-6 text-center">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{card.label}</p>
              <p className="text-lg font-bold mt-1 font-mono">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alocação por Classe</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Cadastre ativos na Carteira para ver a alocação.
              </p>
            ) : (
              <>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={105}
                        dataKey="value"
                        strokeWidth={2}
                        stroke="hsl(var(--background))"
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) => formatBRL(value)}
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          color: 'hsl(var(--foreground))',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-3 mt-2 justify-center">
                  {pieData.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-1.5 text-xs">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-muted-foreground">{item.name}</span>
                      <span className="font-medium">{item.pct.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Problems */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-destructive" /> Problemas Identificados
            </CardTitle>
          </CardHeader>
          <CardContent>
            {problems.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground text-sm">✅ Nenhum problema estrutural identificado.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {problems.map((problem, i) => (
                  <div key={i} className="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/5 border border-destructive/15">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <span className="text-sm">{problem}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
