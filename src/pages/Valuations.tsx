import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save } from 'lucide-react';
import { formatBRL, formatPct } from '@/lib/format';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
            { label: 'Margem de Segurança', value: formatPct(margin), cls: margin > 0 ? 'text-positive' : 'text-negative' },
            { label: 'Preço Máx. Compra', value: formatBRL(maxBuyPrice), cls: '' },
            { label: 'Upside/Downside', value: `${upside > 0 ? '+' : ''}${formatPct(upside)}`, cls: upside > 0 ? 'text-positive' : 'text-negative' },
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

const FieldRow = ({ label, value, onChange, step = '0.01', type = 'number' }: {
  label: string; value: string | number; onChange: (v: string) => void; step?: string; type?: string;
}) => (
  <div className="space-y-1">
    <Label className="text-xs">{label}</Label>
    <Input type={type} value={value} onChange={e => onChange(e.target.value)} step={step} className="font-mono h-9" />
  </div>
);

const useSaveValuation = () => {
  const { user } = useAuth();
  const { data: portfolio = [] } = usePortfolio();

  return async (ticker: string, modelType: string, params: Record<string, any>, fairValue: number, maxBuyPrice: number, currentPrice: number) => {
    if (!user) return;
    const asset = portfolio.find(a => a.ticker.toUpperCase() === ticker.toUpperCase());
    if (!asset) {
      toast.error(`Ativo ${ticker} não encontrado na carteira. Cadastre-o primeiro.`);
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

const AssetSelector = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const { data: portfolio = [] } = usePortfolio();
  return (
    <div className="space-y-1">
      <Label className="text-xs">Ativo</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="font-mono h-9"><SelectValue placeholder="Selecione um ativo" /></SelectTrigger>
        <SelectContent>
          {portfolio.map(a => <SelectItem key={a.id} value={a.ticker}>{a.ticker} — {a.name || ''}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
};

// --- GRAHAM ---
const Graham = () => {
  const [p, setP] = useState({ ticker: '', price: 0, lpa: 0, vpa: 0 });
  const save = useSaveValuation();
  const fv = Math.sqrt(22.5 * Math.max(0, p.lpa) * Math.max(0, p.vpa));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — Graham</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={p.ticker} onChange={v => setP({ ...p, ticker: v })} />
          <FieldRow label="Preço Atual (R$)" value={p.price} onChange={v => setP({ ...p, price: +v })} />
          <FieldRow label="LPA" value={p.lpa} onChange={v => setP({ ...p, lpa: +v })} />
          <FieldRow label="VPA" value={p.vpa} onChange={v => setP({ ...p, vpa: +v })} />
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
  const save = useSaveValuation();
  const fv = p.minDY > 0 ? (p.avgDiv / (p.minDY / 100)) : 0;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — Bazin</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={p.ticker} onChange={v => setP({ ...p, ticker: v })} />
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
  const save = useSaveValuation();
  const g = (p.roe / 100) * (1 - p.payout / 100);
  const lpaFut = p.lpa * Math.pow(1 + g, p.years);
  const fv = lpaFut * p.pl;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — Buffett</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={p.ticker} onChange={v => setP({ ...p, ticker: v })} />
          <FieldRow label="Preço Atual (R$)" value={p.price} onChange={v => setP({ ...p, price: +v })} />
          <FieldRow label="ROE Médio 5 anos (%)" value={p.roe} onChange={v => setP({ ...p, roe: +v })} step="1" />
          <FieldRow label="Payout Médio (%)" value={p.payout} onChange={v => setP({ ...p, payout: +v })} step="1" />
          <FieldRow label="LPA Atual" value={p.lpa} onChange={v => setP({ ...p, lpa: +v })} />
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
  const save = useSaveValuation();
  const peg = p.growth > 0 ? p.pl / p.growth : 0;
  const fv = peg > 0 ? p.price / peg : 0;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Premissas — Lynch (PEG)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={p.ticker} onChange={v => setP({ ...p, ticker: v })} />
          <FieldRow label="Preço Atual (R$)" value={p.price} onChange={v => setP({ ...p, price: +v })} />
          <FieldRow label="P/L" value={p.pl} onChange={v => setP({ ...p, pl: +v })} />
          <FieldRow label="Taxa de Crescimento (%)" value={p.growth} onChange={v => setP({ ...p, growth: +v })} />
          <Button className="w-full gap-2 mt-2" onClick={() => save(p.ticker, 'lynch', p, fv, fv * 0.75, p.price)} disabled={!p.ticker}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Resultado</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-muted"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">PEG Ratio</p><p className={`text-lg font-bold font-mono mt-1 ${peg < 1 ? 'text-positive' : 'text-negative'}`}>{peg.toFixed(2)}</p></div>
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

// --- VFF (DCF simplificado) ---
const VFF = ({ years }: { years: 3 | 5 }) => {
  const initialProfits = years === 3 ? [0, 0, 0] : [0, 0, 0, 0, 0];
  const [p, setP] = useState({ ticker: '', price: 0, shares: 0, discount: 15, perpetuity: 3, profits: initialProfits });
  const save = useSaveValuation();

  const r = p.discount / 100;
  const g = p.perpetuity / 100;
  const pvProfits = p.profits.reduce((sum, profit, i) => sum + profit / Math.pow(1 + r, i + 1), 0);
  const terminal = r > g ? (p.profits[p.profits.length - 1] * (1 + g)) / (r - g) : 0;
  const pvTerminal = terminal / Math.pow(1 + r, p.profits.length);
  const fv = p.shares > 0 ? (pvProfits + pvTerminal) / p.shares : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Premissas — VFF {years} anos</CardTitle>
          <CardDescription>Valuation com Fluxo Futuro (DCF simplificado)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <AssetSelector value={p.ticker} onChange={v => setP({ ...p, ticker: v })} />
          <FieldRow label="Preço Atual (R$)" value={p.price} onChange={v => setP({ ...p, price: +v })} />
          <FieldRow label="Total de Ações" value={p.shares} onChange={v => setP({ ...p, shares: +v })} step="1" />
          <FieldRow label="Taxa de Desconto (%)" value={p.discount} onChange={v => setP({ ...p, discount: +v })} step="0.5" />
          <FieldRow label="Taxa Perpétua (%)" value={p.perpetuity} onChange={v => setP({ ...p, perpetuity: +v })} step="0.5" />
          {p.profits.map((profit, i) => (
            <FieldRow key={i} label={`Lucro Líquido Ano ${i + 1} (R$)`} value={profit}
              onChange={v => { const np = [...p.profits]; np[i] = +v; setP({ ...p, profits: np }); }} step="1" />
          ))}
          <Button className="w-full gap-2 mt-2" onClick={() => save(p.ticker, `vff${years}`, p, fv, fv * 0.75, p.price)} disabled={!p.ticker}><Save className="h-4 w-4" /> Salvar</Button>
        </CardContent>
      </Card>
      <ResultCard fairValue={fv} currentPrice={p.price} maxBuyPrice={fv * 0.75}
        formula={`VPL dos lucros + valor terminal perpétuo. Desconto: ${p.discount}%, Perpétuo: ${p.perpetuity}%`} />
    </div>
  );
};

// --- MAIN PAGE ---
const Valuations = () => (
  <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Valuations</h1>
      <p className="text-sm text-muted-foreground">Análise de valor intrínseco por diferentes métodos</p>
    </div>
    <Tabs defaultValue="graham">
      <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
        <TabsTrigger value="vff3">VFF 3 anos</TabsTrigger>
        <TabsTrigger value="vff5">VFF 5 anos</TabsTrigger>
        <TabsTrigger value="smallcaps">Small Caps</TabsTrigger>
        <TabsTrigger value="graham">Graham</TabsTrigger>
        <TabsTrigger value="buffett">Buffett</TabsTrigger>
        <TabsTrigger value="bazin">Bazin</TabsTrigger>
        <TabsTrigger value="lynch">Lynch</TabsTrigger>
      </TabsList>
      <TabsContent value="vff3"><VFF years={3} /></TabsContent>
      <TabsContent value="vff5"><VFF years={5} /></TabsContent>
      <TabsContent value="smallcaps"><VFF years={3} /></TabsContent>
      <TabsContent value="graham"><Graham /></TabsContent>
      <TabsContent value="buffett"><Buffett /></TabsContent>
      <TabsContent value="bazin"><Bazin /></TabsContent>
      <TabsContent value="lynch"><Lynch /></TabsContent>
    </Tabs>
  </div>
);

export default Valuations;
