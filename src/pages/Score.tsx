import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Brain, Save, TrendingDown, TrendingUp, Shield } from 'lucide-react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { usePortfolio, PortfolioAsset } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useClassTargets } from '@/hooks/useClassTargets';
import { useScoreHistory, useSaveScoreSnapshot } from '@/hooks/useScoreHistory';
import { formatPct } from '@/lib/format';

// ---- Scoring Engine ----

interface PillarScore {
  quality: number;
  growth: number;
  valuation: number;
  risk: number;
  dividends: number;
  total: number;
  alerts: string[];
}

const WEIGHTS = { quality: 25, growth: 20, valuation: 25, risk: 15, dividends: 15 };

function clamp01(v: number): number { return Math.max(0, Math.min(1, isNaN(v) ? 0 : v)); }

function normalize(value: number | null, min: number, max: number, inverse = false): number {
  if (value == null || max === min) return 0;
  const raw = inverse ? (max - value) / (max - min) : (value - min) / (max - min);
  return clamp01(raw);
}

function computeScores(stocks: PortfolioAsset[], totalPortfolio: number): Map<string, PillarScore> {
  const map = new Map<string, PillarScore>();
  if (stocks.length === 0) return map;

  // Collect sector ranges
  const vals = (fn: (f: PortfolioAsset) => number | null) => stocks.map(fn).filter((v): v is number => v != null);
  const range = (arr: number[]) => arr.length > 0 ? { min: Math.min(...arr), max: Math.max(...arr) } : { min: 0, max: 0 };

  const roeRange = range(vals(s => s.fundamentals?.roe ?? null));
  const marginRange = range(vals(s => s.fundamentals?.margin ?? null));
  const peRange = range(vals(s => s.fundamentals?.pe_ratio ?? null));
  const pbRange = range(vals(s => s.fundamentals?.pb_ratio ?? null));
  const dyRange = range(vals(s => s.fundamentals?.dividend_yield ?? s.dy_12m ?? null));
  const payoutRange = range(vals(s => s.fundamentals?.payout ?? null));

  // Debt/EBITDA range
  const debtEbitdaVals = stocks.map(s => {
    const f = s.fundamentals;
    if (!f?.net_debt || !f?.ebitda || f.ebitda === 0) return null;
    return f.net_debt / f.ebitda;
  }).filter((v): v is number => v != null);
  const debtEbitdaRange = range(debtEbitdaVals);

  // EV/EBITDA range
  const evEbitdaVals = stocks.map(s => {
    const f = s.fundamentals;
    if (!f?.ev || !f?.ebitda || f.ebitda === 0) return null;
    return f.ev / f.ebitda;
  }).filter((v): v is number => v != null);
  const evEbitdaRange = range(evEbitdaVals);

  const revenueGrowthRange = range(vals(s => s.fundamentals?.revenue_growth ?? null));

  for (const stock of stocks) {
    const f = stock.fundamentals;
    const alerts: string[] = [];

    // -- QUALITY (25) --
    const roe = f?.roe ?? f?.roe_5y ?? null;
    const margin = f?.margin ?? null;
    const debtEbitda = (f?.net_debt != null && f?.ebitda && f.ebitda !== 0) ? f.net_debt / f.ebitda : null;

    let qualityRaw = 0;
    let qCount = 0;
    const roeNorm = normalize(roe, roeRange.min, roeRange.max);
    if (roe != null) { qualityRaw += roeNorm * 0.4; qCount += 0.4; }
    const marginNorm = normalize(margin, marginRange.min, marginRange.max);
    if (margin != null) { qualityRaw += marginNorm * 0.3; qCount += 0.3; }
    const debtNorm = normalize(debtEbitda, debtEbitdaRange.min, debtEbitdaRange.max, true);
    if (debtEbitda != null) { qualityRaw += debtNorm * 0.3; qCount += 0.3; }

    let qualityScore = qCount > 0 ? (qualityRaw / qCount) * WEIGHTS.quality : 0;

    // Penalties
    if (roe != null && roe > 40 && debtEbitda != null && debtEbitda > 3) {
      qualityScore *= 0.9;
      alerts.push('ROE alto com dívida elevada – redutor aplicado');
    }
    if (roe != null && roe < 5) {
      qualityScore *= 0.5;
      alerts.push('ROE muito baixo (<5%) – score limitado');
    }

    // -- GROWTH (20) --
    const revenueGrowth = f?.revenue_growth ?? null;
    const payout = f?.payout ?? null;
    const sustainableGrowth = (roe != null && payout != null) ? (1 - payout / 100) * (roe / 100) * 100 : null;

    let growthRaw = 0;
    let gCount = 0;
    if (sustainableGrowth != null) { growthRaw += clamp01(sustainableGrowth / 30) * 0.5; gCount += 0.5; }
    if (revenueGrowth != null) { growthRaw += normalize(revenueGrowth, revenueGrowthRange.min, revenueGrowthRange.max) * 0.5; gCount += 0.5; }

    let growthScore = gCount > 0 ? (growthRaw / gCount) * WEIGHTS.growth : 0;

    if (revenueGrowth != null && sustainableGrowth != null && revenueGrowth > sustainableGrowth + 5) {
      growthScore *= 0.8;
      alerts.push('Crescimento possivelmente insustentável');
    }

    // -- VALUATION (25) --
    const pe = f?.pe_ratio ?? null;
    const pb = f?.pb_ratio ?? null;

    let valRaw = 0;
    let vCount = 0;
    // P/L (lower is better)
    if (pe != null && pe > 0) { valRaw += normalize(pe, peRange.min, peRange.max, true) * 0.4; vCount += 0.4; }
    // P/VP (lower is better)
    if (pb != null && pb > 0) { valRaw += normalize(pb, pbRange.min, pbRange.max, true) * 0.3; vCount += 0.3; }
    // EV/EBITDA (lower is better)
    const evEbitda = (f?.ev != null && f?.ebitda && f.ebitda !== 0) ? f.ev / f.ebitda : null;
    if (evEbitda != null) { valRaw += normalize(evEbitda, evEbitdaRange.min, evEbitdaRange.max, true) * 0.3; vCount += 0.3; }

    let valuationScore = vCount > 0 ? (valRaw / vCount) * WEIGHTS.valuation : 0;

    // Penalty: price above avg (no margin of safety)
    const price = stock.last_price ?? stock.avg_price;
    if (stock.avg_price > 0 && price > stock.avg_price * 1.5) {
      alerts.push('Valuation alto – preço distante do preço médio');
    }

    // Cap rule: great valuation but weak quality
    if (valuationScore > 20 && qualityScore < 10) {
      valuationScore = Math.min(valuationScore, 0.7 * WEIGHTS.valuation);
      alerts.push('Valuation bom mas qualidade fraca – score limitado a 70% do pilar');
    }

    // -- RISK (15) --
    const changePercent = stock.change_percent ?? 0;
    const vol = Math.abs(changePercent);
    const pctPortfolio = totalPortfolio > 0 ? (stock.quantity * price) / totalPortfolio * 100 : 0;

    let riskRaw = 0;
    let rCount = 0;

    // Volatility proxy (lower is better)
    riskRaw += clamp01(1 - vol / 10) * 0.3; rCount += 0.3;

    // Debt/EBITDA (lower is better)
    if (debtEbitda != null) { riskRaw += debtNorm * 0.4; rCount += 0.4; }

    // Concentration (lower is better)
    riskRaw += clamp01(1 - pctPortfolio / 30) * 0.3; rCount += 0.3;

    let riskScore = rCount > 0 ? (riskRaw / rCount) * WEIGHTS.risk : 0;

    if (pctPortfolio > 15) {
      riskScore *= 0.8;
      alerts.push(`Concentração excessiva: ${pctPortfolio.toFixed(1)}% da carteira`);
    }

    // -- DIVIDENDS (15) --
    const dy = f?.dividend_yield ?? (stock.dy_12m ?? null);
    const payoutVal = f?.payout ?? null;

    let divRaw = 0;
    let dCount = 0;

    if (dy != null) { divRaw += normalize(dy, dyRange.min, dyRange.max) * 0.5; dCount += 0.5; }
    if (payoutVal != null) {
      // Ideal payout 30-70%
      const payoutScore = payoutVal >= 30 && payoutVal <= 70 ? 1 : payoutVal >= 20 && payoutVal <= 80 ? 0.7 : 0.3;
      divRaw += payoutScore * 0.5;
      dCount += 0.5;
    }

    let dividendsScore = dCount > 0 ? (divRaw / dCount) * WEIGHTS.dividends : 0;

    if (payoutVal != null && payoutVal > 90) {
      dividendsScore *= 0.7;
      alerts.push('Payout acima de 90% – sustentabilidade em risco');
    }

    // -- TOTAL --
    let total = qualityScore + growthScore + valuationScore + riskScore + dividendsScore;

    // Global cap: low ROE caps max score
    if (roe != null && roe < 5) {
      total = Math.min(total, 45);
    }

    // Growth >= discount rate alert
    if (sustainableGrowth != null && sustainableGrowth >= 12) {
      alerts.push('Crescimento ≥ taxa de desconto – verificar premissas');
    }

    map.set(stock.id, {
      quality: Math.round(qualityScore * 100 / WEIGHTS.quality) / 100 * WEIGHTS.quality,
      growth: Math.round(growthScore * 100 / WEIGHTS.growth) / 100 * WEIGHTS.growth,
      valuation: Math.round(valuationScore * 100 / WEIGHTS.valuation) / 100 * WEIGHTS.valuation,
      risk: Math.round(riskScore * 100 / WEIGHTS.risk) / 100 * WEIGHTS.risk,
      dividends: Math.round(dividendsScore * 100 / WEIGHTS.dividends) / 100 * WEIGHTS.dividends,
      total: Math.round(total * 10) / 10,
      alerts,
    });
  }
  return map;
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-500';
  if (score >= 65) return 'text-blue-500';
  if (score >= 50) return 'text-yellow-500';
  return 'text-red-500';
}

function scoreBadge(score: number) {
  if (score >= 80) return <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30">Excelente</Badge>;
  if (score >= 65) return <Badge className="bg-blue-500/15 text-blue-500 border-blue-500/30">Bom</Badge>;
  if (score >= 50) return <Badge className="bg-yellow-500/15 text-yellow-500 border-yellow-500/30">Regular</Badge>;
  return <Badge className="bg-red-500/15 text-red-500 border-red-500/30">Fraco</Badge>;
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
    stocks.map(s => ({ ...s, score: scoreMap.get(s.id)! }))
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
    { pillar: 'Qualidade', value: (selectedScore.quality / WEIGHTS.quality) * 100, fullMark: 100 },
    { pillar: 'Crescimento', value: (selectedScore.growth / WEIGHTS.growth) * 100, fullMark: 100 },
    { pillar: 'Valuation', value: (selectedScore.valuation / WEIGHTS.valuation) * 100, fullMark: 100 },
    { pillar: 'Risco', value: (selectedScore.risk / WEIGHTS.risk) * 100, fullMark: 100 },
    { pillar: 'Dividendos', value: (selectedScore.dividends / WEIGHTS.dividends) * 100, fullMark: 100 },
  ] : [];

  const historyChart = history.map(h => ({
    date: new Date(h.snapshot_date).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
    score: Number(h.score_total),
  }));

  const handleSaveSnapshot = () => {
    const entries = ranking.map(r => ({
      asset_id: r.id,
      score_total: r.score.total,
      score_quality: r.score.quality,
      score_growth: r.score.growth,
      score_valuation: r.score.valuation,
      score_risk: r.score.risk,
      score_dividends: r.score.dividends,
      json_details: { alerts: r.score.alerts },
    }));
    saveSnapshot.mutate(entries);
  };

  // Aggregate alerts across all stocks
  const allAlerts = ranking.flatMap(r => r.score.alerts.map(a => `${r.ticker}: ${a}`));

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" /> Score Interno
          </h1>
          <p className="text-sm text-muted-foreground">Análise quantitativa de ações (0–100)</p>
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
          {/* Radar + Score Detail */}
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
                      ] as [string, number, number][]).map(([label, val, max]) => (
                        <div key={label} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-24">{label}</span>
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${(val / max) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono w-14 text-right">{val.toFixed(1)} / {max}</span>
                        </div>
                      ))}
                    </div>
                    {/* Alerts for selected */}
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

          {/* Historical Chart */}
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

          {/* Ranking Table */}
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
                      <TableCell className="text-center font-mono text-xs">{r.score.quality.toFixed(1)}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{r.score.growth.toFixed(1)}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{r.score.valuation.toFixed(1)}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{r.score.risk.toFixed(1)}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{r.score.dividends.toFixed(1)}</TableCell>
                      <TableCell className="text-center">{scoreBadge(r.score.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Global Alerts */}
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
