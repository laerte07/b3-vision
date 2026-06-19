import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Save, RefreshCw, RotateCcw, Eye, Trash2, Search, Calculator, Loader2 } from 'lucide-react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatBRL } from '@/lib/format';

// ----- helpers -----
const fmtBRL = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : formatBRL(n);
const fmtPct = (n: number | null | undefined, digits = 2) =>
  n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(digits).replace('.', ',')}%`;
const fmtNumPct = (n: number | null | undefined, digits = 2) =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(digits).replace('.', ',')}%`;

const Badgelet = ({ kind }: { kind: 'api' | 'manual' | 'calc' }) => {
  const map = {
    api: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
    manual: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
    calc: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30',
  } as const;
  return <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${map[kind]}`}>{kind}</Badge>;
};

interface FiiOption {
  ticker: string;
  name: string | null;
  price: number | null;
  dy: number | null;
  source: 'portfolio' | 'watchlist';
}

interface Premissas {
  dividendoMensal: number;
  crescimento: number;
  taxaNtnbReal: number;
  inflacao: number;
  irNtnb: number;
  premioDesejado: number;
  margemSeguranca: number;
  tributacaoFii: number;
  prazoNtnb: string;
}

const DEFAULTS: Premissas = {
  dividendoMensal: 0,
  crescimento: 0,
  taxaNtnbReal: 8.04,
  inflacao: 4.72,
  irNtnb: 15,
  premioDesejado: 2,
  margemSeguranca: 0,
  tributacaoFii: 0,
  prazoNtnb: 'Longo prazo',
};

export default function ValuationsFII() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: portfolio = [] } = usePortfolio();
  const { data: watchlist = [] } = useWatchlist();
  const { data: classes = [] } = useAssetClasses();

  const fiisClassId = useMemo(
    () => classes.find(c => c.slug === 'fiis')?.id ?? null,
    [classes]
  );

  const fiiOptions: FiiOption[] = useMemo(() => {
    const map = new Map<string, FiiOption>();
    portfolio.forEach(p => {
      if (fiisClassId && p.class_id === fiisClassId) {
        map.set(p.ticker, {
          ticker: p.ticker, name: p.name, price: p.last_price, dy: p.effective_dy, source: 'portfolio',
        });
      }
    });
    watchlist.forEach(w => {
      if (fiisClassId && w.class_id === fiisClassId && !map.has(w.ticker)) {
        map.set(w.ticker, {
          ticker: w.ticker, name: w.name, price: w.last_price, dy: w.effective_dy, source: 'watchlist',
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [portfolio, watchlist, fiisClassId]);

  const [ticker, setTicker] = useState<string>('');
  const [nome, setNome] = useState<string | null>(null);
  const [precoAtual, setPrecoAtual] = useState<number>(0);
  const [dividendoMensalFonte, setDividendoMensalFonte] = useState<'api' | 'manual'>('manual');
  const [precoFonte, setPrecoFonte] = useState<'api' | 'manual'>('manual');
  const [apiStatus, setApiStatus] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [loadingApi, setLoadingApi] = useState(false);
  const [premissas, setPremissas] = useState<Premissas>(DEFAULTS);
  const [anotacoes, setAnotacoes] = useState('');
  const [savedModalOpen, setSavedModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const setP = <K extends keyof Premissas>(key: K, value: Premissas[K]) =>
    setPremissas(prev => ({ ...prev, [key]: value }));

  const fetchApi = async (t: string) => {
    if (!t) return;
    setLoadingApi(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Sessão expirada');
      const { data, error } = await supabase.functions.invoke('brapi-lookup', {
        headers: { Authorization: `Bearer ${token}` },
        body: { ticker: t },
      });
      if (error || !data?.found) throw new Error(data?.error ?? 'Falha na API');
      const price: number | null = data.price ?? null;
      const dy: number | null = data.dy ?? null; // % a.a.
      setNome(data.name ?? null);
      if (price && price > 0) {
        setPrecoAtual(price);
        setPrecoFonte('api');
      }
      if (price && price > 0 && dy != null && dy > 0) {
        const monthly = (price * (dy / 100)) / 12;
        setP('dividendoMensal', Number(monthly.toFixed(4)));
        setDividendoMensalFonte('api');
      }
      setApiStatus('ok');
    } catch (e: any) {
      setApiStatus('fail');
      toast.error(`API: ${e.message}`);
    } finally {
      setLoadingApi(false);
    }
  };

  const handleSelectTicker = (t: string) => {
    setTicker(t);
    setEditingId(null);
    const opt = fiiOptions.find(o => o.ticker === t);
    if (opt) {
      setNome(opt.name);
      if (opt.price) { setPrecoAtual(opt.price); setPrecoFonte('api'); }
      if (opt.price && opt.dy && opt.dy > 0) {
        const monthly = (opt.price * (opt.dy / 100)) / 12;
        setP('dividendoMensal', Number(monthly.toFixed(4)));
        setDividendoMensalFonte('api');
      }
    }
    // Always try fresh fetch
    fetchApi(t);
  };

  // ----- calculations -----
  const calc = useMemo(() => {
    const div = premissas.dividendoMensal;
    const preco = precoAtual;
    const inflacao = premissas.inflacao / 100;
    const txReal = premissas.taxaNtnbReal / 100;
    const irNtnb = premissas.irNtnb / 100;
    const premioDes = premissas.premioDesejado / 100;
    const margem = premissas.margemSeguranca / 100;

    const dyMensal = preco > 0 ? div / preco : 0;
    const dyCaixa = dyMensal * 12;
    const dyComp = Math.pow(1 + dyMensal, 12) - 1;
    const retornoFII = (1 + dyCaixa) * (1 + inflacao) - 1;

    const ntnbBruta = (1 + txReal) * (1 + inflacao) - 1;
    const ntnbLiq = ntnbBruta * (1 - irNtnb);

    const premioNominal = retornoFII - ntnbLiq;
    const premioAjustado = dyComp - ntnbLiq;

    const retornoReq = ntnbLiq + premioDes;
    const dyReq = (1 + retornoReq) / (1 + inflacao) - 1;

    const precoTetoBruto = dyReq > 0 ? (div * 12) / dyReq : 0;
    const precoTeto = precoTetoBruto * (1 - margem);

    const dyParaPremioZero = (1 + ntnbLiq) / (1 + inflacao) - 1;
    const precoPremioZero = dyParaPremioZero > 0 ? (div * 12) / dyParaPremioZero : 0;

    const upside = preco > 0 && precoTeto > 0 ? (precoTeto - preco) / preco : 0;

    let status: 'Barato' | 'Na faixa' | 'Caro' | '—' = '—';
    if (preco > 0 && precoTeto > 0 && precoPremioZero > 0) {
      if (preco < precoTeto) status = 'Barato';
      else if (preco <= precoPremioZero) status = 'Na faixa';
      else status = 'Caro';
    }

    return {
      dyMensal, dyCaixa, dyComp, retornoFII,
      ntnbBruta, ntnbLiq,
      premioNominal, premioAjustado,
      retornoReq, dyReq,
      precoTeto, precoPremioZero, upside, status,
      premioDes,
    };
  }, [premissas, precoAtual]);

  // ----- saved valuations -----
  const { data: savedList = [], refetch: refetchSaved } = useQuery({
    queryKey: ['fii_valuations', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fii_valuations')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Não autenticado');
      if (!ticker) throw new Error('Selecione um ativo');
      const payload = {
        user_id: user.id,
        ticker,
        nome,
        preco_atual: precoAtual,
        dividendo_mensal: premissas.dividendoMensal,
        crescimento_dividendo: premissas.crescimento,
        taxa_ntnb_real: premissas.taxaNtnbReal,
        inflacao_esperada: premissas.inflacao,
        ir_ntnb: premissas.irNtnb,
        premio_desejado: premissas.premioDesejado,
        margem_seguranca: premissas.margemSeguranca,
        tributacao_fii: premissas.tributacaoFii,
        prazo_ntnb: premissas.prazoNtnb,
        preco_teto: calc.precoTeto,
        preco_premio_zero: calc.precoPremioZero,
        upside: calc.upside * 100,
        status: calc.status,
        anotacoes,
      };
      if (editingId) {
        const { error } = await supabase.from('fii_valuations').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('fii_valuations').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Valuation FII salvo com sucesso');
      qc.invalidateQueries({ queryKey: ['fii_valuations'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fii_valuations').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Valuation removido');
      qc.invalidateQueries({ queryKey: ['fii_valuations'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const loadSaved = (row: any) => {
    setTicker(row.ticker);
    setNome(row.nome);
    setPrecoAtual(Number(row.preco_atual ?? 0));
    setPrecoFonte('manual');
    setDividendoMensalFonte('manual');
    setPremissas({
      dividendoMensal: Number(row.dividendo_mensal ?? 0),
      crescimento: Number(row.crescimento_dividendo ?? 0),
      taxaNtnbReal: Number(row.taxa_ntnb_real ?? DEFAULTS.taxaNtnbReal),
      inflacao: Number(row.inflacao_esperada ?? DEFAULTS.inflacao),
      irNtnb: Number(row.ir_ntnb ?? DEFAULTS.irNtnb),
      premioDesejado: Number(row.premio_desejado ?? DEFAULTS.premioDesejado),
      margemSeguranca: Number(row.margem_seguranca ?? 0),
      tributacaoFii: Number(row.tributacao_fii ?? 0),
      prazoNtnb: row.prazo_ntnb ?? DEFAULTS.prazoNtnb,
    });
    setAnotacoes(row.anotacoes ?? '');
    setEditingId(row.id);
    setSavedModalOpen(false);
    toast.info(`Valuation de ${row.ticker} carregado`);
  };

  const handleReset = () => {
    setTicker('');
    setNome(null);
    setPrecoAtual(0);
    setPremissas(DEFAULTS);
    setAnotacoes('');
    setEditingId(null);
    setApiStatus('idle');
    setPrecoFonte('manual');
    setDividendoMensalFonte('manual');
  };

  const statusColor =
    calc.status === 'Barato' ? 'bg-green-500/15 text-green-400 border-green-500/40' :
    calc.status === 'Na faixa' ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/40' :
    calc.status === 'Caro' ? 'bg-red-500/15 text-red-400 border-red-500/40' :
    'bg-muted text-muted-foreground';

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">VALOR INTRÍNSECO</div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mt-1">Valuations - FII</h1>
          <p className="text-sm text-muted-foreground">Avaliação de FIIs por yield com benchmark NTN-B</p>
        </div>
        <Button variant="outline" onClick={() => setSavedModalOpen(true)} className="gap-2">
          <Calculator className="h-4 w-4" />
          Meus Valuations FII
          <Badge variant="secondary" className="ml-1">{savedList.length}</Badge>
        </Button>
      </div>

      {/* Asset selector */}
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="pt-6 space-y-3">
          <Label>Ativo (somente FIIs)</Label>
          <div className="flex flex-col md:flex-row gap-2">
            <Select value={ticker} onValueChange={handleSelectTicker}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={fiiOptions.length ? 'Selecione um FII' : 'Nenhum FII na carteira/watchlist'} />
              </SelectTrigger>
              <SelectContent>
                {fiiOptions.map(o => (
                  <SelectItem key={o.ticker} value={o.ticker}>
                    {o.ticker} {o.name ? `— ${o.name}` : ''} <span className="text-xs text-muted-foreground ml-1">({o.source})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => ticker && fetchApi(ticker)}
              disabled={!ticker || loadingApi}
              className="gap-2"
            >
              {loadingApi ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Buscar dados (API)
            </Button>
          </div>
          {ticker && apiStatus === 'ok' && (
            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/40">Dados preenchidos automaticamente</Badge>
          )}
          {ticker && apiStatus === 'fail' && (
            <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/40">Preencha os dados manualmente</Badge>
          )}
        </CardContent>
      </Card>

      {ticker && (
        <>
          {/* Top header cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MetricCard
              label="PREÇO ATUAL (R$)"
              value={precoAtual}
              onChange={(v) => { setPrecoAtual(v); setPrecoFonte('manual'); }}
              source={precoFonte}
              format={(n) => n.toFixed(2).replace('.', ',')}
            />
            <MetricCard
              label="DIVIDENDO MENSAL (R$)"
              value={premissas.dividendoMensal}
              onChange={(v) => { setP('dividendoMensal', v); setDividendoMensalFonte('manual'); }}
              source={dividendoMensalFonte}
              format={(n) => n.toFixed(4).replace('.', ',')}
            />
            <MetricCard label="DY MENSAL (%)" value={calc.dyMensal * 100} readOnly source="calc" format={(n) => n.toFixed(2).replace('.', ',')} />
            <MetricCard label="DY ANUAL CAIXA (%)" value={calc.dyCaixa * 100} readOnly source="calc" format={(n) => n.toFixed(2).replace('.', ',')} />
            <MetricCard label="DY ANUAL COMPOSTO (%)" value={calc.dyComp * 100} readOnly source="calc" format={(n) => n.toFixed(2).replace('.', ',')} />
          </div>

          {/* Two columns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* LEFT: Premissas */}
            <Card className="bg-card/50 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">Premissas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <PremissaField
                  label="Dividendo mensal esperado (R$/cota)"
                  value={premissas.dividendoMensal}
                  onChange={(v) => { setP('dividendoMensal', v); setDividendoMensalFonte('manual'); }}
                  badge={dividendoMensalFonte}
                  step={0.01}
                />
                <PremissaField
                  label="Crescimento esperado do dividendo (% a.a.)"
                  value={premissas.crescimento}
                  onChange={(v) => setP('crescimento', v)}
                  note="Crescimento real esperado nos proventos"
                  step={0.1}
                />
                <div className="space-y-1">
                  <Label className="text-xs">Taxa NTN-B real (% a.a. real)</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number" step={0.01}
                      value={premissas.taxaNtnbReal}
                      onChange={(e) => setP('taxaNtnbReal', Number(e.target.value))}
                      className="flex-1"
                    />
                    <Select value={premissas.prazoNtnb} onValueChange={(v) => setP('prazoNtnb', v)}>
                      <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Curto prazo">Curto prazo</SelectItem>
                        <SelectItem value="Médio prazo">Médio prazo</SelectItem>
                        <SelectItem value="Longo prazo">Longo prazo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Taxa real do Tesouro IPCA+</p>
                </div>
                <PremissaField
                  label="Inflação esperada / IPCA (% a.a.)"
                  value={premissas.inflacao}
                  onChange={(v) => setP('inflacao', v)}
                  note="Meta/expectativa de inflação estrutural"
                  step={0.01}
                />
                <PremissaField
                  label="IR sobre NTN-B (%)"
                  value={premissas.irNtnb}
                  onChange={(v) => setP('irNtnb', v)}
                  note="Conforme tabela regressiva do IR"
                  step={0.01}
                />
                <PremissaField
                  label="Prêmio desejado sobre NTN-B líquida (p.p. a.a.)"
                  value={premissas.premioDesejado}
                  onChange={(v) => setP('premioDesejado', v)}
                  note="Retorno adicional exigido vs Tesouro"
                  step={0.1}
                />
                <PremissaField
                  label="Margem de segurança sobre preço-teto (%)"
                  value={premissas.margemSeguranca}
                  onChange={(v) => setP('margemSeguranca', v)}
                  note="Opcional — desconto adicional"
                  step={0.5}
                />
                <PremissaField
                  label="Tributação esperada no rendimento do FII (%)"
                  value={premissas.tributacaoFii}
                  onChange={(v) => setP('tributacaoFii', v)}
                  note="FIIs geralmente isentos para PF"
                  step={0.5}
                />
              </CardContent>
            </Card>

            {/* RIGHT: Indicadores */}
            <Card className="bg-card/50 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">Indicadores Calculados</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <IndicatorGroup title="Retorno do FII">
                  <IndRow label="Dividend yield mensal" value={fmtPct(calc.dyMensal)} />
                  <IndRow label="Dividend yield anual caixa" value={fmtPct(calc.dyCaixa)} />
                  <IndRow label="DY anual composto" value={fmtPct(calc.dyComp)} />
                  <IndRow label="Retorno nominal estimado do FII" value={fmtPct(calc.retornoFII)} />
                </IndicatorGroup>

                <IndicatorGroup title="Benchmark NTN-B">
                  <IndRow label="NTN-B nominal bruta estimada" value={fmtPct(calc.ntnbBruta)} />
                  <IndRow label="NTN-B nominal líquida após IR" value={fmtPct(calc.ntnbLiq)} />
                </IndicatorGroup>

                <IndicatorGroup title="Comparação">
                  <IndRow
                    label="Prêmio nominal atual do FII"
                    value={fmtPct(calc.premioNominal)}
                    color={calc.premioNominal > calc.premioDes ? 'text-green-400' : calc.premioNominal < 0 ? 'text-red-400' : 'text-foreground'}
                  />
                  <IndRow
                    label="Prêmio ajustado atual do FII"
                    value={fmtPct(calc.premioAjustado)}
                    color={calc.premioAjustado >= 0 ? 'text-green-400' : 'text-red-400'}
                  />
                  <IndRow label="Retorno nominal requerido" value={fmtPct(calc.retornoReq)} />
                  <IndRow label="DY caixa requerido do FII" value={fmtPct(calc.dyReq)} />
                </IndicatorGroup>

                <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 space-y-3">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Preços de Referência</div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm">Preço-teto c/ IPCA estrutural</span>
                    <span className="text-2xl font-bold text-blue-400">{fmtBRL(calc.precoTeto)}</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground">Preço para prêmio zero</span>
                    <span className="text-lg font-semibold text-muted-foreground">{fmtBRL(calc.precoPremioZero)}</span>
                  </div>
                  <div className="flex items-baseline justify-between pt-2 border-t border-border/40">
                    <span className="text-sm">Upside / Downside até teto</span>
                    <span className={`text-lg font-bold ${calc.upside >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {calc.upside >= 0 ? '+' : ''}{(calc.upside * 100).toFixed(2).replace('.', ',')}%
                    </span>
                  </div>
                </div>

                <div className="flex justify-center">
                  <Badge className={`text-base px-4 py-1.5 ${statusColor}`}>{calc.status}</Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Comparison table */}
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader><CardTitle className="text-base">Comparação de Preços</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Referência</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">vs Preço Atual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Preço atual</TableCell>
                    <TableCell className="text-right">{fmtBRL(precoAtual)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Preço-teto c/ IPCA estrutural</TableCell>
                    <TableCell className="text-right font-semibold text-blue-400">{fmtBRL(calc.precoTeto)}</TableCell>
                    <TableCell className={`text-right ${calc.precoTeto > precoAtual ? 'text-green-400' : 'text-red-400'}`}>
                      {precoAtual > 0 ? `${((calc.precoTeto - precoAtual) / precoAtual * 100).toFixed(2).replace('.', ',')}%` : '—'}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Preço para prêmio zero</TableCell>
                    <TableCell className="text-right">{fmtBRL(calc.precoPremioZero)}</TableCell>
                    <TableCell className={`text-right ${calc.precoPremioZero > precoAtual ? 'text-green-400' : 'text-red-400'}`}>
                      {precoAtual > 0 ? `${((calc.precoPremioZero - precoAtual) / precoAtual * 100).toFixed(2).replace('.', ',')}%` : '—'}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              {/* Range bar */}
              {precoAtual > 0 && calc.precoTeto > 0 && calc.precoPremioZero > calc.precoTeto && (
                <PriceRangeBar atual={precoAtual} teto={calc.precoTeto} zero={calc.precoPremioZero} />
              )}
            </CardContent>
          </Card>

          {/* Annotations */}
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader><CardTitle className="text-base">Anotações</CardTitle></CardHeader>
            <CardContent>
              <Textarea
                value={anotacoes}
                onChange={(e) => setAnotacoes(e.target.value)}
                placeholder="Escreva suas anotações sobre este FII... (salvo junto com o valuation)"
                rows={4}
              />
            </CardContent>
          </Card>

          {/* Save / reset */}
          <div className="flex flex-col md:flex-row gap-2">
            <Button
              className="flex-1 gap-2"
              size="lg"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !ticker}
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingId ? 'Atualizar Valuation' : 'Salvar Valuation'}
            </Button>
            <Button variant="outline" size="lg" onClick={handleReset} className="gap-2">
              <RotateCcw className="h-4 w-4" /> Limpar
            </Button>
          </div>
        </>
      )}

      <SavedFIIModal
        open={savedModalOpen}
        onOpenChange={setSavedModalOpen}
        rows={savedList}
        onLoad={loadSaved}
        onDelete={(id) => deleteMutation.mutate(id)}
      />
    </div>
  );
}

// ===================== Subcomponents =====================

function MetricCard({
  label, value, onChange, readOnly, source, format,
}: {
  label: string;
  value: number;
  onChange?: (v: number) => void;
  readOnly?: boolean;
  source: 'api' | 'manual' | 'calc';
  format: (n: number) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <Card className="bg-card/60 backdrop-blur group">
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
          <Badgelet kind={source} />
        </div>
        {editing && !readOnly ? (
          <Input
            autoFocus
            value={draft}
            type="number"
            step="0.01"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const n = Number(draft.replace(',', '.'));
              if (Number.isFinite(n)) onChange?.(n);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="h-8 text-base"
          />
        ) : (
          <button
            type="button"
            className={`text-lg font-bold w-full text-left ${readOnly ? 'cursor-default' : 'cursor-pointer hover:text-primary'}`}
            onClick={() => { if (!readOnly) { setDraft(String(value)); setEditing(true); } }}
          >
            {format(value)}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function PremissaField({
  label, value, onChange, badge, note, step = 0.01,
}: {
  label: string; value: number; onChange: (v: number) => void;
  badge?: 'api' | 'manual'; note?: string; step?: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        {badge && <Badgelet kind={badge} />}
      </div>
      <Input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function IndicatorGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function IndRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between text-sm border-b border-border/30 pb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-semibold ${color ?? 'text-foreground'}`}>{value}</span>
    </div>
  );
}

function PriceRangeBar({ atual, teto, zero }: { atual: number; teto: number; zero: number }) {
  // Range spans [teto*0.7, zero*1.1]
  const min = Math.min(teto * 0.7, atual * 0.9);
  const max = Math.max(zero * 1.1, atual * 1.1);
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  return (
    <div className="mt-4 space-y-2">
      <div className="relative h-3 rounded-full bg-gradient-to-r from-green-500/40 via-yellow-500/40 to-red-500/40">
        <div className="absolute -top-1 w-0.5 h-5 bg-blue-400" style={{ left: `${pct(teto)}%` }} />
        <div className="absolute -top-1 w-0.5 h-5 bg-muted-foreground" style={{ left: `${pct(zero)}%` }} />
        <div className="absolute -top-2 w-1 h-7 bg-foreground rounded" style={{ left: `${pct(atual)}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>Barato</span><span>Na faixa</span><span>Caro</span>
      </div>
    </div>
  );
}

function SavedFIIModal({
  open, onOpenChange, rows, onLoad, onDelete,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  rows: any[]; onLoad: (row: any) => void; onDelete: (id: string) => void;
}) {
  const [filter, setFilter] = useState<'todos' | 'baratos' | 'caros'>('todos');
  const [query, setQuery] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const filtered = rows.filter(r => {
    if (query && !r.ticker.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === 'baratos' && r.status !== 'Barato') return false;
    if (filter === 'caros' && r.status !== 'Caro') return false;
    return true;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Meus Valuations FII</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col md:flex-row gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por ticker..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="flex gap-1">
            {(['todos', 'baratos', 'caros'] as const).map(f => (
              <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>
                {f === 'todos' ? 'Todos' : f === 'baratos' ? 'Baratos' : 'Caros'}
              </Button>
            ))}
          </div>
        </div>
        <div className="overflow-auto flex-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead className="text-right">Preço atual</TableHead>
                <TableHead className="text-right">Preço teto</TableHead>
                <TableHead className="text-right">Upside</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum valuation salvo</TableCell></TableRow>
              )}
              {filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold">{r.ticker}</TableCell>
                  <TableCell className="text-right">{fmtBRL(Number(r.preco_atual))}</TableCell>
                  <TableCell className="text-right text-blue-400">{fmtBRL(Number(r.preco_teto))}</TableCell>
                  <TableCell className={`text-right ${Number(r.upside) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {Number(r.upside).toFixed(2).replace('.', ',')}%
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      r.status === 'Barato' ? 'border-green-500/40 text-green-400' :
                      r.status === 'Caro' ? 'border-red-500/40 text-red-400' :
                      'border-yellow-500/40 text-yellow-400'
                    }>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => onLoad(r)} title="Carregar"><Eye className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => setConfirmDel(r.id)} title="Excluir"><Trash2 className="h-4 w-4 text-red-400" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir valuation?</AlertDialogTitle>
              <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => { if (confirmDel) onDelete(confirmDel); setConfirmDel(null); }}>Excluir</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}