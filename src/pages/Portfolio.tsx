import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ASSET_CLASSES, MOCK_POSITIONS } from '@/lib/mock-data';
import { formatBRL, formatPct } from '@/lib/format';

const Portfolio = () => {
  const totalPortfolio = MOCK_POSITIONS.reduce((s, p) => s + p.qty * p.currentPrice, 0);

  const classesWithPositions = ASSET_CLASSES.filter(cls =>
    MOCK_POSITIONS.some(p => p.classId === cls.id)
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Carteira</h1>
        <p className="text-sm text-muted-foreground">Posições por classe de ativo</p>
      </div>

      <Tabs defaultValue={classesWithPositions[0]?.id}>
        <TabsList className="mb-4">
          {classesWithPositions.map(cls => {
            const count = MOCK_POSITIONS.filter(p => p.classId === cls.id).length;
            return (
              <TabsTrigger key={cls.id} value={cls.id}>
                {cls.name} <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">{count}</Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {classesWithPositions.map(cls => {
          const positions = MOCK_POSITIONS.filter(p => p.classId === cls.id);
          const classTotal = positions.reduce((s, p) => s + p.qty * p.currentPrice, 0);

          return (
            <TabsContent key={cls.id} value={cls.id}>
              <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Ticker</TableHead>
                      <TableHead className="font-semibold">Nome</TableHead>
                      <TableHead className="text-right font-semibold">Qtd</TableHead>
                      <TableHead className="text-right font-semibold">PM</TableHead>
                      <TableHead className="text-right font-semibold">Preço Atual</TableHead>
                      <TableHead className="text-right font-semibold">Total</TableHead>
                      <TableHead className="text-right font-semibold">% Classe</TableHead>
                      <TableHead className="text-right font-semibold">% Carteira</TableHead>
                      <TableHead className="text-right font-semibold">DY</TableHead>
                      <TableHead className="text-right font-semibold">Div 12m</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map(pos => {
                      const total = pos.qty * pos.currentPrice;
                      const pctClass = (total / classTotal) * 100;
                      const pctPortfolio = (total / totalPortfolio) * 100;
                      const gain = ((pos.currentPrice - pos.avgPrice) / pos.avgPrice) * 100;

                      return (
                        <TableRow key={pos.ticker} className="hover:bg-muted/30">
                          <TableCell className="font-mono font-semibold text-primary">{pos.ticker}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{pos.name}</TableCell>
                          <TableCell className="text-right font-mono">{pos.qty}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">{formatBRL(pos.avgPrice)}</TableCell>
                          <TableCell className="text-right font-mono">
                            <span className={gain >= 0 ? 'text-positive' : 'text-negative'}>
                              {formatBRL(pos.currentPrice)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">{formatBRL(total)}</TableCell>
                          <TableCell className="text-right font-mono">{formatPct(pctClass)}</TableCell>
                          <TableCell className="text-right font-mono">{formatPct(pctPortfolio)}</TableCell>
                          <TableCell className="text-right font-mono">{pos.dy > 0 ? formatPct(pos.dy) : '—'}</TableCell>
                          <TableCell className="text-right font-mono">{pos.div12m > 0 ? formatBRL(pos.qty * pos.div12m) : '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] border-positive/30 text-positive">Online</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell colSpan={5}>TOTAL</TableCell>
                      <TableCell className="text-right font-mono">{formatBRL(classTotal)}</TableCell>
                      <TableCell className="text-right font-mono">100%</TableCell>
                      <TableCell className="text-right font-mono">{formatPct((classTotal / totalPortfolio) * 100)}</TableCell>
                      <TableCell colSpan={3} />
                    </TableRow>
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
};

export default Portfolio;
