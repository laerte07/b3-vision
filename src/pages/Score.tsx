import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Brain, Save, Shield } from 'lucide-react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';
import { usePortfolio, PortfolioAsset } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useClassTargets } from '@/hooks/useClassTargets';
import { useScoreHistory, useSaveScoreSnapshot } from '@/hooks/useScoreHistory';

// ---- Scoring Engine (VERSÃO REALISTA / DATA-AWARE) ----

interface PillarScore {
  quality: number | null;
  growth: number | null;
  valuation: number | null;
  risk: number | null;
  dividends: number | null;
  total: number;                 // 0-100
  effectiveWeights: Record<string, number>;
  coverage: number;              // 0-1 (quanto dado existe)
  alerts: string[];
}

const WEIGHTS = { quality: 25, growth: 20, valuation: 25, risk: 15, dividends: 15 } as const;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

// Normalização com faixas fixas (benchmarks)
function normBetween(value: number | null | undefined, min: number, max: number, inverse = false): number | null {
  if (value == null || !Number.isFinite(value) || max === min) return null;
  const raw = inverse ? (max - value) / (max - min) : (value - min) / (max - min);
  return clamp01(raw);
}

// Curva “ideal” (payout, etc.)
function scoreBand(value: number | null | undefined, goodMin: number, goodMax: number, okMin: number, okMax: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= goodMin && value <= goodMax) return 1;
  if (value >= okMin && value <= okMax) return 0.7;
  return 0.3;
}

function redistributeWeights(base: typeof WEIGHTS, pillars: Record<keyof typeof WEIGHTS, number | null>) {
  const available = Object.entries(pillars).filter(([, v]) => v != null).map(([k]) => k as keyof typeof WEIGHTS);
  const missing = Object.entries(pillars).filter(([, v]) => v == null).map(([k]) => k as keyof typeof WEIGHTS);

  // Se tudo faltar (improvável), mantém pesos base e total vira 0
  if (available.length === 0) return { eff: base, factor: 1 };

  const missingWeight = missing.reduce((s, k) => s + base[k], 0);
  const availableWeight = available.reduce((s, k) => s + base[k], 0);

  // Redistribui o peso faltante proporcionalmente aos pilares com dado
  const eff: Record<keyof typeof WEIGHTS, number> = { ...base };
  for (const k of missing) eff[k] = 0;

  for (const k of available) {
    const add = (base[k] / availableWeight) * missingWeight;
    eff[k] = base[k] + add;
  }

  // factor usado só pra referência; soma final dos pesos deve dar 100
  return { eff, factor: 100 / Object.values(eff).reduce((a, b) => a + b, 0) };
}

function computeScores(stocks: PortfolioAsset[], totalPortfolio: number): Map<string, PillarScore> {
  const map = new Map<string, PillarScore>();
  if (stocks.length === 0) return map;

  for (const stock of stocks) {
    const f = stock.fundamentals;
    const alerts: string[] = [];

    const price = stock.last_price ?? stock.avg_price;
    const positionValue = stock.quantity * (price || 0);
    const pctPortfolio = totalPortfolio > 0 ? (positionValue / totalPortfolio) * 100 : 0;

    // -------------------------
    // QUALITY (benchmarks)
    // ROE: 0–25% (ótimo), Margem: 0–30%, Dívida/EBITDA: 0–4 (menor melhor)
    // -------------------------
    const roe = (f?.roe ?? f?.roe_5y ?? null);
    const margin = (f?.margin ?? null);

    const debtEbitda = (f?.net_debt != null && f?.ebitda && f.ebitda !== 0)
      ? (f.net_debt / f.ebitda)
      : null;

    const roeN = normBetween(roe, 0, 25);                  // 25% = “teto ótimo”
    const marginN = normBetween(margin, 0, 30);            // 30% = “teto ótimo”
    const debtN = normBetween(debtEbitda, 0, 4, true);     // 0–4 bom; >4 piora

    // média ponderada apenas com itens existentes
    const qParts: Array<{ w: number; v: number | null }> = [
      { w: 0.45, v: roeN },
      { w: 0.35, v: marginN },
      { w: 0.20, v: debtN },
    ];
    const qW = qParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const qualityNorm = qW > 0 ? qParts.filter(p => p.v != null).reduce((s, p) => s + (p.w * (p.v as number)), 0) / qW : null;

    let qualityScore = qualityNorm != null ? qualityNorm * WEIGHTS.quality : null;

    if (roe != null && roe < 5) alerts.push('ROE baixo (<5%) — qualidade pressionada');
    if (debtEbitda != null && debtEbitda > 4) alerts.push('Dívida/EBITDA alto (>4) — atenção ao risco financeiro');

    // -------------------------
    // GROWTH
    // sustainableGrowth = ROE*(1-payout)
    // revenue_growth (se existir)
    // Bench: -10% a 20% (com “cap” em 25%)
    // -------------------------
    const payout = f?.payout ?? null;
    const revenueGrowth = f?.revenue_growth ?? null;

    const sustainableGrowth = (roe != null && payout != null)
      ? (roe * (1 - (payout / 100))) // já em %
      : null;

    const sGrowN = normBetween(sustainableGrowth, 0, 20); // 20% = excelente
    const revGrowN = normBetween(revenueGrowth, -10, 20); // -10..20
    const gParts: Array<{ w: number; v: number | null }> = [
      { w: 0.60, v: sGrowN },
      { w: 0.40, v: revGrowN },
    ];
    const gW = gParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const growthNorm = gW > 0 ? gParts.filter(p => p.v != null).reduce((s, p) => s + (p.w * (p.v as number)), 0) / gW : null;

    let growthScore = growthNorm != null ? growthNorm * WEIGHTS.growth : null;

    if (growthScore == null) alerts.push('Sem dados suficientes para Crescimento (payout/ROE/revenueGrowth)');

    // -------------------------
    // VALUATION
    // Benchmarks: P/L 0–25 (menor melhor), P/VP 0–3 (menor melhor), EV/EBITDA 0–12 (menor melhor)
    // -------------------------
    const pe = f?.pe_ratio ?? null;
    const pb = f?.pb_ratio ?? null;
    const evEbitda = (f?.ev != null && f?.ebitda && f.ebitda !== 0) ? (f.ev / f.ebitda) : null;

    const peN = (pe != null && pe > 0) ? normBetween(pe, 5, 25, true) : null;     // muito baixo pode ser distorção; começa em 5
    const pbN = (pb != null && pb > 0) ? normBetween(pb, 0.8, 3, true) : null;
    const evN = (evEbitda != null && evEbitda > 0) ? normBetween(evEbitda, 4, 12, true) : null;

    const vParts: Array<{ w: number; v: number | null }> = [
      { w: 0.45, v: peN },
      { w: 0.25, v: pbN },
      { w: 0.30, v: evN },
    ];
    const vW = vParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const valuationNorm = vW > 0 ? vParts.filter(p => p.v != null).reduce((s, p) => s + (p.w * (p.v as number)), 0) / vW : null;

    let valuationScore = valuationNorm != null ? valuationNorm * WEIGHTS.valuation : null;

    if (valuationScore == null) alerts.push('Sem dados suficientes para Valuation (P/L, P/VP, EV/EBITDA)');

    // -------------------------
    // RISK
    // Proxy: volatilidade do dia (fraca), concentração, e dívida/ebitda se houver
    // Bench: vol 0..8% (>=8% piora), concentração 0..20% (>=20 piora)
    // -------------------------
    const changePercent = stock.change_percent ?? null;
    const volAbs = changePercent != null ? Math.abs(changePercent) : null;

    const volN = normBetween(volAbs, 0, 8, true);            // <=8% ok
    const concN = normBetween(pctPortfolio, 0, 20, true);    // <=20% ok
    const debtRiskN = debtN; // reaproveita (0..4)

    const rParts: Array<{ w: number; v: number | null }> = [
      { w: 0.35, v: volN },
      { w: 0.35, v: concN },
      { w: 0.30, v: debtRiskN },
    ];
    const rW = rParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const riskNorm = rW > 0 ? rParts.filter(p => p.v != null).reduce((s, p) => s + (p.w * (p.v as number)), 0) / rW : null;

    let riskScore = riskNorm != null ? riskNorm * WEIGHTS.risk : null;

    if (pctPortfolio > 15) alerts.push(`Concentração elevada: ${pctPortfolio.toFixed(1)}% da carteira`);

    // -------------------------
    // DIVIDENDS
    // Usa dividend_yield OU dy_12m. Se nenhum existir => N/D (não pune, redistribui peso)
    // Bench DY: 0–12% (maior melhor até 12), payout: ideal 30–70
    // -------------------------
    const dy = (f?.dividend_yield ?? stock.dy_12m ?? null);
    const dyN = normBetween(dy, 0, 12); // 12% = teto
    const payoutBand = scoreBand(payout, 30, 70, 20, 80); // 1, 0.7, 0.3

    const dParts: Array<{ w: number; v: number | null }> = [
      { w: 0.60, v: dyN },
      { w: 0.40, v: payoutBand },
    ];
    const dW = dParts.filter(p => p.v != null).reduce((s, p) => s + p.w, 0);
    const divNorm = dW > 0 ? dParts.filter(p => p.v != null).reduce((s, p) => s + (p.w * (p.v as number)), 0) / dW : null;

    let dividendsScore = divNorm != null ? divNorm * WEIGHTS.dividends : null;

    if (dividendsScore == null) {
      alerts.push('Sem dados de Dividendos (DY/Dividends). Plano BRAPI pode não fornecer.');
    } else {
      if (payout != null && payout > 90) alerts.push('Payout > 90% — dividendo pode ser pouco sustentável');
    }

    // -------------------------
    // TOTAL com pesos dinâmicos
    // -------------------------
    const pillars = {
      quality: qualityScore,
      growth: growthScore,
      valuation: valuationScore,
      risk: riskScore,
      dividends: dividendsScore,
    } as const;

    const { eff } = redistributeWeights(WEIGHTS, pillars as any);

    const sumEff = (Object.values(eff) as number[]).reduce((a, b) => a + b, 0);

    // Score final = soma( pillar_norm * peso_efetivo )
    // (onde pillar_norm = score/peso_base original do pilar)
    let total = 0;
    let haveAny = false;

    (Object.keys(pillars) as (keyof typeof WEIGHTS)[]).forEach((k) => {
      const s = pillars[k];
      if (s != null && WEIGHTS[k] > 0) {
        haveAny = true;
        const norm = s / WEIGHTS[k]; // volta pra 0..1
        total += norm * eff[k];
      }
    });

    if (!haveAny) total = 0;

    // Coverage: % de pilares com dado (simples e útil)
    const coverage = (Object.values(pillars).filter(v => v != null).length) / 5;

    // Alertas extras de “baixa confiabilidade”
    if (coverage < 0.6) alerts.push('Baixa cobertura de dados — score menos confiável');

    map.set(stock.id, {
      quality: qualityScore != null ? Math.round(qualityScore * 10) / 10 : null,
      growth: growthScore != null ? Math.round(growthScore * 10) / 10 : null,
      valuation: valuationScore != null ? Math.round(valuationScore * 10) / 10 : null,
      risk: riskScore != null ? Math.round(riskScore * 10) / 10 : null,
      dividends: dividendsScore != null ? Math.round(dividendsScore * 10) / 10 : null,
      total: Math.round(total * 10) / 10,
      effectiveWeights: eff,
      coverage,
      alerts,
    });
  }

  return map;
}

function scoreColor(score: number): string {
  if (score >= 85) return 'text-emerald-500';
  if (score >= 70) return 'text-blue-500';
  if (score >= 55) return 'text-yellow-500';
  return 'text-red-500';
}

function scoreBadge(score: number) {
  if (score >= 85) return <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30">Excelente</Badge>;
  if (score >= 70) return <Badge className="bg-blue-500/15 text-blue-500 border-blue-500/30">Muito bom</Badge>;
  if (score >= 55) return <Badge className="bg-yellow-500/15 text-yellow-500 border-yellow-500/30">Bom</Badge>;
  return <Badge className="bg-red-500/15 text-red-500 border-red-500/30">Fraco</Badge>;
}

function fmtPillar(val: number | null, max: number) {
  if (val == null) return 'N/D';
  return `${val.toFixed(1)} / ${max}`;
}

// ---- Main Component ----
const ACOES_SLUG = 'acoes';

const Score = () => {
  const { data: portfolio = [], isLoading } = usePortfolio();
  const { data: classes = [] } = useAssetClasses();
  const { data: targets = [] } = useClassTargets();
  const saveSnapshot = useSaveScoreSnapshot();

  const acoesClassId = classes.find(c => c.slug === ACOES_SLUG)?.id;

  const stocks = useMemo(() =>
    portfolio.filter(p => p.class_id === acoesClassId && p.quantity > 0),
    [portfolio, acoesClassId]
  );

  const totalPortfolio = useMemo(() =>
    portfolio.reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0),
    [portfolio]
  );

  const scoreMap = useMemo(() => computeScores(stocks, totalPortfolio), [stocks, totalPortfolio]);

  const ranking = useMemo(() =>
    stocks
      .map(s => ({ ...s, score: scoreMap.get(s.id)! }))
      .filter(s => s.score)
      .sort((a, b) => b.score.total - a.score.total),
    [stocks, scoreMap]
  );

  const [selectedId, setSelectedId] = useState<string>('');
  const selectedStock = stocks.find(s => s.id === selectedId);
  const selectedScore = selectedId ? scoreMap.get(selectedId) : ranking[0]?.score;
  const selectedTicker = selectedStock?.ticker ?? ranking[0]?.ticker ?? '';

  const { data: history = [] } = useScoreHistory(selectedId || ranking[0]?.id);

  const radarData = selectedScore ? [
    { pillar: 'Qualidade', value: selectedScore.quality != null ? (selectedScore.quality / WEIGHTS.quality) * 100 : 0, fullMark: 100 },
    { pillar: 'Crescimento', value: selectedScore.growth != null ? (selectedScore.growth / WEIGHTS.growth) * 100 : 0, fullMark: 100 },
    { pillar: 'Valuation', value: selectedScore.valuation != null ? (selectedScore.valuation / WEIGHTS.valuation) * 100 : 0, fullMark: 100 },
    { pillar: 'Risco', value: selectedScore.risk != null ? (selectedScore.risk / WEIGHTS.risk) * 100 : 0, fullMark: 100 },
    { pillar: 'Dividendos', value: selectedScore.dividends != null ? (selectedScore.dividends / WEIGHTS.dividends) * 100 : 0, fullMark: 100 },
  ] : [];

  const historyChart = history.map(h => ({
    date: new Date(h.snapshot_date).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
    score: Number(h.score_total),
  }));

  const handleSaveSnapshot = () => {
    const entries = ranking.map(r => ({
      asset_id: r.id,
      score_total: r.score.total,
      score_quality: r.score.quality ?? 0,
      score_growth: r.score.growth ?? 0,
      score_valuation: r.score.valuation ?? 0,
      score_risk: r.score.risk ?? 0,
      score_dividends: r.score.dividends ?? 0,
      json_details: {
        alerts: r.score.alerts,
        coverage: r.score.coverage,
        effectiveWeights: r.score.effectiveWeights,
      },
    }));
    saveSnapshot.mutate(entries);
  };

  const allAlerts = ranking.flatMap(r => r.score.alerts.map(a => `${r.ticker}: ${a}`));

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" /> Score Interno
          </h1>
          <p className="text-sm text-muted-foreground">
            Análise quantitativa de ações (0–100) • Cobertura de dados: {selectedScore ? Math.round(selectedScore.coverage * 100) : 0}%
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleSaveSnapshot} disabled={saveSnapshot.isPending || ranking.length === 0}>
          <Save className="h-4 w-4" />
          Salvar Snapshot
        </Button>
      </div>

      {stocks.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhuma ação encontrada na carteira.</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Radar do Ativo</CardTitle>
                  <Select value={selectedId || ranking[0]?.id || ''} onValueChange={setSelectedId}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {ranking.map(r => (
                        <SelectItem key={r.id} value={r.id}>{r.ticker}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {radarData.length > 0 ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                        <PolarGrid stroke="hsl(var(--border))" />
                        <PolarAngleAxis dataKey="pillar" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                        <Radar name={selectedTicker} dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.25} strokeWidth={2} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">Selecione um ativo</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Score Total</CardTitle></CardHeader>
              <CardContent>
                {selectedScore ? (
                  <div className="space-y-4">
                    <div className="text-center">
                      <span className={`text-5xl font-bold font-mono ${scoreColor(selectedScore.total)}`}>
                        {selectedScore.total.toFixed(1)}
                      </span>
                      <span className="text-2xl text-muted-foreground"> / 100</span>
                      <div className="mt-2">{scoreBadge(selectedScore.total)}</div>
                    </div>

                    <div className="space-y-2 mt-6">
                      {([
                        ['Qualidade', selectedScore.quality, WEIGHTS.quality],
                        ['Crescimento', selectedScore.growth, WEIGHTS.growth],
                        ['Valuation', selectedScore.valuation, WEIGHTS.valuation],
                        ['Risco', selectedScore.risk, WEIGHTS.risk],
                        ['Dividendos', selectedScore.dividends, WEIGHTS.dividends],
                      ] as [string, number | null, number][]).map(([label, val, max]) => (
                        <div key={label} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-24">{label}</span>
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${val == null ? 0 : (val / max) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono w-20 text-right">{val == null ? 'N/D' : `${val.toFixed(1)} / ${max}`}</span>
                        </div>
                      ))}
                    </div>

                    {selectedScore.alerts.length > 0 && (
                      <div className="mt-4 space-y-1">
                        <p className="text-xs font-medium text-muted-foreground uppercase">Alertas</p>
                        {selectedScore.alerts.map((a, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs p-2 rounded bg-destructive/5 border border-destructive/15">
                            <AlertTriangle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                            <span>{a}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">Nenhum dado</p>
                )}
              </CardContent>
            </Card>
          </div>

          {historyChart.length > 1 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Histórico de Score – {selectedTicker}</CardTitle></CardHeader>
              <CardContent>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historyChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                      <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
                      <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Ranking da Carteira</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Ativo</TableHead>
                    <TableHead className="text-center">Score</TableHead>
                    <TableHead className="text-center">Qualidade</TableHead>
                    <TableHead className="text-center">Crescimento</TableHead>
                    <TableHead className="text-center">Valuation</TableHead>
                    <TableHead className="text-center">Risco</TableHead>
                    <TableHead className="text-center">Dividendos</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ranking.map((r, idx) => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedId(r.id)}>
                      <TableCell className="font-mono text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{r.ticker}</TableCell>
                      <TableCell className={`text-center font-bold font-mono ${scoreColor(r.score.total)}`}>{r.score.total.toFixed(1)}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{r.score.quality == null ? 'N/D' : r.score.quality.toFixed(1)}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{r.score.growth == null ? 'N/D' : r.score.growth.toFixed(1)}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{r.score.valuation == null ? 'N/D' : r.score.valuation.toFixed(1)}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{r.score.risk == null ? 'N/D' : r.score.risk.toFixed(1)}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{r.score.dividends == null ? 'N/D' : r.score.dividends.toFixed(1)}</TableCell>
                      <TableCell className="text-center">{scoreBadge(r.score.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {allAlerts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4 text-destructive" /> Alertas Inteligentes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {allAlerts.slice(0, 20).map((alert, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/5 border border-destructive/15">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                      <span className="text-xs">{alert}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default Score;
