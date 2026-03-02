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

// ---- Scoring Engine ----

type MaybeNumber = number | null;

interface PillarScore {
  quality: MaybeNumber;   // points (0..WEIGHTS.quality) or null if N/D
  growth: MaybeNumber;    // points (0..WEIGHTS.growth) or null if N/D
  valuation: MaybeNumber; // points (0..WEIGHTS.valuation) or null if N/D
  risk: MaybeNumber;      // points (0..WEIGHTS.risk) or null if N/D
  dividends: MaybeNumber; // points (0..WEIGHTS.dividends) or null if N/D

  total: number;          // 0..100, rescaled by available weight
  usedWeight: number;     // sum of weights actually used
  alerts: string[];
}

const WEIGHTS = { quality: 25, growth: 20, valuation: 25, risk: 15, dividends: 15 };

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

/**
 * Percentile-like normalization based on min/max within the current universe (stocks).
 * WARNING: if the universe is tiny or values are very close, this can compress scores.
 */
function normalize(value: number | null, min: number, max: number, inverse = false): number {
  if (value == null || !Number.isFinite(value) || max === min) return 0;
  const raw = inverse ? (max - value) / (max - min) : (value - min) / (max - min);
  return clamp01(raw);
}

function hasNum(v: any): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function scoreToPoints01(raw01: number, weight: number): number {
  return clamp01(raw01) * weight;
}

/**
 * Returns:
 * - points: (0..weight) if at least one metric is present
 * - usedFrac: how much of the pillar's "metric mix" was effectively present (0..1)
 */
function weightedPillar(
  parts: Array<{ value01: number; w: number; present: boolean }>,
  weight: number
): { points: MaybeNumber; usedFrac: number } {
  const usedW = parts.reduce((s, p) => (p.present ? s + p.w : s), 0);
  if (usedW <= 0) return { points: null, usedFrac: 0 };

  const sum = parts.reduce((s, p) => (p.present ? s + p.value01 * p.w : s), 0);
  const avg01 = sum / usedW;

  return { points: scoreToPoints01(avg01, weight), usedFrac: usedW };
}

/**
 * Total score is "neutralized":
 * - If a pillar is N/D (null), its weight is excluded.
 * - Total is rescaled to 0..100 based on used weights.
 */
function computeScores(stocks: PortfolioAsset[], totalPortfolio: number): Map<string, PillarScore> {
  const map = new Map<string, PillarScore>();
  if (stocks.length === 0) return map;

  // Helpers to build universe ranges
  const vals = (fn: (f: PortfolioAsset) => number | null) =>
    stocks.map(fn).filter((v): v is number => v != null && Number.isFinite(v));

  const range = (arr: number[]) =>
    arr.length > 0 ? { min: Math.min(...arr), max: Math.max(...arr) } : { min: 0, max: 0 };

  // Universe ranges (only from available values)
  const roeRange = range(vals(s => s.fundamentals?.roe ?? s.fundamentals?.roe_5y ?? null));
  const marginRange = range(vals(s => s.fundamentals?.margin ?? null));
  const peRange = range(vals(s => s.fundamentals?.pe_ratio ?? null));
  const pbRange = range(vals(s => s.fundamentals?.pb_ratio ?? null));
  const dyRange = range(vals(s => s.fundamentals?.dividend_yield ?? s.dy_12m ?? null));
  const payoutRange = range(vals(s => s.fundamentals?.payout ?? null));
  const revenueGrowthRange = range(vals(s => s.fundamentals?.revenue_growth ?? null));

  // Debt/EBITDA universe range
  const debtEbitdaVals = stocks
    .map(s => {
      const f = s.fundamentals;
      if (!f?.net_debt || !f?.ebitda || f.ebitda === 0) return null;
      return f.net_debt / f.ebitda;
    })
    .filter((v): v is number => v != null && Number.isFinite(v));
  const debtEbitdaRange = range(debtEbitdaVals);

  // EV/EBITDA universe range
  const evEbitdaVals = stocks
    .map(s => {
      const f = s.fundamentals;
      if (!f?.ev || !f?.ebitda || f.ebitda === 0) return null;
      return f.ev / f.ebitda;
    })
    .filter((v): v is number => v != null && Number.isFinite(v));
  const evEbitdaRange = range(evEbitdaVals);

  for (const stock of stocks) {
    const f = stock.fundamentals;
    const alerts: string[] = [];

    const price = stock.last_price ?? stock.avg_price ?? 0;
    const pctPortfolio = totalPortfolio > 0 ? (stock.quantity * price) / totalPortfolio * 100 : 0;

    // ---------------- QUALITY (25) ----------------
    const roe = f?.roe ?? f?.roe_5y ?? null;
    const margin = f?.margin ?? null;
    const debtEbitda =
      f?.net_debt != null && f?.ebitda && f.ebitda !== 0 ? f.net_debt / f.ebitda : null;

    const roeNorm = normalize(roe, roeRange.min, roeRange.max);
    const marginNorm = normalize(margin, marginRange.min, marginRange.max);
    const debtNorm = normalize(debtEbitda, debtEbitdaRange.min, debtEbitdaRange.max, true);

    let { points: qualityScore } = weightedPillar(
      [
        { value01: roeNorm, w: 0.4, present: roe != null },
        { value01: marginNorm, w: 0.3, present: margin != null },
        { value01: debtNorm, w: 0.3, present: debtEbitda != null },
      ],
      WEIGHTS.quality
    );

    if (qualityScore == null) {
      alerts.push('Dados insuficientes para Qualidade (ROE/Margem/Dívida)');
    } else {
      // Penalties / sanity checks
      if (roe != null && roe > 40 && debtEbitda != null && debtEbitda > 3) {
        qualityScore *= 0.9;
        alerts.push('ROE alto com dívida elevada – redutor aplicado');
      }
      if (roe != null && roe < 5) {
        qualityScore *= 0.7; // menos agressivo (era 0.5)
        alerts.push('ROE muito baixo (<5%) – redutor aplicado');
      }
    }

    // ---------------- GROWTH (20) ----------------
    const revenueGrowth = f?.revenue_growth ?? null;
    const payout = f?.payout ?? null;

    // sustainable growth (%): (1 - payout) * ROE
    const sustainableGrowth =
      roe != null && payout != null ? (1 - payout / 100) * (roe / 100) * 100 : null;

    const sg01 = sustainableGrowth != null ? clamp01(sustainableGrowth / 25) : 0; // 25% já é bem alto
    const rg01 = normalize(revenueGrowth, revenueGrowthRange.min, revenueGrowthRange.max);

    let { points: growthScore } = weightedPillar(
      [
        { value01: sg01, w: 0.6, present: sustainableGrowth != null },
        { value01: rg01, w: 0.4, present: revenueGrowth != null },
      ],
      WEIGHTS.growth
    );

    if (growthScore == null) {
      alerts.push('Dados insuficientes para Crescimento (ROE/Payout ou Revenue Growth)');
    } else {
      if (revenueGrowth != null && sustainableGrowth != null && revenueGrowth > sustainableGrowth + 6) {
        growthScore *= 0.85;
        alerts.push('Crescimento possivelmente insustentável (Revenue > Sustentável)');
      }
    }

    // ---------------- VALUATION (25) ----------------
    const pe = f?.pe_ratio ?? null;
    const pb = f?.pb_ratio ?? null;
    const evEbitda =
      f?.ev != null && f?.ebitda && f.ebitda !== 0 ? f.ev / f.ebitda : null;

    const pe01 = pe != null && pe > 0 ? normalize(pe, peRange.min, peRange.max, true) : 0;
    const pb01 = pb != null && pb > 0 ? normalize(pb, pbRange.min, pbRange.max, true) : 0;
    const eve01 = evEbitda != null ? normalize(evEbitda, evEbitdaRange.min, evEbitdaRange.max, true) : 0;

    let { points: valuationScore } = weightedPillar(
      [
        { value01: pe01, w: 0.4, present: pe != null && pe > 0 },
        { value01: pb01, w: 0.3, present: pb != null && pb > 0 },
        { value01: eve01, w: 0.3, present: evEbitda != null },
      ],
      WEIGHTS.valuation
    );

    if (valuationScore == null) {
      alerts.push('Dados insuficientes para Valuation (P/L, P/VP, EV/EBITDA)');
    } else {
      if (stock.avg_price > 0 && price > stock.avg_price * 1.5) {
        alerts.push('Valuation esticado – preço muito acima do preço médio');
      }

      // Cap: valuation excelente, mas qualidade muito fraca (evita “armadilha barata”)
      if (qualityScore != null && valuationScore > 0.8 * WEIGHTS.valuation && qualityScore < 0.35 * WEIGHTS.quality) {
        valuationScore = Math.min(valuationScore, 0.75 * WEIGHTS.valuation);
        alerts.push('Valuation bom mas qualidade fraca – cap aplicado no pilar');
      }
    }

    // ---------------- RISK (15) ----------------
    // NOTE: sua “volatilidade” atual usa change_percent (um dia). É proxy fraco, mas ok por enquanto.
    const changePercent = stock.change_percent ?? null;
    const vol = changePercent != null ? Math.abs(changePercent) : null;

    const vol01 = vol != null ? clamp01(1 - vol / 12) : 0;              // 12% dia já é extremo
    const debt01 = debtEbitda != null ? debtNorm : 0;
    const conc01 = clamp01(1 - pctPortfolio / 25);                      // concentração >25% já é agressivo

    let { points: riskScore } = weightedPillar(
      [
        { value01: vol01, w: 0.35, present: vol != null },
        { value01: debt01, w: 0.35, present: debtEbitda != null },
        { value01: conc01, w: 0.30, present: totalPortfolio > 0 },
      ],
      WEIGHTS.risk
    );

    if (riskScore == null) {
      alerts.push('Dados insuficientes para Risco');
    } else {
      if (pctPortfolio > 15) {
        riskScore *= 0.85;
        alerts.push(`Concentração elevada: ${pctPortfolio.toFixed(1)}% da carteira`);
      }
    }

    // ---------------- DIVIDENDS (15) ----------------
    // Preferimos dy_12m calculado (dividends_cache), senão dividend_yield
    const dy = (stock.dy_12m != null && Number.isFinite(stock.dy_12m)) ? stock.dy_12m : (f?.dividend_yield ?? null);
    const payoutVal = f?.payout ?? null;

    const dy01 = dy != null ? normalize(dy, dyRange.min, dyRange.max) : 0;

    // payout "ideal" 30-70, ok 20-80, fora disso penaliza
    const payout01 =
      payoutVal == null
        ? 0
        : payoutVal >= 30 && payoutVal <= 70
          ? 1
          : payoutVal >= 20 && payoutVal <= 80
            ? 0.7
            : 0.35;

    let { points: dividendsScore } = weightedPillar(
      [
        { value01: dy01, w: 0.6, present: dy != null },
        { value01: payout01, w: 0.4, present: payoutVal != null },
      ],
      WEIGHTS.dividends
    );

    if (dividendsScore == null) {
      alerts.push('Dados insuficientes para Dividendos (DY/Payout)');
    } else {
      if (payoutVal != null && payoutVal > 95) {
        dividendsScore *= 0.75;
        alerts.push('Payout acima de 95% – sustentabilidade em risco');
      }
    }

    // ---------------- TOTAL (neutralized & rescaled) ----------------
    const pillarEntries: Array<{ key: keyof typeof WEIGHTS; points: MaybeNumber; w: number }> = [
      { key: 'quality', points: qualityScore, w: WEIGHTS.quality },
      { key: 'growth', points: growthScore, w: WEIGHTS.growth },
      { key: 'valuation', points: valuationScore, w: WEIGHTS.valuation },
      { key: 'risk', points: riskScore, w: WEIGHTS.risk },
      { key: 'dividends', points: dividendsScore, w: WEIGHTS.dividends },
    ];

    const usedWeight = pillarEntries.reduce((s, p) => (p.points != null ? s + p.w : s), 0);
    const sumPoints = pillarEntries.reduce((s, p) => (p.points != null ? s + p.points : s), 0);

    // Rescale by used weight so missing pillars do not punish the asset
    let total = usedWeight > 0 ? (sumPoints / usedWeight) * 100 : 0;

    // Optional sanity caps (soft, not punitive on missing data)
    if (roe != null && roe < 3 && usedWeight >= 60) {
      total = Math.min(total, 65);
      alerts.push('ROE muito baixo (<3%) – teto de score aplicado');
    }

    // If too many missing pillars, warn
    const missingPillars = pillarEntries.filter(p => p.points == null).length;
    if (missingPillars >= 2) {
      alerts.push('Score neutralizado por falta de dados (2+ pilares N/D)');
    }

    // Round
    const round1 = (n: number) => Math.round(n * 10) / 10;

    map.set(stock.id, {
      quality: qualityScore != null ? round1(qualityScore) : null,
      growth: growthScore != null ? round1(growthScore) : null,
      valuation: valuationScore != null ? round1(valuationScore) : null,
      risk: riskScore != null ? round1(riskScore) : null,
      dividends: dividendsScore != null ? round1(dividendsScore) : null,
      total: round1(total),
      usedWeight,
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

function pillarDisplay(val: MaybeNumber) {
  return val == null ? 'N/D' : val.toFixed(1);
}

function pillarBarWidth(val: MaybeNumber, max: number) {
  if (val == null) return 0;
  return Math.max(0, Math.min(100, (val / max) * 100));
}

// ---- Main Component ----
const ACOES_SLUG = 'acoes';

const Score = () => {
  const { data: portfolio = [], isLoading } = usePortfolio();
  const { data: classes = [] } = useAssetClasses();
  const { data: targets = [] } = useClassTargets(); // (mantido, caso você use depois)
  const saveSnapshot = useSaveScoreSnapshot();

  const acoesClassId = classes.find(c => c.slug === ACOES_SLUG)?.id;

  const stocks = useMemo(
    () => portfolio.filter(p => p.class_id === acoesClassId && p.quantity > 0),
    [portfolio, acoesClassId]
  );

  const totalPortfolio = useMemo(
    () => portfolio.reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price ?? 0), 0),
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
        { pillar: 'Qualidade', value: selectedScore.quality == null ? 0 : (selectedScore.quality / WEIGHTS.quality) * 100, fullMark: 100 },
        { pillar: 'Crescimento', value: selectedScore.growth == null ? 0 : (selectedScore.growth / WEIGHTS.growth) * 100, fullMark: 100 },
        { pillar: 'Valuation', value: selectedScore.valuation == null ? 0 : (selectedScore.valuation / WEIGHTS.valuation) * 100, fullMark: 100 },
        { pillar: 'Risco', value: selectedScore.risk == null ? 0 : (selectedScore.risk / WEIGHTS.risk) * 100, fullMark: 100 },
        { pillar: 'Dividendos', value: selectedScore.dividends == null ? 0 : (selectedScore.dividends / WEIGHTS.dividends) * 100, fullMark: 100 },
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
      score_quality: r.score.quality ?? null,
      score_growth: r.score.growth ?? null,
      score_valuation: r.score.valuation ?? null,
      score_risk: r.score.risk ?? null,
      score_dividends: r.score.dividends ?? null,
      json_details: { alerts: r.score.alerts, usedWeight: r.score.usedWeight },
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
          <CardContent className="py-12 text-center text-muted-foreground">Nenhuma ação encontrada na carteira.</CardContent>
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

                      {/* Transparency on neutralization */}
                      <div className="mt-2 text-xs text-muted-foreground">
                        Peso usado: <span className="font-mono">{selectedScore.usedWeight}</span>/100 (pilares N/D não penalizam)
                      </div>
                    </div>

                    <div className="space-y-2 mt-6">
                      {(
                        [
                          ['Qualidade', selectedScore.quality, WEIGHTS.quality],
                          ['Crescimento', selectedScore.growth, WEIGHTS.growth],
                          ['Valuation', selectedScore.valuation, WEIGHTS.valuation],
                          ['Risco', selectedScore.risk, WEIGHTS.risk],
                          ['Dividendos', selectedScore.dividends, WEIGHTS.dividends],
                        ] as [string, MaybeNumber, number][]
                      ).map(([label, val, max]) => (
                        <div key={label} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-24">{label}</span>

                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${val == null ? 'bg-muted-foreground/25' : 'bg-primary'}`}
                              style={{ width: `${pillarBarWidth(val, max)}%` }}
                            />
                          </div>

                          <span className="text-xs font-mono w-20 text-right">
                            {val == null ? 'N/D' : `${val.toFixed(1)} / ${max}`}
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
                      <TableCell className="text-center font-mono text-xs">{pillarDisplay(r.score.quality)}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{pillarDisplay(r.score.growth)}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{pillarDisplay(r.score.valuation)}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{pillarDisplay(r.score.risk)}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{pillarDisplay(r.score.dividends)}</TableCell>
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
