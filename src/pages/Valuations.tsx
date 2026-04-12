import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Save, AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { formatBRL, formatPct } from '@/lib/format';
import { usePortfolio, PortfolioAsset } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  buildFinancialData,
  calcGrowthRate,
  calcVFF,
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

const PartialBanner = ({ _onManual }: { _onManual?: () => void }) => (
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
  const [ticker, setTicker] = useState('');
  const [manualLpa, setManualLpa] = useState<number | null>(null);
  const [manualVpa, setManualVpa] = useState<number | null>(null);
  const { fd } = useFinancialData(ticker);
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
          {!ticker ? <EmptyAssetHint /> : <Warnings items={[...(fd?.warnings ?? []), ...warnings]} />}
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
  const [ticker, setTicker] = useState('');
  const [manualDiv, setManualDiv] = useState<number | null>(null);
  const [minDY, setMinDY] = useState(6);
  const { fd } = useFinancialData(ticker);
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
          {!ticker ? <EmptyAssetHint /> : <Warnings items={[...(fd?.warnings ?? []), ...warnings]} />}
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
  const [ticker, setTicker] = useState('');
  const [manuals, setManuals] = useState<{ roe?: number; payout?: number; lpa?: number; pl?: number }>({});
  const [years, setYears] = useState(10);
  const { fd } = useFinancialData(ticker);
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
          {!ticker ? <EmptyAssetHint /> : <Warnings items={[...(fd?.warnings ?? []), ...warnings]} />}
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
  const [ticker, setTicker] = useState('');
  const [manuals, setManuals] = useState<{ pl?: number; growth?: number }>({});
  const { fd } = useFinancialData(ticker);
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
          {!ticker ? <EmptyAssetHint /> : <Warnings items={[...(fd?.warnings ?? []), ...warnings]} />}
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

// ===================== VFF (DCF) =====================
const VFF = ({ years }: { years: 3 | 5 }) => {
  const [ticker, setTicker] = useState('');
  const [manuals, setManuals] = useState<{ netIncome?: number; growth?: number; discount?: number; perpetuity?: number; profits?: number[] }>({});
  const { fd } = useFinancialData(ticker);
  const save = useSaveValuation();

  const autoGrowth = fd ? calcGrowthRate(fd.roe.value, fd.payout.value) : { g: 0, source: 'nd' as const };
  const netIncome = manuals.netIncome ?? fd?.net_income.value ?? 0;
  const growth = manuals.growth ?? autoGrowth.g;
  const discount = manuals.discount ?? 15;
  const perpetuity = manuals.perpetuity ?? 3;
  const shares = fd?.total_shares.value ?? 0;

  const autoResult = calcVFF(netIncome, growth, discount, perpetuity, shares, years);
  const profits = manuals.profits ?? autoResult.profits;

  // Recalc with possibly manual profits
  const r = discount / 100;
  const gPerp = perpetuity / 100;
  const pvProfits = profits.reduce((sum, p, i) => sum + p / Math.pow(1 + r, i + 1), 0);
  const lastProfit = profits[profits.length - 1] || 0;
  const terminal = r > gPerp && lastProfit > 0 ? (lastProfit * (1 + gPerp)) / (r - gPerp) : 0;
  const pvTerminal = terminal / Math.pow(1 + r, years);
  const marketCap = pvProfits + pvTerminal;
  const fv = shares > 0 ? marketCap / shares : 0;

  const allWarnings = [...(fd?.warnings ?? []), ...autoResult.warnings];

  if (fd) logValuation(`VFF${years}`, ticker, fd, { netIncome, growth, fv, marketCap });

  const reprojectProfits = (ni: number, g: number) => {
    if (ni <= 0) return Array(years).fill(0);
    return Array.from({ length: years }, (_, i) => Math.round(ni * Math.pow(1 + g / 100, i + 1)));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Premissas — VFF {years} anos</CardTitle>
          <CardDescription>Valuation com Fluxo Futuro (DCF)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={ticker} onChange={t => { setTicker(t); setManuals({}); }} />
          {!ticker ? <EmptyAssetHint /> : <Warnings items={allWarnings} />}
          <FieldRow label="Preço Atual (R$)" value={fd?.price.value ?? 0} onChange={() => {}} disabled sourcedValue={fd?.price} />
          <FieldRow label="Total de Ações" value={shares} onChange={() => {}} disabled step="1" sourcedValue={fd?.total_shares} />

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Lucro Base (R$)</Label>
              <SourceBadge sv={manuals.netIncome != null ? { value: manuals.netIncome, source: 'manual' } : fd?.net_income ?? { value: 0, source: 'nd' }} />
            </div>
            <Input type="number" value={netIncome} onChange={e => {
              const ni = +e.target.value;
              setManuals(p => ({ ...p, netIncome: ni, profits: reprojectProfits(ni, growth) }));
            }} step="1" className="font-mono h-9" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Crescimento (g) %</Label>
              <SourceBadge sv={manuals.growth != null ? { value: manuals.growth, source: 'manual' } : { value: autoGrowth.g, source: autoGrowth.source }} />
            </div>
            <Input type="number" value={growth} onChange={e => {
              const g = +e.target.value;
              setManuals(p => ({ ...p, growth: g, profits: reprojectProfits(netIncome, g) }));
            }} step="0.5" className="font-mono h-9" />
            <p className="text-[10px] text-muted-foreground">g = (1 − Payout) × ROE, limitado 0–15%</p>
          </div>

          <FieldRow label="Taxa de Desconto (%)" value={discount} onChange={v => setManuals(p => ({ ...p, discount: +v }))} step="0.5" />
          <FieldRow label="Taxa Perpétua (%)" value={perpetuity} onChange={v => setManuals(p => ({ ...p, perpetuity: +v }))} step="0.5" />

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Lucros Projetados</Label>
              <button type="button" className="text-[10px] text-primary hover:underline" onClick={() => setManuals(p => ({ ...p, profits: undefined }))}>↻ Reprojetar</button>
            </div>
            {profits.map((profit, i) => (
              <FieldRow key={i} label={`Ano ${i + 1} (R$)`} value={profit} onChange={v => {
                const np = [...profits]; np[i] = +v;
                setManuals(p => ({ ...p, profits: np }));
              }} step="1" />
            ))}
          </div>

          <Button className="w-full gap-2 mt-2" onClick={() => {
            if (fv <= 0) { toast.error('Preço justo inválido.'); return; }
            save(ticker, `vff${years}`, { netIncome, growth, discount, perpetuity, profits, shares }, fv, fv * 0.75, fd?.price.value ?? 0);
          }} disabled={!ticker || fv <= 0}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <div className="space-y-6">
        <ResultCard fairValue={fv} currentPrice={fd?.price.value ?? 0} maxBuyPrice={fv * 0.75} formula="MktCap = Σ VPL Lucros + Perpétuo. PJ = MktCap / Ações" />
        <Card>
          <CardHeader><CardTitle className="text-sm">Detalhamento</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs font-mono text-muted-foreground">
            <p>Lucro Base: {formatBRL(netIncome)} ({(manuals.netIncome != null ? 'manual' : fd?.net_income.source) ?? 'nd'})</p>
            <p>Crescimento (g): {growth.toFixed(2)}%</p>
            <p>VPL Lucros: {formatBRL(pvProfits)}</p>
            <p>Valor Terminal: {formatBRL(terminal)}</p>
            <p>VP Terminal: {formatBRL(pvTerminal)}</p>
            <p>Market Cap Proj.: {formatBRL(marketCap)}</p>
            <p className="pt-1 border-t border-border text-primary font-semibold">Preço Justo: {formatBRL(fv)}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

// ===================== P/VP JUSTIFICADO =====================
const PVPJustificado = () => {
  const [ticker, setTicker] = useState('');
  const [manuals, setManuals] = useState<{ vpa?: number; roe?: number; discount?: number; growth?: number }>({});
  const { fd } = useFinancialData(ticker);
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
          {!ticker ? <EmptyAssetHint /> : <Warnings items={[...(fd?.warnings ?? []), ...warnings]} />}
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
  const [ticker, setTicker] = useState('');
  const [manuals, setManuals] = useState<{ lpa?: number; pl?: number }>({});
  const { fd } = useFinancialData(ticker);
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
          {!ticker ? <EmptyAssetHint /> : <Warnings items={[...(fd?.warnings ?? []), ...warnings]} />}
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
  const [ticker, setTicker] = useState('');
  const [manuals, setManuals] = useState<{ ebitda?: number; multiplo?: number; netDebt?: number; shares?: number }>({});
  const { fd } = useFinancialData(ticker);
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
          {!ticker ? <EmptyAssetHint /> : <Warnings items={[...(fd?.warnings ?? []), ...warnings]} />}
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
const Valuations = () => (
  <div className="space-y-6 animate-fade-in">
    <div>
      <p className="kpi-label mb-1">Valor Intrínseco</p>
      <h1 className="text-xl font-semibold tracking-tight">Valuations</h1>
    </div>
    <Tabs defaultValue="graham">
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
      <TabsContent value="vff3"><VFF years={3} /></TabsContent>
      <TabsContent value="vff5"><VFF years={5} /></TabsContent>
      <TabsContent value="graham"><Graham /></TabsContent>
      <TabsContent value="buffett"><Buffett /></TabsContent>
      <TabsContent value="bazin"><Bazin /></TabsContent>
      <TabsContent value="lynch"><Lynch /></TabsContent>
      <TabsContent value="pvp"><PVPJustificado /></TabsContent>
      <TabsContent value="pl"><PLJusto /></TabsContent>
      <TabsContent value="evebitda"><EVEbitda /></TabsContent>
    </Tabs>
  </div>
);

export default Valuations;
