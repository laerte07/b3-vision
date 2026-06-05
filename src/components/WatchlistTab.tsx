import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Eye, Plus, Trash2, BarChart3, Pencil, Search, Loader2, Wallet } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useWatchlist, useAddToWatchlist, useRemoveFromWatchlist, useLookupTicker, useUpdateWatchlistNote, WatchlistRow } from '@/hooks/useWatchlist';
import { formatBRL, formatPct } from '@/lib/format';
import FundamentalsDrawer from '@/components/FundamentalsDrawer';

export const WatchlistTab = () => {
  const { data: items = [], isLoading } = useWatchlist();
  const { data: classes = [] } = useAssetClasses();
  const navigate = useNavigate();
  const add = useAddToWatchlist();
  const remove = useRemoveFromWatchlist();
  const updateNote = useUpdateWatchlistNote();
  const lookup = useLookupTicker();

  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<WatchlistRow | null>(null);
  const [fundAsset, setFundAsset] = useState<WatchlistRow | null>(null);

  const [form, setForm] = useState<{ ticker: string; setor: string; notes: string; preview: any }>({
    ticker: '', setor: '', notes: '', preview: null,
  });

  const resetForm = () => setForm({ ticker: '', setor: '', notes: '', preview: null });

  // Open Aportes page with this watchlist asset pre-filled in the launch modal.
  const handleAportar = (it: WatchlistRow) => {
    // Detect class: prefer the asset's existing class_id; fallback by ticker heuristic.
    let classId = it.class_id;
    if (!classId) {
      const t = it.ticker.toUpperCase();
      let slug = 'acoes';
      if (/11$/.test(t)) slug = 'fiis';
      const cls = classes.find(c => c.slug === slug) ?? classes.find(c => c.slug === 'acoes');
      classId = cls?.id ?? '';
    }
    const payload = {
      ticker: it.ticker,
      asset_id: it.id,
      class_id: classId,
      price: it.last_price ?? 0,
      qty: 1,
    };
    sessionStorage.setItem('aporte_prefill_watchlist', JSON.stringify(payload));
    navigate('/app/contributions');
  };

  const handleSearch = async () => {
    if (!form.ticker.trim()) return;
    try {
      const res = await lookup.mutateAsync(form.ticker);
      setForm(f => ({ ...f, preview: res, setor: res.sector ?? f.setor }));
    } catch {
      setForm(f => ({ ...f, preview: null }));
    }
  };

  const handleAdd = () => {
    add.mutate({
      ticker: form.ticker.toUpperCase(),
      nome: form.preview?.name ?? null,
      setor: form.setor || null,
      notes: form.notes || null,
      price: form.preview?.price ?? null,
      dy: form.preview?.dy ?? null,
    }, { onSuccess: () => { setAddOpen(false); resetForm(); } });
  };

  const handleSaveNotes = () => {
    if (!editItem) return;
    updateNote.mutate(
      { id: editItem.watchlist_id, notes: form.notes, setor: form.setor },
      { onSuccess: () => { setEditItem(null); resetForm(); } },
    );
  };

  if (isLoading) {
    return <div className="text-muted-foreground text-sm py-6 text-center">Carregando watchlist...</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2 h-8 text-xs" onClick={() => { resetForm(); setAddOpen(true); }}>
          <Plus className="h-3.5 w-3.5" /> Adicionar Ativo
        </Button>
      </div>

      {items.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <Eye className="h-12 w-12 mx-auto text-muted-foreground/50" />
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Nenhum ativo em observação</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Adicione ativos para acompanhar e realizar valuations sem precisar tê-los em carteira.
            </p>
          </div>
          <Button size="sm" className="gap-2 h-8 text-xs" onClick={() => { resetForm(); setAddOpen(true); }}>
            <Plus className="h-3.5 w-3.5" /> Adicionar primeiro ativo
          </Button>
        </Card>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {items.map(it => (
              <div key={it.watchlist_id} className="glass-card p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-sm">{it.ticker}</span>
                    <span className="text-muted-foreground text-xs truncate max-w-[120px]">{it.name || ''}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] border-primary/30 text-primary bg-primary/5">Observando</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><span className="text-muted-foreground block">Preço</span><span className="font-mono">{it.last_price != null ? formatBRL(it.last_price) : '—'}</span></div>
                  <div><span className="text-muted-foreground block">DY</span><span className="font-mono">{it.effective_dy != null ? formatPct(it.effective_dy) : '—'}</span></div>
                  <div><span className="text-muted-foreground block">Setor</span><span className="text-xs truncate">{it.setor || '—'}</span></div>
                </div>
                <div className="flex justify-end gap-0.5 pt-1 border-t border-border/30">
                  <AportarBtn onClick={() => handleAportar(it)} />
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => { setEditItem(it); setForm({ ticker: it.ticker, setor: it.setor || '', notes: it.notes || '', preview: null }); }}><Pencil className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => setFundAsset(it)}><BarChart3 className="h-3 w-3" /></Button>
                  <DeleteBtn ticker={it.ticker} onConfirm={() => remove.mutate(it.watchlist_id)} />
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block glass-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/40">
                  <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Ticker</TableHead>
                  <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Nome</TableHead>
                  <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Setor</TableHead>
                  <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Preço Atual</TableHead>
                  <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">DY</TableHead>
                  <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-24">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(it => (
                  <TableRow key={it.watchlist_id} className="data-row">
                    <TableCell className="font-mono font-medium text-foreground">{it.ticker}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{it.name || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">{it.setor || '—'}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{it.last_price != null ? formatBRL(it.last_price) : '—'}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{it.effective_dy != null ? formatPct(it.effective_dy) : '—'}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] border-primary/30 text-primary bg-primary/5">Observando</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-0.5">
                        <AportarBtn onClick={() => handleAportar(it)} />
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => { setEditItem(it); setForm({ ticker: it.ticker, setor: it.setor || '', notes: it.notes || '', preview: null }); }}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setFundAsset(it)}><BarChart3 className="h-3.5 w-3.5" /></Button>
                        <DeleteBtn ticker={it.ticker} onConfirm={() => remove.mutate(it.watchlist_id)} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Add modal */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader><DialogTitle>Adicionar à Watchlist</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1">
              <Label className="text-xs">Ticker</Label>
              <div className="flex gap-2">
                <Input
                  value={form.ticker}
                  onChange={e => setForm({ ...form, ticker: e.target.value.toUpperCase(), preview: null })}
                  placeholder="Ex: PETR4"
                  className="font-mono"
                  onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                />
                <Button type="button" variant="outline" onClick={handleSearch} disabled={lookup.isPending || !form.ticker.trim()} className="gap-2">
                  {lookup.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  Buscar
                </Button>
              </div>
              {lookup.isError && <p className="text-xs text-destructive">Ativo não encontrado</p>}
            </div>

            {form.preview && (
              <div className="glass-card p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-sm">{form.preview.ticker}</span>
                  <span className="text-xs text-muted-foreground">{form.preview.name || '—'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Preço: </span><span className="font-mono">{form.preview.price != null ? formatBRL(form.preview.price) : '—'}</span></div>
                  <div><span className="text-muted-foreground">DY: </span><span className="font-mono">{form.preview.dy != null ? formatPct(form.preview.dy) : '—'}</span></div>
                </div>
              </div>
            )}

            <div className="space-y-1"><Label className="text-xs">Setor (opcional)</Label><Input value={form.setor} onChange={e => setForm({ ...form, setor: e.target.value })} placeholder="Ex: Energia" /></div>
            <div className="space-y-1"><Label className="text-xs">Notas (opcional)</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Por que está observando este ativo?" /></div>

            <Button className="w-full" onClick={handleAdd} disabled={add.isPending || !form.ticker.trim() || !form.preview}>
              {add.isPending ? 'Salvando...' : 'Adicionar à Watchlist'}
            </Button>
            {!form.preview && form.ticker.trim() && <p className="text-[11px] text-muted-foreground text-center">Clique em "Buscar" para validar o ticker.</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit notes modal */}
      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o) { setEditItem(null); resetForm(); } }}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader><DialogTitle>Editar {editItem?.ticker}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1"><Label className="text-xs">Setor</Label><Input value={form.setor} onChange={e => setForm({ ...form, setor: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Notas</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={4} /></div>
            <Button className="w-full" onClick={handleSaveNotes} disabled={updateNote.isPending}>
              {updateNote.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <FundamentalsDrawer asset={fundAsset as any} open={!!fundAsset} onOpenChange={(o) => { if (!o) setFundAsset(null); }} />
    </div>
  );
};

const DeleteBtn = ({ ticker, onConfirm }: { ticker: string; onConfirm: () => void }) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/70 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Remover {ticker} da watchlist?</AlertDialogTitle>
        <AlertDialogDescription>Os valuations salvos para este ticker permanecerão intactos.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancelar</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm}>Remover</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default WatchlistTab;

const AportarBtn = ({ onClick }: { onClick: () => void }) => (
  <TooltipProvider delayDuration={150}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-emerald-500/80 hover:text-emerald-400"
          onClick={onClick}
        >
          <Wallet className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">Registrar aporte</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);