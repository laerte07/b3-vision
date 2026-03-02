import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Brain, Save, Shield } from 'lucide-react';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
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

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, isNaN(v) ? 0 : v));
}

// Converte para % quando a API vier como decimal (0.18) ou % (18)
function asPercent(x: number | null | undefined): number | null {
  if (x == null) return null;
  if (Math.abs(x) <= 1.5) return x * 100; // heurística: 0..1.5 => decimal
  return x;
}

// Curvas suaves para métricas “menor é melhor”
function scoreLowerBetter(value: number | null, good: number, ok: number, bad: number, fallback = 0.55) {
  if (value == null || value <= 0) return clamp01(fallback);
  if (value <= good) return 1;
  if (value <= ok) return 1 - (value - good) * (0.3 / (ok - good)); // 1..0.7
  if (value <= bad) return 0.7 - (value - ok) * (0.5 / (bad - ok)); // 0.7..0.2
  return 0.2;
}

// Curvas suaves para métricas “maior é melhor”
function scoreHigherBetter(value: number | null, bad: number, ok: number, good: number, fallback = 0.55) {
  if (value == null) return clamp01(fallback);
  if (value >= good) return 1;
  if (value >= ok) return 0.7 + (value - ok) * (0.3 / (good - ok)); // 0.7..1
  if (value >= bad) return 0.2 + (value - bad) * (0.5 / (ok - bad)); // 0.2..0.7
  return 0.2;
}

/**
 * Benchmarks realistas (Brasil) – pode evoluir p/ setor depois.
 * Ideia: pontuar por “mundo real”, não pelo min/max da carteira (amostra pequena distorce).
 */
const BENCH = {
  roe: { bad: 5, ok: 12, good: 20 }, // %
  margin: { bad: 5, ok: 12, good: 20 }, // %
  debtEbitda: { good: 0.8, ok: 2.0, bad: 4.0 }, // x (menor melhor)
  revGrowth: { bad: -5, ok: 5, good: 15 }, // % a.a.
  // múltiplos (menor melhor)
  pe: { good: 6, ok: 12, bad: 25 },
  pb: { good: 0.8, ok: 1.8, bad: 4.0 },
  evEbitda: { good: 4, ok: 8, bad: 15 },
  // dividendos
  dy: { bad: 2, ok: 5, good: 8 }, // %
};

function computeScores(stocks: PortfolioAsset[], totalPortfolio: number): Map<string, PillarScore> {
  const map = new Map<string, PillarScore>();
  if (stocks.length === 0) return map;

  for (const stock of stocks) {
    const f = stock.fundamentals;
    const alerts: string[] = [];

    const price = stock.last_price ?? stock.avg_price;
    const positionValue = stock.quantity * (price || 0);
    const pctPortfolio = totalPortfolio > 0 ? (positionValue / totalPortfolio) * 100 : 0;

    // ---------- QUALITY (25) ----------
    const roe = asPercent(f?.roe ?? f?.roe_5y ?? null);
    const margin = asPercent(f?.margin ?? null);

    const debtEbitda =
      f?.net_debt != null && f?.ebitda && f.ebitda !== 0 ? f.net_debt / f.ebitda : null;

    const roeS = scoreHigherBetter(roe, BENCH.roe.bad, BENCH.roe.ok, BENCH.roe.good, 0.55);
    const marginS = scoreHigherBetter(margin, BENCH.margin.bad, BENCH.margin.ok, BENCH.margin.good, 0.50);
    const debtS = scoreLowerBetter(debtEbitda, BENCH.debtEbitda.good, BENCH.debtEbitda.ok, BENCH.debtEbitda.bad, 0.55);

    let quality01 = roeS * 0.45 + marginS * 0.25 + debtS * 0.30;

    if (roe != null && roe < 5) {
      quality01 *= 0.75;
      alerts.push('ROE muito baixo (<5%) – qualidade penalizada');
    }
    if (debtEbitda != null && debtEbitda > 4) {
      quality01 *= 0.80;
      alerts.push('Dívida/EBITDA muito alta (>4x) – qualidade penalizada');
    }

    const qualityScore = quality01 * WEIGHTS.quality;

    // ---------- GROWTH (20) ----------
    const payout = f?.payout ?? null; // %
    const revGrowth = asPercent(f?.revenue_growth ?? null);

    // g sustentável (%): ROE * (1 - payout)
    const sustainableGrowth = roe != null && payout != null ? roe * (1 - payout / 100) : null;

    const revS = scoreHigherBetter(revGrowth, BENCH.revGrowth.bad, BENCH.revGrowth.ok, BENCH.revGrowth.good, 0.50);
    const susS = scoreHigherBetter(sustainableGrowth, 3, 8, 15, 0.55);

    let growth01 = susS * 0.55 + revS * 0.45;

    if (revGrowth != null && sustainableGrowth != null && revGrowth > sustainableGrowth + 8) {
      growth01 *= 0.85;
      alerts.push('Crescimento acima do sustentável – revisar premissas');
    }

    const growthScore = growth01 * WEIGHTS.growth;

    // ---------- VALUATION (25) ----------
    const pe = f?.pe_ratio ?? null;
    const pb = f?.pb_ratio ?? null;
    const evEbitda = f?.ev != null && f?.ebitda && f.ebitda !== 0 ? f.ev / f.ebitda : null;

    const peS = scoreLowerBetter(pe, BENCH.pe.good, BENCH.pe.ok, BENCH.pe.bad, 0.55);
    const pbS = scoreLowerBetter(pb, BENCH.pb.good, BENCH.pb.ok, BENCH.pb.bad, 0.55);
    const evS = scoreLowerBetter(evEbitda, BENCH.evEbitda.good, BENCH.evEbitda.ok, BENCH.evEbitda.bad, 0.55);

    let valuation01 = peS * 0.40 + pbS * 0.25 + evS * 0.35;

    if (stock.avg_price > 0 && price > stock.avg_price * 1.6) {
      alerts.push('Preço muito acima do PM – pode haver esticamento (atenção)');
    }

    // valuation excelente não pode maquiar qualidade muito fraca
    if (valuation01 > 0.80 && quality01 < 0.35) {
      valuation01 = Math.min(valuation01, 0.70);
      alerts.push('Valuation bom, mas qualidade fraca – valuation limitado');
    }

    const valuationScore = valuation01 * WEIGHTS.valuation;

    // ---------- RISK (15) ----------
    // change_percent é diário -> proxy leve (não destruir score)
    const dayMove = Math.abs(stock.change_percent ?? 0);
    const moveS = scoreLowerBetter(dayMove, 0.8, 2.0, 6.0, 0.55);

    const concS = scoreLowerBetter(pctPortfolio, 6, 12, 25, 0.60);
    const debtRiskS = debtS;

    let risk01 = moveS * 0.35 + debtRiskS * 0.30 + concS * 0.35;

    if (pctPortfolio > 15) {
      risk01 *= 0.85;
      alerts.push(`Concentração alta: ${pctPortfolio.toFixed(1)}% da carteira`);
    }

    const riskScore = risk01 * WEIGHTS.risk;

    // ---------- DIVIDENDS (15) ----------
    const dy = asPercent(f?.dividend_yield ?? stock.dy_12m ?? null);

    const payoutScore =
      payout == null ? 0.55 :
      payout >= 30 && payout <= 70 ? 1 :
      payout >= 20 && payout <= 80 ? 0.75 :
      0.40;

    const dyS = scoreHigherBetter(dy, BENCH.dy.bad, BENCH.dy.ok, BENCH.dy.good, 0.50);

    let dividends01 = dyS * 0.60 + payoutScore * 0.40;

    if (payout != null && payout > 95) {
      dividends01 *= 0.80;
      alerts.push('Payout muito alto (>95%) – dividendo pode ser insustentável');
    }

    const dividendsScore = dividends01 * WEIGHTS.dividends;

    // ---------- TOTAL ----------
    let total = qualityScore + growthScore + valuationScore + riskScore + dividendsScore;

    // cap global mais realista: ROE MUITO baixo impede “excelente”, mas não mata tudo
    if (roe != null && roe < 5) total = Math.min(total, 60);

    if (sustainableGrowth != null && sustainableGrowth >= 20) {
      alerts.push('Crescimento sustentável muito alto (≥20%) – checar ROE/payout (outlier?)');
    }

    map.set(stock.id, {
      quality: Math.round(qualityScore * 10) / 10,
      growth: Math.round(growthScore * 10) / 10,
      valuation: Math.round(valuationScore * 10) / 10,
      risk: Math.round(riskScore * 10) / 10,
      dividends: Math.round(dividendsScore * 10) / 10,
      total: Math.round(total * 10) / 10,
      alerts,
    });
  }

  return map;
}

// ---- Status / Cores (calibrado p/ Brasil) ----
function scoreColor(score: number): string {
  if (score >= 85) return 'text-emerald-500';
  if (score >= 70) return 'text-sky-500';
  if (score >= 55) return 'text-blue-500';
  if (score >= 40) return 'text-yellow-500';
  return 'text-red-500';
}

function scoreBadge(score: number) {
  if (score >= 85) return <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30">Excelente</Badge>;
  if (score >= 70) return <Badge className="bg-sky-500/15 text-sky-500 border-sky-500/30">Muito bom</Badge>;
  if (score >= 55) return <Badge className="bg-blue-500/15 text-blue-500 border-blue-500/30">Bom</Badge>;
  if (score >= 40) return <Badge className="bg-yellow-500/15 text-yellow-500 border-yellow-500/30">Regular</Badge>;
  return <Badge className="bg-red-500/15 text-red-500 border-red-500/30">Fraco</Badge>;
}

// ---- Main Component ----
const ACOES_SLUG = 'acoes';

const Score = () => {
  const { data: portfolio = [], isLoading } = usePortfolio();
  const { data: classes = [] } = useAssetClasses();
  const { data: targets = [] } = useClassTargets(); // mantido (mesmo que não use agora)
  const saveSnapshot = useSaveScoreSnapshot();

  const acoesClassId = classes.find(c => c.slug === ACOES_SLUG)?.id;

  const stocks = useMemo(
    () => portfolio.filter(p => p.class_id === acoesClassId && p.quantity > 0),
    [portfolio, acoesClassId]
  );

  const totalPortfolio = useMemo(
    () => portfolio.reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0),
    [portfolio]
  );

  const scoreMap = useMemo(() => computeScores(stocks, totalPortfolio), [stocks, totalPortfolio]);

  const ranking = useMemo(
    () =>
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

  const radarData = selectedScore
    ? [
        { pillar: 'Qualidade', value: (selectedScore.quality / WEIGHTS.quality) * 100, fullMark: 100 },
        { pillar: 'Crescimento', value: (selectedScore.growth / WEIGHTS.growth) * 100, fullMark: 100 },
        { pillar: 'Valuation', value: (selectedScore.valuation / WEIGHTS.valuation) * 100, fullMark: 100 },
        { pillar: 'Risco', value: (selectedScore.risk / WEIGHTS.risk) * 100, fullMark: 100 },
        { pillar: 'Dividendos', value: (selectedScore.dividends / WEIGHTS.dividends) * 100, fullMark: 100 },
      ]
    : [];

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
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={handleSaveSnapshot}
          disabled={saveSnapshot.isPending || ranking.length === 0}
        >
          <Save className="h-4 w-4" />
          Salvar Snapshot
        </Button>
      </div>

      {stocks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma ação encontrada na carteira.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Radar + Score Detail */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Radar do Ativo</CardTitle>
                  <Select value={selectedId || ranking[0]?.id || ''} onValueChange={setSelectedId}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {ranking.map(r => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.ticker}
                        </SelectItem>
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
                        <Radar
                          name={selectedTicker}
                          dataKey="value"
                          stroke="hsl(var(--primary))"
                          fill="hsl(var(--primary))"
                          fillOpacity={0.25}
                          strokeWidth={2}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">Selecione um ativo</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Score Total</CardTitle>
              </CardHeader>
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
                          <span className="text-xs font-mono w-14 text-right">
                            {val.toFixed(1)} / {max}
                          </span>
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
              <CardHeader>
                <CardTitle className="text-base">Histórico de Score – {selectedTicker}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historyChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          color: 'hsl(var(--foreground))',
                        }}
                      />
                      <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Ranking Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ranking da Carteira</CardTitle>
            </CardHeader>
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
