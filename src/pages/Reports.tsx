import { Button } from '@/components/ui/button';
import { FileSpreadsheet, Calendar, Download } from 'lucide-react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useClassTargets } from '@/hooks/useClassTargets';
import { formatBRL, formatPct, formatNumber } from '@/lib/format';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const exportCSV = (filename: string, headers: string[], rows: string[][]) => {
  const bom = '\uFEFF';
  const csv = bom + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
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

  const classAlloc = classes.map(cls => {
    const items = portfolio.filter(p => p.class_id === cls.id);
    const val = items.reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0);
    return { name: cls.name, value: val, pct: totalPortfolio > 0 ? (val / totalPortfolio) * 100 : 0 };
  }).filter(c => c.value > 0).sort((a, b) => b.value - a.value);

  const top5 = [...portfolio].map(p => ({ ...p, currentValue: p.quantity * (p.last_price ?? p.avg_price) })).sort((a, b) => b.currentValue - a.currentValue).slice(0, 5);

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
      return [p.ticker, p.name || '', cls?.name || '', String(p.quantity), p.avg_price.toFixed(2), price.toFixed(2), total.toFixed(2), totalPortfolio > 0 ? ((total / totalPortfolio) * 100).toFixed(2) : '0', p.dy_12m != null ? p.dy_12m.toFixed(2) : '', p.fundamentals?.pe_ratio?.toFixed(2) ?? '', p.fundamentals?.roe?.toFixed(2) ?? ''];
    });
    exportCSV('relatorio_posicoes.csv', headers, rows);
  };

  const exportMonthly = () => {
    const headers = ['Indicador', 'Valor'];
    const rows = [
      ['Patrimônio', formatBRL(totalPortfolio)], ['Proventos 12m', formatBRL(totalDiv12m)], ['DY Médio', formatPct(avgDY)], ['Total Ativos', String(portfolio.length)],
      ...classAlloc.map(c => [`Alocação ${c.name}`, `${c.pct.toFixed(1)}%`]),
      ...top5.map((a, i) => [`Top ${i + 1}`, `${a.ticker} - ${formatBRL(a.currentValue)}`]),
      ...bandAlerts.filter(b => b.status !== 'OK').map(b => [`Alerta ${b.className}`, `${b.status} (${b.pct.toFixed(1)}%)`]),
    ];
    exportCSV('relatorio_mensal.csv', headers, rows);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <p className="kpi-label mb-1">Exportações</p>
        <h1 className="text-xl font-semibold tracking-tight">Relatórios</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <h3 className="section-title mb-4">Exportar Dados</h3>
          <div className="space-y-2">
            <Button variant="outline" className="w-full justify-start gap-3 h-10 text-sm" onClick={exportPositions}>
              <FileSpreadsheet className="h-4 w-4 text-primary" /> Posições Completas (CSV)
            </Button>
            <Button variant="outline" className="w-full justify-start gap-3 h-10 text-sm" onClick={exportMonthly}>
              <Download className="h-4 w-4 text-primary" /> Relatório Mensal (CSV)
            </Button>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="h-3.5 w-3.5 text-primary" />
            <h3 className="section-title">Resumo Mensal</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Patrimônio', value: formatBRL(totalPortfolio) },
              { label: 'Proventos 12m', value: formatBRL(totalDiv12m) },
              { label: 'DY Médio', value: formatPct(avgDY) },
              { label: 'Ativos', value: String(portfolio.length) },
            ].map(item => (
              <div key={item.label} className="stat-block">
                <p className="kpi-label">{item.label}</p>
                <p className="text-base font-semibold font-mono mt-1">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="glass-card p-5">
        <h3 className="section-title mb-4">Alocação por Classe</h3>
        <div className="space-y-2">
          {classAlloc.map(c => (
            <div key={c.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/20">
              <span className="text-sm font-medium">{c.name}</span>
              <div className="text-right flex items-center gap-3">
                <span className="text-sm font-mono">{formatBRL(c.value)}</span>
                <span className="text-xs text-muted-foreground font-mono">{c.pct.toFixed(1)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card p-5">
        <h3 className="section-title mb-4">Top 5 Ativos</h3>
        <div className="space-y-2">
          {top5.map((a, i) => (
            <div key={a.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/20">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-muted-foreground w-5">{i + 1}.</span>
                <span className="text-sm font-mono font-medium">{a.ticker}</span>
              </div>
              <div className="text-right flex items-center gap-3">
                <span className="text-sm font-mono">{formatBRL(a.currentValue)}</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {totalPortfolio > 0 ? ((a.currentValue / totalPortfolio) * 100).toFixed(1) : 0}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {bandAlerts.some(b => b.status !== 'OK') && (
        <div className="glass-card p-5">
          <h3 className="section-title mb-4">Alertas de Banda</h3>
          <div className="space-y-2">
            {bandAlerts.filter(b => b.status !== 'OK').map(b => (
              <div key={b.className} className="flex items-center justify-between p-3 rounded-lg bg-negative/[0.03] border border-negative/10">
                <span className="text-sm">{b.className}</span>
                <span className={cn('text-xs font-mono font-medium', b.status === 'ACIMA' ? 'text-negative' : 'text-warning')}>
                  {b.status} ({b.pct.toFixed(1)}% vs {b.lower}–{b.upper}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Reports;
