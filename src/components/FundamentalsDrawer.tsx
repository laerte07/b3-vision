import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetClose } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { RotateCcw, Save, X } from 'lucide-react';
import { useFundamentalsOverride, OverrideJson } from '@/hooks/useFundamentalsOverride';
import { getEffectiveFundamentals, computeCoverage, coverageBadge, FieldSource } from '@/lib/effective-fundamentals';
import type { PortfolioAsset } from '@/hooks/usePortfolio';

interface Props {
  asset: PortfolioAsset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FieldDef {
  key: string;
  label: string;
  unit: string;
  tab: 'geral' | 'valuation' | 'dividendos' | 'historico';
  min?: number;
  max?: number;
}

const FIELDS: FieldDef[] = [
  { key: 'roe', label: 'ROE', unit: '%', tab: 'geral' },
  { key: 'margin', label: 'Margem', unit: '%', tab: 'geral' },
  { key: 'revenue_growth', label: 'Cresc. Receita', unit: '%', tab: 'geral' },
  { key: 'net_debt', label: 'Dívida Líquida', unit: 'R$', tab: 'geral' },
  { key: 'ebitda', label: 'EBITDA', unit: 'R$', tab: 'geral' },
  { key: 'lpa', label: 'LPA', unit: 'R$', tab: 'geral' },
  { key: 'vpa', label: 'VPA', unit: 'R$', tab: 'geral' },
  { key: 'market_cap', label: 'Market Cap', unit: 'R$', tab: 'geral' },
  { key: 'net_income_ttm', label: 'Lucro Líquido', unit: 'R$', tab: 'geral' },
  { key: 'equity', label: 'Patrimônio Líquido', unit: 'R$', tab: 'geral' },
  { key: 'pe_ratio', label: 'P/L', unit: 'x', tab: 'valuation' },
  { key: 'pb_ratio', label: 'P/VP', unit: 'x', tab: 'valuation' },
  { key: 'ev', label: 'EV', unit: 'R$', tab: 'valuation' },
  { key: 'dividend_yield', label: 'DY', unit: '%', tab: 'dividendos' },
  { key: 'div_12m', label: 'Div 12m', unit: 'R$', tab: 'dividendos' },
  { key: 'payout', label: 'Payout', unit: '%', tab: 'dividendos', max: 200 },
];

function sourceBadge(source: FieldSource) {
  if (source === 'manual') return <Badge variant="outline" className="text-[9px] px-1 py-0 bg-primary/10 text-primary border-primary/30">Manual</Badge>;
  if (source === 'api') return <Badge variant="outline" className="text-[9px] px-1 py-0 bg-emerald-500/10 text-emerald-500 border-emerald-500/30">API</Badge>;
  return <Badge variant="outline" className="text-[9px] px-1 py-0">N/D</Badge>;
}

export default function FundamentalsDrawer({ asset, open, onOpenChange }: Props) {
  const { overrides, isLoading, isPending, saveAll, resetAll } = useFundamentalsOverride(asset?.id);
  const [draft, setDraft] = useState<OverrideJson>({});

  useEffect(() => {
    if (open) setDraft({ ...overrides });
  }, [open, overrides]);

  if (!asset) return null;

  const eff = getEffectiveFundamentals(asset, draft);
  const coverage = computeCoverage(eff);
  const badge = coverageBadge(coverage);

  const currentYear = new Date().getFullYear();
  const histYears = [currentYear, currentYear - 1, currentYear - 2];

  const setDraftField = (key: string, raw: string) => {
    const val = raw === '' ? undefined : Number(raw);
    setDraft(prev => ({ ...prev, [key]: val != null && !isNaN(val) ? val : undefined }));
  };

  const clearDraftField = (key: string) => {
    setDraft(prev => {
      const next = { ...prev };
      delete (next as any)[key];
      return next;
    });
  };

  const handleSave = () => {
    // Clean undefined values
    const clean: OverrideJson = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v !== undefined && v !== null) (clean as any)[k] = v;
    }
    saveAll(clean);
  };

  const handleResetAll = () => {
    setDraft({});
    resetAll();
  };

  const renderField = (f: FieldDef) => {
    const draftVal = (draft as any)[f.key];
    const hasDraft = draftVal !== undefined && draftVal !== null;
    const source = hasDraft ? 'manual' : eff.sources[f.key];
    const displayVal = hasDraft ? String(draftVal) : (eff.values[f.key] != null ? String(eff.values[f.key]) : '');

    return (
      <div key={f.key} className="grid grid-cols-[1fr_80px_60px_32px] items-center gap-2">
        <div className="space-y-0.5">
          <Label className="text-xs text-muted-foreground">{f.label} ({f.unit})</Label>
          <Input
            type="number"
            step="any"
            min={f.min}
            max={f.max}
            value={displayVal}
            onChange={e => setDraftField(f.key, e.target.value)}
            placeholder="—"
            className="h-8 font-mono text-sm"
          />
        </div>
        <div className="flex items-end pb-1 justify-center">
          {sourceBadge(source as FieldSource)}
        </div>
        <div className="text-[10px] text-muted-foreground text-center pb-1">{f.unit}</div>
        <div className="pb-1">
          {hasDraft && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => clearDraftField(f.key)} title="Restaurar API">
              <RotateCcw className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderHistorico = () => {
    const years = draft.net_income_years ?? overrides.net_income_years ?? {};
    return (
      <div className="space-y-3">
        <Label className="text-xs text-muted-foreground">Lucro Líquido por Ano (R$)</Label>
        {histYears.map(y => (
          <div key={y} className="grid grid-cols-[80px_1fr] items-center gap-2">
            <span className="text-sm font-mono">{y}</span>
            <Input
              type="number"
              step="any"
              value={years[String(y)] != null ? String(years[String(y)]) : ''}
              onChange={e => {
                const val = e.target.value === '' ? null : Number(e.target.value);
                setDraft(prev => ({
                  ...prev,
                  net_income_years: { ...(prev.net_income_years ?? {}), [String(y)]: val },
                }));
              }}
              placeholder="—"
              className="h-8 font-mono text-sm"
            />
          </div>
        ))}
      </div>
    );
  };

  const tabFields = (tab: string) => FIELDS.filter(f => f.tab === tab);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[780px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Fundamentos — {asset.ticker}
            <Badge variant="outline" className={badge.className}>{badge.label} ({coverage}%)</Badge>
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Edite manualmente ou use os dados da API. Manual tem prioridade.
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          <Tabs defaultValue="geral">
            <TabsList className="mb-3 w-full">
              <TabsTrigger value="geral" className="flex-1">Geral</TabsTrigger>
              <TabsTrigger value="valuation" className="flex-1">Valuation</TabsTrigger>
              <TabsTrigger value="dividendos" className="flex-1">Dividendos</TabsTrigger>
              <TabsTrigger value="historico" className="flex-1">Histórico</TabsTrigger>
            </TabsList>

            <TabsContent value="geral" className="space-y-3">{tabFields('geral').map(renderField)}</TabsContent>
            <TabsContent value="valuation" className="space-y-3">{tabFields('valuation').map(renderField)}</TabsContent>
            <TabsContent value="dividendos" className="space-y-3">{tabFields('dividendos').map(renderField)}</TabsContent>
            <TabsContent value="historico">{renderHistorico()}</TabsContent>
          </Tabs>
        </div>

        <SheetFooter className="flex-row gap-2 pt-4 border-t">
          <Button onClick={handleSave} disabled={isPending} className="flex-1 gap-2">
            <Save className="h-4 w-4" /> {isPending ? 'Salvando...' : 'Salvar'}
          </Button>
          <Button variant="outline" onClick={handleResetAll} disabled={isPending} className="gap-2">
            <RotateCcw className="h-4 w-4" /> Restaurar Todos
          </Button>
          <SheetClose asChild>
            <Button variant="ghost" size="icon"><X className="h-4 w-4" /></Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
