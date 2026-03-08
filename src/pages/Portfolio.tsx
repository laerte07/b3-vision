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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import FundamentalsDrawer from '@/components/FundamentalsDrawer';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { usePortfolio, useAddAsset, useUpdatePosition, useDeleteAsset, useRefreshMarket, PortfolioAsset } from '@/hooks/usePortfolio';
import { formatBRL, formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';

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
      ticker: form.ticker, name: form.name, class_id: form.class_id,
      quantity: Number(form.quantity), avg_price: Number(form.avg_price),
    }, { onSuccess: () => { setAddOpen(false); resetForm(); } });
  };

  const handleEdit = () => {
    if (!editAsset) return;
    updatePosition.mutate({
      asset_id: editAsset.id, position_id: editAsset.position_id,
      quantity: Number(form.quantity), avg_price: Number(form.avg_price), name: form.name,
    }, { onSuccess: () => { setEditAsset(null); resetForm(); } });
  };

  const openEdit = (asset: PortfolioAsset) => {
    setEditAsset(asset);
    setForm({ ticker: asset.ticker, name: asset.name || '', class_id: asset.class_id, quantity: String(asset.quantity), avg_price: String(asset.avg_price) });
  };

  const formatRelativeAge = (dateISO: string | null): { label: string; variant: 'ok' | 'warn' | 'muted'; fullDate: string | null } => {
    if (!dateISO) return { label: 'Sem dados', variant: 'muted', fullDate: null };
    const ms = Date.now() - new Date(dateISO).getTime();
    const mins = Math.floor(ms / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    const full = new Date(dateISO).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (mins < 1) return { label: 'Agora', variant: 'ok', fullDate: full };
    if (mins <= 59) return { label: `${mins}min`, variant: 'ok', fullDate: full };
    if (hours <= 23) return { label: `${hours}h`, variant: 'warn', fullDate: full };
    return { label: `${days}d`, variant: 'warn', fullDate: full };
  };

  const statusBadgeClass: Record<string, string> = {
    ok: 'border-positive/30 bg-positive/5 text-positive',
    warn: 'border-warning/30 bg-warning/5 text-warning',
    muted: 'border-muted-foreground/20 bg-muted/30 text-muted-foreground',
  };

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Carregando...</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <p className="kpi-label mb-1">Posições</p>
          <h1 className="text-xl font-semibold tracking-tight">Carteira</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2 text-xs h-8" onClick={() => refreshMarket.mutate()} disabled={refreshMarket.isPending}>
            <RefreshCw className={cn('h-3.5 w-3.5', refreshMarket.isPending && 'animate-spin')} />
            Atualizar
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2 h-8 text-xs" onClick={resetForm}><Plus className="h-3.5 w-3.5" /> Novo Ativo</Button>
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
                  <div className="space-y-1"><Label className="text-xs">Preço Médio</Label><Input type="number" step="0.01" value={form.avg_price} onChange={e => setForm({ ...form, avg_price: e.target.value })} className="font-mono" /></div>
                </div>
                <Button className="w-full" onClick={handleAdd} disabled={addAsset.isPending || !form.ticker || !form.class_id}>{addAsset.isPending ? 'Salvando...' : 'Adicionar'}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {portfolio.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground text-sm">
          Nenhum ativo cadastrado. Clique em "Novo Ativo" para começar.
        </Card>
      ) : (
        <Tabs defaultValue={defaultTab}>
          <TabsList className="mb-4 flex flex-wrap h-auto gap-1">
            {classesWithPositions.map(cls => {
              const count = portfolio.filter(p => p.class_id === cls.id).length;
              return (
                <TabsTrigger key={cls.id} value={cls.id} className="text-xs">
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
                <div className="glass-card overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b border-border/40">
                        <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Ticker</TableHead>
                        <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Nome</TableHead>
                        <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Qtd</TableHead>
                        <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">PM</TableHead>
                        <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Atual</TableHead>
                        <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Total</TableHead>
                        <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">% Classe</TableHead>
                        <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">% Cart.</TableHead>
                        <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">DY</TableHead>
                        <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Status</TableHead>
                        <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-20">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {positions.map(pos => {
                        const price = pos.last_price ?? pos.avg_price;
                        const total = pos.quantity * price;
                        const pctClass = classTotal > 0 ? (total / classTotal) * 100 : 0;
                        const pctPortfolio = totalPortfolio > 0 ? (total / totalPortfolio) * 100 : 0;
                        const gain = pos.avg_price > 0 ? ((price - pos.avg_price) / pos.avg_price) * 100 : 0;
                        const status = formatRelativeAge(pos.price_updated_at);

                        return (
                          <TableRow key={pos.id} className="data-row">
                            <TableCell className="font-mono font-medium text-foreground">{pos.ticker}</TableCell>
                            <TableCell className="text-muted-foreground text-xs">{pos.name || '—'}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{pos.quantity}</TableCell>
                            <TableCell className="text-right font-mono text-sm text-muted-foreground">{formatBRL(pos.avg_price)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              <span className={gain >= 0 ? 'text-positive' : 'text-negative'}>{formatBRL(price)}</span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-medium">{formatBRL(total)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{formatPct(pctClass)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{formatPct(pctPortfolio)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{pos.effective_dy != null ? formatPct(pos.effective_dy) : '—'}</TableCell>
                            <TableCell>
                              <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="outline" className={cn('text-[10px] whitespace-nowrap', statusBadgeClass[status.variant])}>{status.label}</Badge>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">
                                    {status.fullDate ? (
                                      <div className="space-y-0.5">
                                        <div>Última: {status.fullDate}</div>
                                        {pos.price_source && <div>Fonte: {pos.price_source}</div>}
                                      </div>
                                    ) : 'Sem dados'}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-0.5">
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => openEdit(pos)}><Pencil className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setFundAsset(pos)}><BarChart3 className="h-3.5 w-3.5" /></Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/70 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button></AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Excluir {pos.ticker}?</AlertDialogTitle>
                                      <AlertDialogDescription>Esta ação é irreversível.</AlertDialogDescription>
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
                      <TableRow className="bg-muted/20 font-medium">
                        <TableCell colSpan={5} className="text-xs text-muted-foreground uppercase tracking-wider">Total</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatBRL(classTotal)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">100%</TableCell>
                        <TableCell className="text-right font-mono text-xs">{totalPortfolio > 0 ? formatPct((classTotal / totalPortfolio) * 100) : '—'}</TableCell>
                        <TableCell colSpan={3} />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      <Dialog open={!!editAsset} onOpenChange={open => { if (!open) setEditAsset(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar {editAsset?.ticker}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1"><Label className="text-xs">Nome</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Quantidade</Label><Input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="font-mono" /></div>
              <div className="space-y-1"><Label className="text-xs">Preço Médio</Label><Input type="number" step="0.01" value={form.avg_price} onChange={e => setForm({ ...form, avg_price: e.target.value })} className="font-mono" /></div>
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
