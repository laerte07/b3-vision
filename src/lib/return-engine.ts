/**
 * Shared return calculation engine used by Dashboard and Rentabilidade.
 * Single source of truth for portfolio return, TWR, simulation, and benchmark normalization.
 */
import type { PortfolioAsset } from '@/hooks/usePortfolio';
import type { Transaction } from '@/hooks/useTransactions';
import type { BenchmarkPoint } from '@/hooks/useBenchmarkHistory';

// ─── Types ──────────────────────────────────────────────────
export type SeriesKey = 'carteira' | 'cdi' | 'ipca' | 'ifix' | 'ibov';
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
  ifix?: number;
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
  { key: 'ifix',     label: 'IFIX',     color: 'hsl(142, 70%, 45%)' },
  { key: 'ibov',     label: 'IBOV',     color: 'hsl(280, 70%, 60%)' },
];

export const SERIES_TO_BENCHMARK: Partial<Record<SeriesKey, string>> = {
  cdi: 'CDI', ipca: 'IPCA', ibov: 'IBOV', ifix: 'IFIX',
};
export const BENCHMARK_TO_SERIES: Record<string, SeriesKey> = {
  CDI: 'cdi', IPCA: 'ipca', IBOV: 'ibov', IFIX: 'ifix',
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
    let baseValue: number | null = null;
    for (const p of points) {
      if (p.date <= periodStartStr) baseValue = p.value;
      else break;
    }
    if (baseValue === null && points.length > 0) baseValue = points[0].value;
    if (!baseValue || baseValue === 0) continue;
    const daily: Record<string, number> = {};
    for (const p of points) {
      if (p.date < periodStartStr) continue;
      daily[p.date] = ((p.value / baseValue) - 1) * 100;
    }
    result[code] = daily;
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
  let portfolioReturn = 0;

  for (const asset of activeAssets) {
    const weight = (asset.quantity * (asset.last_price ?? asset.avg_price)) / totalValue;
    const currentPrice = asset.last_price!;
    const assetTxs = sorted.filter(t => t.asset_id === asset.id);

    let startPrice: number | null = null;
    for (const t of assetTxs) {
      if (t.date <= periodStartStr) startPrice = t.price;
      else break;
    }
    if (startPrice === null) {
      const firstAfter = assetTxs.find(t => t.date > periodStartStr);
      if (firstAfter) startPrice = firstAfter.price;
    }
    if (!startPrice || startPrice <= 0) startPrice = asset.avg_price;
    if (startPrice <= 0) continue;

    portfolioReturn += weight * ((currentPrice / startPrice) - 1);
  }

  return portfolioReturn * 100;
}

// ─── Real TWR ───────────────────────────────────────────────
export function computeRealTWR(
  transactions: Transaction[],
  portfolio: PortfolioAsset[],
  periodStartStr: string,
  nowStr: string,
): number | null {
  if (portfolio.length === 0) return null;

  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
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

  for (const tx of inPeriodTxs) {
    lastKnownPrice[tx.asset_id] = tx.price;
    const valueBeforeFlow = valuate();
    if (prevValue > 0) {
      twrProduct *= (valueBeforeFlow / prevValue);
    }
    updatePosition(tx);
    prevValue = valuate();
  }

  for (const [id, price] of Object.entries(currentPriceMap)) {
    lastKnownPrice[id] = price;
  }
  const finalValue = valuate();
  if (prevValue > 0) {
    twrProduct *= (finalValue / prevValue);
  }

  const totalTWR = (twrProduct - 1) * 100;
  if (prevValue === 0 && inPeriodTxs.length === 0) return null;
  return totalTWR;
}

// ─── Unified data pipeline ──────────────────────────────────
function computeEffectiveEndDate(benchmarkRawData: BenchmarkPoint[]): string {
  const today = toDateStr(new Date());
  let latest = '';
  for (const p of benchmarkRawData) {
    if (p.date > latest && p.date <= today) latest = p.date;
  }
  return latest || today;
}

export function buildUnifiedData(
  mode: Mode,
  period: PeriodKey,
  transactions: Transaction[],
  portfolio: PortfolioAsset[],
  benchmarkRawData: BenchmarkPoint[],
): UnifiedResult {
  const periodStart = getPeriodStartDate(period, transactions);
  const periodStartStr = toDateStr(periodStart);
  const effectiveEndStr = computeEffectiveEndDate(benchmarkRawData);
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

  // 5. Build chart points
  const totalDays = allDays.length - 1;
  const chartData: UnifiedChartPoint[] = [];
  const finalValues: Partial<Record<SeriesKey, number>> = {};

  for (const dateStr of timelineDays) {
    const dayIndex = allDays.indexOf(dateStr);
    const fraction = totalDays > 0 ? dayIndex / totalDays : 1;
    const point: UnifiedChartPoint = { dateStr, label: formatLabel(dateStr) };

    // Carteira: compound interpolation (not linear!)
    if (carteiraFinal !== null) {
      const totalReturnDec = carteiraFinal / 100;
      const interpPct = totalReturnDec >= -1
        ? (Math.pow(1 + totalReturnDec, fraction) - 1) * 100
        : carteiraFinal * fraction;
      point.carteira = +interpPct.toFixed(2);
    }

    // Benchmarks: actual daily data with forward-fill
    for (const [code, daily] of Object.entries(benchmarkDaily)) {
      const seriesKey = BENCHMARK_TO_SERIES[code];
      if (!seriesKey) continue;
      let val: number | undefined;
      if (daily[dateStr] !== undefined) {
        val = daily[dateStr];
      } else {
        let lastVal = 0;
        for (const d of allDays) {
          if (d > dateStr) break;
          if (daily[d] !== undefined) lastVal = daily[d];
        }
        val = lastVal;
      }
      (point as any)[seriesKey] = +val.toFixed(2);
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

  return { chartData, finalValues, hasCarteiraData };
}
