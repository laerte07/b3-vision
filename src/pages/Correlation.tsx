import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

const mockCorrelations = [
  { a: 'ITSA4', b: 'BBSE3', value: 0.72, note: 'Ambos setor financeiro' },
  { a: 'GARE11', b: 'HGRE11', value: 0.85, note: 'FIIs de tijolo' },
  { a: 'ITSA4', b: 'IVVB11', value: -0.15, note: 'Descorrelação com exterior' },
  { a: 'WIZC3', b: 'XPML11', value: 0.10, note: 'Baixa correlação' },
  { a: 'BBSE3', b: 'CPTS11', value: -0.30, note: 'Renda variável vs crédito' },
];

const Correlation = () => (
  <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Correlação & Diversificação</h1>
      <p className="text-sm text-muted-foreground">Análise de correlação entre ativos da carteira</p>
    </div>

    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base">Matriz de Correlação</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold">Ativo A</TableHead>
              <TableHead className="font-semibold">Ativo B</TableHead>
              <TableHead className="text-right font-semibold">Correlação</TableHead>
              <TableHead className="font-semibold">Tipo</TableHead>
              <TableHead className="font-semibold">Nota Estratégica</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mockCorrelations.map((c, i) => (
              <TableRow key={i} className="hover:bg-muted/30">
                <TableCell className="font-mono font-semibold text-primary">{c.a}</TableCell>
                <TableCell className="font-mono font-semibold text-primary">{c.b}</TableCell>
                <TableCell className="text-right font-mono font-medium">
                  <span className={c.value > 0.5 ? 'text-negative' : c.value < 0 ? 'text-positive' : 'text-muted-foreground'}>
                    {c.value > 0 ? '+' : ''}{c.value.toFixed(2)}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={c.value > 0.5 ? 'destructive' : c.value < 0 ? 'default' : 'secondary'} className="text-[10px]">
                    {c.value > 0 ? 'Positiva' : 'Negativa'}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.note}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
    <p className="text-xs text-muted-foreground">* Valores manuais. Cálculo automático por histórico será implementado quando houver API de dados históricos.</p>
  </div>
);

export default Correlation;
