import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DollarSign, TrendingUp, BarChart3, PieChart as PieIcon, RefreshCw, AlertTriangle } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { usePortfolio, useRefreshMarket } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useClassTargets } from '@/hooks/useClassTargets';
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
  const { data: portfolio = [] } = usePortfolio();
  const { data: classes = [] } = useAssetClasses();
  const { data: targets = [] } = useClassTargets();
  const refreshMarket = useRefreshMarket();

  const classValues = classes.map(cls => {
    const positions = portfolio.filter(p => p.class_id === cls.id);
    const total = positions.reduce((sum, p) => sum + p.quantity * (p.last_price ?? p.avg_price), 0);
    const div12m = positions.reduce((sum, p) => sum + p.quantity * (p.div_12m ?? 0), 0);
    return { ...cls, total, div12m };
  }).filter(c => c.total > 0);

  const totalPatrimony = classValues.reduce((s, c) => s + c.total, 0);
  const totalDiv12m = classValues.reduce((s, c) => s + c.div12m, 0);
  const avgDY = totalPatrimony > 0 ? (totalDiv12m / totalPatrimony) * 100 : 0;
  const totalAssets = portfolio.length;

  const pieData = classValues.map(c => ({
    name: c.name,
    value: c.total,
    pct: totalPatrimony > 0 ? (c.total / totalPatrimony) * 100 : 0,
  }));

  const alerts: string[] = [];
  classValues.forEach(cv => {
    const target = targets.find(t => t.class_id === cv.id);
    if (target && totalPatrimony > 0) {
      const pct = (cv.total / totalPatrimony) * 100;
      if (pct > target.upper_band) alerts.push(`${cv.name} acima da banda (${pct.toFixed(1)}% > ${target.upper_band}%)`);
      if (pct < target.lower_band) alerts.push(`${cv.name} abaixo da banda (${pct.toFixed(1)}% < ${target.lower_band}%)`);
    }
  });

  const summaryCards = [
    { label: 'Patrimônio Total', value: formatBRL(totalPatrimony), icon: DollarSign, color: 'text-primary' },
    { label: 'Proventos 12m', value: formatBRL(totalDiv12m), icon: TrendingUp, color: 'text-positive' },
    { label: 'DY Médio', value: formatPct(avgDY), icon: BarChart3, color: 'text-primary' },
    { label: 'Total de Ativos', value: String(totalAssets), icon: PieIcon, color: 'text-primary' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Visão geral da sua carteira</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => refreshMarket.mutate()} disabled={refreshMarket.isPending}>
          <RefreshCw className={`h-4 w-4 ${refreshMarket.isPending ? 'animate-spin' : ''}`} />
          Atualizar Mercado
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map(card => (
          <Card key={card.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{card.label}</p>
                  <p className="text-2xl font-bold mt-1">{card.value}</p>
                </div>
                <div className={`h-10 w-10 rounded-lg bg-muted flex items-center justify-center ${card.color}`}>
                  <card.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Alocação por Classe</CardTitle></CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Cadastre ativos na Carteira para ver a alocação.</p>
            ) : (
              <>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={65} outerRadius={105} dataKey="value" strokeWidth={2} stroke="hsl(222, 25%, 6%)">
                        {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(value: number) => formatBRL(value)} contentStyle={{ backgroundColor: 'hsl(222, 20%, 10%)', border: '1px solid hsl(222, 12%, 20%)', borderRadius: '8px', color: 'hsl(210, 20%, 92%)' }} />
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" /> Alertas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground text-sm">✅ Carteira dentro das bandas configuradas.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.map((alert, i) => (
                  <div key={i} className="flex items-start gap-2.5 p-3 rounded-lg bg-warning/5 border border-warning/15">
                    <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                    <span className="text-sm">{alert}</span>
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
