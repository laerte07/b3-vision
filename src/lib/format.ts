export const formatBRL = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

export const formatPct = (value: number) =>
  `${value.toFixed(2)}%`;

export const formatNumber = (value: number, decimals = 0) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
