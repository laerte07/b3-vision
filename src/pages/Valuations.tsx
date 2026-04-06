import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Loader2 } from 'lucide-react';
import { formatBRL, formatPct } from '@/lib/format';
import { usePortfolio, PortfolioAsset } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ---- Only show Ações (stocks) in valuations ----
const ACOES_SLUG = 'acoes';

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

const FieldRow = ({ label, value, onChange, step = '0.01', disabled = false, hint }: {
  label: string; value: string | number; onChange: (v: string) => void; step?: string; disabled?: boolean; hint?: string;
}) => (
  <div className="space-y-1">
    <Label className="text-xs">{label}</Label>
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
    if (!asset) {
      toast.error(`Ativo ${ticker} não encontrado na carteira.`);
      return;
    }
    const upside = currentPrice > 0 ? ((fairValue - currentPrice) / currentPrice) * 100 : 0;

    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('valuation_models').upsert({
        user_id: user.id, asset_id: asset.id, model_type: modelType, json_params: params,
      }, { onConflict: 'user_id,asset_id,model_type' }),
      supabase.from('valuation_results').upsert({
        user_id: user.id, asset_id: asset.id, model_type: modelType,
        fair_value: fairValue, upside, max_buy_price: maxBuyPrice,
        json_breakdown: params,
      }, { onConflict: 'user_id,asset_id,model_type' }),
    ]);

    if (e1 || e2) toast.error((e1 || e2)!.message);
    else toast.success(`Valuation ${modelType} salvo para ${ticker}`);
  };
};

// Stock-only selector
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
        <SelectContent>
          {stocks.map(a => <SelectItem key={a.id} value={a.ticker}>{a.ticker} — {a.name || ''}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
};

// Hook to auto-fill from fundamentals
const useAutoFill = (ticker: string, portfolio: PortfolioAsset[]) => {
  const asset = portfolio.find(a => a.ticker === ticker);
  if (!asset) return null;
  const f = asset.fundamentals;
  const overrides = (asset as any).overrides as Record<string, any> | undefined;

  const lpa = f?.lpa ?? 0;
  const totalShares = f?.total_shares ?? 0;
  const margin = f?.margin ?? 0;
  const payout = f?.payout ?? 0;
  const roe = f?.roe ?? 0;

  // Estimate net income: override > LPA*shares > margin-based estimate
  let netIncome = 0;
  let netIncomeSource = 'nd';
  const overrideNI = overrides?.net_income_ttm;
  if (overrideNI != null && typeof overrideNI === 'number' && overrideNI !== 0) {
    netIncome = overrideNI;
    netIncomeSource = 'manual';
  } else if (lpa !== 0 && totalShares > 0) {
    netIncome = lpa * totalShares;
    netIncomeSource = 'calculado (LPA × Ações)';
  }

  // Historical net incomes from overrides
  const netIncomeYears: Record<string, number | null> = overrides?.net_income_years ?? {};

  return {
    price: asset.last_price ?? asset.avg_price,
    lpa,
    vpa: f?.vpa ?? 0,
    roe,
    payout,
    pe_ratio: f?.pe_ratio ?? 0,
    pb_ratio: f?.pb_ratio ?? 0,
    ev: f?.ev ?? 0,
    ebitda: f?.ebitda ?? 0,
    net_debt: f?.net_debt ?? 0,
    total_shares: totalShares,
    dividend_yield: f?.dividend_yield ?? 0,
    margin,
    revenue_growth: f?.revenue_growth ?? 0,
    netIncome,
    netIncomeSource,
    netIncomeYears,
  };
};

// --- GRAHAM ---
const Graham = () => {
  const [p, setP] = useState({ ticker: '', price: 0, lpa: 0, vpa: 0 });
  const { data: portfolio = [] } = usePortfolio();
  const save = useSaveValuation();

  const onSelectTicker = (t: string) => {
    const auto = useAutoFill(t, portfolio);
    if (auto) setP({ ticker: t, price: auto.price, lpa: auto.lpa, vpa: auto.vpa });
    else setP({ ...p, ticker: t });
  };

  const fv = Math.sqrt(22.5 * Math.max(0, p.lpa) * Math.max(0, p.vpa));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — Graham</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={p.ticker} onChange={onSelectTicker} />
          <FieldRow label="Preço Atual (R$)" value={p.price} onChange={v => setP({ ...p, price: +v })} />
          <FieldRow label="LPA" value={p.lpa} onChange={v => setP({ ...p, lpa: +v })} hint="Auto-preenchido via BRAPI" />
          <FieldRow label="VPA" value={p.vpa} onChange={v => setP({ ...p, vpa: +v })} hint="Auto-preenchido via BRAPI" />
          <Button className="w-full gap-2 mt-2" onClick={() => save(p.ticker, 'graham', p, fv, fv * 0.75, p.price)} disabled={!p.ticker}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <ResultCard fairValue={fv} currentPrice={p.price} maxBuyPrice={fv * 0.75} formula="VI = √(22,5 × LPA × VPA)" />
    </div>
  );
};

// --- BAZIN ---
const Bazin = () => {
  const [p, setP] = useState({ ticker: '', price: 0, avgDiv: 0, minDY: 6 });
  const { data: portfolio = [] } = usePortfolio();
  const save = useSaveValuation();

  const onSelectTicker = (t: string) => {
    const auto = useAutoFill(t, portfolio);
    if (auto) setP({ ...p, ticker: t, price: auto.price });
    else setP({ ...p, ticker: t });
  };

  const fv = p.minDY > 0 ? (p.avgDiv / (p.minDY / 100)) : 0;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — Bazin</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={p.ticker} onChange={onSelectTicker} />
          <FieldRow label="Preço Atual (R$)" value={p.price} onChange={v => setP({ ...p, price: +v })} />
          <FieldRow label="Dividendo Médio Anual (5 anos)" value={p.avgDiv} onChange={v => setP({ ...p, avgDiv: +v })} />
          <FieldRow label="DY Mínimo Desejado (%)" value={p.minDY} onChange={v => setP({ ...p, minDY: +v })} step="0.5" />
          <Button className="w-full gap-2 mt-2" onClick={() => save(p.ticker, 'bazin', p, fv, fv * 0.75, p.price)} disabled={!p.ticker}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <ResultCard fairValue={fv} currentPrice={p.price} maxBuyPrice={fv * 0.75} formula="Preço Justo = Dividendo Médio Anual ÷ DY Mínimo" />
    </div>
  );
};

// --- BUFFETT ---
const Buffett = () => {
  const [p, setP] = useState({ ticker: '', price: 0, roe: 0, payout: 0, lpa: 0, years: 10, pl: 15 });
  const { data: portfolio = [] } = usePortfolio();
  const save = useSaveValuation();

  const onSelectTicker = (t: string) => {
    const auto = useAutoFill(t, portfolio);
    if (auto) setP({ ...p, ticker: t, price: auto.price, roe: auto.roe, payout: auto.payout, lpa: auto.lpa, pl: auto.pe_ratio || 15 });
    else setP({ ...p, ticker: t });
  };

  const g = (p.roe / 100) * (1 - p.payout / 100);
  const lpaFut = p.lpa * Math.pow(1 + g, p.years);
  const fv = lpaFut * p.pl;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — Buffett</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={p.ticker} onChange={onSelectTicker} />
          <FieldRow label="Preço Atual (R$)" value={p.price} onChange={v => setP({ ...p, price: +v })} />
          <FieldRow label="ROE Médio 5 anos (%)" value={p.roe} onChange={v => setP({ ...p, roe: +v })} step="1" hint="Auto-preenchido" />
          <FieldRow label="Payout Médio (%)" value={p.payout} onChange={v => setP({ ...p, payout: +v })} step="1" hint="Auto-preenchido" />
          <FieldRow label="LPA Atual" value={p.lpa} onChange={v => setP({ ...p, lpa: +v })} hint="Auto-preenchido" />
          <FieldRow label="Horizonte (anos)" value={p.years} onChange={v => setP({ ...p, years: +v })} step="1" />
          <FieldRow label="P/L Justo" value={p.pl} onChange={v => setP({ ...p, pl: +v })} step="1" />
          <Button className="w-full gap-2 mt-2" onClick={() => save(p.ticker, 'buffett', p, fv, fv * 0.5, p.price)} disabled={!p.ticker}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <ResultCard fairValue={fv} currentPrice={p.price} maxBuyPrice={fv * 0.5} formula="g = ROE × (1 − Payout); LPA futuro = LPA × (1+g)^n; PJ = LPA futuro × P/L" />
    </div>
  );
};

// --- LYNCH ---
const Lynch = () => {
  const [p, setP] = useState({ ticker: '', price: 0, pl: 0, growth: 0 });
  const { data: portfolio = [] } = usePortfolio();
  const save = useSaveValuation();

  const onSelectTicker = (t: string) => {
    const auto = useAutoFill(t, portfolio);
    if (auto) setP({ ticker: t, price: auto.price, pl: auto.pe_ratio, growth: auto.revenue_growth || 0 });
    else setP({ ...p, ticker: t });
  };

  const peg = p.growth > 0 ? p.pl / p.growth : 0;
  const fv = peg > 0 ? p.price / peg : 0;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — Lynch (PEG)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={p.ticker} onChange={onSelectTicker} />
          <FieldRow label="Preço Atual (R$)" value={p.price} onChange={v => setP({ ...p, price: +v })} />
          <FieldRow label="P/L" value={p.pl} onChange={v => setP({ ...p, pl: +v })} hint="Auto-preenchido" />
          <FieldRow label="Taxa de Crescimento (%)" value={p.growth} onChange={v => setP({ ...p, growth: +v })} />
          <Button className="w-full gap-2 mt-2" onClick={() => save(p.ticker, 'lynch', p, fv, fv * 0.75, p.price)} disabled={!p.ticker}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Resultado</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-muted"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">PEG Ratio</p><p className={`text-lg font-bold font-mono mt-1 ${peg < 1 ? 'text-emerald-500' : 'text-red-500'}`}>{peg.toFixed(2)}</p></div>
            <div className="p-3 rounded-lg bg-muted"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Veredicto</p><p className="text-lg font-bold mt-1">{peg < 1 ? '✅ Barato' : peg < 1.5 ? '⚠️ Justo' : '❌ Caro'}</p></div>
            <div className="p-3 rounded-lg bg-muted"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Preço Justo (PEG=1)</p><p className="text-lg font-bold font-mono mt-1 text-primary">{formatBRL(fv)}</p></div>
            <div className="p-3 rounded-lg bg-muted"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Preço Máx. Compra</p><p className="text-lg font-bold font-mono mt-1">{formatBRL(fv * 0.75)}</p></div>
          </div>
          <p className="text-[11px] text-muted-foreground border-t border-border pt-3 font-mono">PEG = P/L ÷ Taxa Crescimento. PEG {'<'} 1 = subvalorizado.</p>
        </CardContent>
      </Card>
    </div>
  );
};

// --- VFF (DCF) with auto growth rate ---
const VFF = ({ years }: { years: 3 | 5 }) => {
  const initialProfits = years === 3 ? [0, 0, 0] : [0, 0, 0, 0, 0];
  const [p, setP] = useState({
    ticker: '', price: 0, shares: 0, discount: 15, perpetuity: 3,
    profits: initialProfits, roe: 0, payout: 0, autoGrowth: 0,
    netIncomeBase: 0, useAutoProjection: true,
  });
  const [dataSource, setDataSource] = useState({ netIncome: 'nd', growth: 'nd' });
  const { data: portfolio = [] } = usePortfolio();
  const save = useSaveValuation();

  const onSelectTicker = (t: string) => {
    const auto = useAutoFill(t, portfolio);
    if (auto) {
      const roe = auto.roe || 0;
      const payout = auto.payout || 0;
      // Growth: g = (1 - payout) × ROE, capped 0-15%
      let rawGrowth = (1 - payout / 100) * (roe / 100) * 100;
      rawGrowth = Math.max(0, Math.min(15, rawGrowth));
      const growthSource = roe > 0 && payout > 0 ? 'calculado (ROE × retenção)' : 'nd';

      const baseNI = auto.netIncome;
      const g = rawGrowth / 100;

      // Project profits using growth rate
      const projected = Array.from({ length: years }, (_, i) =>
        Math.round(baseNI * Math.pow(1 + g, i + 1))
      );

      setP({
        ticker: t, price: auto.price, shares: auto.total_shares,
        roe, payout, autoGrowth: Math.round(rawGrowth * 100) / 100,
        discount: 15, perpetuity: 3,
        profits: baseNI > 0 ? projected : initialProfits,
        netIncomeBase: baseNI,
        useAutoProjection: baseNI > 0,
      });
      setDataSource({ netIncome: auto.netIncomeSource, growth: growthSource });
    } else {
      setP(prev => ({ ...prev, ticker: t }));
    }
  };

  // Reproject when growth changes and auto is on
  const handleGrowthChange = (v: string) => {
    const newGrowth = +v;
    const g = newGrowth / 100;
    const base = p.netIncomeBase;
    const projected = base > 0 && p.useAutoProjection
      ? Array.from({ length: years }, (_, i) => Math.round(base * Math.pow(1 + g, i + 1)))
      : p.profits;
    setP(prev => ({ ...prev, autoGrowth: newGrowth, profits: projected }));
    setDataSource(prev => ({ ...prev, growth: 'manual' }));
  };

  const r = p.discount / 100;
  const g = p.perpetuity / 100;

  // Sanity checks
  const warnings: string[] = [];
  if (p.profits.every(v => v === 0)) warnings.push('Lucro líquido zerado — verifique os dados fundamentais.');
  if (p.shares === 0) warnings.push('Número de ações = 0.');
  if (p.discount <= p.perpetuity) warnings.push('Taxa de desconto deve ser maior que a perpétua.');
  if (p.autoGrowth > 20) warnings.push(`Crescimento alto (${p.autoGrowth}%) — ajustado automaticamente.`);

  const pvProfits = p.profits.reduce((sum, profit, i) => sum + profit / Math.pow(1 + r, i + 1), 0);
  const lastProfit = p.profits[p.profits.length - 1];
  const terminal = r > g && lastProfit > 0 ? (lastProfit * (1 + g)) / (r - g) : 0;
  const pvTerminal = terminal / Math.pow(1 + r, p.profits.length);
  const marketCapProjected = pvProfits + pvTerminal;
  const fv = p.shares > 0 ? marketCapProjected / p.shares : 0;

  // Debug log
  console.log(`[ValuationEngine VFF${years}]`, {
    ticker: p.ticker,
    lucro_base: p.netIncomeBase,
    fonte_lucro: dataSource.netIncome,
    crescimento_g: p.autoGrowth,
    fonte_crescimento: dataSource.growth,
    taxa_desconto: p.discount,
    lucros_projetados: p.profits,
    valor_terminal: terminal,
    vp_terminal: pvTerminal,
    valor_total: marketCapProjected,
    preco_justo: fv,
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Premissas — VFF {years} anos</CardTitle>
          <CardDescription>Valuation com Fluxo Futuro (DCF)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={p.ticker} onChange={onSelectTicker} />

          {warnings.length > 0 && (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 space-y-1">
              {warnings.map((w, i) => (
                <p key={i} className="text-xs text-yellow-600 dark:text-yellow-400">⚠️ {w}</p>
              ))}
            </div>
          )}

          <FieldRow label="Preço Atual (R$)" value={p.price} onChange={v => setP({ ...p, price: +v })} />
          <FieldRow label="Total de Ações" value={p.shares} onChange={v => setP({ ...p, shares: +v })} step="1" hint="Auto-preenchido" />

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Lucro Base (R$)</Label>
              <span className="text-[10px] text-muted-foreground">Fonte: {dataSource.netIncome}</span>
            </div>
            <Input type="number" value={p.netIncomeBase} onChange={e => {
              const ni = +e.target.value;
              const gRate = p.autoGrowth / 100;
              const projected = ni > 0 ? Array.from({ length: years }, (_, i) => Math.round(ni * Math.pow(1 + gRate, i + 1))) : p.profits;
              setP(prev => ({ ...prev, netIncomeBase: ni, profits: projected }));
              setDataSource(prev => ({ ...prev, netIncome: 'manual' }));
            }} step="1" className="font-mono h-9" />
            <p className="text-[10px] text-muted-foreground">Lucro líquido base para projeção. Editável.</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Crescimento (g) %</Label>
              <span className="text-[10px] text-muted-foreground">Fonte: {dataSource.growth}</span>
            </div>
            <Input type="number" value={p.autoGrowth} onChange={e => handleGrowthChange(e.target.value)} step="0.5" className="font-mono h-9" />
            <p className="text-[10px] text-muted-foreground">g = (1 − Payout) × ROE. Limitado a 0–15%. Editável.</p>
          </div>

          <FieldRow label="Taxa de Desconto (%)" value={p.discount} onChange={v => setP({ ...p, discount: +v })} step="0.5" />
          <FieldRow label="Taxa Perpétua (%)" value={p.perpetuity} onChange={v => setP({ ...p, perpetuity: +v })} step="0.5" />

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Lucros Projetados</Label>
              <button
                type="button"
                className="text-[10px] text-primary hover:underline"
                onClick={() => {
                  const gRate = p.autoGrowth / 100;
                  const base = p.netIncomeBase;
                  if (base > 0) {
                    const projected = Array.from({ length: years }, (_, i) => Math.round(base * Math.pow(1 + gRate, i + 1)));
                    setP(prev => ({ ...prev, profits: projected, useAutoProjection: true }));
                  }
                }}
              >
                ↻ Reprojetar
              </button>
            </div>
            {p.profits.map((profit, i) => (
              <FieldRow key={i} label={`Ano ${i + 1} (R$)`} value={profit}
                onChange={v => {
                  const np = [...p.profits]; np[i] = +v;
                  setP(prev => ({ ...prev, profits: np, useAutoProjection: false }));
                }} step="1" />
            ))}
          </div>

          <Button className="w-full gap-2 mt-2"
            onClick={() => {
              if (fv <= 0) { toast.error('Preço justo inválido. Verifique os dados.'); return; }
              save(p.ticker, `vff${years}`, p, fv, fv * 0.75, p.price);
            }}
            disabled={!p.ticker || fv <= 0}>
            <Save className="h-4 w-4" /> Salvar
          </Button>
        </CardContent>
      </Card>
      <div className="space-y-6">
        <ResultCard fairValue={fv} currentPrice={p.price} maxBuyPrice={fv * 0.75}
          formula={`MktCap Proj = Σ VPL Lucros + Perpétuo. Preço Justo = MktCap / Total Ações`} />
        <Card>
          <CardHeader><CardTitle className="text-sm">Detalhamento</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs font-mono text-muted-foreground">
            <p>Lucro Base: {formatBRL(p.netIncomeBase)} ({dataSource.netIncome})</p>
            <p>Crescimento (g): {p.autoGrowth.toFixed(2)}% ({dataSource.growth})</p>
            <p>VPL Lucros: {formatBRL(pvProfits)}</p>
            <p>Valor Terminal: {formatBRL(terminal)}</p>
            <p>VP Terminal: {formatBRL(pvTerminal)}</p>
            <p>Market Cap Proj.: {formatBRL(marketCapProjected)}</p>
            <p className="pt-1 border-t border-border text-primary font-semibold">Preço Justo: {formatBRL(fv)}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

// --- P/VP Justificado ---
const PVPJustificado = () => {
  const [p, setP] = useState({ ticker: '', price: 0, vpa: 0, roe: 0, discount: 15, growth: 3 });
  const { data: portfolio = [] } = usePortfolio();
  const save = useSaveValuation();

  const onSelectTicker = (t: string) => {
    const auto = useAutoFill(t, portfolio);
    if (auto) setP({ ...p, ticker: t, price: auto.price, vpa: auto.vpa, roe: auto.roe });
    else setP({ ...p, ticker: t });
  };

  const disc = p.discount / 100;
  const grow = p.growth / 100;
  const pvpJusto = disc > grow ? (p.roe / 100) / (disc - grow) : 0;
  const fv = pvpJusto * p.vpa;
  const pvpAtual = p.vpa > 0 ? p.price / p.vpa : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — P/VP Justificado</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={p.ticker} onChange={onSelectTicker} />
          <FieldRow label="Preço Atual (R$)" value={p.price} onChange={v => setP({ ...p, price: +v })} />
          <FieldRow label="VPA" value={p.vpa} onChange={v => setP({ ...p, vpa: +v })} hint="Auto-preenchido" />
          <FieldRow label="ROE (%)" value={p.roe} onChange={v => setP({ ...p, roe: +v })} hint="Auto-preenchido" />
          <FieldRow label="Taxa de Desconto (%)" value={p.discount} onChange={v => setP({ ...p, discount: +v })} step="0.5" />
          <FieldRow label="Taxa de Crescimento (%)" value={p.growth} onChange={v => setP({ ...p, growth: +v })} step="0.5" />
          <Button className="w-full gap-2 mt-2" onClick={() => save(p.ticker, 'pvp_justificado', p, fv, fv * 0.75, p.price)} disabled={!p.ticker}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Resultado</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-muted"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">P/VP Justificado</p><p className="text-lg font-bold font-mono mt-1 text-primary">{pvpJusto.toFixed(2)}x</p></div>
            <div className="p-3 rounded-lg bg-muted"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">P/VP Atual</p><p className={`text-lg font-bold font-mono mt-1 ${pvpAtual < pvpJusto ? 'text-emerald-500' : 'text-red-500'}`}>{pvpAtual.toFixed(2)}x</p></div>
            <div className="p-3 rounded-lg bg-muted"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Preço Justo</p><p className="text-lg font-bold font-mono mt-1 text-primary">{formatBRL(fv)}</p></div>
            <div className="p-3 rounded-lg bg-muted">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Upside</p>
              <p className={`text-lg font-bold font-mono mt-1 ${fv > p.price ? 'text-emerald-500' : 'text-red-500'}`}>
                {p.price > 0 ? `${(((fv - p.price) / p.price) * 100).toFixed(1)}%` : '-'}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground border-t border-border pt-3 font-mono">P/VP Just. = ROE / (Desconto - Crescimento)</p>
        </CardContent>
      </Card>
    </div>
  );
};

// --- Por Múltiplos (P/L Justo) ---
const PLJusto = () => {
  const [p, setP] = useState({ ticker: '', price: 0, lpa: 0, plJusto: 15 });
  const { data: portfolio = [] } = usePortfolio();
  const save = useSaveValuation();

  const onSelectTicker = (t: string) => {
    const auto = useAutoFill(t, portfolio);
    if (auto) setP({ ...p, ticker: t, price: auto.price, lpa: auto.lpa });
    else setP({ ...p, ticker: t });
  };

  const fv = p.lpa * p.plJusto;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — P/L Justo (Múltiplos)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={p.ticker} onChange={onSelectTicker} />
          <FieldRow label="Preço Atual (R$)" value={p.price} onChange={v => setP({ ...p, price: +v })} />
          <FieldRow label="LPA" value={p.lpa} onChange={v => setP({ ...p, lpa: +v })} hint="Auto-preenchido" />
          <FieldRow label="P/L Justo" value={p.plJusto} onChange={v => setP({ ...p, plJusto: +v })} step="1" />
          <Button className="w-full gap-2 mt-2" onClick={() => save(p.ticker, 'pl_justo', p, fv, fv * 0.75, p.price)} disabled={!p.ticker}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <ResultCard fairValue={fv} currentPrice={p.price} maxBuyPrice={fv * 0.75} formula="Preço Justo = LPA × P/L Justo" />
    </div>
  );
};

// --- EV/EBITDA Justo ---
const EVEbitda = () => {
  const [p, setP] = useState({ ticker: '', price: 0, ebitda: 0, evEbitdaJusto: 8, netDebt: 0, totalShares: 0 });
  const { data: portfolio = [] } = usePortfolio();
  const save = useSaveValuation();

  const onSelectTicker = (t: string) => {
    const auto = useAutoFill(t, portfolio);
    if (auto) setP({ ticker: t, price: auto.price, ebitda: auto.ebitda, evEbitdaJusto: 8, netDebt: auto.net_debt, totalShares: auto.total_shares });
    else setP({ ...p, ticker: t });
  };

  const evJusto = p.ebitda * p.evEbitdaJusto;
  const equityValue = evJusto - p.netDebt;
  const fv = p.totalShares > 0 ? equityValue / p.totalShares : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — EV/EBITDA Justo</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={p.ticker} onChange={onSelectTicker} />
          <FieldRow label="Preço Atual (R$)" value={p.price} onChange={v => setP({ ...p, price: +v })} />
          <FieldRow label="EBITDA (R$)" value={p.ebitda} onChange={v => setP({ ...p, ebitda: +v })} hint="Auto-preenchido" />
          <FieldRow label="EV/EBITDA Justo" value={p.evEbitdaJusto} onChange={v => setP({ ...p, evEbitdaJusto: +v })} step="0.5" />
          <FieldRow label="Dívida Líquida (R$)" value={p.netDebt} onChange={v => setP({ ...p, netDebt: +v })} hint="Auto-preenchido" />
          <FieldRow label="Total de Ações" value={p.totalShares} onChange={v => setP({ ...p, totalShares: +v })} step="1" hint="Auto-preenchido" />
          <Button className="w-full gap-2 mt-2" onClick={() => save(p.ticker, 'ev_ebitda', p, fv, fv * 0.75, p.price)} disabled={!p.ticker}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <div className="space-y-6">
        <ResultCard fairValue={fv} currentPrice={p.price} maxBuyPrice={fv * 0.75} formula="EV Justo = EBITDA × Múltiplo; Equity = EV - Dívida; PJ = Equity / Ações" />
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

// --- MAIN PAGE ---
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
