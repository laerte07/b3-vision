export interface AssetClass {
  id: string;
  name: string;
  slug: string;
}

export interface Position {
  ticker: string;
  name: string;
  classId: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  dy: number;
  div12m: number;
}

export interface ClassTarget {
  classId: string;
  className: string;
  targetPct: number;
  lowerBand: number;
  upperBand: number;
}

export const ASSET_CLASSES: AssetClass[] = [
  { id: '1', name: 'Ações', slug: 'acoes' },
  { id: '2', name: 'FIIs', slug: 'fiis' },
  { id: '3', name: 'ETFs', slug: 'etfs' },
  { id: '4', name: 'Renda Fixa', slug: 'renda-fixa' },
  { id: '5', name: 'BDRs', slug: 'bdrs' },
  { id: '6', name: 'Criptos', slug: 'criptos' },
];

export const MOCK_POSITIONS: Position[] = [
  { ticker: 'ITSA4', name: 'Itaúsa', classId: '1', qty: 100, avgPrice: 8.90, currentPrice: 10.20, dy: 8.5, div12m: 0.87 },
  { ticker: 'BBSE3', name: 'BB Seguridade', classId: '1', qty: 30, avgPrice: 28.00, currentPrice: 35.06, dy: 7.62, div12m: 2.67 },
  { ticker: 'WIZC3', name: 'Wiz Co', classId: '1', qty: 40, avgPrice: 7.50, currentPrice: 9.32, dy: 6.20, div12m: 0.58 },
  { ticker: 'GARE11', name: 'Guardian RE', classId: '2', qty: 17, avgPrice: 8.77, currentPrice: 8.55, dy: 11.61, div12m: 1.41 },
  { ticker: 'HGRE11', name: 'CSHG Real Estate', classId: '2', qty: 10, avgPrice: 123.50, currentPrice: 128.32, dy: 9.80, div12m: 12.58 },
  { ticker: 'XPML11', name: 'XP Malls', classId: '2', qty: 10, avgPrice: 106.53, currentPrice: 111.75, dy: 9.88, div12m: 11.04 },
  { ticker: 'CPTS11', name: 'Capitânia Securities', classId: '2', qty: 80, avgPrice: 7.51, currentPrice: 8.01, dy: 13.02, div12m: 1.04 },
  { ticker: 'KNSC11', name: 'Kinea Securities', classId: '2', qty: 60, avgPrice: 8.70, currentPrice: 9.11, dy: 12.51, div12m: 0.95 },
  { ticker: 'VGIR11', name: 'Valora RE', classId: '2', qty: 50, avgPrice: 9.53, currentPrice: 9.75, dy: 15.52, div12m: 1.06 },
  { ticker: 'IVVB11', name: 'iShares S&P500', classId: '3', qty: 5, avgPrice: 240.00, currentPrice: 249.24, dy: 0, div12m: 0 },
];

export const MOCK_TARGETS: ClassTarget[] = [
  { classId: '1', className: 'Ações', targetPct: 30, lowerBand: 25, upperBand: 35 },
  { classId: '2', className: 'FIIs', targetPct: 40, lowerBand: 35, upperBand: 45 },
  { classId: '3', className: 'ETFs', targetPct: 8, lowerBand: 3, upperBand: 13 },
  { classId: '4', className: 'Renda Fixa', targetPct: 16, lowerBand: 11, upperBand: 21 },
  { classId: '5', className: 'BDRs', targetPct: 3, lowerBand: 0, upperBand: 6 },
  { classId: '6', className: 'Criptos', targetPct: 3, lowerBand: 0, upperBand: 6 },
];
