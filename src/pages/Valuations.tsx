import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Save, AlertTriangle, CheckCircle2, Info, Loader2, BarChart3, RotateCcw, Minus, Plus } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { SavedValuationsModal } from '@/components/SavedValuationsModal';
import { useSavedValuations } from '@/hooks/useSavedValuations';
import { formatBRL, formatPct } from '@/lib/format';
import { usePortfolio, PortfolioAsset } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  buildFinancialData,
  calcGraham,
  calcBazin,
  calcBuffett,
  calcLynch,
  calcPVPJustificado,
  calcPLJusto,
  calcEVEbitda,
  logValuation,
  type FinancialData,
  type SourcedValue,
} from '@/lib/financial-engine';

const ACOES_SLUG = 'acoes';

type DataStatus = 'idle' | 'loading' | 'success' | 'partial' | 'error';

// ---- Prefill helper: lets SavedValuationsModal pre-select a ticker per tab ----
const PREFILL_KEY = 'valuation_prefill_v1';
const readPrefill = (tab: string): string => {
  try {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    if (!raw) return '';
    const obj = JSON.parse(raw) as Record<string, string>;
    const t = obj[tab] || '';
    if (t) {
      delete obj[tab];
      sessionStorage.setItem(PREFILL_KEY, JSON.stringify(obj));
    }
    return t;
  } catch { return ''; }
};
export const writePrefill = (tab: string, ticker: string) => {
  try {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    obj[tab] = ticker;
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
};

// ---- Shared components ----

const SourceBadge = ({ sv }: { sv: SourcedValue }) => {
  const colors: Record<string, string> = {
    api: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
    manual: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
    calculado: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30',
    nd: 'bg-red-500/15 text-red-500 border-red-500/30',
  };
  return <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${colors[sv.source] || ''}`}>{sv.source}</Badge>;
};

const Warnings = ({ items }: { items: string[] }) => {
  if (!items.length) return null;
  return (
    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 space-y-1">
      {items.map((w, i) => (
        <p key={i} className="text-xs text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0" /> {w}
        </p>
      ))}
    </div>
  );
};

const EmptyAssetHint = () => (
  <div className="rounded-lg border border-border bg-muted/50 p-6 flex flex-col items-center gap-2">
    <Info className="h-5 w-5 text-muted-foreground" />
    <p className="text-sm text-muted-foreground text-center">Selecione um ativo para calcular o valuation</p>
  </div>
);

const LoadingSkeleton = () => (
  <div className="space-y-3 animate-fade-in">
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-center gap-2">
      <Loader2 className="h-4 w-4 text-primary animate-spin" />
      <p className="text-xs text-primary">Buscando dados fundamentalistas...</p>
    </div>
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-full" />
  </div>
);

const SuccessBanner = () => (
  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 flex items-center gap-2">
    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
    <p className="text-[11px] text-emerald-600 dark:text-emerald-400">Dados preenchidos automaticamente</p>
  </div>
);

const PartialBanner = () => (
  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-2.5 flex items-center justify-between gap-2">
    <div className="flex items-center gap-2">
      <Info className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
      <p className="text-[11px] text-yellow-600 dark:text-yellow-400">Alguns dados não foram encontrados — você pode editar manualmente</p>
    </div>
  </div>
);

const ErrorBanner = () => (
  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex flex-col items-center gap-2">
    <AlertTriangle className="h-4 w-4 text-red-500" />
    <p className="text-xs text-red-500 text-center">Não foi possível carregar os fundamentos deste ativo</p>
    <p className="text-[10px] text-muted-foreground">Preencha os campos manualmente abaixo</p>
  </div>
);

/** Renders the appropriate status banner */
const StatusBanner = ({ status, warnings }: { status: DataStatus; warnings: string[] }) => {
  if (status === 'loading') return <LoadingSkeleton />;
  if (status === 'error') return <ErrorBanner />;
  if (status === 'partial') return (
    <>
      <PartialBanner />
      <Warnings items={warnings} />
    </>
  );
  if (status === 'success') return (
    <>
      <SuccessBanner />
      {warnings.length > 0 && <Warnings items={warnings} />}
    </>
  );
  return null;
};

const ResultCard = ({ fairValue, currentPrice, maxBuyPrice, formula }: {
  fairValue: number; currentPrice: number; maxBuyPrice: number; formula: string;
}) => {
  const margin = fairValue > 0 ? ((fairValue - currentPrice) / fairValue) * 100 : 0;
  const upside = currentPrice > 0 ? ((fairValue - currentPrice) / currentPrice) * 100 : 0;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Resultado</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Preço Justo', value: formatBRL(fairValue), cls: 'text-primary' },
            { label: 'Margem de Segurança', value: formatPct(margin), cls: margin > 0 ? 'text-emerald-500' : 'text-red-500' },
            { label: 'Preço Máx. Compra', value: formatBRL(maxBuyPrice), cls: '' },
            { label: 'Upside/Downside', value: `${upside > 0 ? '+' : ''}${formatPct(upside)}`, cls: upside > 0 ? 'text-emerald-500' : 'text-red-500' },
          ].map(item => (
            <div key={item.label} className="p-3 rounded-lg bg-muted">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
              <p className={`text-lg font-bold font-mono mt-1 ${item.cls}`}>{item.value}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground border-t border-border pt-3 font-mono">{formula}</p>
      </CardContent>
    </Card>
  );
};

const FieldRow = ({ label, value, onChange, step = '0.01', disabled = false, hint, sourcedValue }: {
  label: string; value: string | number; onChange: (v: string) => void; step?: string; disabled?: boolean; hint?: string; sourcedValue?: SourcedValue;
}) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between">
      <Label className="text-xs">{label}</Label>
      {sourcedValue && <SourceBadge sv={sourcedValue} />}
    </div>
    <Input type="number" value={value} onChange={e => onChange(e.target.value)} step={step} className="font-mono h-9" disabled={disabled} />
    {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
  </div>
);

const useSaveValuation = () => {
  const { user } = useAuth();
  const { data: portfolio = [] } = usePortfolio();
  return async (ticker: string, modelType: string, params: Record<string, any>, fairValue: number, maxBuyPrice: number, currentPrice: number) => {
    if (!user) return;
    const asset = portfolio.find(a => a.ticker.toUpperCase() === ticker.toUpperCase());
    if (!asset) { toast.error(`Ativo ${ticker} não encontrado.`); return; }
    const upside = currentPrice > 0 ? ((fairValue - currentPrice) / currentPrice) * 100 : 0;
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('valuation_models').upsert({ user_id: user.id, asset_id: asset.id, model_type: modelType, json_params: params }, { onConflict: 'user_id,asset_id,model_type' }),
      supabase.from('valuation_results').upsert({ user_id: user.id, asset_id: asset.id, model_type: modelType, fair_value: fairValue, upside, max_buy_price: maxBuyPrice, json_breakdown: params }, { onConflict: 'user_id,asset_id,model_type' }),
    ]);
    if (e1 || e2) toast.error((e1 || e2)!.message);
    else toast.success(`Valuation ${modelType} salvo para ${ticker}`);
  };
};

const AssetSelector = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const { data: portfolio = [] } = usePortfolio();
  const { data: classes = [] } = useAssetClasses();
  const acoesClassId = classes.find(c => c.slug === ACOES_SLUG)?.id;
  const stocks = portfolio.filter(a => a.class_id === acoesClassId);
  return (
    <div className="space-y-1">
      <Label className="text-xs">Ativo (somente Ações)</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="font-mono h-9"><SelectValue placeholder="Selecione uma ação" /></SelectTrigger>
        <SelectContent>{stocks.map(a => <SelectItem key={a.id} value={a.ticker}>{a.ticker} — {a.name || ''}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
};

/** Hook: find asset and build FinancialData with status */
const useFinancialData = (ticker: string): { asset: PortfolioAsset | undefined; fd: FinancialData | null; status: DataStatus } => {
  const { data: portfolio = [], isLoading } = usePortfolio();
  return useMemo(() => {
    if (!ticker) return { asset: undefined, fd: null, status: 'idle' as DataStatus };
    if (isLoading) return { asset: undefined, fd: null, status: 'loading' as DataStatus };
    const asset = portfolio.find(a => a.ticker === ticker);
    if (!asset) return { asset: undefined, fd: null, status: 'error' as DataStatus };
    const fd = buildFinancialData(asset);
    // Determine status based on warnings and data quality
    const hasNd = [fd.lpa, fd.vpa, fd.price, fd.roe, fd.total_shares].some(sv => sv.source === 'nd');
    const status: DataStatus = hasNd ? 'partial' : 'success';
    return { asset, fd, status };
  }, [portfolio, ticker, isLoading]);
};

// ===================== GRAHAM =====================
const Graham = () => {
  const [ticker, setTicker] = useState(() => readPrefill('graham'));
  const [manualLpa, setManualLpa] = useState<number | null>(null);
  const [manualVpa, setManualVpa] = useState<number | null>(null);
  const { fd, status } = useFinancialData(ticker);
  const save = useSaveValuation();

  const lpa = manualLpa ?? fd?.lpa.value ?? 0;
  const vpa = manualVpa ?? fd?.vpa.value ?? 0;
  const price = fd?.price.value ?? 0;
  const { fairValue, warnings } = calcGraham(lpa, vpa);

  if (fd) logValuation('Graham', ticker, fd, { fairValue });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — Graham</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={ticker} onChange={t => { setTicker(t); setManualLpa(null); setManualVpa(null); }} />
          {status === 'idle' ? <EmptyAssetHint /> : status === 'loading' ? <LoadingSkeleton /> : <StatusBanner status={status} warnings={[...(fd?.warnings ?? []), ...warnings]} />}
          <FieldRow label="Preço Atual (R$)" value={price} onChange={() => {}} disabled sourcedValue={fd?.price} />
          <FieldRow label="LPA" value={lpa} onChange={v => setManualLpa(+v)} sourcedValue={manualLpa != null ? { value: manualLpa, source: 'manual' } : fd?.lpa} />
          <FieldRow label="VPA" value={vpa} onChange={v => setManualVpa(+v)} sourcedValue={manualVpa != null ? { value: manualVpa, source: 'manual' } : fd?.vpa} />
          <Button className="w-full gap-2 mt-2" onClick={() => save(ticker, 'graham', { lpa, vpa, price }, fairValue, fairValue * 0.75, price)} disabled={!ticker || fairValue <= 0}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <ResultCard fairValue={fairValue} currentPrice={price} maxBuyPrice={fairValue * 0.75} formula="VI = √(22,5 × LPA × VPA)" />
    </div>
  );
};

// ===================== BAZIN =====================
const Bazin = () => {
  const [ticker, setTicker] = useState(() => readPrefill('bazin'));
  const [manualDiv, setManualDiv] = useState<number | null>(null);
  const [minDY, setMinDY] = useState(6);
  const { fd, status } = useFinancialData(ticker);
  const save = useSaveValuation();

  // Div per share from div_12m (already per share in most cases)
  const autoDiv = fd ? fd.div_12m.value : 0;
  const avgDiv = manualDiv ?? autoDiv;
  const price = fd?.price.value ?? 0;
  const { fairValue, warnings } = calcBazin(avgDiv, minDY);

  if (fd) logValuation('Bazin', ticker, fd, { fairValue, avgDiv });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — Bazin</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={ticker} onChange={t => { setTicker(t); setManualDiv(null); }} />
          {status === 'idle' ? <EmptyAssetHint /> : status === 'loading' ? <LoadingSkeleton /> : <StatusBanner status={status} warnings={[...(fd?.warnings ?? []), ...warnings]} />}
          <FieldRow label="Preço Atual (R$)" value={price} onChange={() => {}} disabled sourcedValue={fd?.price} />
          <FieldRow label="Dividendo por Ação (anual)" value={avgDiv} onChange={v => setManualDiv(+v)} sourcedValue={manualDiv != null ? { value: manualDiv, source: 'manual' } : fd?.div_12m} hint="Div/ação últimos 12m" />
          <FieldRow label="DY Mínimo Desejado (%)" value={minDY} onChange={v => setMinDY(+v)} step="0.5" />
          <Button className="w-full gap-2 mt-2" onClick={() => save(ticker, 'bazin', { avgDiv, minDY, price }, fairValue, fairValue * 0.75, price)} disabled={!ticker || fairValue <= 0}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <ResultCard fairValue={fairValue} currentPrice={price} maxBuyPrice={fairValue * 0.75} formula="Preço Justo = Dividendo por Ação ÷ DY Mínimo" />
    </div>
  );
};

// ===================== BUFFETT =====================
const Buffett = () => {
  const [ticker, setTicker] = useState(() => readPrefill('buffett'));
  const [manuals, setManuals] = useState<{ roe?: number; payout?: number; lpa?: number; pl?: number }>({});
  const [years, setYears] = useState(10);
  const { fd, status } = useFinancialData(ticker);
  const save = useSaveValuation();

  const roe = manuals.roe ?? fd?.roe.value ?? 0;
  const payout = manuals.payout ?? fd?.payout.value ?? 0;
  const lpa = manuals.lpa ?? fd?.lpa.value ?? 0;
  const pl = manuals.pl ?? fd?.pe_ratio.value ?? 15;
  const price = fd?.price.value ?? 0;

  const { fairValue, g, lpaFut, warnings } = calcBuffett(lpa, roe, payout, years, pl);
  if (fd) logValuation('Buffett', ticker, fd, { fairValue, g, lpaFut });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — Buffett</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={ticker} onChange={t => { setTicker(t); setManuals({}); }} />
          {status === 'idle' ? <EmptyAssetHint /> : status === 'loading' ? <LoadingSkeleton /> : <StatusBanner status={status} warnings={[...(fd?.warnings ?? []), ...warnings]} />}
          <FieldRow label="Preço Atual (R$)" value={price} onChange={() => {}} disabled sourcedValue={fd?.price} />
          <FieldRow label="ROE (%)" value={roe} onChange={v => setManuals(p => ({ ...p, roe: +v }))} sourcedValue={manuals.roe != null ? { value: manuals.roe, source: 'manual' } : fd?.roe} />
          <FieldRow label="Payout (%)" value={payout} onChange={v => setManuals(p => ({ ...p, payout: +v }))} sourcedValue={manuals.payout != null ? { value: manuals.payout, source: 'manual' } : fd?.payout} />
          <FieldRow label="LPA" value={lpa} onChange={v => setManuals(p => ({ ...p, lpa: +v }))} sourcedValue={manuals.lpa != null ? { value: manuals.lpa, source: 'manual' } : fd?.lpa} />
          <FieldRow label="Horizonte (anos)" value={years} onChange={v => setYears(+v)} step="1" />
          <FieldRow label="P/L Justo (saída)" value={pl} onChange={v => setManuals(p => ({ ...p, pl: +v }))} step="1" sourcedValue={manuals.pl != null ? { value: manuals.pl, source: 'manual' } : fd?.pe_ratio} />
          <Button className="w-full gap-2 mt-2" onClick={() => save(ticker, 'buffett', { roe, payout, lpa, years, pl, price }, fairValue, fairValue * 0.5, price)} disabled={!ticker || fairValue <= 0}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <div className="space-y-6">
        <ResultCard fairValue={fairValue} currentPrice={price} maxBuyPrice={fairValue * 0.5} formula="g = ROE × (1 − Payout); LPA fut = LPA × (1+g)^n; PJ = LPA fut × P/L" />
        <Card>
          <CardHeader><CardTitle className="text-sm">Detalhamento</CardTitle></CardHeader>
          <CardContent className="text-xs font-mono text-muted-foreground space-y-1">
            <p>Crescimento (g): {g.toFixed(2)}%</p>
            <p>LPA Futuro ({years}a): {lpaFut.toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

// ===================== LYNCH =====================
const Lynch = () => {
  const [ticker, setTicker] = useState(() => readPrefill('lynch'));
  const [manuals, setManuals] = useState<{ pl?: number; growth?: number }>({});
  const { fd, status } = useFinancialData(ticker);
  const save = useSaveValuation();

  const pl = manuals.pl ?? fd?.pe_ratio.value ?? 0;
  const growth = manuals.growth ?? fd?.revenue_growth.value ?? 0;
  const price = fd?.price.value ?? 0;

  const { peg, fairValue, warnings } = calcLynch(price, pl, growth);
  if (fd) logValuation('Lynch', ticker, fd, { peg, fairValue });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — Lynch (PEG)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={ticker} onChange={t => { setTicker(t); setManuals({}); }} />
          {status === 'idle' ? <EmptyAssetHint /> : status === 'loading' ? <LoadingSkeleton /> : <StatusBanner status={status} warnings={[...(fd?.warnings ?? []), ...warnings]} />}
          <FieldRow label="Preço Atual (R$)" value={price} onChange={() => {}} disabled sourcedValue={fd?.price} />
          <FieldRow label="P/L" value={pl} onChange={v => setManuals(p => ({ ...p, pl: +v }))} sourcedValue={manuals.pl != null ? { value: manuals.pl, source: 'manual' } : fd?.pe_ratio} />
          <FieldRow label="Taxa de Crescimento (%)" value={growth} onChange={v => setManuals(p => ({ ...p, growth: +v }))} sourcedValue={manuals.growth != null ? { value: manuals.growth, source: 'manual' } : fd?.revenue_growth} />
          <Button className="w-full gap-2 mt-2" onClick={() => save(ticker, 'lynch', { pl, growth, price }, fairValue, fairValue * 0.75, price)} disabled={!ticker}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Resultado</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-muted"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">PEG Ratio</p><p className={`text-lg font-bold font-mono mt-1 ${peg > 0 && peg < 1 ? 'text-emerald-500' : 'text-red-500'}`}>{peg.toFixed(2)}</p></div>
            <div className="p-3 rounded-lg bg-muted"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Veredicto</p><p className="text-lg font-bold mt-1">{peg > 0 && peg < 1 ? '✅ Barato' : peg < 1.5 ? '⚠️ Justo' : '❌ Caro'}</p></div>
            <div className="p-3 rounded-lg bg-muted"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Preço Justo (PEG=1)</p><p className="text-lg font-bold font-mono mt-1 text-primary">{formatBRL(fairValue)}</p></div>
            <div className="p-3 rounded-lg bg-muted"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Preço Máx. Compra</p><p className="text-lg font-bold font-mono mt-1">{formatBRL(fairValue * 0.75)}</p></div>
          </div>
          <p className="text-[11px] text-muted-foreground border-t border-border pt-3 font-mono">PEG = P/L ÷ Crescimento. PEG {'<'} 1 = subvalorizado.</p>
        </CardContent>
      </Card>
    </div>
  );
};

// ===================== VFF (DCF) — Redesigned =====================
const HEADER_KPIS = [
  { key: 'price', label: 'Preço Atual', fmt: (v: number) => formatBRL(v) },
  { key: 'shares', label: 'Nº Total de Ações', fmt: (v: number) => v > 0 ? new Intl.NumberFormat('pt-BR').format(v) : '—' },
  { key: 'mktcap', label: 'Market Cap', fmt: (v: number) => v > 0 ? formatBRL(v) : '—' },
  { key: 'payout', label: 'Payout', fmt: (v: number) => v > 0 ? `${v.toFixed(1)}%` : '—' },
  { key: 'roe', label: 'ROE', fmt: (v: number) => v > 0 ? `${v.toFixed(1)}%` : '—' },
] as const;

const KpiCell = ({ label, value, loading }: { label: string; value: string; loading: boolean }) => (
  <div className="flex-1 min-w-[140px] rounded-lg border border-border bg-muted/30 p-3">
    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    {loading ? <Skeleton className="h-5 w-20 mt-1.5" /> : <p className="text-base font-bold font-mono mt-1 text-foreground">{value}</p>}
  </div>
);

const GrowthBadge = ({ pct }: { pct: number | null }) => {
  if (pct == null || !Number.isFinite(pct)) return <span className="text-muted-foreground text-xs">—</span>;
  const positive = pct >= 0;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-mono font-medium ${positive ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
      {positive ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
};

// Format a number to pt-BR with thousand separators (no currency, no decimals by default)
const formatNumberBR = (n: number, decimals = 0) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);

// Parse a pt-BR formatted string back to a number. Returns null for empty.
const parseNumberBR = (s: string): number | null => {
  if (s == null) return null;
  const cleaned = s.replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

// Text input that displays numbers formatted in pt-BR while editing
const NumberInputBR = ({ value, onChange, placeholder, className, decimals = 0 }: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  className?: string;
  decimals?: number;
}) => {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const display = focused
    ? draft
    : (value == null ? '' : formatNumberBR(value, decimals));
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={display}
      placeholder={placeholder}
      className={className}
      onFocus={() => {
        setFocused(true);
        setDraft(value == null ? '' : formatNumberBR(value, decimals));
      }}
      onChange={e => {
        setDraft(e.target.value);
        onChange(parseNumberBR(e.target.value));
      }}
      onBlur={() => setFocused(false)}
    />
  );
};

const VFF = ({ years }: { years: 3 | 5 }) => {
  const [ticker, setTicker] = useState(() => readPrefill(years === 3 ? 'vff3' : 'vff5'));
  const [periodYears, setPeriodYears] = useState<3 | 5>(years);
  const [manuals, setManuals] = useState<{
    payout?: number; roe?: number; growth?: number; discount?: number; perpetuity?: number;
    historicals?: Record<number, number | null>; projections?: Record<number, number>; growths?: Record<number, number>;
    shares?: number; notes?: string;
  }>({});
  const { asset, fd, status } = useFinancialData(ticker);
  const save = useSaveValuation();

  // Header KPI values
  const price = fd?.price.value ?? 0;
  const shares = manuals.shares ?? fd?.total_shares.value ?? 0;
  const mktcap = price * shares;
  const apiPayout = fd?.payout.value ?? 0;
  const apiRoe = fd?.roe.value ?? 0;

  // Premissas
  const payout = manuals.payout ?? apiPayout;
  const roe = manuals.roe ?? apiRoe;
  const autoGrowth = Math.max(0, Math.min(15, (1 - payout / 100) * roe));
  const growth = manuals.growth ?? autoGrowth;
  const discount = manuals.discount ?? 15;
  const perpetuity = manuals.perpetuity ?? 3;

  // Years arrays — historical = last 5 completed years; projections start at current year
  const currentYear = new Date().getFullYear();
  const histYears = useMemo(() => Array.from({ length: 5 }, (_, i) => currentYear - 5 + i), [currentYear]);
  const projYears = useMemo(() => Array.from({ length: periodYears }, (_, i) => currentYear + i), [currentYear, periodYears]);

  // Historical net income from Supabase fundamentals overrides (Histórico tab)
  const histFromOverrides = (asset?.overrides?.net_income_years ?? {}) as Record<string, number | null>;

  // Returns null when no value is available (so the input renders empty, not 0)
  const getHistorical = (y: number): number | null => {
    if (manuals.historicals && y in manuals.historicals) return manuals.historicals[y];
    const raw = histFromOverrides[String(y)];
    return raw == null ? null : Number(raw);
  };

  // Base for projections = most recent non-null historical year (e.g. 2025 if available)
  const baseNetIncome = useMemo(() => {
    for (let i = histYears.length - 1; i >= 0; i--) {
      const v = getHistorical(histYears[i]);
      if (v != null && v > 0) return v;
    }
    return fd?.net_income.value ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histYears, manuals.historicals, histFromOverrides, fd?.net_income.value]);

  // Projected values: by default base × (1+g)^n with possible per-year growth override
  const projections = useMemo(() => {
    const result: { year: number; profit: number; growthApplied: number }[] = [];
    let prev = baseNetIncome;
    for (let i = 0; i < periodYears; i++) {
      const y = projYears[i];
      const gApplied = manuals.growths?.[y] ?? growth;
      let profit: number;
      if (manuals.projections?.[y] != null) {
        profit = manuals.projections[y];
      } else {
        profit = prev * (1 + gApplied / 100);
      }
      result.push({ year: y, profit, growthApplied: gApplied });
      prev = profit;
    }
    return result;
  }, [baseNetIncome, periodYears, projYears, growth, manuals.projections, manuals.growths]);

  // DCF math
  const r = discount / 100;
  const gPerp = perpetuity / 100;
  const pvProfits = projections.reduce((sum, p, i) => sum + p.profit / Math.pow(1 + r, i + 1), 0);
  const lastProfit = projections[projections.length - 1]?.profit || 0;
  const terminal = r > gPerp && lastProfit > 0 ? (lastProfit * (1 + gPerp)) / (r - gPerp) : 0;
  const pvTerminal = terminal / Math.pow(1 + r, periodYears);
  const projMarketCap = pvProfits + pvTerminal;
  const fairPrice = shares > 0 ? projMarketCap / shares : 0;
  const upside = price > 0 && fairPrice > 0 ? ((fairPrice - price) / price) * 100 : 0;

  const isLoading = status === 'loading';
  const allWarnings = fd?.warnings ?? [];

  if (fd) logValuation(`VFF${periodYears}`, ticker, fd, { baseNetIncome, growth, fairPrice, projMarketCap });

  const reset = () => setManuals({});

  const handleSave = () => {
    if (!ticker) { toast.error('Selecione um ativo.'); return; }
    if (fairPrice <= 0) {
      toast.error('Preço justo inválido — preencha Lucro Base e Total de Ações.');
      return;
    }
    const origem = manuals.historicals != null || manuals.shares != null ? 'manual' : 'fundamentos';
    const incomplete = (fd?.net_income.source === 'nd') || (fd?.total_shares.source === 'nd');
    save(
      ticker,
      `vff_${periodYears}`,
      {
        payout, roe, growth, discount, perpetuity, shares,
        baseNetIncome,
        historicals: histYears.map(y => ({ year: y, profit: getHistorical(y) })),
        projections: projections.map(p => ({ year: p.year, profit: p.profit, growth: p.growthApplied })),
        notes: manuals.notes ?? '',
        origem_dados: origem,
      },
      fairPrice,
      fairPrice * 0.75,
      price,
    );
    if (incomplete) toast.warning('Dados incompletos — valuation baseado em input manual.');
  };

  // Build status banner content
  const statusContent = status === 'idle'
    ? null
    : isLoading
      ? <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 flex items-center gap-2"><Loader2 className="h-4 w-4 text-primary animate-spin" /><p className="text-xs text-primary">Buscando dados…</p></div>
      : <StatusBanner status={status} warnings={allWarnings} />;

  return (
    <div className="space-y-4">
      {/* Asset selector + status */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-[260px] flex-1 max-w-md">
          <AssetSelector value={ticker} onChange={t => { setTicker(t); setManuals({}); }} />
        </div>
        {statusContent && <div className="flex-1 min-w-[260px]">{statusContent}</div>}
      </div>

      {/* TOP HEADER BAR */}
      <div className="flex flex-wrap gap-2">
        <KpiCell label="Preço Atual (R$)" value={HEADER_KPIS[0].fmt(price)} loading={isLoading} />
        <KpiCell label="Nº Total de Ações" value={HEADER_KPIS[1].fmt(shares)} loading={isLoading} />
        <KpiCell label="Market Cap (R$)" value={HEADER_KPIS[2].fmt(mktcap)} loading={isLoading} />
        <KpiCell label="Payout (%)" value={HEADER_KPIS[3].fmt(apiPayout)} loading={isLoading} />
        <KpiCell label="ROE (%)" value={HEADER_KPIS[4].fmt(apiRoe)} loading={isLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT COLUMN — Premissas + Realidade Projetada */}
        <div className="lg:col-span-5 space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Premissas</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FieldRow label="Payout médio (%)" value={payout} onChange={v => setManuals(p => ({ ...p, payout: +v }))} step="0.5" sourcedValue={manuals.payout != null ? { value: manuals.payout, source: 'manual' } : fd?.payout} />
              <FieldRow label="ROE (%)" value={roe} onChange={v => setManuals(p => ({ ...p, roe: +v }))} step="0.5" sourcedValue={manuals.roe != null ? { value: manuals.roe, source: 'manual' } : fd?.roe} />
              <FieldRow label="Taxa Esperada de Crescimento (%)" value={growth.toFixed(2)} onChange={v => setManuals(p => ({ ...p, growth: +v }))} step="0.5" hint="(1 − Payout) × ROE — limitado 0–15%" sourcedValue={manuals.growth != null ? { value: manuals.growth, source: 'manual' } : { value: autoGrowth, source: 'calculado' }} />
              <FieldRow label="Taxa de Desconto (%)" value={discount} onChange={v => setManuals(p => ({ ...p, discount: +v }))} step="0.5" />
              <FieldRow label="Taxa Perpétua (%)" value={perpetuity} onChange={v => setManuals(p => ({ ...p, perpetuity: +v }))} step="0.5" />
              <p className="text-[10px] text-muted-foreground italic">💡 Média histórica da Selic é 11,53% (9,80% ex IR15%)</p>
            </CardContent>
          </Card>

          <Card className="border-primary/30 bg-primary/[0.03]">
            <CardHeader className="pb-3"><CardTitle className="text-base">Realidade Projetada</CardTitle></CardHeader>
            <CardContent className="space-y-2.5">
              <div className="flex justify-between items-baseline text-sm">
                <span className="text-muted-foreground">Market Cap (projetado)</span>
                <span className="font-mono font-medium">{projMarketCap > 0 ? formatBRL(projMarketCap) : '—'}</span>
              </div>
              <div className="flex justify-between items-baseline text-sm">
                <span className="text-muted-foreground">Nº total de ações</span>
                <span className="font-mono font-medium">{shares > 0 ? new Intl.NumberFormat('pt-BR').format(shares) : '—'}</span>
              </div>
              <div className="border-t border-border pt-2.5 mt-2 space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Preço por ação</span>
                  <span className="font-mono font-bold text-xl text-primary">{fairPrice > 0 ? formatBRL(fairPrice) : '—'}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Upside / Downside</span>
                  <span className={`font-mono font-bold text-xl ${upside > 0 ? 'text-emerald-500' : upside < 0 ? 'text-red-500' : 'text-primary'}`}>
                    {fairPrice > 0 && price > 0 ? `${upside > 0 ? '+' : ''}${upside.toFixed(1)}%` : '—'}
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground pt-1">Atualizado em: {new Date().toLocaleString('pt-BR')}</p>
              <div className="flex gap-2 pt-2">
                <Button className="flex-1 gap-2" onClick={handleSave} disabled={!ticker || fairPrice <= 0}>
                  <Save className="h-4 w-4" /> Salvar Preço Teto
                </Button>
                <Button variant="outline" className="gap-2" onClick={reset} title="Resetar inputs manuais">
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN — DCF Table */}
        <div className="lg:col-span-7">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Fluxo de Caixa Descontado</CardTitle>
                <CardDescription className="text-xs mt-0.5">VFF — projeção de {periodYears} anos + perpetuidade</CardDescription>
              </div>
              <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
                {[3, 5].map(y => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => setPeriodYears(y as 3 | 5)}
                    className={`px-2.5 py-1 text-xs rounded-sm font-medium transition-colors ${periodYears === y ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {y} anos
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="text-left px-4 py-2 font-medium">Ano</th>
                      <th className="text-right px-3 py-2 font-medium">Lucro Líquido (R$)</th>
                      <th className="text-center px-3 py-2 font-medium">Crescimento</th>
                      <th className="text-right px-4 py-2 font-medium">VPL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* HISTORICAL ROWS */}
                    {histYears.map((y, i) => {
                      const profit = getHistorical(y);
                      const prev = i > 0 ? getHistorical(histYears[i - 1]) : null;
                      const growthYoY = (profit != null && prev != null && prev > 0)
                        ? ((profit - prev) / prev) * 100
                        : null;
                      return (
                        <tr key={y} className="border-b border-border/40 bg-muted/20 hover:bg-muted/40">
                          <td className="px-4 py-2 font-mono text-muted-foreground">{y}</td>
                          <td className="px-3 py-1.5">
                            <NumberInputBR
                              value={profit}
                              placeholder="—"
                              onChange={val => setManuals(p => ({ ...p, historicals: { ...(p.historicals ?? {}), [y]: val } }))}
                              className="font-mono h-8 text-right text-xs"
                            />
                          </td>
                          <td className="px-3 py-2 text-center"><GrowthBadge pct={growthYoY} /></td>
                          <td className="px-4 py-2 text-right text-muted-foreground font-mono">—</td>
                        </tr>
                      );
                    })}
                    {/* DIVIDER */}
                    <tr><td colSpan={4} className="border-t-2 border-primary/30 py-0"></td></tr>
                    {/* PROJECTED ROWS */}
                    {projections.map((p, i) => {
                      const vpl = p.profit / Math.pow(1 + r, i + 1);
                      return (
                        <tr key={p.year} className="border-b border-border/40 bg-primary/[0.04] border-l-2 border-l-primary/40 hover:bg-primary/[0.08]">
                          <td className="px-4 py-2 font-mono font-medium text-primary">{p.year}</td>
                          <td className="px-3 py-1.5">
                            <NumberInputBR
                              value={Math.round(p.profit)}
                              onChange={val => setManuals(prev => ({ ...prev, projections: { ...(prev.projections ?? {}), [p.year]: val ?? 0 } }))}
                              className="font-mono h-8 text-right text-xs"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <Input
                              type="number"
                              value={p.growthApplied.toFixed(2)}
                              onChange={e => setManuals(prev => ({ ...prev, growths: { ...(prev.growths ?? {}), [p.year]: +e.target.value }, projections: undefined }))}
                              className="font-mono h-8 text-center text-xs w-20 mx-auto"
                              step="0.5"
                            />
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs whitespace-nowrap">{vpl > 0 ? formatBRL(vpl) : '—'}</td>
                        </tr>
                      );
                    })}
                    {/* PERPETUITY ROW */}
                    <tr className="border-t-2 border-border bg-accent/30">
                      <td className="px-4 py-2.5 font-medium">Perpétuo</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs whitespace-nowrap">{terminal > 0 ? formatBRL(lastProfit * (1 + gPerp)) : '—'}</td>
                      <td className="px-3 py-2 text-center">
                        <div className="inline-flex items-center gap-1 rounded-md border border-border bg-background">
                          <button type="button" onClick={() => setManuals(p => ({ ...p, perpetuity: Math.max(0, perpetuity - 0.5) }))} className="h-7 w-7 flex items-center justify-center hover:bg-muted rounded-l-md"><Minus className="h-3 w-3" /></button>
                          <span className="text-xs font-mono px-1.5 min-w-[40px] text-center">{perpetuity.toFixed(1)}%</span>
                          <button type="button" onClick={() => setManuals(p => ({ ...p, perpetuity: perpetuity + 0.5 }))} className="h-7 w-7 flex items-center justify-center hover:bg-muted rounded-r-md"><Plus className="h-3 w-3" /></button>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-medium text-xs whitespace-nowrap">{pvTerminal > 0 ? formatBRL(pvTerminal) : '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* NOTES */}
          <Card className="mt-4">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Anotações</CardTitle></CardHeader>
            <CardContent>
              <Textarea
                value={manuals.notes ?? ''}
                onChange={e => setManuals(p => ({ ...p, notes: e.target.value }))}
                placeholder="Escreva suas anotações sobre o ativo aqui... (salvo junto com o preço teto)"
                className="min-h-[90px] text-sm resize-y"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

// ===================== P/VP JUSTIFICADO =====================
const PVPJustificado = () => {
  const [ticker, setTicker] = useState(() => readPrefill('pvp'));
  const [manuals, setManuals] = useState<{ vpa?: number; roe?: number; discount?: number; growth?: number }>({});
  const { fd, status } = useFinancialData(ticker);
  const save = useSaveValuation();

  const vpa = manuals.vpa ?? fd?.vpa.value ?? 0;
  const roe = manuals.roe ?? fd?.roe.value ?? 0;
  const discount = manuals.discount ?? 15;
  const growth = manuals.growth ?? 3;
  const price = fd?.price.value ?? 0;

  const { pvpJusto, fairValue, warnings } = calcPVPJustificado(vpa, roe, discount, growth);
  const pvpAtual = vpa > 0 ? price / vpa : 0;

  if (fd) logValuation('P/VP Justificado', ticker, fd, { pvpJusto, fairValue });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — P/VP Justificado</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={ticker} onChange={t => { setTicker(t); setManuals({}); }} />
          {status === 'idle' ? <EmptyAssetHint /> : status === 'loading' ? <LoadingSkeleton /> : <StatusBanner status={status} warnings={[...(fd?.warnings ?? []), ...warnings]} />}
          <FieldRow label="Preço Atual (R$)" value={price} onChange={() => {}} disabled sourcedValue={fd?.price} />
          <FieldRow label="VPA" value={vpa} onChange={v => setManuals(p => ({ ...p, vpa: +v }))} sourcedValue={manuals.vpa != null ? { value: manuals.vpa, source: 'manual' } : fd?.vpa} />
          <FieldRow label="ROE (%)" value={roe} onChange={v => setManuals(p => ({ ...p, roe: +v }))} sourcedValue={manuals.roe != null ? { value: manuals.roe, source: 'manual' } : fd?.roe} />
          <FieldRow label="Taxa de Desconto (%)" value={discount} onChange={v => setManuals(p => ({ ...p, discount: +v }))} step="0.5" />
          <FieldRow label="Taxa de Crescimento (%)" value={growth} onChange={v => setManuals(p => ({ ...p, growth: +v }))} step="0.5" />
          <Button className="w-full gap-2 mt-2" onClick={() => save(ticker, 'pvp_justificado', { vpa, roe, discount, growth, price }, fairValue, fairValue * 0.75, price)} disabled={!ticker}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Resultado</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-muted"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">P/VP Justificado</p><p className="text-lg font-bold font-mono mt-1 text-primary">{pvpJusto.toFixed(2)}x</p></div>
            <div className="p-3 rounded-lg bg-muted"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">P/VP Atual</p><p className={`text-lg font-bold font-mono mt-1 ${pvpAtual < pvpJusto ? 'text-emerald-500' : 'text-red-500'}`}>{pvpAtual.toFixed(2)}x</p></div>
            <div className="p-3 rounded-lg bg-muted"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Preço Justo</p><p className="text-lg font-bold font-mono mt-1 text-primary">{formatBRL(fairValue)}</p></div>
            <div className="p-3 rounded-lg bg-muted">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Upside</p>
              <p className={`text-lg font-bold font-mono mt-1 ${fairValue > price ? 'text-emerald-500' : 'text-red-500'}`}>
                {price > 0 ? `${(((fairValue - price) / price) * 100).toFixed(1)}%` : '-'}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground border-t border-border pt-3 font-mono">P/VP Just. = ROE / (Desconto - Crescimento)</p>
        </CardContent>
      </Card>
    </div>
  );
};

// ===================== P/L JUSTO =====================
const PLJusto = () => {
  const [ticker, setTicker] = useState(() => readPrefill('pl'));
  const [manuals, setManuals] = useState<{ lpa?: number; pl?: number }>({});
  const { fd, status } = useFinancialData(ticker);
  const save = useSaveValuation();

  const lpa = manuals.lpa ?? fd?.lpa.value ?? 0;
  const pl = manuals.pl ?? 15;
  const price = fd?.price.value ?? 0;

  const { fairValue, warnings } = calcPLJusto(lpa, pl);
  if (fd) logValuation('P/L Justo', ticker, fd, { fairValue });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — P/L Justo (Múltiplos)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={ticker} onChange={t => { setTicker(t); setManuals({}); }} />
          {status === 'idle' ? <EmptyAssetHint /> : status === 'loading' ? <LoadingSkeleton /> : <StatusBanner status={status} warnings={[...(fd?.warnings ?? []), ...warnings]} />}
          <FieldRow label="Preço Atual (R$)" value={price} onChange={() => {}} disabled sourcedValue={fd?.price} />
          <FieldRow label="LPA" value={lpa} onChange={v => setManuals(p => ({ ...p, lpa: +v }))} sourcedValue={manuals.lpa != null ? { value: manuals.lpa, source: 'manual' } : fd?.lpa} />
          <FieldRow label="P/L Justo" value={pl} onChange={v => setManuals(p => ({ ...p, pl: +v }))} step="1" />
          <Button className="w-full gap-2 mt-2" onClick={() => save(ticker, 'pl_justo', { lpa, pl, price }, fairValue, fairValue * 0.75, price)} disabled={!ticker || fairValue <= 0}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <ResultCard fairValue={fairValue} currentPrice={price} maxBuyPrice={fairValue * 0.75} formula="Preço Justo = LPA × P/L Justo" />
    </div>
  );
};

// ===================== EV/EBITDA JUSTO =====================
const EVEbitda = () => {
  const [ticker, setTicker] = useState(() => readPrefill('evebitda'));
  const [manuals, setManuals] = useState<{ ebitda?: number; multiplo?: number; netDebt?: number; shares?: number }>({});
  const { fd, status } = useFinancialData(ticker);
  const save = useSaveValuation();

  const ebitda = manuals.ebitda ?? fd?.ebitda.value ?? 0;
  const multiplo = manuals.multiplo ?? 8;
  const netDebt = manuals.netDebt ?? fd?.net_debt.value ?? 0;
  const shares = manuals.shares ?? fd?.total_shares.value ?? 0;
  const price = fd?.price.value ?? 0;

  const { evJusto, equityValue, fairValue, warnings } = calcEVEbitda(ebitda, multiplo, netDebt, shares);
  if (fd) logValuation('EV/EBITDA', ticker, fd, { evJusto, equityValue, fairValue });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — EV/EBITDA Justo</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={ticker} onChange={t => { setTicker(t); setManuals({}); }} />
          {status === 'idle' ? <EmptyAssetHint /> : status === 'loading' ? <LoadingSkeleton /> : <StatusBanner status={status} warnings={[...(fd?.warnings ?? []), ...warnings]} />}
          <FieldRow label="Preço Atual (R$)" value={price} onChange={() => {}} disabled sourcedValue={fd?.price} />
          <FieldRow label="EBITDA (R$)" value={ebitda} onChange={v => setManuals(p => ({ ...p, ebitda: +v }))} sourcedValue={manuals.ebitda != null ? { value: manuals.ebitda, source: 'manual' } : fd?.ebitda} />
          <FieldRow label="EV/EBITDA Justo" value={multiplo} onChange={v => setManuals(p => ({ ...p, multiplo: +v }))} step="0.5" />
          <FieldRow label="Dívida Líquida (R$)" value={netDebt} onChange={v => setManuals(p => ({ ...p, netDebt: +v }))} sourcedValue={manuals.netDebt != null ? { value: manuals.netDebt, source: 'manual' } : fd?.net_debt} />
          <FieldRow label="Total de Ações" value={shares} onChange={v => setManuals(p => ({ ...p, shares: +v }))} step="1" sourcedValue={manuals.shares != null ? { value: manuals.shares, source: 'manual' } : fd?.total_shares} />
          <Button className="w-full gap-2 mt-2" onClick={() => save(ticker, 'ev_ebitda', { ebitda, multiplo, netDebt, shares, price }, fairValue, fairValue * 0.75, price)} disabled={!ticker || fairValue <= 0}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <div className="space-y-6">
        <ResultCard fairValue={fairValue} currentPrice={price} maxBuyPrice={fairValue * 0.75} formula="EV Justo = EBITDA × Múltiplo; Equity = EV − Dívida; PJ = Equity / Ações" />
        <Card>
          <CardHeader><CardTitle className="text-sm">Detalhamento</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs font-mono text-muted-foreground">
            <p>EV Justo: {formatBRL(evJusto)}</p>
            <p>Equity Value: {formatBRL(equityValue)}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

// ===================== MAIN PAGE =====================
const Valuations = () => {
  const [tab, setTab] = useState<string>('graham');
  const [tabKey, setTabKey] = useState(0); // remount on prefill
  const [modalOpen, setModalOpen] = useState(false);
  const { data: saved = [] } = useSavedValuations();

  const handleOpenSaved = (modelTabKey: string, ticker: string) => {
    writePrefill(modelTabKey, ticker);
    setTab(modelTabKey);
    setTabKey(k => k + 1);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="kpi-label mb-1">Valor Intrínseco</p>
          <h1 className="text-xl font-semibold tracking-tight">Valuations</h1>
        </div>
        <Button variant="outline" onClick={() => setModalOpen(true)} className="gap-2">
          <BarChart3 className="h-4 w-4" />
          Meus Valuations
          {saved.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5">{saved.length}</Badge>
          )}
        </Button>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
          <TabsTrigger value="vff3">VFF 3a</TabsTrigger>
          <TabsTrigger value="vff5">VFF 5a</TabsTrigger>
          <TabsTrigger value="graham">Graham</TabsTrigger>
          <TabsTrigger value="buffett">Buffett</TabsTrigger>
          <TabsTrigger value="bazin">Bazin</TabsTrigger>
          <TabsTrigger value="lynch">Lynch</TabsTrigger>
          <TabsTrigger value="pvp">P/VP Just.</TabsTrigger>
          <TabsTrigger value="pl">P/L Justo</TabsTrigger>
          <TabsTrigger value="evebitda">EV/EBITDA</TabsTrigger>
        </TabsList>
        <TabsContent value="vff3"><VFF key={`vff3-${tabKey}`} years={3} /></TabsContent>
        <TabsContent value="vff5"><VFF key={`vff5-${tabKey}`} years={5} /></TabsContent>
        <TabsContent value="graham"><Graham key={`graham-${tabKey}`} /></TabsContent>
        <TabsContent value="buffett"><Buffett key={`buffett-${tabKey}`} /></TabsContent>
        <TabsContent value="bazin"><Bazin key={`bazin-${tabKey}`} /></TabsContent>
        <TabsContent value="lynch"><Lynch key={`lynch-${tabKey}`} /></TabsContent>
        <TabsContent value="pvp"><PVPJustificado key={`pvp-${tabKey}`} /></TabsContent>
        <TabsContent value="pl"><PLJusto key={`pl-${tabKey}`} /></TabsContent>
        <TabsContent value="evebitda"><EVEbitda key={`evebitda-${tabKey}`} /></TabsContent>
      </Tabs>
      <SavedValuationsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onOpenValuation={handleOpenSaved}
      />
    </div>
  );
};

export default Valuations;
