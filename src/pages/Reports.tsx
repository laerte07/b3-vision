import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet, Download, Calendar } from 'lucide-react';

const Reports = () => (
  <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
      <p className="text-sm text-muted-foreground">Exporte dados e acompanhe a evolução mensal</p>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Exportar Dados</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {['Posições', 'Rebalanceamento', 'Valuations', 'Transações'].map(item => (
            <Button key={item} variant="outline" className="w-full justify-start gap-3">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              Exportar {item} (CSV)
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Resumo Mensal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            O resumo mensal incluirá: aportes, vendas, variação de alocação, proventos recebidos e evolução patrimonial.
          </p>
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            Gerar Resumo
          </Button>
        </CardContent>
      </Card>
    </div>
  </div>
);

export default Reports;
