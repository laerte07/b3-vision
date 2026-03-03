import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface OverrideJson {
  dividend_yield?: number | null;
  div_12m?: number | null;
  lpa?: number | null;
  vpa?: number | null;
  roe?: number | null;
  pb_ratio?: number | null;
  pe_ratio?: number | null;
  ev?: number | null;
  ebitda?: number | null;
  net_debt?: number | null;
  payout?: number | null;
  market_cap?: number | null;
  net_income_ttm?: number | null;
  equity?: number | null;
  margin?: number | null;
  revenue_growth?: number | null;
  net_income_years?: Record<string, number | null>;
}

export function useFundamentalsOverride(assetId: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['fundamentals-override', assetId],
    enabled: !!user && !!assetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fundamentals_overrides')
        .select('*')
        .eq('user_id', user!.id)
        .eq('asset_id', assetId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.override_json as OverrideJson) ?? {};
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (overrides: OverrideJson) => {
      const { error } = await supabase
        .from('fundamentals_overrides')
        .upsert({
          user_id: user!.id,
          asset_id: assetId!,
          override_json: overrides as any,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,asset_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fundamentals-override', assetId] });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      toast.success('Fundamentos salvos');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const setField = (field: keyof OverrideJson, value: number | null) => {
    const current = query.data ?? {};
    upsertMutation.mutate({ ...current, [field]: value });
  };

  const clearField = (field: keyof OverrideJson) => {
    const current = { ...(query.data ?? {}) };
    delete current[field];
    upsertMutation.mutate(current);
  };

  const resetAll = () => {
    upsertMutation.mutate({});
  };

  const saveAll = (overrides: OverrideJson) => {
    upsertMutation.mutate(overrides);
  };

  return {
    overrides: query.data ?? {},
    isLoading: query.isLoading,
    isPending: upsertMutation.isPending,
    setField,
    clearField,
    resetAll,
    saveAll,
  };
}
