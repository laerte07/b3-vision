import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet, Calendar, Download } from 'lucide-react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useClassTargets } from '@/hooks/useClassTargets';
import { formatBRL, formatPct, formatNumber } from '@/lib/format';
import { toast } from 'sonner';

const exportCSV = (filename: string, headers: string[], rows: string[][]) => {
  const bom = '\uFEFF';
  const csv = bom + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
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
  const totalDiv12m = portfolio.reduce((s, p) => s + p.quantity * (p.div_12m ?? 0), 0);
  const avgDY = totalPortfolio > 0 ? (totalDiv12m / totalPortfolio) * 100 : 0;

  // Allocation by class
  const classAlloc = classes.map(cls => {
    const items = portfolio.filter(p => p.class_id === cls.id);
    const val = items.reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0);
    return { name: cls.name, value: val, pct: totalPortfolio > 0 ? (val / totalPortfolio) * 100 : 0 };
  }).filter(c => c.value > 0).sort((a, b) => b.value - a.value);

  // Top 5 assets
  const top5 = [...portfolio]
    .map(p => ({ ...p, currentValue: p.quantity * (p.last_price ?? p.avg_price) }))
    .sort((a, b) => b.currentValue - a.currentValue)
    .slice(0, 5);

  // Band alerts
  const bandAlerts = targets.map(t => {
    const cls = classes.find(c => c.id === t.class_id);
    const val = portfolio.filter(p => p.class_id === t.class_id).reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0);
    const pct = totalPortfolio > 0 ? (val / totalPortfolio) * 100 : 0;
    const status = pct > t.upper_band ? 'ACIMA' : pct < t.lower_band ? 'ABAIXO' : 'OK';
    return { className: cls?.name ?? '', pct, target: t.target_percent, lower: t.lower_band, upper: t.upper_band, status };
  });

  const exportPositions = () => {
    const headers = ['Ticker', 'Nome', 'Classe', 'Qtd', 'PM', 'Preço Atual', 'Total', '% Carteira', 'DY 12m', 'P/L', 'ROE'];
    const rows = portfolio.map(p => {
      const cls = classes.find(c => c.id === p.class_id);
      const price = p.last_price ?? p.avg_price;
      const total = p.quantity * price;
      return [
        p.ticker, p.name || '', cls?.name || '', String(p.quantity),
        p.avg_price.toFixed(2), price.toFixed(2), total.toFixed(2),
        totalPortfolio > 0 ? ((total / totalPortfolio) * 100).toFixed(2) : '0',
        p.dy_12m != null ? p.dy_12m.toFixed(2) : '',
        p.fundamentals?.pe_ratio?.toFixed(2) ?? '',
        p.fundamentals?.roe?.toFixed(2) ?? '',
      ];
    });
    exportCSV('relatorio_posicoes.csv', headers, rows);
  };

  const exportMonthly = () => {
    const headers = ['Indicador', 'Valor'];
    const rows = [
      ['Patrimônio', formatBRL(totalPortfolio)],
      ['Proventos 12m', formatBRL(totalDiv12m)],
      ['DY Médio', formatPct(avgDY)],
      ['Total Ativos', String(portfolio.length)],
      ...classAlloc.map(c => [`Alocação ${c.name}`, `${c.pct.toFixed(1)}%`]),
      ...top5.map((a, i) => [`Top ${i + 1}`, `${a.ticker} - ${formatBRL(a.currentValue)}`]),
      ...bandAlerts.filter(b => b.status !== 'OK').map(b => [`Alerta ${b.className}`, `${b.status} (${b.pct.toFixed(1)}%)`]),
    ];
    exportCSV('relatorio_mensal.csv', headers, rows);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">Relatório mensal completo e exportações</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Exportar Dados</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" className="w-full justify-start gap-3" onClick={exportPositions}>
              <FileSpreadsheet className="h-4 w-4 text-primary" /> Posições Completas (CSV)
            </Button>
            <Button variant="outline" className="w-full justify-start gap-3" onClick={exportMonthly}>
              <Download className="h-4 w-4 text-primary" /> Relatório Mensal (CSV)
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
              {[
                { label: 'Patrimônio', value: formatBRL(totalPortfolio) },
                { label: 'Proventos 12m', value: formatBRL(totalDiv12m) },
                { label: 'DY Médio', value: formatPct(avgDY) },
                { label: 'Ativos', value: String(portfolio.length) },
              ].map(item => (
                <div key={item.label} className="p-3 rounded-lg bg-muted">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
                  <p className="text-lg font-bold font-mono mt-1">{item.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Allocation breakdown */}
      <Card>
        <CardHeader><CardTitle className="text-base">Alocação por Classe</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {classAlloc.map(c => (
              <div key={c.name} className="flex items-center justify-between p-2 rounded bg-muted">
                <span className="text-sm font-medium">{c.name}</span>
                <div className="text-right">
                  <span className="text-sm font-mono">{formatBRL(c.value)}</span>
                  <span className="text-xs text-muted-foreground ml-2">({c.pct.toFixed(1)}%)</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Top 5 */}
      <Card>
        <CardHeader><CardTitle className="text-base">Top 5 Ativos</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {top5.map((a, i) => (
              <div key={a.id} className="flex items-center justify-between p-2 rounded bg-muted">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}.</span>
                  <span className="text-sm font-mono font-medium">{a.ticker}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-mono">{formatBRL(a.currentValue)}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    ({totalPortfolio > 0 ? ((a.currentValue / totalPortfolio) * 100).toFixed(1) : 0}%)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Band alerts */}
      {bandAlerts.some(b => b.status !== 'OK') && (
        <Card>
          <CardHeader><CardTitle className="text-base">Alertas de Banda</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {bandAlerts.filter(b => b.status !== 'OK').map(b => (
                <div key={b.className} className="flex items-center justify-between p-2 rounded bg-destructive/5 border border-destructive/15">
                  <span className="text-sm">{b.className}</span>
                  <span className={`text-xs font-mono font-bold ${b.status === 'ACIMA' ? 'text-red-500' : 'text-amber-500'}`}>
                    {b.status} ({b.pct.toFixed(1)}% vs {b.lower}–{b.upper}%)
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Reports;
