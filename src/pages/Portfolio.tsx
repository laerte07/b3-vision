import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, RefreshCw, BarChart3 } from 'lucide-react';
import FundamentalsDrawer from '@/components/FundamentalsDrawer';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { usePortfolio, useAddAsset, useUpdatePosition, useDeleteAsset, useRefreshMarket, PortfolioAsset } from '@/hooks/usePortfolio';
import { formatBRL, formatPct } from '@/lib/format';

const Portfolio = () => {
  const { data: classes = [] } = useAssetClasses();
  const { data: portfolio = [], isLoading } = usePortfolio();
  const addAsset = useAddAsset();
  const updatePosition = useUpdatePosition();
  const deleteAsset = useDeleteAsset();
  const refreshMarket = useRefreshMarket();

  const [addOpen, setAddOpen] = useState(false);
  const [editAsset, setEditAsset] = useState<PortfolioAsset | null>(null);
  const [fundAsset, setFundAsset] = useState<PortfolioAsset | null>(null);
  const [form, setForm] = useState({ ticker: '', name: '', class_id: '', quantity: '', avg_price: '' });

  const totalPortfolio = portfolio.reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0);

  const classesWithPositions = classes.filter(cls => portfolio.some(p => p.class_id === cls.id));
  const defaultTab = classesWithPositions[0]?.id ?? '';

  const resetForm = () => setForm({ ticker: '', name: '', class_id: '', quantity: '', avg_price: '' });

  const handleAdd = () => {
    addAsset.mutate({
      ticker: form.ticker,
      name: form.name,
      class_id: form.class_id,
      quantity: Number(form.quantity),
      avg_price: Number(form.avg_price),
    }, { onSuccess: () => { setAddOpen(false); resetForm(); } });
  };

  const handleEdit = () => {
    if (!editAsset) return;
    updatePosition.mutate({
      asset_id: editAsset.id,
      position_id: editAsset.position_id,
      quantity: Number(form.quantity),
      avg_price: Number(form.avg_price),
      name: form.name,
    }, { onSuccess: () => { setEditAsset(null); resetForm(); } });
  };

  const openEdit = (asset: PortfolioAsset) => {
    setEditAsset(asset);
    setForm({ ticker: asset.ticker, name: asset.name || '', class_id: asset.class_id, quantity: String(asset.quantity), avg_price: String(asset.avg_price) });
  };

  const getStatus = (a: PortfolioAsset) => {
    if (!a.price_source || a.price_source === 'manual') return { label: 'Manual', cls: 'border-warning/30 text-warning' };
    if (a.price_updated_at) {
      const mins = (Date.now() - new Date(a.price_updated_at).getTime()) / 60000;
      if (mins < 60) return { label: 'Online', cls: 'border-positive/30 text-positive' };
      return { label: 'Desatualizado', cls: 'border-warning/30 text-warning' };
    }
    return { label: 'Sem cotação', cls: 'border-muted-foreground/30 text-muted-foreground' };
  };

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Carteira</h1>
          <p className="text-sm text-muted-foreground">Posições por classe de ativo</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => refreshMarket.mutate()} disabled={refreshMarket.isPending}>
            <RefreshCw className={`h-4 w-4 ${refreshMarket.isPending ? 'animate-spin' : ''}`} />
            Atualizar Mercado
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" onClick={resetForm}><Plus className="h-4 w-4" /> Adicionar Ativo</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Adicionar Ativo</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-1"><Label className="text-xs">Ticker</Label><Input value={form.ticker} onChange={e => setForm({ ...form, ticker: e.target.value })} placeholder="Ex: PETR4" className="font-mono" /></div>
                <div className="space-y-1"><Label className="text-xs">Nome (opcional)</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Petrobras" /></div>
                <div className="space-y-1">
                  <Label className="text-xs">Classe</Label>
                  <Select value={form.class_id} onValueChange={v => setForm({ ...form, class_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-xs">Quantidade</Label><Input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="font-mono" /></div>
                  <div className="space-y-1"><Label className="text-xs">Preço Médio (R$)</Label><Input type="number" step="0.01" value={form.avg_price} onChange={e => setForm({ ...form, avg_price: e.target.value })} className="font-mono" /></div>
                </div>
                <Button className="w-full" onClick={handleAdd} disabled={addAsset.isPending || !form.ticker || !form.class_id}>{addAsset.isPending ? 'Salvando...' : 'Adicionar'}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {portfolio.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <p>Nenhum ativo cadastrado. Clique em "Adicionar Ativo" para começar.</p>
        </Card>
      ) : (
        <Tabs defaultValue={defaultTab}>
          <TabsList className="mb-4 flex flex-wrap h-auto gap-1">
            {classesWithPositions.map(cls => {
              const count = portfolio.filter(p => p.class_id === cls.id).length;
              return (
                <TabsTrigger key={cls.id} value={cls.id}>
                  {cls.name} <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">{count}</Badge>
                </TabsTrigger>
              );
            })}
          </TabsList>

          {classesWithPositions.map(cls => {
            const positions = portfolio.filter(p => p.class_id === cls.id);
            const classTotal = positions.reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0);

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
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="font-semibold w-20">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {positions.map(pos => {
                        const price = pos.last_price ?? pos.avg_price;
                        const total = pos.quantity * price;
                        const pctClass = classTotal > 0 ? (total / classTotal) * 100 : 0;
                        const pctPortfolio = totalPortfolio > 0 ? (total / totalPortfolio) * 100 : 0;
                        const gain = pos.avg_price > 0 ? ((price - pos.avg_price) / pos.avg_price) * 100 : 0;
                        const status = getStatus(pos);

                        return (
                          <TableRow key={pos.id} className="hover:bg-muted/30">
                            <TableCell className="font-mono font-semibold text-primary">{pos.ticker}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{pos.name || '—'}</TableCell>
                            <TableCell className="text-right font-mono">{pos.quantity}</TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">{formatBRL(pos.avg_price)}</TableCell>
                            <TableCell className="text-right font-mono">
                              <span className={gain >= 0 ? 'text-positive' : 'text-negative'}>{formatBRL(price)}</span>
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">{formatBRL(total)}</TableCell>
                            <TableCell className="text-right font-mono">{formatPct(pctClass)}</TableCell>
                            <TableCell className="text-right font-mono">{formatPct(pctPortfolio)}</TableCell>
                            <TableCell className="text-right font-mono">{pos.effective_dy != null ? formatPct(pos.effective_dy) : '—'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-[10px] ${status.cls}`}>{status.label}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(pos)}><Pencil className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFundAsset(pos)}><BarChart3 className="h-3.5 w-3.5" /></Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button></AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Excluir {pos.ticker}?</AlertDialogTitle>
                                      <AlertDialogDescription>Esta ação é irreversível. O ativo e sua posição serão removidos.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => deleteAsset.mutate(pos.id)}>Excluir</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-muted/30 font-semibold">
                        <TableCell colSpan={5}>TOTAL</TableCell>
                        <TableCell className="text-right font-mono">{formatBRL(classTotal)}</TableCell>
                        <TableCell className="text-right font-mono">100%</TableCell>
                        <TableCell className="text-right font-mono">{totalPortfolio > 0 ? formatPct((classTotal / totalPortfolio) * 100) : '—'}</TableCell>
                        <TableCell colSpan={3} />
                      </TableRow>
                    </TableBody>
                  </Table>
                </Card>
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editAsset} onOpenChange={open => { if (!open) setEditAsset(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar {editAsset?.ticker}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1"><Label className="text-xs">Nome</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Quantidade</Label><Input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="font-mono" /></div>
              <div className="space-y-1"><Label className="text-xs">Preço Médio (R$)</Label><Input type="number" step="0.01" value={form.avg_price} onChange={e => setForm({ ...form, avg_price: e.target.value })} className="font-mono" /></div>
            </div>
            <Button className="w-full" onClick={handleEdit} disabled={updatePosition.isPending}>{updatePosition.isPending ? 'Salvando...' : 'Salvar'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <FundamentalsDrawer asset={fundAsset} open={!!fundAsset} onOpenChange={open => { if (!open) setFundAsset(null); }} />
    </div>
  );
};

export default Portfolio;
