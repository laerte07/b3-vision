import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { BarChart3, Eye, Trash2, Search, ArrowUpDown, Inbox, GitCompare, Trophy, TrendingUp, Flame } from 'lucide-react';
// Flame icon used in TopOpportunities
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatBRL, formatPct } from '@/lib/format';
import {
  useSavedValuations, useDeleteSavedValuation,
  MODEL_LABELS, MODEL_TAB_KEYS, type SavedValuation,
} from '@/hooks/useSavedValuations';
import { buildConsensus, scoreClassification, type ConsensusRow } from '@/lib/valuation-consensus';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenValuation?: (modelTabKey: string, ticker: string) => void;
}

type FilterMode = 'all' | 'under' | 'over';
type SortMode = 'recent' | 'upside_desc' | 'dy_desc';

const MODEL_KEYS = Object.keys(MODEL_LABELS);

const UpsideBadge = ({ upside }: { upside: number | null }) => {
  if (upside === null || !Number.isFinite(upside)) return <Badge variant="outline">—</Badge>;
  const positive = upside >= 0;
  return (
    <Badge className={positive
      ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30'
      : 'bg-red-500/15 text-red-600 border border-red-500/30'}>
      {positive ? 'Subvalorizado' : 'Sobrevalorizado'}
    </Badge>
  );
};

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return '—';
  }
};

const ValuationRow = ({ v, onOpen, onDelete }: {
  v: SavedValuation;
  onOpen: () => void;
  onDelete: () => void;
}) => {
  const upsideColor = v.upside === null ? '' : v.upside >= 0 ? 'text-emerald-500' : 'text-red-500';
  return (
    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={onOpen}>
      <TableCell className="font-mono font-semibold">{v.ticker}</TableCell>
      <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{v.name || '—'}</TableCell>
      <TableCell className="font-mono text-right">{v.current_price !== null ? formatBRL(v.current_price) : '—'}</TableCell>
      <TableCell className="font-mono text-right">{v.dividend_yield !== null ? formatPct(v.dividend_yield * 100) : '—'}</TableCell>
      <TableCell className="font-mono text-right">{v.max_buy_price !== null ? formatBRL(v.max_buy_price) : '—'}</TableCell>
      <TableCell className={`font-mono text-right ${upsideColor}`}>
        {v.upside !== null ? `${v.upside >= 0 ? '+' : ''}${formatPct(v.upside)}` : '—'}
      </TableCell>
      <TableCell><UpsideBadge upside={v.upside} /></TableCell>
      <TableCell className="text-xs text-muted-foreground">{formatDate(v.updated_at)}</TableCell>
      <TableCell onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1 justify-end">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onOpen} title="Ver / editar">
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600" title="Excluir">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir valuation?</AlertDialogTitle>
                <AlertDialogDescription>
                  Você está prestes a excluir o valuation {MODEL_LABELS[v.model_type] || v.model_type} de {v.ticker}. Esta ação não pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete} className="bg-red-500 hover:bg-red-600">Excluir</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  );
};

const ValuationCard = ({ v, onOpen, onDelete }: {
  v: SavedValuation;
  onOpen: () => void;
  onDelete: () => void;
}) => {
  const upsideColor = v.upside === null ? '' : v.upside >= 0 ? 'text-emerald-500' : 'text-red-500';
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono font-semibold">{v.ticker}</div>
          <div className="text-[11px] text-muted-foreground line-clamp-1">{v.name || '—'}</div>
        </div>
        <UpsideBadge upside={v.upside} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase">Preço atual</div>
          <div className="font-mono">{v.current_price !== null ? formatBRL(v.current_price) : '—'}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase">Preço teto</div>
          <div className="font-mono">{v.max_buy_price !== null ? formatBRL(v.max_buy_price) : '—'}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase">DY</div>
          <div className="font-mono">{v.dividend_yield !== null ? formatPct(v.dividend_yield * 100) : '—'}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase">Upside</div>
          <div className={`font-mono ${upsideColor}`}>
            {v.upside !== null ? `${v.upside >= 0 ? '+' : ''}${formatPct(v.upside)}` : '—'}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <span className="text-[10px] text-muted-foreground">{formatDate(v.updated_at)}</span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7" onClick={onOpen}>
            <Eye className="h-3 w-3 mr-1" /> Ver
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500"><Trash2 className="h-3.5 w-3.5" /></Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir valuation?</AlertDialogTitle>
                <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete} className="bg-red-500 hover:bg-red-600">Excluir</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
};

const EmptyState = ({ msg }: { msg: string }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <Inbox className="h-10 w-10 text-muted-foreground mb-2" />
    <p className="text-sm text-muted-foreground">{msg}</p>
  </div>
);

export const SavedValuationsModal = ({ open, onOpenChange, onOpenValuation }: Props) => {
  const { data: valuations = [], isLoading } = useSavedValuations();
  const deleteMut = useDeleteSavedValuation();
  const [view, setView] = useState<'list' | 'compare'>('list');
  const [activeTab, setActiveTab] = useState<string>('graham');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [sort, setSort] = useState<SortMode>('recent');

  const consensus = useMemo(() => buildConsensus(valuations, MODEL_KEYS), [valuations]);
  const filteredConsensus = useMemo(() => {
    let list = consensus;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(c => c.ticker.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q));
    }
    return list;
  }, [consensus, search]);
  const topScore = filteredConsensus[0]?.score ?? -1;

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    MODEL_KEYS.forEach(k => { c[k] = 0; });
    valuations.forEach(v => { if (c[v.model_type] !== undefined) c[v.model_type]++; });
    return c;
  }, [valuations]);

  const filtered = useMemo(() => {
    let list = valuations.filter(v => v.model_type === activeTab);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(v => v.ticker.toLowerCase().includes(q) || (v.name || '').toLowerCase().includes(q));
    }
    if (filter === 'under') list = list.filter(v => (v.upside ?? 0) >= 0);
    if (filter === 'over') list = list.filter(v => (v.upside ?? 0) < 0);
    list = [...list].sort((a, b) => {
      if (sort === 'upside_desc') return (b.upside ?? -Infinity) - (a.upside ?? -Infinity);
      if (sort === 'dy_desc') return (b.dividend_yield ?? -Infinity) - (a.dividend_yield ?? -Infinity);
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return list;
  }, [valuations, activeTab, search, filter, sort]);

  const handleOpen = (v: SavedValuation) => {
    onOpenValuation?.(MODEL_TAB_KEYS[v.model_type] || 'graham', v.ticker);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] md:max-w-6xl p-0 gap-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="p-4 md:p-6 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" /> Meus Valuations
          </DialogTitle>
          <DialogDescription>
            {view === 'compare'
              ? 'Comparativo entre métodos com score consolidado'
              : 'Seus cálculos salvos por método'}
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 md:px-6 pt-3 pb-2 flex items-center gap-2 border-b border-border">
          <Button
            size="sm"
            variant={view === 'list' ? 'default' : 'outline'}
            onClick={() => setView('list')}
            className="h-9"
          >
            <BarChart3 className="h-3.5 w-3.5 mr-1" /> Por Método
          </Button>
          <Button
            size="sm"
            variant={view === 'compare' ? 'default' : 'outline'}
            onClick={() => setView('compare')}
            className="h-9"
          >
            <GitCompare className="h-3.5 w-3.5 mr-1" /> Comparar Métodos
            {consensus.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{consensus.length}</Badge>
            )}
          </Button>
        </div>

        {view === 'list' ? (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 md:px-6 pt-3 border-b border-border">
              <ScrollArea className="w-full">
                <TabsList className="flex w-max h-auto gap-1 bg-muted/50 p-1">
                  {MODEL_KEYS.map(k => (
                    <TabsTrigger key={k} value={k} className="whitespace-nowrap text-xs">
                      {MODEL_LABELS[k]}
                      {counts[k] > 0 && (
                        <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{counts[k]}</Badge>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </ScrollArea>
            </div>

            <div className="px-4 md:px-6 py-3 flex flex-col md:flex-row gap-2 md:items-center border-b border-border">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar por ticker ou empresa..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')} className="h-9">Todos</Button>
                <Button size="sm" variant={filter === 'under' ? 'default' : 'outline'} onClick={() => setFilter('under')} className="h-9">Subvalorizados</Button>
                <Button size="sm" variant={filter === 'over' ? 'default' : 'outline'} onClick={() => setFilter('over')} className="h-9">Sobrevalorizados</Button>
              </div>
              <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
                <SelectTrigger className="h-9 w-full md:w-[180px]">
                  <ArrowUpDown className="h-3.5 w-3.5 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Mais recente</SelectItem>
                  <SelectItem value="upside_desc">Maior upside</SelectItem>
                  <SelectItem value="dy_desc">Maior DY</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <ScrollArea className="flex-1">
              {MODEL_KEYS.map(k => (
                <TabsContent key={k} value={k} className="m-0 p-4 md:p-6">
                  {isLoading ? (
                    <EmptyState msg="Carregando valuations..." />
                  ) : filtered.length === 0 ? (
                    <EmptyState msg={
                      valuations.filter(v => v.model_type === k).length === 0
                        ? 'Nenhum valuation salvo neste método'
                        : 'Nenhum resultado para os filtros aplicados'
                    } />
                  ) : (
                    <>
                      <div className="hidden md:block rounded-lg border border-border overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Ticker</TableHead>
                              <TableHead>Empresa</TableHead>
                              <TableHead className="text-right">Preço atual</TableHead>
                              <TableHead className="text-right">DY</TableHead>
                              <TableHead className="text-right">Preço teto</TableHead>
                              <TableHead className="text-right">Upside</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Data</TableHead>
                              <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filtered.map(v => (
                              <ValuationRow
                                key={v.id}
                                v={v}
                                onOpen={() => handleOpen(v)}
                                onDelete={() => deleteMut.mutate(v.id)}
                              />
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="md:hidden grid grid-cols-1 gap-2">
                        {filtered.map(v => (
                          <ValuationCard
                            key={v.id}
                            v={v}
                            onOpen={() => handleOpen(v)}
                            onDelete={() => deleteMut.mutate(v.id)}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </TabsContent>
              ))}
            </ScrollArea>
          </Tabs>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 md:px-6 py-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar ativo..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-4 md:p-6 space-y-4">
                {isLoading ? (
                  <EmptyState msg="Carregando comparativo..." />
                ) : filteredConsensus.length === 0 ? (
                  <EmptyState msg="Nenhum valuation salvo para comparar" />
                ) : (
                  <>
                    <TopOpportunities
                      rows={filteredConsensus}
                      onOpen={(ticker, model) => {
                        onOpenValuation?.(MODEL_TAB_KEYS[model] || 'graham', ticker);
                        onOpenChange(false);
                      }}
                    />
                    <CompareView
                      rows={filteredConsensus}
                      topScore={topScore}
                      onOpen={(ticker, model) => {
                        onOpenValuation?.(MODEL_TAB_KEYS[model] || 'graham', ticker);
                        onOpenChange(false);
                      }}
                    />
                  </>
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const ScoreBadge = ({ score, breakdown }: { score: number; breakdown: ConsensusRow['breakdown'] }) => {
  const cls = scoreClassification(score);
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className={`border ${cls.className} font-mono cursor-help`}>
            {score} {cls.emoji} {cls.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          <div className="space-y-1">
            <div>Upside: <strong>{breakdown.upside}</strong></div>
            <div>Consistência: <strong>{breakdown.consistency}</strong></div>
            <div>Margem segurança: <strong>{breakdown.safety}</strong></div>
            <div>Cobertura: <strong>{breakdown.coverage}</strong></div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const CompareView = ({ rows, topScore, onOpen }: {
  rows: ConsensusRow[];
  topScore: number;
  onOpen: (ticker: string, model: string) => void;
}) => {
  return (
    <>
      <div className="hidden md:block rounded-lg border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-card">Ativo</TableHead>
              <TableHead className="text-right">Preço atual</TableHead>
              {MODEL_KEYS.map(k => (
                <TableHead key={k} className="text-right whitespace-nowrap text-[11px]">
                  {MODEL_LABELS[k]}
                </TableHead>
              ))}
              <TableHead className="text-right">Upside médio</TableHead>
              <TableHead>Melhor método</TableHead>
              <TableHead className="text-right">Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => {
              const isTop = r.score === topScore && topScore > 0;
              return (
                <TableRow
                  key={r.ticker}
                  className={`cursor-pointer hover:bg-muted/40 transition-shadow ${isTop ? 'bg-primary/5 ring-1 ring-primary/40 shadow-[0_0_18px_-6px_hsl(var(--primary)/0.5)]' : ''}`}
                  onClick={() => r.bestModel && onOpen(r.ticker, r.bestModel)}
                >
                  <TableCell className="sticky left-0 bg-card font-mono font-semibold">
                    <div className="flex items-center gap-1">
                      {isTop && <Trophy className="h-3.5 w-3.5 text-primary" />}
                      {r.ticker}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-sans truncate max-w-[140px]">{r.name || '—'}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.current_price !== null ? formatBRL(r.current_price) : '—'}
                  </TableCell>
                  {MODEL_KEYS.map(k => {
                    const v = r.byModel[k];
                    const fair = v?.max_buy_price ?? v?.fair_value ?? null;
                    const isBest = r.bestModel === k;
                    return (
                      <TableCell
                        key={k}
                        className={`text-right font-mono text-xs ${isBest ? 'text-emerald-600 font-bold bg-emerald-500/5' : ''}`}
                      >
                        {fair !== null ? formatBRL(fair) : '—'}
                      </TableCell>
                    );
                  })}
                  <TableCell className={`text-right font-mono ${(r.avgUpside ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {r.avgUpside !== null ? (
                      <span className="inline-flex items-center gap-0.5">
                        {r.avgUpside >= 0 && <TrendingUp className="h-3 w-3" />}
                        {r.avgUpside >= 0 ? '+' : ''}{formatPct(r.avgUpside)}
                      </span>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    {r.bestModel ? (
                      <Badge className="bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 text-[10px] gap-1">
                        <Trophy className="h-2.5 w-2.5" />
                        {MODEL_LABELS[r.bestModel]}
                        {r.bestUpside !== null && (
                          <span className="opacity-80">({r.bestUpside >= 0 ? '+' : ''}{formatPct(r.bestUpside)})</span>
                        )}
                      </Badge>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <ScoreBadge score={r.score} breakdown={r.breakdown} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="md:hidden grid grid-cols-1 gap-2">
        {rows.map(r => {
          const isTop = r.score === topScore && topScore > 0;
          return (
            <div
              key={r.ticker}
              className={`rounded-lg border p-3 space-y-2 cursor-pointer ${isTop ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'}`}
              onClick={() => r.bestModel && onOpen(r.ticker, r.bestModel)}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono font-semibold">{r.ticker}</div>
                  <div className="text-[11px] text-muted-foreground line-clamp-1">{r.name || '—'}</div>
                </div>
                <ScoreBadge score={r.score} breakdown={r.breakdown} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase">Preço atual</div>
                  <div className="font-mono">{r.current_price !== null ? formatBRL(r.current_price) : '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase">Upside médio</div>
                  <div className={`font-mono ${(r.avgUpside ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {r.avgUpside !== null ? `${r.avgUpside >= 0 ? '+' : ''}${formatPct(r.avgUpside)}` : '—'}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-[10px] text-muted-foreground uppercase">Melhor método</div>
                  <div className="font-mono text-emerald-600">
                    {r.bestModel ? `${MODEL_LABELS[r.bestModel]} • ${formatBRL(r.bestFairValue || 0)}` : '—'}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-[10px] text-muted-foreground uppercase">Cobertura</div>
                  <div className="font-mono">{r.coverage} / {MODEL_KEYS.length} métodos</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};
