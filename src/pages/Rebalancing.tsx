import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useClassTargets } from '@/hooks/useClassTargets';
import { formatBRL, formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';

const Rebalancing = () => {
  const [aporte, setAporte] = useState(6000);
  const [allowSales, setAllowSales] = useState(true);
  const [mode, setMode] = useState<'conservative' | 'target'>('target');

  const { data: portfolio = [] } = usePortfolio();
  const { data: classes = [] } = useAssetClasses();
  const { data: targets = [] } = useClassTargets();

  const totalPortfolio = portfolio.reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0);
  const totalWithAporte = totalPortfolio + aporte;

  const classData = targets.map(target => {
    const cls = classes.find(c => c.id === target.class_id);
    const positions = portfolio.filter(p => p.class_id === target.class_id);
    const currentValue = positions.reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0);
    const currentPct = totalPortfolio > 0 ? (currentValue / totalPortfolio) * 100 : 0;
    const idealValue = totalWithAporte * (target.target_percent / 100);
    let action: 'comprar' | 'vender' | 'manter' = 'manter';
    let amount = 0;
    if (mode === 'target') {
      amount = idealValue - currentValue;
      action = amount > 10 ? 'comprar' : amount < -10 ? 'vender' : 'manter';
    } else {
      if (currentPct > target.upper_band) { amount = totalWithAporte * (target.upper_band / 100) - currentValue; action = 'vender'; }
      else if (currentPct < target.lower_band) { amount = totalWithAporte * (target.lower_band / 100) - currentValue; action = 'comprar'; }
    }
    if (!allowSales && amount < 0) { amount = 0; action = 'manter'; }
    return { className: cls?.name ?? '?', classId: target.class_id, currentValue, currentPct, targetPct: target.target_percent, lowerBand: target.lower_band, upperBand: target.upper_band, idealValue, diff: target.target_percent - currentPct, action, amount };
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <p className="kpi-label mb-1">Simulador</p>
        <h1 className="text-xl font-semibold tracking-tight">Rebalanceamento</h1>
      </div>

      <div className="glass-card p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <Label className="text-xs">Aporte do mês (R$)</Label>
            <Input type="number" value={aporte} onChange={e => setAporte(Number(e.target.value))} className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Permitir vendas?</Label>
            <div className="flex items-center gap-3 pt-1">
              <Switch checked={allowSales} onCheckedChange={setAllowSales} />
              <span className="text-sm text-muted-foreground">{allowSales ? 'Sim' : 'Não'}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Modo</Label>
            <Tabs value={mode} onValueChange={(v) => setMode(v as 'conservative' | 'target')}>
              <TabsList className="w-full">
                <TabsTrigger value="conservative" className="flex-1 text-xs">Conservador</TabsTrigger>
                <TabsTrigger value="target" className="flex-1 text-xs">Alvo</TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="text-[11px] text-muted-foreground">
              {mode === 'conservative' ? 'Ajusta apenas para dentro da banda' : 'Rebalanceia para o % alvo exato'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { label: 'Patrimônio Atual', value: formatBRL(totalPortfolio) },
          { label: 'Aporte', value: `+${formatBRL(aporte)}`, accent: true },
          { label: 'Total Projetado', value: formatBRL(totalWithAporte), primary: true },
        ].map(item => (
          <div key={item.label} className="glass-card p-5 text-center">
            <p className="kpi-label">{item.label}</p>
            <p className={cn('text-xl font-semibold mt-1 font-mono', item.accent && 'text-positive', item.primary && 'text-primary')}>{item.value}</p>
          </div>
        ))}
      </div>

      {classData.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground text-sm">
          Configure metas por classe em Configurações para ver o rebalanceamento.
        </Card>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="p-4 border-b border-border/30">
            <h3 className="section-title">Resultado por Classe</h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/30">
                <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Classe</TableHead>
                <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Valor Atual</TableHead>
                <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">% Atual</TableHead>
                <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">% Alvo</TableHead>
                <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Banda</TableHead>
                <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Ideal</TableHead>
                <TableHead className="text-center text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Ação</TableHead>
                <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Ajuste</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classData.map(cd => (
                <TableRow key={cd.classId} className="data-row">
                  <TableCell className="font-medium text-sm">{cd.className}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatBRL(cd.currentValue)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatPct(cd.currentPct)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatPct(cd.targetPct)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{cd.lowerBand}–{cd.upperBand}%</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatBRL(cd.idealValue)}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={cd.action === 'comprar' ? 'default' : cd.action === 'vender' ? 'destructive' : 'secondary'} className="text-[10px] min-w-[52px]">{cd.action.toUpperCase()}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium">
                    {cd.amount !== 0 ? (
                      <span className={cd.amount > 0 ? 'text-positive' : 'text-negative'}>{cd.amount > 0 ? '+' : ''}{formatBRL(cd.amount)}</span>
                    ) : (<span className="text-muted-foreground">—</span>)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default Rebalancing;
