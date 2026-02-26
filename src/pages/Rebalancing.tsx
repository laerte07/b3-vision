import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { ASSET_CLASSES, MOCK_POSITIONS, MOCK_TARGETS } from '@/lib/mock-data';
import { formatBRL, formatPct } from '@/lib/format';

const Rebalancing = () => {
  const [aporte, setAporte] = useState(6000);
  const [allowSales, setAllowSales] = useState(true);
  const [mode, setMode] = useState<'conservative' | 'target'>('target');

  const totalPortfolio = MOCK_POSITIONS.reduce((s, p) => s + p.qty * p.currentPrice, 0);
  const totalWithAporte = totalPortfolio + aporte;

  const classData = MOCK_TARGETS.map(target => {
    const positions = MOCK_POSITIONS.filter(p => p.classId === target.classId);
    const currentValue = positions.reduce((s, p) => s + p.qty * p.currentPrice, 0);
    const currentPct = totalPortfolio > 0 ? (currentValue / totalPortfolio) * 100 : 0;
    const idealValue = totalWithAporte * (target.targetPct / 100);

    let action: 'comprar' | 'vender' | 'manter' = 'manter';
    let amount = 0;

    if (mode === 'target') {
      amount = idealValue - currentValue;
      action = amount > 10 ? 'comprar' : amount < -10 ? 'vender' : 'manter';
    } else {
      if (currentPct > target.upperBand) {
        const bandValue = totalWithAporte * (target.upperBand / 100);
        amount = bandValue - currentValue;
        action = 'vender';
      } else if (currentPct < target.lowerBand) {
        const bandValue = totalWithAporte * (target.lowerBand / 100);
        amount = bandValue - currentValue;
        action = 'comprar';
      }
    }

    if (!allowSales && amount < 0) {
      amount = 0;
      action = 'manter';
    }

    return { ...target, currentValue, currentPct, idealValue, diff: target.targetPct - currentPct, action, amount };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Rebalanceamento</h1>
        <p className="text-sm text-muted-foreground">Simule aportes e vendas para manter a alocação alvo</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Simulador</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label>Aporte do mês (R$)</Label>
              <Input type="number" value={aporte} onChange={e => setAporte(Number(e.target.value))} className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label>Permitir vendas?</Label>
              <div className="flex items-center gap-3 pt-1">
                <Switch checked={allowSales} onCheckedChange={setAllowSales} />
                <span className="text-sm text-muted-foreground">{allowSales ? 'Sim' : 'Não'}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Modo de rebalanceamento</Label>
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Patrimônio Atual</p>
            <p className="text-xl font-bold mt-1 font-mono">{formatBRL(totalPortfolio)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Aporte</p>
            <p className="text-xl font-bold mt-1 font-mono text-positive">+{formatBRL(aporte)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Projetado</p>
            <p className="text-xl font-bold mt-1 font-mono text-primary">{formatBRL(totalWithAporte)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader><CardTitle className="text-base">Resultado por Classe</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold">Classe</TableHead>
                <TableHead className="text-right font-semibold">Valor Atual</TableHead>
                <TableHead className="text-right font-semibold">% Atual</TableHead>
                <TableHead className="text-right font-semibold">% Alvo</TableHead>
                <TableHead className="text-right font-semibold">Banda</TableHead>
                <TableHead className="text-right font-semibold">Valor Ideal</TableHead>
                <TableHead className="text-center font-semibold">Ação</TableHead>
                <TableHead className="text-right font-semibold">Ajuste (R$)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classData.map(cd => (
                <TableRow key={cd.classId} className="hover:bg-muted/30">
                  <TableCell className="font-medium">{cd.className}</TableCell>
                  <TableCell className="text-right font-mono">{formatBRL(cd.currentValue)}</TableCell>
                  <TableCell className="text-right font-mono">{formatPct(cd.currentPct)}</TableCell>
                  <TableCell className="text-right font-mono">{formatPct(cd.targetPct)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{cd.lowerBand}–{cd.upperBand}%</TableCell>
                  <TableCell className="text-right font-mono">{formatBRL(cd.idealValue)}</TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={cd.action === 'comprar' ? 'default' : cd.action === 'vender' ? 'destructive' : 'secondary'}
                      className="text-[10px] min-w-[60px]"
                    >
                      {cd.action.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium">
                    {cd.amount !== 0 ? (
                      <span className={cd.amount > 0 ? 'text-positive' : 'text-negative'}>
                        {cd.amount > 0 ? '+' : ''}{formatBRL(cd.amount)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Rebalancing;
