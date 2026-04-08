/**
 * FinancialEngine — Central module for all valuation calculations.
 * Single source of truth for derived financial metrics.
 */

import type { PortfolioAsset } from '@/hooks/usePortfolio';

export type DataSource = 'api' | 'manual' | 'calculado' | 'nd';

export interface SourcedValue {
  value: number;
  source: DataSource;
}

export interface FinancialData {
  price: SourcedValue;
  lpa: SourcedValue;
  vpa: SourcedValue;
  roe: SourcedValue;          // percentage (e.g. 15 = 15%)
  payout: SourcedValue;       // percentage
  pe_ratio: SourcedValue;
  pb_ratio: SourcedValue;
  ev: SourcedValue;
  ebitda: SourcedValue;
  net_debt: SourcedValue;
  total_shares: SourcedValue;
  dividend_yield: SourcedValue; // percentage
  div_12m: SourcedValue;
  margin: SourcedValue;       // percentage
  revenue_growth: SourcedValue; // percentage
  net_income: SourcedValue;
  equity: SourcedValue;
  market_cap: SourcedValue;
  ev_ebitda: SourcedValue;
  warnings: string[];
}

const sv = (value: number, source: DataSource): SourcedValue => ({ value, source });
const ZERO: SourcedValue = { value: 0, source: 'nd' };

/**
 * Build a complete FinancialData object from a PortfolioAsset.
 * Priority: manual override > API fundamentals > calculated > 0 with warning.
 */
export function buildFinancialData(asset: PortfolioAsset): FinancialData {
  const f = asset.fundamentals;
  const ov = asset.overrides ?? {};
  const warnings: string[] = [];

  // Helper: get value with priority manual > api
  const get = (key: string, apiVal: number | null | undefined): SourcedValue => {
    const manual = ov[key];
    if (manual != null && typeof manual === 'number' && Number.isFinite(manual)) {
      return sv(manual, 'manual');
    }
    if (apiVal != null && Number.isFinite(apiVal) && apiVal !== 0) {
      return sv(apiVal, 'api');
    }
    return ZERO;
  };

  // --- Base metrics from API/manual ---
  const price = (() => {
    const p = asset.last_price ?? asset.avg_price;
    return p > 0 ? sv(p, 'api') : ZERO;
  })();

  const lpa = get('lpa', f?.lpa);
  const vpa = get('vpa', f?.vpa);
  const roe = get('roe', f?.roe);
  const payout = get('payout', f?.payout);
  const pe_ratio = get('pe_ratio', f?.pe_ratio);
  const pb_ratio = get('pb_ratio', f?.pb_ratio);
  const ebitda = get('ebitda', f?.ebitda);
  const net_debt = get('net_debt', f?.net_debt);
  const dividend_yield = get('dividend_yield', f?.dividend_yield);
  const margin = get('margin', f?.margin);
  const revenue_growth = get('revenue_growth', f?.revenue_growth);

  // Total shares — special: from API, never from override directly
  const total_shares = (() => {
    const ts = f?.total_shares;
    if (ts != null && Number.isFinite(ts) && ts > 0) return sv(ts, 'api');
    return ZERO;
  })();

  // Div 12m
  const div_12m = (() => {
    const manual = ov.div_12m;
    if (manual != null && typeof manual === 'number' && manual > 0) return sv(manual, 'manual');
    if (asset.div_12m != null && asset.div_12m > 0) return sv(asset.div_12m, 'api');
    // Fallback: DY * price / 100
    if (dividend_yield.value > 0 && price.value > 0) {
      return sv((dividend_yield.value / 100) * price.value, 'calculado');
    }
    return ZERO;
  })();

  // --- Derived metrics ---

  // Net income: override > LPA*shares > margin-based
  const net_income = (() => {
    const manualNI = ov.net_income_ttm;
    if (manualNI != null && typeof manualNI === 'number' && manualNI !== 0) {
      return sv(manualNI, 'manual');
    }
    if (lpa.value !== 0 && total_shares.value > 0) {
      return sv(lpa.value * total_shares.value, 'calculado');
    }
    return ZERO;
  })();

  // Equity: override > VPA*shares
  const equity = (() => {
    const manualEq = ov.equity;
    if (manualEq != null && typeof manualEq === 'number' && manualEq !== 0) {
      return sv(manualEq, 'manual');
    }
    if (vpa.value !== 0 && total_shares.value > 0) {
      return sv(vpa.value * total_shares.value, 'calculado');
    }
    return ZERO;
  })();

  // Market cap
  const market_cap = (() => {
    const manualMC = ov.market_cap;
    if (manualMC != null && typeof manualMC === 'number' && manualMC > 0) {
      return sv(manualMC, 'manual');
    }
    if (price.value > 0 && total_shares.value > 0) {
      return sv(price.value * total_shares.value, 'calculado');
    }
    return ZERO;
  })();

  // EV: override > API > MarketCap + NetDebt
  const ev = (() => {
    const manualEV = ov.ev;
    if (manualEV != null && typeof manualEV === 'number' && manualEV !== 0) {
      return sv(manualEV, 'manual');
    }
    if (f?.ev != null && Number.isFinite(f.ev) && f.ev !== 0) {
      return sv(f.ev, 'api');
    }
    if (market_cap.value > 0) {
      return sv(market_cap.value + net_debt.value, 'calculado');
    }
    return ZERO;
  })();

  // EV/EBITDA
  const ev_ebitda = (() => {
    if (ev.value !== 0 && ebitda.value !== 0) {
      return sv(ev.value / ebitda.value, 'calculado');
    }
    return ZERO;
  })();

  // Auto-calculate LPA if missing but have net_income and shares
  const lpaFinal = (() => {
    if (lpa.value !== 0) return lpa;
    if (net_income.value !== 0 && total_shares.value > 0) {
      return sv(net_income.value / total_shares.value, 'calculado');
    }
    return lpa;
  })();

  // Auto-calculate VPA if missing but have equity and shares
  const vpaFinal = (() => {
    if (vpa.value !== 0) return vpa;
    if (equity.value !== 0 && total_shares.value > 0) {
      return sv(equity.value / total_shares.value, 'calculado');
    }
    return vpa;
  })();

  // P/L: if missing, calculate
  const pe_final = (() => {
    if (pe_ratio.value !== 0) return pe_ratio;
    if (lpaFinal.value > 0 && price.value > 0) {
      return sv(price.value / lpaFinal.value, 'calculado');
    }
    return pe_ratio;
  })();

  // P/VP: if missing, calculate
  const pb_final = (() => {
    if (pb_ratio.value !== 0) return pb_ratio;
    if (vpaFinal.value > 0 && price.value > 0) {
      return sv(price.value / vpaFinal.value, 'calculado');
    }
    return pb_ratio;
  })();

  // Warnings
  if (lpaFinal.value === 0) warnings.push('LPA indisponível — verifique dados fundamentais.');
  if (total_shares.value === 0) warnings.push('Número de ações indisponível.');
  if (price.value === 0) warnings.push('Preço atual indisponível.');

  return {
    price,
    lpa: lpaFinal,
    vpa: vpaFinal,
    roe,
    payout,
    pe_ratio: pe_final,
    pb_ratio: pb_final,
    ev,
    ebitda,
    net_debt,
    total_shares,
    dividend_yield,
    div_12m,
    margin,
    revenue_growth,
    net_income,
    equity,
    market_cap,
    ev_ebitda,
    warnings,
  };
}

// --- Valuation calculation functions ---

export function calcGrowthRate(roe: number, payout: number): { g: number; source: DataSource } {
  if (roe > 0 && payout >= 0) {
    const raw = (roe / 100) * (1 - payout / 100) * 100;
    return { g: Math.max(0, Math.min(15, raw)), source: 'calculado' };
  }
  return { g: 0, source: 'nd' };
}

export interface VFFResult {
  fairValue: number;
  maxBuyPrice: number;
  pvProfits: number;
  terminal: number;
  pvTerminal: number;
  marketCap: number;
  profits: number[];
  warnings: string[];
}

export function calcVFF(
  netIncome: number,
  growthPct: number,
  discountPct: number,
  perpetuityPct: number,
  totalShares: number,
  years: number,
): VFFResult {
  const warnings: string[] = [];
  const g = growthPct / 100;
  const r = discountPct / 100;
  const gPerp = perpetuityPct / 100;

  if (netIncome <= 0) warnings.push('Lucro base inválido (≤ 0).');
  if (totalShares <= 0) warnings.push('Número de ações inválido.');
  if (r <= gPerp) warnings.push('Taxa de desconto deve ser maior que a perpétua.');

  const profits = Array.from({ length: years }, (_, i) =>
    Math.round(netIncome * Math.pow(1 + g, i + 1))
  );

  const pvProfits = profits.reduce((sum, p, i) => sum + p / Math.pow(1 + r, i + 1), 0);
  const lastProfit = profits[profits.length - 1] || 0;
  const terminal = r > gPerp && lastProfit > 0 ? (lastProfit * (1 + gPerp)) / (r - gPerp) : 0;
  const pvTerminal = terminal / Math.pow(1 + r, years);
  const marketCap = pvProfits + pvTerminal;
  const fairValue = totalShares > 0 ? marketCap / totalShares : 0;

  if (fairValue <= 0 && netIncome > 0) warnings.push('Preço justo zerado — verifique ações e taxas.');

  return {
    fairValue,
    maxBuyPrice: fairValue * 0.75,
    pvProfits,
    terminal,
    pvTerminal,
    marketCap,
    profits,
    warnings,
  };
}

export function calcGraham(lpa: number, vpa: number): { fairValue: number; warnings: string[] } {
  const warnings: string[] = [];
  if (lpa <= 0) warnings.push('LPA inválido para Graham (deve ser > 0).');
  if (vpa <= 0) warnings.push('VPA inválido para Graham (deve ser > 0).');
  const fairValue = Math.sqrt(22.5 * Math.max(0, lpa) * Math.max(0, vpa));
  return { fairValue, warnings };
}

export function calcBazin(divPerShare: number, minDY: number): { fairValue: number; warnings: string[] } {
  const warnings: string[] = [];
  if (divPerShare <= 0) warnings.push('Dividendo por ação inválido (deve ser > 0).');
  if (minDY <= 0) warnings.push('DY mínimo deve ser > 0.');
  const fairValue = minDY > 0 ? divPerShare / (minDY / 100) : 0;
  return { fairValue, warnings };
}

export function calcBuffett(
  lpa: number, roe: number, payout: number, years: number, plJusto: number
): { fairValue: number; g: number; lpaFut: number; warnings: string[] } {
  const warnings: string[] = [];
  if (lpa <= 0) warnings.push('LPA inválido para Buffett.');
  const g = (roe / 100) * (1 - payout / 100);
  const lpaFut = lpa * Math.pow(1 + g, years);
  const fairValue = lpaFut * plJusto;
  return { fairValue, g: g * 100, lpaFut, warnings };
}

export function calcLynch(
  price: number, pl: number, growth: number
): { peg: number; fairValue: number; warnings: string[] } {
  const warnings: string[] = [];
  if (pl <= 0) warnings.push('P/L inválido para Lynch.');
  if (growth <= 0) warnings.push('Crescimento inválido para Lynch (deve ser > 0).');
  const peg = growth > 0 ? pl / growth : 0;
  // Fair value at PEG = 1: price where P/L = growth → price = LPA * growth
  // Simpler: fair = price / PEG (when PEG > 0)
  const fairValue = peg > 0 ? price / peg : 0;
  return { peg, fairValue, warnings };
}

export function calcPVPJustificado(
  vpa: number, roe: number, discount: number, growth: number
): { pvpJusto: number; fairValue: number; warnings: string[] } {
  const warnings: string[] = [];
  if (vpa <= 0) warnings.push('VPA inválido.');
  const disc = discount / 100;
  const grow = growth / 100;
  if (disc <= grow) warnings.push('Taxa de desconto deve ser maior que crescimento.');
  const pvpJusto = disc > grow ? (roe / 100) / (disc - grow) : 0;
  const fairValue = pvpJusto * vpa;
  return { pvpJusto, fairValue, warnings };
}

export function calcPLJusto(
  lpa: number, plJusto: number
): { fairValue: number; warnings: string[] } {
  const warnings: string[] = [];
  if (lpa <= 0) warnings.push('LPA inválido para P/L Justo.');
  const fairValue = lpa * plJusto;
  return { fairValue, warnings };
}

export function calcEVEbitda(
  ebitda: number, multiplo: number, netDebt: number, totalShares: number
): { evJusto: number; equityValue: number; fairValue: number; warnings: string[] } {
  const warnings: string[] = [];
  if (ebitda <= 0) warnings.push('EBITDA inválido.');
  if (totalShares <= 0) warnings.push('Número de ações inválido.');
  const evJusto = ebitda * multiplo;
  const equityValue = evJusto - netDebt;
  const fairValue = totalShares > 0 ? equityValue / totalShares : 0;
  return { evJusto, equityValue, fairValue, warnings };
}

/** Debug log for any valuation */
export function logValuation(model: string, ticker: string, data: FinancialData, result: Record<string, any>) {
  console.log(`[ValuationEngine ${model}]`, {
    ticker,
    price: `${data.price.value} (${data.price.source})`,
    lpa: `${data.lpa.value} (${data.lpa.source})`,
    vpa: `${data.vpa.value} (${data.vpa.source})`,
    roe: `${data.roe.value}% (${data.roe.source})`,
    ebitda: `${data.ebitda.value} (${data.ebitda.source})`,
    net_debt: `${data.net_debt.value} (${data.net_debt.source})`,
    net_income: `${data.net_income.value} (${data.net_income.source})`,
    total_shares: `${data.total_shares.value} (${data.total_shares.source})`,
    ...result,
  });
}
