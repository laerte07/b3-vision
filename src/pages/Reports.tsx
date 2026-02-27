import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet, Calendar } from 'lucide-react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useClassTargets } from '@/hooks/useClassTargets';
import { formatBRL, formatPct } from '@/lib/format';
import { toast } from 'sonner';

const exportCSV = (filename: string, headers: string[], rows: string[][]) => {
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  toast.success(`${filename} exportado`);
};

const Reports = () => {
  const { data: portfolio = [] } = usePortfolio();
  const { data: classes = [] } = useAssetClasses();
  const { data: targets = [] } = useClassTargets();

  const totalPortfolio = portfolio.reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0);

  const exportPositions = () => {
    const headers = ['Ticker', 'Nome', 'Classe', 'Qtd', 'PM', 'Preço Atual', 'Total', '% Carteira', 'DY'];
    const rows = portfolio.map(p => {
      const cls = classes.find(c => c.id === p.class_id);
      const price = p.last_price ?? p.avg_price;
      const total = p.quantity * price;
      return [p.ticker, p.name || '', cls?.name || '', String(p.quantity), String(p.avg_price), String(price), String(total.toFixed(2)), totalPortfolio > 0 ? formatPct((total / totalPortfolio) * 100) : '0', p.dy_12m != null ? String(p.dy_12m.toFixed(2)) : ''];
    });
    exportCSV('posicoes.csv', headers, rows);
  };

  const exportRebalancing = () => {
    const headers = ['Classe', '% Alvo', 'Banda Inf', 'Banda Sup', 'Valor Atual', '% Atual'];
    const rows = targets.map(t => {
      const cls = classes.find(c => c.id === t.class_id);
      const val = portfolio.filter(p => p.class_id === t.class_id).reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0);
      const pct = totalPortfolio > 0 ? (val / totalPortfolio) * 100 : 0;
      return [cls?.name || '', String(t.target_percent), String(t.lower_band), String(t.upper_band), val.toFixed(2), pct.toFixed(2)];
    });
    exportCSV('rebalanceamento.csv', headers, rows);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">Exporte dados e acompanhe a evolução mensal</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Exportar Dados</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" className="w-full justify-start gap-3" onClick={exportPositions}>
              <FileSpreadsheet className="h-4 w-4 text-primary" /> Exportar Posições (CSV)
            </Button>
            <Button variant="outline" className="w-full justify-start gap-3" onClick={exportRebalancing}>
              <FileSpreadsheet className="h-4 w-4 text-primary" /> Exportar Rebalanceamento (CSV)
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" /> Resumo Mensal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-muted">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Patrimônio</p>
                <p className="text-lg font-bold font-mono mt-1">{formatBRL(totalPortfolio)}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Ativos</p>
                <p className="text-lg font-bold font-mono mt-1">{portfolio.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Reports;
