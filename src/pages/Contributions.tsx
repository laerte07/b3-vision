import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  DollarSign, TrendingUp, PieChart as PieIcon, CheckCircle, Trash2, Copy,
  Edit3, Download, ArrowRight, AlertTriangle, Wallet, BarChart3,
} from 'lucide-react';
import { usePortfolio, PortfolioAsset } from '@/hooks/usePortfolio';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useClassTargets } from '@/hooks/useClassTargets';
import { useContributions, useConfirmContribution, useDeleteContribution, useUpdateContributionNote, Contribution } from '@/hooks/useContributions';
import { formatBRL, formatPct } from '@/lib/format';

// ============================================================
// ALLOCATION MODES
// ============================================================
type AllocMode = 'rebalanceamento' | 'score_rebalanceamento' | 'manual' | 'classe_primeiro';

const MODE_LABELS: Record<AllocMode, string> = {
  rebalanceamento: 'Rebalanceamento',
  score_rebalanceamento: 'Score + Rebalanceamento',
  manual: 'Manual',
  classe_primeiro: 'Classe Primeiro',
};

// ============================================================
// SUGGESTION ITEM
// ============================================================
interface SuggestionItem {
  asset: PortfolioAsset;
  className: string;
  sector: string;
  score: number;
  pctCurrent: number;
  pctProjected: number;
  price: number;
  suggestedAmount: number;
  suggestedQty: number;
  remainder: number;
  reason: string;
}

// ============================================================
// SCORING HELPERS (lightweight, using score from Score.tsx data)
// ============================================================
function getAssetScore(asset: PortfolioAsset): number {
  // Simple heuristic score for allocation priority
  const f = asset.fundamentals;
  if (!f) return 50;
  let s = 50;
  if (f.roe != null && f.roe > 10) s += 10;
  if (f.dividend_yield != null && f.dividend_yield > 4) s += 10;
  if (f.pe_ratio != null && f.pe_ratio > 0 && f.pe_ratio < 20) s += 10;
  if (f.pb_ratio != null && f.pb_ratio > 0 && f.pb_ratio < 3) s += 5;
  if (f.margin != null && f.margin > 10) s += 5;
  if (f.payout != null && f.payout >= 25 && f.payout <= 80) s += 5;
  return Math.min(s, 95);
}

// ============================================================
// MAIN COMPONENT
// ============================================================
const Contributions = () => {
  const { data: portfolio = [], isLoading: loadingPortfolio } = usePortfolio();
  const { data: classes = [] } = useAssetClasses();
  const { data: targets = [] } = useClassTargets();
  const { data: contributions = [], isLoading: loadingContribs } = useContributions();
  const confirmContribution = useConfirmContribution();
  const deleteContribution = useDeleteContribution();
  const updateNote = useUpdateContributionNote();

  // --- State ---
  const [aporteValue, setAporteValue] = useState(0);
  const [aporteDate, setAporteDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [mode, setMode] = useState<AllocMode>('score_rebalanceamento');
  const [manualAmounts, setManualAmounts] = useState<Record<string, number>>({});
  const [classAmounts, setClassAmounts] = useState<Record<string, number>>({});
  const [noteText, setNoteText] = useState('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [editNoteId, setEditNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'month' | 'year'>('all');

  // --- Computed ---
  const totalPortfolio = useMemo(
    () => portfolio.reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0),
    [portfolio]
  );

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const monthContribs = useMemo(
    () => contributions.filter(c => {
      const d = new Date(c.contribution_date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }),
    [contributions, currentMonth, currentYear]
  );

  const yearContribs = useMemo(
    () => contributions.filter(c => new Date(c.contribution_date).getFullYear() === currentYear),
    [contributions, currentYear]
  );

  const monthTotal = monthContribs.reduce((s, c) => s + c.total_amount, 0);
  const yearTotal = yearContribs.reduce((s, c) => s + c.total_amount, 0);
  const monthAssetCount = new Set(monthContribs.flatMap(c => c.items.map(i => i.asset_id))).size;

  // Most contributed class this month
  const classContribMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of monthContribs) {
      for (const item of c.items) {
        const asset = portfolio.find(p => p.id === item.asset_id);
        if (asset) {
          map[asset.class_id] = (map[asset.class_id] ?? 0) + item.amount;
        }
      }
    }
    return map;
  }, [monthContribs, portfolio]);

  const topClassId = Object.entries(classContribMap).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topClassName = classes.find(c => c.id === topClassId)?.name ?? '—';

  // Most contributed asset this month
  const assetContribMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of monthContribs) {
      for (const item of c.items) {
        map[item.asset_id] = (map[item.asset_id] ?? 0) + item.amount;
      }
    }
    return map;
  }, [monthContribs]);

  const topAssetId = Object.entries(assetContribMap).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topAssetTicker = portfolio.find(p => p.id === topAssetId)?.ticker ?? '—';

  // ============================================================
  // SUGGESTION ENGINE
  // ============================================================
  const suggestions = useMemo((): SuggestionItem[] => {
    if (aporteValue <= 0 || portfolio.length === 0) return [];

    const totalWithAporte = totalPortfolio + aporteValue;
    const activeAssets = portfolio.filter(p => p.quantity > 0 || p.active);

    if (mode === 'manual') {
      return activeAssets.map(asset => {
        const price = asset.last_price ?? asset.avg_price;
        const currentVal = asset.quantity * price;
        const amt = manualAmounts[asset.id] ?? 0;
        const qty = price > 0 ? Math.floor(amt / price) : 0;
        const remainder = amt - qty * price;
        const projectedVal = currentVal + qty * price;
        const cls = classes.find(c => c.id === asset.class_id);

        return {
          asset,
          className: cls?.name ?? '—',
          sector: asset.sector ?? '—',
          score: getAssetScore(asset),
          pctCurrent: totalPortfolio > 0 ? (currentVal / totalPortfolio) * 100 : 0,
          pctProjected: totalWithAporte > 0 ? (projectedVal / totalWithAporte) * 100 : 0,
          price,
          suggestedAmount: qty * price,
          suggestedQty: qty,
          remainder,
          reason: amt > 0 ? 'Alocação manual' : '—',
        };
      }).filter(s => s.suggestedAmount > 0 || manualAmounts[s.asset.id]);
    }

    if (mode === 'classe_primeiro') {
      const results: SuggestionItem[] = [];
      for (const [classId, classAmt] of Object.entries(classAmounts)) {
        if (classAmt <= 0) continue;
        const classAssets = activeAssets
          .filter(a => a.class_id === classId)
          .sort((a, b) => getAssetScore(b) - getAssetScore(a));

        if (classAssets.length === 0) continue;
        const perAsset = classAmt / classAssets.length;

        for (const asset of classAssets) {
          const price = asset.last_price ?? asset.avg_price;
          const currentVal = asset.quantity * price;
          const qty = price > 0 ? Math.floor(perAsset / price) : 0;
          const remainder = perAsset - qty * price;
          const projectedVal = currentVal + qty * price;
          const cls = classes.find(c => c.id === asset.class_id);

          results.push({
            asset,
            className: cls?.name ?? '—',
            sector: asset.sector ?? '—',
            score: getAssetScore(asset),
            pctCurrent: totalPortfolio > 0 ? (currentVal / totalPortfolio) * 100 : 0,
            pctProjected: totalWithAporte > 0 ? (projectedVal / totalWithAporte) * 100 : 0,
            price,
            suggestedAmount: qty * price,
            suggestedQty: qty,
            remainder,
            reason: 'Distribuição por classe',
          });
        }
      }
      return results;
    }

    // Rebalanceamento or Score + Rebalanceamento
    const classData = targets.map(target => {
      const cls = classes.find(c => c.id === target.class_id);
      const positions = activeAssets.filter(p => p.class_id === target.class_id);
      const currentValue = positions.reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0);
      const idealValue = totalWithAporte * (target.target_percent / 100);
      const deficit = idealValue - currentValue;
      return { classId: target.class_id, className: cls?.name ?? '?', positions, currentValue, idealValue, deficit, targetPct: target.target_percent };
    }).filter(cd => cd.deficit > 0).sort((a, b) => b.deficit - a.deficit);

    let remaining = aporteValue;
    const results: SuggestionItem[] = [];

    for (const cd of classData) {
      if (remaining <= 0) break;
      const classAlloc = Math.min(cd.deficit, remaining);

      let sortedAssets = cd.positions;
      if (mode === 'score_rebalanceamento') {
        sortedAssets = [...cd.positions].sort((a, b) => {
          const sa = getAssetScore(a);
          const sb = getAssetScore(b);
          const concPenA = totalPortfolio > 0 ? (a.quantity * (a.last_price ?? a.avg_price)) / totalPortfolio : 0;
          const concPenB = totalPortfolio > 0 ? (b.quantity * (b.last_price ?? b.avg_price)) / totalPortfolio : 0;
          return (sb - concPenB * 20) - (sa - concPenA * 20);
        });
      }

      if (sortedAssets.length === 0) continue;

      // Distribute within class — try each asset in priority order
      let classRemaining = classAlloc;
      for (let i = 0; i < sortedAssets.length && classRemaining > 0; i++) {
        const asset = sortedAssets[i];
        const price = asset.last_price ?? asset.avg_price;
        if (price <= 0) continue;

        const qty = Math.floor(classRemaining / price);
        if (qty <= 0) continue; // can't afford this asset, try next (cheaper) one

        const actualAmt = qty * price;
        const currentVal = asset.quantity * price;
        const projectedVal = currentVal + actualAmt;
        const cls = classes.find(c => c.id === asset.class_id);

        let reason = 'Abaixo do alvo da classe';
        if (mode === 'score_rebalanceamento' && i === 0) reason = 'Melhor score da classe';
        const pctP = totalPortfolio > 0 ? (currentVal / totalPortfolio) * 100 : 0;
        if (pctP < 3) reason = 'Baixa concentração';

        results.push({
          asset,
          className: cls?.name ?? '—',
          sector: asset.sector ?? '—',
          score: getAssetScore(asset),
          pctCurrent: totalPortfolio > 0 ? (currentVal / totalPortfolio) * 100 : 0,
          pctProjected: totalWithAporte > 0 ? (projectedVal / totalWithAporte) * 100 : 0,
          price,
          suggestedAmount: actualAmt,
          suggestedQty: qty,
          remainder: classRemaining - actualAmt,
          reason,
        });

        classRemaining -= actualAmt;
        remaining -= actualAmt;
      }
    }

    return results;
  }, [aporteValue, portfolio, classes, targets, mode, manualAmounts, classAmounts, totalPortfolio]);

  const totalSuggested = suggestions.reduce((s, item) => s + item.suggestedAmount, 0);
  const totalRemainder = aporteValue - totalSuggested;

  // Minimum eligible price for current strategy
  const minEligiblePrice = useMemo(() => {
    if (aporteValue <= 0 || portfolio.length === 0) return 0;
    const activeAssets = portfolio.filter(p => p.quantity > 0 || p.active);
    const prices = activeAssets
      .map(a => a.last_price ?? a.avg_price)
      .filter(p => p > 0);
    return prices.length > 0 ? Math.min(...prices) : 0;
  }, [aporteValue, portfolio]);

  // ============================================================
  // IMPACT PROJECTION
  // ============================================================
  const impact = useMemo(() => {
    const totalAfter = totalPortfolio + totalSuggested;

    // DY before
    const dyWeightedBefore = portfolio.reduce((s, p) => {
      const val = p.quantity * (p.last_price ?? p.avg_price);
      return s + val * (p.effective_dy ?? 0);
    }, 0);
    const dyBefore = totalPortfolio > 0 ? dyWeightedBefore / totalPortfolio : 0;

    // DY after (add suggested contributions)
    let dyWeightedAfter = dyWeightedBefore;
    for (const s of suggestions) {
      const addedVal = s.suggestedQty * s.price;
      dyWeightedAfter += addedVal * (s.asset.effective_dy ?? 0);
    }
    const dyAfter = totalAfter > 0 ? dyWeightedAfter / totalAfter : 0;

    // Class allocation before/after
    const classAlloc: { name: string; before: number; after: number }[] = [];
    for (const cls of classes) {
      const beforeVal = portfolio.filter(p => p.class_id === cls.id).reduce((s, p) => s + p.quantity * (p.last_price ?? p.avg_price), 0);
      const addedVal = suggestions.filter(s => s.asset.class_id === cls.id).reduce((s, item) => s + item.suggestedAmount, 0);
      const afterVal = beforeVal + addedVal;
      if (beforeVal > 0 || afterVal > 0) {
        classAlloc.push({
          name: cls.name,
          before: totalPortfolio > 0 ? (beforeVal / totalPortfolio) * 100 : 0,
          after: totalAfter > 0 ? (afterVal / totalAfter) * 100 : 0,
        });
      }
    }

    // Top concentration
    const assetVals = portfolio.map(p => {
      const val = p.quantity * (p.last_price ?? p.avg_price);
      const added = suggestions.find(s => s.asset.id === p.id)?.suggestedAmount ?? 0;
      return { ticker: p.ticker, before: val, after: val + added };
    }).sort((a, b) => b.after - a.after);

    const topBefore = assetVals[0] ? (totalPortfolio > 0 ? (assetVals[0].before / totalPortfolio) * 100 : 0) : 0;
    const topAfter = assetVals[0] ? (totalAfter > 0 ? (assetVals[0].after / totalAfter) * 100 : 0) : 0;

    return {
      patrimonyBefore: totalPortfolio,
      patrimonyAfter: totalAfter,
      dyBefore,
      dyAfter,
      classAlloc,
      topConcentrationBefore: topBefore,
      topConcentrationAfter: topAfter,
    };
  }, [portfolio, suggestions, classes, totalPortfolio, totalSuggested]);

  // ============================================================
  // CONFIRM
  // ============================================================
  const handleConfirm = () => {
    const items = suggestions
      .filter(s => s.suggestedQty > 0)
      .map(s => ({
        asset_id: s.asset.id,
        amount: s.suggestedAmount,
        quantity: s.suggestedQty,
        unit_price: s.price,
      }));

    if (items.length === 0) return;

    confirmContribution.mutate({
      contribution_date: aporteDate,
      total_amount: totalSuggested,
      allocation_mode: mode,
      note: noteText || undefined,
      items,
    });
    setShowConfirmDialog(false);
    setNoteText('');
  };

  // ============================================================
  // CSV EXPORT
  // ============================================================
  const exportCSV = () => {
    const headers = ['Data', 'Valor Total', 'Modo', 'Ativos', 'Observação'];
    const rows = contributions.map(c => [
      c.contribution_date,
      c.total_amount.toFixed(2),
      MODE_LABELS[c.allocation_mode as AllocMode] ?? c.allocation_mode,
      c.items.length.toString(),
      c.note ?? '',
    ]);

    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aportes_${currentYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Duplicate last contribution
  const duplicateLast = useCallback(() => {
    if (contributions.length === 0) return;
    const last = contributions[0];
    setAporteValue(last.total_amount);
    setMode(last.allocation_mode as AllocMode);
    if (last.allocation_mode === 'manual') {
      const amounts: Record<string, number> = {};
      for (const item of last.items) amounts[item.asset_id] = item.amount;
      setManualAmounts(amounts);
    }
  }, [contributions]);

  // History filtering
  const filteredHistory = useMemo(() => {
    if (historyFilter === 'month') return monthContribs;
    if (historyFilter === 'year') return yearContribs;
    return contributions;
  }, [contributions, monthContribs, yearContribs, historyFilter]);

  const isLoading = loadingPortfolio || loadingContribs;

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" /> Aportes
          </h1>
          <p className="text-sm text-muted-foreground">Planeje, simule e registre seus aportes mensais</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={duplicateLast} disabled={contributions.length === 0}>
            <Copy className="h-3.5 w-3.5" /> Repetir último
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCSV} disabled={contributions.length === 0}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>
      </div>

      {/* ========== BLOCO 1: RESUMO DO MÊS ========== */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {[
          { label: 'Planejado', value: formatBRL(aporteValue), icon: DollarSign },
          { label: 'Realizado (mês)', value: formatBRL(monthTotal), icon: CheckCircle },
          { label: 'Restante', value: formatBRL(Math.max(0, aporteValue - monthTotal)), icon: TrendingUp },
          { label: 'Ativos aportados', value: String(monthAssetCount), icon: BarChart3 },
          { label: 'Classe + aportada', value: topClassName, icon: PieIcon },
          { label: 'Ativo + aportado', value: topAssetTicker, icon: TrendingUp },
        ].map(card => (
          <Card key={card.label}>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{card.label}</p>
                  <p className="text-lg font-bold mt-1 font-mono">{card.value}</p>
                </div>
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center text-primary">
                  <card.icon className="h-4 w-4" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ========== BLOCO 2: SIMULADOR ========== */}
      <Card>
        <CardHeader><CardTitle className="text-base">Simulador de Aporte</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label>Valor do aporte (R$)</Label>
              <Input type="number" value={aporteValue} onChange={e => setAporteValue(Number(e.target.value))} className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label>Data do aporte</Label>
              <Input type="date" value={aporteDate} onChange={e => setAporteDate(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label>Modo de alocação</Label>
              <Tabs value={mode} onValueChange={v => setMode(v as AllocMode)}>
                <TabsList className="w-full grid grid-cols-2 lg:grid-cols-4">
                  <TabsTrigger value="rebalanceamento" className="text-[10px]">Rebalancear</TabsTrigger>
                  <TabsTrigger value="score_rebalanceamento" className="text-[10px]">Score+Reb.</TabsTrigger>
                  <TabsTrigger value="manual" className="text-[10px]">Manual</TabsTrigger>
                  <TabsTrigger value="classe_primeiro" className="text-[10px]">Classe</TabsTrigger>
                </TabsList>
              </Tabs>
              <p className="text-[11px] text-muted-foreground">
                {mode === 'rebalanceamento' && 'Prioriza classes mais abaixo do alvo'}
                {mode === 'score_rebalanceamento' && 'Rebalanceia priorizando melhor score'}
                {mode === 'manual' && 'Defina o valor por ativo manualmente'}
                {mode === 'classe_primeiro' && 'Defina quanto por classe, o sistema distribui'}
              </p>
            </div>
          </div>

          {/* Manual inputs */}
          {mode === 'manual' && portfolio.length > 0 && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {portfolio.filter(p => p.active).map(asset => (
                <div key={asset.id} className="space-y-1">
                  <Label className="text-[10px]">{asset.ticker}</Label>
                  <Input
                    type="number"
                    className="h-8 text-xs font-mono"
                    value={manualAmounts[asset.id] ?? ''}
                    onChange={e => setManualAmounts(prev => ({ ...prev, [asset.id]: Number(e.target.value) }))}
                    placeholder="0"
                  />
                </div>
              ))}
              <div className="col-span-full text-xs text-muted-foreground">
                Total manual: {formatBRL(Object.values(manualAmounts).reduce((s, v) => s + v, 0))} / {formatBRL(aporteValue)}
              </div>
            </div>
          )}

          {/* Class inputs */}
          {mode === 'classe_primeiro' && classes.length > 0 && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              {classes.map(cls => (
                <div key={cls.id} className="space-y-1">
                  <Label className="text-[10px]">{cls.name}</Label>
                  <Input
                    type="number"
                    className="h-8 text-xs font-mono"
                    value={classAmounts[cls.id] ?? ''}
                    onChange={e => setClassAmounts(prev => ({ ...prev, [cls.id]: Number(e.target.value) }))}
                    placeholder="0"
                  />
                </div>
              ))}
              <div className="col-span-full text-xs text-muted-foreground">
                Total classes: {formatBRL(Object.values(classAmounts).reduce((s, v) => s + v, 0))} / {formatBRL(aporteValue)}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ========== BLOCO 3: SUGESTÃO DE ALOCAÇÃO ========== */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Sugestão de Alocação</CardTitle>
            {suggestions.length > 0 && (
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="font-mono text-xs">
                  Alocado: {formatBRL(totalSuggested)}
                </Badge>
                {totalRemainder > 1 && (
                  <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                    Sobra: {formatBRL(totalRemainder)}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {aporteValue <= 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <DollarSign className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Informe um valor de aporte para gerar a simulação.</p>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Com o valor atual não foi possível comprar nenhum ativo elegível.</p>
              {minEligiblePrice > 0 && (
                <p className="text-xs mt-2">
                  Menor valor necessário para iniciar nesta estratégia:{' '}
                  <span className="font-mono font-bold text-primary">{formatBRL(minEligiblePrice)}</span>
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto -mx-6 -mb-6">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">Ativo</TableHead>
                    <TableHead className="font-semibold">Classe</TableHead>
                    <TableHead className="font-semibold">Setor</TableHead>
                    <TableHead className="text-center font-semibold">Score</TableHead>
                    <TableHead className="text-right font-semibold">% Atual</TableHead>
                    <TableHead className="text-right font-semibold">% Projetada</TableHead>
                    <TableHead className="text-right font-semibold">Preço</TableHead>
                    <TableHead className="text-right font-semibold">Valor</TableHead>
                    <TableHead className="text-right font-semibold">Qtde</TableHead>
                    <TableHead className="text-right font-semibold">Sobra</TableHead>
                    <TableHead className="font-semibold">Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suggestions.map(s => (
                    <TableRow key={s.asset.id} className="hover:bg-muted/30">
                      <TableCell className="font-medium">{s.asset.ticker}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.className}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{s.sector || '—'}</Badge>
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs">{s.score}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatPct(s.pctCurrent)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatPct(s.pctProjected)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatBRL(s.price)}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold text-primary">{formatBRL(s.suggestedAmount)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{s.suggestedQty}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatBRL(s.remainder)}</TableCell>
                      <TableCell>
                        <span className="text-[10px] text-muted-foreground">{s.reason}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ========== BLOCO 4: IMPACTO PROJETADO ========== */}
      {suggestions.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Impacto Projetado</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Patrimônio', before: formatBRL(impact.patrimonyBefore), after: formatBRL(impact.patrimonyAfter) },
                { label: 'DY Médio', before: formatPct(impact.dyBefore), after: formatPct(impact.dyAfter) },
                { label: 'Conc. Top Ativo', before: formatPct(impact.topConcentrationBefore), after: formatPct(impact.topConcentrationAfter) },
              ].map(item => (
                <div key={item.label} className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">{item.label}</p>
                  <div className="flex items-center gap-2 text-sm font-mono">
                    <span className="text-muted-foreground">{item.before}</span>
                    <ArrowRight className="h-3 w-3 text-primary" />
                    <span className="font-bold">{item.after}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Class allocation table */}
            {impact.classAlloc.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-semibold">Classe</TableHead>
                    <TableHead className="text-right font-semibold">% Antes</TableHead>
                    <TableHead className="text-right font-semibold">% Depois</TableHead>
                    <TableHead className="text-right font-semibold">Δ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {impact.classAlloc.map(ca => {
                    const delta = ca.after - ca.before;
                    return (
                      <TableRow key={ca.name}>
                        <TableCell className="font-medium">{ca.name}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatPct(ca.before)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatPct(ca.after)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          <span className={delta > 0.05 ? 'text-emerald-500' : delta < -0.05 ? 'text-red-500' : ''}>
                            {delta > 0 ? '+' : ''}{formatPct(delta)}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}

            {/* Confirm button */}
            <div className="mt-6 flex items-center gap-3 justify-end">
              <div className="space-y-1 mr-auto">
                <Label className="text-xs">Observação (opcional)</Label>
                <Input
                  className="h-8 text-xs w-64"
                  placeholder="Ex: Aporte mensal março"
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                />
              </div>
              <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
                <DialogTrigger asChild>
                  <Button className="gap-2" disabled={suggestions.filter(s => s.suggestedQty > 0).length === 0}>
                    <CheckCircle className="h-4 w-4" /> Confirmar Aporte
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Confirmar Aporte de {formatBRL(totalSuggested)}?</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Isso irá registrar o aporte e atualizar automaticamente as posições de {suggestions.filter(s => s.suggestedQty > 0).length} ativo(s).
                    </p>
                    <div className="p-3 rounded-lg bg-muted/30 border border-border/50 space-y-1">
                      {suggestions.filter(s => s.suggestedQty > 0).map(s => (
                        <div key={s.asset.id} className="flex justify-between text-xs">
                          <span className="font-medium">{s.asset.ticker}</span>
                          <span className="font-mono">{s.suggestedQty} × {formatBRL(s.price)} = {formatBRL(s.suggestedAmount)}</span>
                        </div>
                      ))}
                    </div>
                    {totalRemainder > 1 && (
                      <div className="flex items-start gap-2 p-2 rounded bg-warning/10 border border-warning/20 text-xs">
                        <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                        <span>Sobra de {formatBRL(totalRemainder)} não alocada (frações de cotas).</span>
                      </div>
                    )}
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="outline" size="sm" onClick={() => setShowConfirmDialog(false)}>Cancelar</Button>
                      <Button size="sm" onClick={handleConfirm} disabled={confirmContribution.isPending}>
                        {confirmContribution.isPending ? 'Salvando...' : 'Confirmar'}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ========== BLOCO 5: HISTÓRICO ========== */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Histórico de Aportes</CardTitle>
            <Tabs value={historyFilter} onValueChange={v => setHistoryFilter(v as any)}>
              <TabsList>
                <TabsTrigger value="all" className="text-xs">Todos</TabsTrigger>
                <TabsTrigger value="month" className="text-xs">Mês</TabsTrigger>
                <TabsTrigger value="year" className="text-xs">Ano</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {filteredHistory.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Nenhum aporte registrado{historyFilter !== 'all' ? ' neste período' : ''}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-semibold">Data</TableHead>
                    <TableHead className="text-right font-semibold">Valor</TableHead>
                    <TableHead className="text-center font-semibold">Ativos</TableHead>
                    <TableHead className="font-semibold">Modo</TableHead>
                    <TableHead className="font-semibold">Observação</TableHead>
                    <TableHead className="text-right font-semibold">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredHistory.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">
                        {new Date(c.contribution_date).toLocaleDateString('pt-BR')}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-primary">
                        {formatBRL(c.total_amount)}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs">{c.items.length}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {MODE_LABELS[c.allocation_mode as AllocMode] ?? c.allocation_mode}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {c.note ?? '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost" size="sm" className="h-7 w-7 p-0"
                            onClick={() => {
                              setEditNoteId(c.id);
                              setEditNoteText(c.note ?? '');
                            }}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="sm" className="h-7 w-7 p-0"
                            onClick={() => {
                              setAporteValue(c.total_amount);
                              setMode(c.allocation_mode as AllocMode);
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => deleteContribution.mutate(c.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Note Dialog */}
      <Dialog open={editNoteId !== null} onOpenChange={open => { if (!open) setEditNoteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Observação</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={editNoteText}
              onChange={e => setEditNoteText(e.target.value)}
              placeholder="Observação..."
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditNoteId(null)}>Cancelar</Button>
              <Button size="sm" onClick={() => {
                if (editNoteId) {
                  updateNote.mutate({ id: editNoteId, note: editNoteText });
                  setEditNoteId(null);
                }
              }}>
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Contributions;
