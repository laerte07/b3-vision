import { useState, useMemo, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, CheckCircle, AlertTriangle, Search } from 'lucide-react';
import { PortfolioAsset } from '@/hooks/usePortfolio';
import { formatBRL } from '@/lib/format';
import { parseMoney } from '@/lib/parse-money';
import { cn } from '@/lib/utils';

// ============================================================
// TYPES
// ============================================================
export interface LaunchItem {
  id: string;
  type: 'compra' | 'venda';
  asset_id: string;
  ticker: string;
  class_id: string;
  price: number;
  quantity: number;
  fees: number;
  total: number;
  priceAuto: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portfolio: PortfolioAsset[];
  classes: { id: string; name: string; slug: string }[];
  /** Pre-filled items from suggestion engine */
  prefillItems?: {
    asset: PortfolioAsset;
    qty: number;
    price: number;
  }[];
  aporteDate: string;
  noteText: string;
  onConfirm: (items: LaunchItem[], note: string, date: string) => void;
  isPending: boolean;
}

// ============================================================
// HELPERS
// ============================================================
let _nextId = 1;
const genId = () => `launch-${_nextId++}`;

const CLASS_LABELS: Record<string, string> = {
  acoes: 'Ações',
  fiis: 'FIIs',
  etfs: 'ETFs',
  bdrs: 'BDRs',
  renda_fixa: 'Renda Fixa',
};

function recalcTotal(item: LaunchItem): LaunchItem {
  return { ...item, total: +(item.price * item.quantity + item.fees).toFixed(2) };
}

// ============================================================
// COMPONENT
// ============================================================
export function ContributionLaunchModal({
  open, onOpenChange, portfolio, classes, prefillItems, aporteDate, noteText: initialNote, onConfirm, isPending,
}: Props) {
  const [items, setItems] = useState<LaunchItem[]>([]);
  const [note, setNote] = useState(initialNote);
  const [date, setDate] = useState(aporteDate);

  // Populate from prefill when modal opens
  useEffect(() => {
    if (!open) return;
    setNote(initialNote);
    setDate(aporteDate);

    if (prefillItems && prefillItems.length > 0) {
      setItems(
        prefillItems.map(pi => recalcTotal({
          id: genId(),
          type: 'compra',
          asset_id: pi.asset.id,
          ticker: pi.asset.ticker,
          class_id: pi.asset.class_id,
          price: pi.price,
          quantity: pi.qty,
          fees: 0,
          total: 0,
          priceAuto: true,
        }))
      );
    } else {
      setItems([]);
    }
  }, [open, prefillItems, aporteDate, initialNote]);

  const grandTotal = useMemo(() => items.reduce((s, i) => s + i.total, 0), [items]);

  const updateItem = useCallback((id: string, patch: Partial<LaunchItem>) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, ...patch };

      // Auto-calc logic
      // If price + qty changed → recalc total
      if ('price' in patch || 'quantity' in patch || 'fees' in patch) {
        return recalcTotal(updated);
      }
      // If total changed manually → recalc qty from price
      if ('total' in patch && updated.price > 0) {
        const newQty = Math.floor((updated.total - updated.fees) / updated.price);
        return { ...updated, quantity: Math.max(0, newQty), total: +(newQty * updated.price + updated.fees).toFixed(2) };
      }
      return updated;
    }));
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const addEmptyItem = useCallback(() => {
    setItems(prev => [...prev, {
      id: genId(),
      type: 'compra',
      asset_id: '',
      ticker: '',
      class_id: '',
      price: 0,
      quantity: 0,
      fees: 0,
      total: 0,
      priceAuto: false,
    }]);
  }, []);

  const handleConfirm = () => {
    const valid = items.filter(i => i.asset_id && i.quantity > 0 && i.price > 0);
    if (valid.length === 0) return;
    onConfirm(valid, note, date);
  };

  const validCount = items.filter(i => i.asset_id && i.quantity > 0 && i.price > 0).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">Adicionar Lançamento</DialogTitle>
        </DialogHeader>

        {/* Date + Note row */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Data da operação</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="font-mono h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Observação (opcional)</Label>
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Ex: Aporte mensal março" className="h-9 text-sm" />
          </div>
        </div>

        {/* Items */}
        {items.length > 0 && (
          <div className="space-y-3">
            {items.map((item, idx) => (
              <LaunchItemRow
                key={item.id}
                item={item}
                index={idx}
                portfolio={portfolio}
                classes={classes}
                onUpdate={updateItem}
                onRemove={removeItem}
              />
            ))}
          </div>
        )}

        {/* Add item button */}
        <Button variant="outline" size="sm" className="gap-1.5 mt-3 w-full" onClick={addEmptyItem}>
          <Plus className="h-3.5 w-3.5" /> Adicionar Lançamento
        </Button>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Valor total</span>
            <span className="text-lg font-bold font-mono text-primary">{formatBRL(grandTotal)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button size="sm" className="gap-1.5" onClick={handleConfirm} disabled={isPending || validCount === 0}>
              <CheckCircle className="h-3.5 w-3.5" />
              {isPending ? 'Salvando...' : `Confirmar ${validCount > 0 ? `(${validCount})` : ''}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// SINGLE ITEM ROW
// ============================================================
function LaunchItemRow({
  item, index, portfolio, classes, onUpdate, onRemove,
}: {
  item: LaunchItem;
  index: number;
  portfolio: PortfolioAsset[];
  classes: { id: string; name: string; slug: string }[];
  onUpdate: (id: string, patch: Partial<LaunchItem>) => void;
  onRemove: (id: string) => void;
}) {
  const [assetSearch, setAssetSearch] = useState('');
  const [assetOpen, setAssetOpen] = useState(false);
  const [priceRaw, setPriceRaw] = useState(item.price > 0 ? item.price.toFixed(2).replace('.', ',') : '');
  const [qtyRaw, setQtyRaw] = useState(item.quantity > 0 ? String(item.quantity) : '');
  const [feesRaw, setFeesRaw] = useState('');
  const [totalRaw, setTotalRaw] = useState('');

  // Sync from parent when prefilled
  useEffect(() => {
    if (item.price > 0) setPriceRaw(item.price.toFixed(2).replace('.', ','));
    if (item.quantity > 0) setQtyRaw(String(item.quantity));
  }, [item.price, item.quantity]);

  // Filtered assets for search
  const filteredAssets = useMemo(() => {
    if (assetSearch.length < 2) return [];
    const q = assetSearch.toLowerCase();
    return portfolio.filter(a =>
      a.active && (
        a.ticker.toLowerCase().includes(q) ||
        (a.name ?? '').toLowerCase().includes(q)
      )
    ).slice(0, 15);
  }, [portfolio, assetSearch]);

  // Find current position for sell validation
  const currentPosition = portfolio.find(p => p.id === item.asset_id);
  const maxSellQty = currentPosition?.quantity ?? 0;
  const sellExceeds = item.type === 'venda' && item.quantity > maxSellQty;

  const handlePriceBlur = () => {
    const val = parseMoney(priceRaw);
    onUpdate(item.id, { price: val, priceAuto: false });
  };

  const handleQtyBlur = () => {
    const val = parseInt(qtyRaw) || 0;
    onUpdate(item.id, { quantity: val });
  };

  const handleFeesBlur = () => {
    const val = parseMoney(feesRaw);
    onUpdate(item.id, { fees: val });
  };

  const handleTotalBlur = () => {
    const val = parseMoney(totalRaw);
    if (val > 0) onUpdate(item.id, { total: val });
  };

  const classSlug = classes.find(c => c.id === item.class_id)?.slug ?? '';

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
      {/* Header: type toggle + asset + remove */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground font-medium min-w-[20px]">#{index + 1}</span>

        {/* Buy/Sell toggle */}
        <Tabs value={item.type} onValueChange={v => onUpdate(item.id, { type: v as 'compra' | 'venda' })} className="shrink-0">
          <TabsList className="h-8">
            <TabsTrigger value="compra" className="text-xs px-3 h-7 data-[state=active]:bg-emerald-600/20 data-[state=active]:text-emerald-400">
              Compra
            </TabsTrigger>
            <TabsTrigger value="venda" className="text-xs px-3 h-7 data-[state=active]:bg-red-600/20 data-[state=active]:text-red-400">
              Venda
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Asset class */}
        <Select value={item.class_id || undefined} onValueChange={v => onUpdate(item.id, { class_id: v })}>
          <SelectTrigger className="w-[120px] h-8 text-xs">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            {classes.map(c => (
              <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Asset search */}
        <Popover open={assetOpen} onOpenChange={setAssetOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("flex-1 justify-start text-xs h-8 font-mono", !item.ticker && "text-muted-foreground")}>
              <Search className="h-3 w-3 mr-1.5 shrink-0" />
              {item.ticker || 'Selecionar ativo...'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[260px] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput placeholder="Digite 2+ caracteres..." value={assetSearch} onValueChange={setAssetSearch} className="text-xs" />
              <CommandList>
                <CommandEmpty className="text-xs py-4 text-center">
                  {assetSearch.length < 2 ? 'Digite 2 ou mais caracteres' : 'Nenhum ativo encontrado'}
                </CommandEmpty>
                {filteredAssets.length > 0 && (
                  <CommandGroup>
                    {filteredAssets.map(a => (
                      <CommandItem
                        key={a.id}
                        value={a.id}
                        onSelect={() => {
                          const price = a.last_price ?? a.avg_price;
                          onUpdate(item.id, {
                            asset_id: a.id,
                            ticker: a.ticker,
                            class_id: a.class_id,
                            price,
                            priceAuto: true,
                          });
                          setPriceRaw(price.toFixed(2).replace('.', ','));
                          setAssetOpen(false);
                          setAssetSearch('');
                        }}
                        className="text-xs"
                      >
                        <div className="flex justify-between w-full">
                          <span className="font-mono font-medium">{a.ticker}</span>
                          <span className="text-muted-foreground">{a.last_price ? formatBRL(a.last_price) : '—'}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 text-destructive hover:text-destructive" onClick={() => onRemove(item.id)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Fields row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Preço (R$)</Label>
          <Input
            type="text" inputMode="decimal"
            value={priceRaw}
            onChange={e => setPriceRaw(e.target.value)}
            onBlur={handlePriceBlur}
            className="h-8 text-xs font-mono"
            placeholder="0,00"
          />
          {item.priceAuto && <span className="text-[9px] text-muted-foreground">Preço atual</span>}
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Quantidade</Label>
          <Input
            type="text" inputMode="numeric"
            value={qtyRaw}
            onChange={e => setQtyRaw(e.target.value)}
            onBlur={handleQtyBlur}
            className="h-8 text-xs font-mono"
            placeholder="0"
          />
          {sellExceeds && (
            <span className="text-[9px] text-destructive flex items-center gap-0.5">
              <AlertTriangle className="h-2.5 w-2.5" /> Máx: {maxSellQty}
            </span>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Outros custos</Label>
          <Input
            type="text" inputMode="decimal"
            value={feesRaw}
            onChange={e => setFeesRaw(e.target.value)}
            onBlur={handleFeesBlur}
            className="h-8 text-xs font-mono"
            placeholder="0,00"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Valor total</Label>
          <div className="h-8 flex items-center px-3 rounded-md border border-border bg-muted/30 text-xs font-mono font-bold text-primary">
            {formatBRL(item.total)}
          </div>
        </div>
      </div>
    </div>
  );
}
