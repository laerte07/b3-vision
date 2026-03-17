/**
 * Shared return calculation engine used by Dashboard and Rentabilidade.
 * Single source of truth for portfolio return, TWR, simulation, and benchmark normalization.
 */
import type { PortfolioAsset } from '@/hooks/usePortfolio';
import type { Transaction } from '@/hooks/useTransactions';
import type { BenchmarkPoint } from '@/hooks/useBenchmarkHistory';

// ─── Types ──────────────────────────────────────────────────
export type SeriesKey = 'carteira' | 'cdi' | 'ipca' | 'ibov' | 'sp500';
export type PeriodKey = 'mtd' | '6m' | '12m' | '24m' | '60m' | 'all';
export type Mode = 'real' | 'simulacao';

export interface SeriesDef { key: SeriesKey; label: string; color: string }

export interface UnifiedChartPoint {
  dateStr: string;
  label: string;
  carteira?: number;
  cdi?: number;
  ipca?: number;
  ibov?: number;
  sp500?: number;
}

export interface UnifiedResult {
  chartData: UnifiedChartPoint[];
  finalValues: Partial<Record<SeriesKey, number>>;
  hasCarteiraData: boolean;
}

// ─── Constants ──────────────────────────────────────────────
export const ALL_SERIES: SeriesDef[] = [
  { key: 'carteira', label: 'Carteira', color: 'hsl(43, 85%, 55%)' },
  { key: 'cdi',      label: 'CDI',      color: 'hsl(200, 80%, 55%)' },
  { key: 'ipca',     label: 'IPCA',     color: 'hsl(30, 90%, 55%)' },
  { key: 'ibov',     label: 'IBOV',     color: 'hsl(280, 70%, 60%)' },
  { key: 'sp500',    label: 'S&P 500',  color: 'hsl(350, 75%, 55%)' },
];

export const SERIES_TO_BENCHMARK: Partial<Record<SeriesKey, string>> = {
  cdi: 'CDI', ipca: 'IPCA', ibov: 'IBOV', sp500: 'SP500',
};
export const BENCHMARK_TO_SERIES: Record<string, SeriesKey> = {
  CDI: 'cdi', IPCA: 'ipca', IBOV: 'ibov', SP500: 'sp500',
};

// ─── Date helpers ───────────────────────────────────────────
export function toDateStr(d: Date): string { return d.toISOString().slice(0, 10); }

export function buildDailyTimeline(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const cur = new Date(start); cur.setHours(0, 0, 0, 0);
  const endN = new Date(end); endN.setHours(0, 0, 0, 0);
  while (cur <= endN) { dates.push(toDateStr(cur)); cur.setDate(cur.getDate() + 1); }
  return dates;
}

export function getPeriodStartDate(period: PeriodKey, transactions: Transaction[]): Date {
  const now = new Date();
  if (period === 'mtd') return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === 'all' && transactions.length > 0) return new Date(transactions[0].date);
  const monthsMap: Record<string, number> = { '6m': 6, '12m': 12, '24m': 24, '60m': 60 };
  const m = monthsMap[period] ?? 12;
  const d = new Date(); d.setMonth(d.getMonth() - m);
  return d;
}

export function getPeriodMonths(period: PeriodKey, transactions: Transaction[]): number {
  if (period === 'mtd') return 1;
  if (period === 'all' && transactions.length > 0) {
    const first = new Date(transactions[0].date);
    const now = new Date();
    return Math.max(1, (now.getFullYear() - first.getFullYear()) * 12 + (now.getMonth() - first.getMonth()) + 1);
  }
  const monthsMap: Record<string, number> = { '6m': 6, '12m': 12, '24m': 24, '60m': 60 };
  return monthsMap[period] ?? 12;
}

/**
 * Resolve effective end date: last date with benchmark data, never future.
 */
export function resolveEffectiveEndDate(benchmarkRawData: BenchmarkPoint[]): string {
  const today = toDateStr(new Date());
  let latest = '';
  for (const p of benchmarkRawData) {
    if (p.date > latest && p.date <= today) latest = p.date;
  }
  return latest || today;
}

// ─── Normalize benchmarks ───────────────────────────────────
export function normalizeBenchmarkDaily(
  benchmarkData: BenchmarkPoint[],
  periodStartStr: string,
): Record<string, Record<string, number>> {
  const grouped: Record<string, BenchmarkPoint[]> = {};
  for (const p of benchmarkData) {
    if (!grouped[p.benchmark_code]) grouped[p.benchmark_code] = [];
    grouped[p.benchmark_code].push(p);
  }
  const result: Record<string, Record<string, number>> = {};
  for (const [code, points] of Object.entries(grouped)) {
    // Sort by date
    points.sort((a, b) => a.date.localeCompare(b.date));
    // Find base: last point on or before periodStart
    let baseValue: number | null = null;
    for (const p of points) {
      if (p.date <= periodStartStr) baseValue = p.value;
      else break;
    }
    if (baseValue === null && points.length > 0) baseValue = points[0].value;
    if (!baseValue || baseValue === 0) {
      if (import.meta.env.DEV) console.warn(`[BenchmarkData] ${code}: no base value, skipping`);
      continue;
    }
    const daily: Record<string, number> = {};
    for (const p of points) {
      if (p.date < periodStartStr) continue;
      daily[p.date] = ((p.value / baseValue) - 1) * 100;
    }
    result[code] = daily;
    if (import.meta.env.DEV) {
      const keys = Object.keys(daily);
      const last = keys.length > 0 ? daily[keys[keys.length - 1]] : 0;
      console.log(`[BenchmarkData] ${code}: base=${baseValue.toFixed(2)}, points=${keys.length}, last=${last.toFixed(2)}%`);
    }
  }
  return result;
}

// ─── Simulation return ──────────────────────────────────────
export function computeSimulationReturn(
  portfolio: PortfolioAsset[],
  transactions: Transaction[],
  periodStartStr: string,
): number | null {
  const activeAssets = portfolio.filter(a => a.quantity > 0 && a.last_price != null);
  const totalValue = activeAssets.reduce((sum, a) => sum + a.quantity * (a.last_price ?? a.avg_price), 0);
  if (totalValue <= 0) return null;

  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  if (import.meta.env.DEV) {
    console.group('[RentabilidadeSimulação] Cálculo detalhado');
    console.log('periodStart:', periodStartStr);
    console.log('ativos:', activeAssets.length, 'totalValue:', totalValue.toFixed(2));
  }

  let portfolioReturn = 0;
  const details: any[] = [];

  for (const asset of activeAssets) {
    const weight = (asset.quantity * (asset.last_price ?? asset.avg_price)) / totalValue;
    const currentPrice = asset.last_price!;

    // Find start price from transactions
    let startPrice: number | null = null;
    let startSource = '';
    const assetTxs = sorted.filter(t => t.asset_id === asset.id);

    for (const t of assetTxs) {
      if (t.date <= periodStartStr) { startPrice = t.price; startSource = 'tx_before'; }
      else break;
    }
    if (startPrice === null) {
      const firstAfter = assetTxs.find(t => t.date > periodStartStr);
      if (firstAfter) { startPrice = firstAfter.price; startSource = 'tx_after'; }
    }
    // Fallback: avg_price (works when no transactions exist)
    if (!startPrice || startPrice <= 0) { startPrice = asset.avg_price; startSource = 'avg_price'; }
    if (startPrice <= 0) continue;

    const ret = (currentPrice / startPrice) - 1;
    portfolioReturn += weight * ret;

    if (import.meta.env.DEV) {
      details.push({
        ticker: asset.ticker, peso: (weight * 100).toFixed(2) + '%',
        preço_início: startPrice.toFixed(2), fonte: startSource,
        preço_final: currentPrice.toFixed(2),
        retorno: (ret * 100).toFixed(2) + '%',
        contribuição: (weight * ret * 100).toFixed(2) + '%',
      });
    }
  }

  if (import.meta.env.DEV) {
    console.table(details);
    console.log(`Retorno simulado: ${(portfolioReturn * 100).toFixed(4)}%`);
    console.groupEnd();
  }

  return portfolioReturn * 100;
}

// ─── Real TWR ───────────────────────────────────────────────
/**
 * Computes Time-Weighted Return.
 * If no transactions exist but positions do, falls back to a simple
 * avg_price → current_price return calculation.
 */
export function computeRealTWR(
  transactions: Transaction[],
  portfolio: PortfolioAsset[],
  periodStartStr: string,
  nowStr: string,
): number | null {
  const activeAssets = portfolio.filter(a => a.quantity > 0 && a.last_price != null);
  if (activeAssets.length === 0) return null;

  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  // ─── FALLBACK: no transactions at all → use positions directly ───
  if (sorted.length === 0) {
    if (import.meta.env.DEV) {
      console.group('[RentabilidadeReal] Fallback: sem transações, usando posições');
    }
    const totalValue = activeAssets.reduce((s, a) => s + a.quantity * (a.last_price!), 0);
    const totalCost = activeAssets.reduce((s, a) => s + a.quantity * a.avg_price, 0);
    if (totalCost <= 0) { if (import.meta.env.DEV) console.groupEnd(); return null; }

    const ret = ((totalValue / totalCost) - 1) * 100;
    if (import.meta.env.DEV) {
      console.log(`Custo total: ${totalCost.toFixed(2)}, Valor atual: ${totalValue.toFixed(2)}, Retorno: ${ret.toFixed(2)}%`);
      console.groupEnd();
    }
    return ret;
  }

  // ─── Standard TWR with transactions ───
  const currentPriceMap: Record<string, number> = {};
  portfolio.forEach(a => { if (a.last_price != null) currentPriceMap[a.id] = a.last_price; });

  const positions: Record<string, { qty: number; avgPrice: number }> = {};
  const lastKnownPrice: Record<string, number> = {};

  const updatePosition = (tx: Transaction) => {
    if (!positions[tx.asset_id]) positions[tx.asset_id] = { qty: 0, avgPrice: 0 };
    const pos = positions[tx.asset_id];
    if (tx.type === 'compra' || tx.type === 'buy') {
      const newQty = pos.qty + tx.quantity;
      pos.avgPrice = newQty > 0 ? ((pos.qty * pos.avgPrice) + (tx.quantity * tx.price)) / newQty : tx.price;
      pos.qty = newQty;
    } else {
      pos.qty = Math.max(0, pos.qty - tx.quantity);
    }
  };

  // Build positions up to period start
  for (const tx of sorted) {
    if (tx.date > periodStartStr) break;
    updatePosition(tx);
    lastKnownPrice[tx.asset_id] = tx.price;
  }
  for (const [id, pos] of Object.entries(positions)) {
    if (!lastKnownPrice[id] && pos.avgPrice > 0) lastKnownPrice[id] = pos.avgPrice;
  }

  const valuate = (): number => {
    let total = 0;
    for (const [id, pos] of Object.entries(positions)) {
      if (pos.qty <= 0) continue;
      total += pos.qty * (lastKnownPrice[id] ?? 0);
    }
    return total;
  };

  const inPeriodTxs = sorted.filter(tx => tx.date > periodStartStr && tx.date <= nowStr);
  let twrProduct = 1;
  let prevValue = valuate();

  if (import.meta.env.DEV) {
    console.group('[RentabilidadeReal] TWR com transações');
    console.log('Período:', periodStartStr, '→', nowStr);
    console.log('Posições início:', JSON.parse(JSON.stringify(positions)));
    console.log('Patrimônio inicial:', prevValue.toFixed(2));
    console.log('Transações no período:', inPeriodTxs.length);
  }

  for (const tx of inPeriodTxs) {
    lastKnownPrice[tx.asset_id] = tx.price;
    const valueBeforeFlow = valuate();
    if (prevValue > 0) {
      twrProduct *= (valueBeforeFlow / prevValue);
      if (import.meta.env.DEV) {
        const ticker = portfolio.find(a => a.id === tx.asset_id)?.ticker ?? '?';
        console.log(`  ${tx.date} | ${tx.type} ${tx.quantity}x ${ticker} @ ${tx.price.toFixed(2)} | ${prevValue.toFixed(0)}→${valueBeforeFlow.toFixed(0)} | sub=${((valueBeforeFlow / prevValue - 1) * 100).toFixed(2)}%`);
      }
    }
    updatePosition(tx);
    prevValue = valuate();
  }

  // Final sub-period with current prices
  for (const [id, price] of Object.entries(currentPriceMap)) {
    lastKnownPrice[id] = price;
  }
  const finalValue = valuate();
  if (prevValue > 0) {
    twrProduct *= (finalValue / prevValue);
  }

  const totalTWR = (twrProduct - 1) * 100;

  if (import.meta.env.DEV) {
    console.log(`Final: ${prevValue.toFixed(0)}→${finalValue.toFixed(0)} | TWR=${totalTWR.toFixed(2)}%`);
    console.groupEnd();
  }

  if (prevValue === 0 && inPeriodTxs.length === 0) return null;
  return totalTWR;
}

// ─── Unified data pipeline ──────────────────────────────────
export function buildUnifiedData(
  mode: Mode,
  period: PeriodKey,
  transactions: Transaction[],
  portfolio: PortfolioAsset[],
  benchmarkRawData: BenchmarkPoint[],
): UnifiedResult {
  const periodStart = getPeriodStartDate(period, transactions);
  const periodStartStr = toDateStr(periodStart);
  const effectiveEndStr = resolveEffectiveEndDate(benchmarkRawData);
  const effectiveEnd = new Date(effectiveEndStr + 'T00:00:00');

  // 1. Compute portfolio return
  let carteiraFinal: number | null = null;
  if (mode === 'real') {
    carteiraFinal = computeRealTWR(transactions, portfolio, periodStartStr, effectiveEndStr);
  } else {
    carteiraFinal = computeSimulationReturn(portfolio, transactions, periodStartStr);
  }
  const hasCarteiraData = carteiraFinal !== null;

  // 2. Normalize benchmarks
  const benchmarkDaily = normalizeBenchmarkDaily(benchmarkRawData, periodStartStr);

  // 3. Build timeline
  const allDays = buildDailyTimeline(periodStart, effectiveEnd);
  const useDaily = allDays.length <= 200;
  let timelineDays: string[];
  if (useDaily) {
    timelineDays = allDays;
  } else {
    timelineDays = [allDays[0]];
    for (let i = 7; i < allDays.length - 1; i += 7) timelineDays.push(allDays[i]);
    if (timelineDays[timelineDays.length - 1] !== allDays[allDays.length - 1]) timelineDays.push(allDays[allDays.length - 1]);
  }

  // 4. Labels
  const formatLabel = (dateStr: string): string => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return useDaily
      ? dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
      : dt.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
  };

  // 5. Build chart points with forward-fill for benchmarks
  const totalDays = allDays.length - 1;
  const chartData: UnifiedChartPoint[] = [];
  const finalValues: Partial<Record<SeriesKey, number>> = {};

  // Pre-build forward-fill maps for each benchmark for O(1) lookup
  const benchmarkFF: Record<string, Record<string, number>> = {};
  for (const [code, daily] of Object.entries(benchmarkDaily)) {
    const ff: Record<string, number> = {};
    let lastVal = 0;
    for (const d of allDays) {
      if (daily[d] !== undefined) lastVal = daily[d];
      ff[d] = lastVal;
    }
    benchmarkFF[code] = ff;
  }

  for (const dateStr of timelineDays) {
    const dayIndex = allDays.indexOf(dateStr);
    const fraction = totalDays > 0 ? dayIndex / totalDays : 1;
    const point: UnifiedChartPoint = { dateStr, label: formatLabel(dateStr) };

    // Carteira: compound interpolation
    if (carteiraFinal !== null) {
      const totalReturnDec = carteiraFinal / 100;
      const interpPct = totalReturnDec >= -1
        ? (Math.pow(1 + totalReturnDec, fraction) - 1) * 100
        : carteiraFinal * fraction;
      point.carteira = +interpPct.toFixed(2);
    }

    // Benchmarks with forward-fill
    for (const [code, ff] of Object.entries(benchmarkFF)) {
      const seriesKey = BENCHMARK_TO_SERIES[code];
      if (!seriesKey) continue;
      (point as any)[seriesKey] = +(ff[dateStr] ?? 0).toFixed(2);
    }
    chartData.push(point);
  }

  // 6. Final values
  const lastPoint = chartData[chartData.length - 1];
  if (lastPoint) {
    for (const s of ALL_SERIES) {
      const v = (lastPoint as any)[s.key] as number | undefined;
      if (v !== undefined) finalValues[s.key] = v;
    }
  }

  if (import.meta.env.DEV) {
    console.group('[DateResolver] Unified pipeline');
    console.log('mode:', mode, 'period:', period);
    console.log('periodStart:', periodStartStr, 'effectiveEnd:', effectiveEndStr);
    console.log('chartPoints:', chartData.length, 'hasCarteira:', hasCarteiraData);
    console.log('finalValues:', finalValues);
    console.groupEnd();
  }

  return { chartData, finalValues, hasCarteiraData };
}
