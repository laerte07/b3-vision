import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { fadeUp, stagger } from '@/lib/motion-variants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Brain, Save, Shield, ArrowUpDown, ChevronUp, ChevronDown, Info } from 'lucide-react';
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useScoreHistory, useSaveScoreSnapshot } from '@/hooks/useScoreHistory';
import {
  computeScores, scoreColor, scoreLabel,
  PILLAR_KEYS, SECTOR_LABELS,
  type PillarKey, type PillarScore, type AlertCategory,
} from '@/lib/score-engine';

const ACOES_SLUG = 'acoes';

type SortKey = 'totalAdjusted' | 'totalBase' | 'quality' | 'growth' | 'valuation' | 'risk' | 'dividends' | 'ticker' | 'sector' | 'delta';
type SortDir = 'asc' | 'desc';

const PILLAR_SHORT: Record<PillarKey, string> = {
  quality: 'Qual', growth: 'Cresc', valuation: 'Val', risk: 'Risco', dividends: 'Div',
};
const PILLAR_LONG: Record<PillarKey, string> = {
  quality: 'Qualidade', growth: 'Crescimento', valuation: 'Valuation', risk: 'Risco', dividends: 'Dividendos',
};

const ALERT_CATEGORY_LABEL: Record<AlertCategory, string> = {
  quality: 'Qualidade', growth: 'Crescimento', valuation: 'Valuation',
  risk: 'Risco', dividends: 'Dividendos', data: 'Dados', coherence: 'Coerência',
};

const ALERT_PRIORITY_ICON: Record<string, string> = {
  high: '🔴', medium: '🟡', low: '🔵',
};

function scoreBadgeEl(score: number) {
  const s = scoreLabel(score);
  return <Badge className={s.className}>{s.text}</Badge>;
}

const fmtNorm = (n: number | null) => n == null ? 'N/D' : `${(n * 100).toFixed(0)}%`;
const fmtRaw = (v: number | null | undefined) => v == null ? '—' : typeof v === 'number' ? v.toFixed(2) : String(v);

const PILLAR_RAW_KEYS: Record<PillarKey, { key: string; label: string }[]> = {
  quality: [{ key: 'roe', label: 'ROE' }, { key: 'margin', label: 'Margem' }, { key: 'debtEbitda', label: 'Dív/EBITDA' }],
  growth: [{ key: 'revenueGrowth', label: 'Cresc. Receita' }, { key: 'payout', label: 'Payout' }],
  valuation: [{ key: 'pe', label: 'P/L' }, { key: 'pb', label: 'P/VP' }, { key: 'evEbitda', label: 'EV/EBITDA' }],
  risk: [{ key: 'debtEbitda', label: 'Dív/EBITDA' }],
  dividends: [{ key: 'dy', label: 'DY' }, { key: 'payout', label: 'Payout' }],
};

const Score = () => {
  const { data: portfolio = [], isLoading } = usePortfolio();
  const { data: classes = [] } = useAssetClasses();
  const saveSnapshot = useSaveScoreSnapshot();

  const acoesClassId = classes.find(c => c.slug === ACOES_SLUG)?.id ?? null;

  const stocks = useMemo(
    () => portfolio.filter(p => (acoesClassId ? p.class_id === acoesClassId : false) && p.quantity > 0),
    [portfolio, acoesClassId]
  );

  const totalPortfolio = useMemo(
    () => portfolio.reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0),
    [portfolio]
  );

  const scoreMap = useMemo(() => computeScores(stocks, totalPortfolio), [stocks, totalPortfolio]);

  const [sortKey, setSortKey] = useState<SortKey>('totalAdjusted');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const ranking = useMemo(() => {
    const items = stocks
      .map(s => ({ ...s, score: scoreMap.get(s.id)! }))
      .filter(s => !!s.score);

    items.sort((a, b) => {
      let va: any, vb: any;
      switch (sortKey) {
        case 'ticker': va = a.ticker; vb = b.ticker; break;
        case 'sector': va = a.score.sectorLabel; vb = b.score.sectorLabel; break;
        case 'totalBase': va = a.score.totalBase; vb = b.score.totalBase; break;
        case 'totalAdjusted': va = a.score.totalAdjusted; vb = b.score.totalAdjusted; break;
        case 'delta': va = a.score.totalAdjusted - a.score.totalBase; vb = b.score.totalAdjusted - b.score.totalBase; break;
        case 'quality': va = a.score.qualityNorm ?? -1; vb = b.score.qualityNorm ?? -1; break;
        case 'growth': va = a.score.growthNorm ?? -1; vb = b.score.growthNorm ?? -1; break;
        case 'valuation': va = a.score.valuationNorm ?? -1; vb = b.score.valuationNorm ?? -1; break;
        case 'risk': va = a.score.riskNorm ?? -1; vb = b.score.riskNorm ?? -1; break;
        case 'dividends': va = a.score.dividendsNorm ?? -1; vb = b.score.dividendsNorm ?? -1; break;
        default: va = a.score.totalAdjusted; vb = b.score.totalAdjusted;
      }
      if (typeof va === 'string') {
        const cmp = va.localeCompare(vb);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return items;
  }, [stocks, scoreMap, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />;
    return sortDir === 'desc' ? <ChevronDown className="h-3 w-3 ml-1" /> : <ChevronUp className="h-3 w-3 ml-1" />;
  };

  const [selectedId, setSelectedId] = useState<string>('');
  const fallbackId = ranking[0]?.id ?? '';
  const effectiveSelectedId = selectedId || fallbackId;
  const selectedStock = stocks.find(s => s.id === effectiveSelectedId);
  const selectedScore = effectiveSelectedId ? scoreMap.get(effectiveSelectedId) : null;
  const selectedTicker = selectedStock?.ticker ?? '';

  // Multi-select for comparative radar
  const RADAR_COLORS = ['hsl(var(--primary))', 'hsl(142 71% 45%)', 'hsl(280 67% 55%)', 'hsl(38 92% 50%)', 'hsl(0 72% 51%)'];
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const effectiveCompareIds = useMemo(
    () => compareIds.length > 0 ? compareIds : (effectiveSelectedId ? [effectiveSelectedId] : []),
    [compareIds, effectiveSelectedId]
  );

  const toggleCompare = (id: string) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  };

  const { data: history = [] } = useScoreHistory(effectiveSelectedId || undefined);

  const comparativeRadarData = useMemo(() => {
    const pillars = [
      { key: 'qualityNorm', label: 'Qualidade' },
      { key: 'growthNorm', label: 'Crescimento' },
      { key: 'valuationNorm', label: 'Valuation' },
      { key: 'riskNorm', label: 'Risco' },
      { key: 'dividendsNorm', label: 'Dividendos' },
    ];
    return pillars.map(p => {
      const entry: Record<string, any> = { pillar: p.label, fullMark: 100 };
      effectiveCompareIds.forEach(id => {
        const sc = scoreMap.get(id);
        const st = stocks.find(s => s.id === id);
        if (sc && st) {
          entry[st.ticker] = ((sc[p.key as keyof PillarScore] as number | null) ?? 0) * 100;
        }
      });
      return entry;
    });
  }, [effectiveCompareIds, scoreMap, stocks]);

  const historyChart = (history ?? []).map((h: any) => ({
    date: new Date(h.snapshot_date).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
    score: Number(h.score_total),
  }));

  const handleSaveSnapshot = () => {
    const entries = ranking.map(r => ({
      asset_id: r.id,
      score_total: r.score.totalAdjusted,
      score_quality: (r.score.qualityNorm ?? 0) * 25,
      score_growth: (r.score.growthNorm ?? 0) * 20,
      score_valuation: (r.score.valuationNorm ?? 0) * 25,
      score_risk: (r.score.riskNorm ?? 0) * 15,
      score_dividends: (r.score.dividendsNorm ?? 0) * 15,
      json_details: {
        alerts: r.score.alerts.map(a => a.text),
        coverage: r.score.coverage,
        sectorGroup: r.score.sectorGroup,
        totalBase: r.score.totalBase,
        totalAdjusted: r.score.totalAdjusted,
      },
    }));
    saveSnapshot.mutate(entries);
  };

  // Group alerts by category for better readability
  const groupedAlerts = useMemo(() => {
    const allAlerts = ranking.flatMap(r =>
      r.score.alerts.map(a => ({ ...a, ticker: r.ticker }))
    );
    // Sort by priority then group
    const sorted = allAlerts.sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return (p[a.priority] ?? 1) - (p[b.priority] ?? 1);
    });
    // Deduplicate similar alerts
    const seen = new Set<string>();
    return sorted.filter(a => {
      const key = `${a.ticker}:${a.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 25);
  }, [ranking]);

  const highAlerts = groupedAlerts.filter(a => a.priority === 'high');
  const otherAlerts = groupedAlerts.filter(a => a.priority !== 'high');

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div>;

  if (!acoesClassId) {
    return (
      <div className="space-y-6">
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          Não encontrei a classe <span className="font-mono">acoes</span>. Verifique o slug da classe no banco.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <motion.div className="space-y-6" initial="hidden" animate="visible" variants={stagger}>
      <motion.div variants={fadeUp} custom={0} className="flex items-center justify-between">
        <div>
          <p className="kpi-label mb-1">Análise Quantitativa v6</p>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" /> Score Interno
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Motor baseado em indicadores • Normalização por setor • Percentis relativos
          </p>
        </div>
        <Button
          variant="outline" size="sm" className="gap-2"
          onClick={handleSaveSnapshot}
          disabled={saveSnapshot.isPending || ranking.length === 0}
        >
          <Save className="h-4 w-4" /> Salvar Snapshot
        </Button>
      </motion.div>

      {stocks.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          Nenhuma ação encontrada na carteira.
        </CardContent></Card>
      ) : (
        <>
          <motion.div variants={fadeUp} custom={1} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Radar */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Radar do Ativo</CardTitle>
                  <Select value={effectiveSelectedId} onValueChange={setSelectedId}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
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

            {/* Score detail */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Score Total — {selectedTicker}</CardTitle>
              </CardHeader>
              <CardContent>
                {selectedScore ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">{selectedScore.sectorLabel}</Badge>
                      <Badge variant="outline" className="text-xs bg-muted/50">
                        Cobertura {Math.round(selectedScore.coverage * 100)}%
                      </Badge>
                      <Badge variant="outline" className="text-xs bg-muted/50">
                        Confiança {Math.round(selectedScore.confidence * 100)}%
                      </Badge>
                    </div>

                    {/* Base vs Adjusted */}
                    <div className="flex items-end gap-6 justify-center">
                      <div className="text-center">
                        <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Base</p>
                        <span className={`text-3xl font-bold font-mono ${scoreColor(selectedScore.totalBase)}`}>
                          {selectedScore.totalBase.toFixed(1)}
                        </span>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Ajustado</p>
                        <span className={`text-5xl font-bold font-mono ${scoreColor(selectedScore.totalAdjusted)}`}>
                          {selectedScore.totalAdjusted.toFixed(1)}
                        </span>
                        <span className="text-2xl text-muted-foreground"> / 93</span>
                      </div>
                      {(() => {
                        const delta = selectedScore.totalAdjusted - selectedScore.totalBase;
                        if (Math.abs(delta) < 0.1) return null;
                        return (
                          <div className="text-center">
                            <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Δ</p>
                            <span className={`text-lg font-mono font-bold ${delta > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="text-center">{scoreBadgeEl(selectedScore.totalAdjusted)}</div>

                    {/* Weights */}
                    <div className="mt-4 p-3 rounded-lg bg-muted/30 border border-border/50">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase mb-2">
                        Pesos: Base → {selectedScore.sectorGroup !== 'base' ? selectedScore.sectorLabel.split(' / ')[0] : 'Padrão'}
                      </p>
                      <div className="grid grid-cols-5 gap-1 text-center text-[10px]">
                        {PILLAR_KEYS.map(k => {
                          const bw = selectedScore.effectiveBaseWeights[k];
                          const aw = selectedScore.effectiveAdjustedWeights[k];
                          const diff = aw - bw;
                          return (
                            <div key={k}>
                              <div className="text-muted-foreground">{PILLAR_SHORT[k]}</div>
                              <div className="font-mono font-bold">{bw.toFixed(0)} → {aw.toFixed(0)}</div>
                              {Math.abs(diff) >= 0.5 && (
                                <div className={`font-mono text-[9px] ${diff > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                  {diff > 0 ? '+' : ''}{diff.toFixed(0)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Pillar bars */}
                    <div className="space-y-2 mt-4">
                      {PILLAR_KEYS.map(k => {
                        const norm = selectedScore[`${k}Norm` as keyof PillarScore] as number | null;
                        return (
                          <div key={k} className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground w-24">{PILLAR_LONG[k]}</span>
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${norm == null ? 0 : norm * 100}%` }} />
                            </div>
                            <span className="text-xs font-mono w-12 text-right">{fmtNorm(norm)}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Raw inputs */}
                    {selectedScore.rawInputs && (
                      <div className="mt-4 p-3 rounded-lg bg-muted/20 border border-border/30">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase mb-2 flex items-center gap-1">
                          <Info className="h-3 w-3" /> Indicadores brutos
                        </p>
                        <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[10px]">
                          {Object.entries(selectedScore.rawInputs).map(([key, val]) => (
                            <div key={key} className="flex justify-between">
                              <span className="text-muted-foreground">{key}</span>
                              <span className="font-mono">{val != null ? (typeof val === 'number' ? val.toFixed(2) : val) : '—'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Alerts for selected */}
                    {selectedScore.alerts.length > 0 && (
                      <div className="mt-4 space-y-1">
                        <p className="text-xs font-medium text-muted-foreground uppercase">Alertas</p>
                        {selectedScore.alerts.map((a, i) => (
                          <div key={i} className={`flex items-start gap-2 text-xs p-2 rounded border ${
                            a.priority === 'high' ? 'bg-destructive/10 border-destructive/20' :
                            a.priority === 'medium' ? 'bg-yellow-500/10 border-yellow-500/20' :
                            'bg-muted/50 border-border/50'
                          }`}>
                            <span className="shrink-0 text-[10px]">{ALERT_PRIORITY_ICON[a.priority]}</span>
                            <span>{a.text}</span>
                            <Badge variant="outline" className="ml-auto text-[9px] shrink-0">{ALERT_CATEGORY_LABEL[a.category]}</Badge>
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
          </motion.div>

          {/* History */}
          {historyChart.length > 1 && (
            <motion.div variants={fadeUp} custom={2}><Card>
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
                      <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
                      <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card></motion.div>
          )}

          {/* Ranking */}
          <motion.div variants={fadeUp} custom={3}><Card>
            <CardHeader>
              <CardTitle className="text-base">Ranking da Carteira</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('ticker')}>
                      <span className="flex items-center">Ativo <SortIcon col="ticker" /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('sector')}>
                      <span className="flex items-center">Setor <SortIcon col="sector" /></span>
                    </TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleSort('totalBase')}>
                      <span className="flex items-center justify-center">Base <SortIcon col="totalBase" /></span>
                    </TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleSort('totalAdjusted')}>
                      <span className="flex items-center justify-center">Ajustado <SortIcon col="totalAdjusted" /></span>
                    </TableHead>
                    <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleSort('delta')}>
                      <span className="flex items-center justify-center">Δ <SortIcon col="delta" /></span>
                    </TableHead>
                    {PILLAR_KEYS.map(k => (
                      <TableHead key={k} className="text-center cursor-pointer select-none" onClick={() => toggleSort(k as SortKey)}>
                        <span className="flex items-center justify-center">{PILLAR_SHORT[k]} <SortIcon col={k as SortKey} /></span>
                      </TableHead>
                    ))}
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ranking.map((r, idx) => {
                    const delta = r.score.totalAdjusted - r.score.totalBase;
                    return (
                      <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedId(r.id)}>
                        <TableCell className="font-mono text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-medium">{r.ticker}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                            {r.score.sectorLabel.split(' / ')[0]}
                          </Badge>
                        </TableCell>
                        <TableCell className={`text-center font-mono text-xs ${scoreColor(r.score.totalBase)}`}>
                          {r.score.totalBase.toFixed(1)}
                        </TableCell>
                        <TableCell className={`text-center font-bold font-mono ${scoreColor(r.score.totalAdjusted)}`}>
                          {r.score.totalAdjusted.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-center font-mono text-xs">
                          {Math.abs(delta) < 0.1 ? '—' : (
                            <span className={delta > 0 ? 'text-emerald-500' : 'text-red-500'}>
                              {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                            </span>
                          )}
                        </TableCell>
                        {PILLAR_KEYS.map(k => (
                          <TableCell key={k} className="text-center font-mono text-xs">
                            <TooltipProvider delayDuration={200}>
                              <UITooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help border-b border-dotted border-muted-foreground/40">
                                    {fmtNorm(r.score[`${k}Norm` as keyof PillarScore] as number | null)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs space-y-0.5 max-w-48">
                                  <p className="font-semibold mb-1">{PILLAR_LONG[k]} — {r.ticker}</p>
                                  {PILLAR_RAW_KEYS[k].map(({ key, label }) => (
                                    <div key={key} className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">{label}</span>
                                      <span className="font-mono">{fmtRaw(r.score.rawInputs[key])}</span>
                                    </div>
                                  ))}
                                </TooltipContent>
                              </UITooltip>
                            </TooltipProvider>
                          </TableCell>
                        ))}
                        <TableCell className="text-center">{scoreBadgeEl(r.score.totalAdjusted)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card></motion.div>

          {/* Grouped Alerts */}
          {groupedAlerts.length > 0 && (
            <motion.div variants={fadeUp} custom={4}><Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4 text-destructive" /> Alertas Inteligentes
                  <Badge variant="outline" className="text-[10px] ml-2">{groupedAlerts.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {highAlerts.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-destructive uppercase mb-2">Prioridade Alta</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {highAlerts.map((a, i) => (
                        <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
                          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                          <span className="text-xs"><strong>{a.ticker}</strong>: {a.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {otherAlerts.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Observações</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                      {otherAlerts.map((a, i) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30 border border-border/30">
                          <span className="text-[10px] shrink-0 mt-0.5">{ALERT_PRIORITY_ICON[a.priority]}</span>
                          <span className="text-xs"><strong>{a.ticker}</strong>: {a.text}</span>
                          <Badge variant="outline" className="ml-auto text-[9px] shrink-0">{ALERT_CATEGORY_LABEL[a.category]}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card></motion.div>
          )}
        </>
      )}
    </motion.div>
  );
};

export default Score;
