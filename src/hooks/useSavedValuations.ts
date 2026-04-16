import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface SavedValuation {
  id: string;
  asset_id: string;
  ticker: string;
  name: string | null;
  model_type: string;
  fair_value: number | null;
  upside: number | null;
  max_buy_price: number | null;
  json_breakdown: Record<string, any>;
  updated_at: string;
  created_at: string;
  current_price: number | null;
  dividend_yield: number | null;
}

export const MODEL_LABELS: Record<string, string> = {
  vff_3: 'VFF 3 anos',
  vff_5: 'VFF 5 anos',
  graham: 'Graham',
  buffett: 'Buffett',
  bazin: 'Bazin',
  lynch: 'Lynch',
  pvp_justificado: 'P/VP Justificado',
  pl_justo: 'P/L Justo',
  ev_ebitda: 'EV/EBITDA',
};

export const MODEL_TAB_KEYS: Record<string, string> = {
  vff_3: 'vff3',
  vff_5: 'vff5',
  graham: 'graham',
  buffett: 'buffett',
  bazin: 'bazin',
  lynch: 'lynch',
  pvp_justificado: 'pvp',
  pl_justo: 'pl',
  ev_ebitda: 'evebitda',
};

export const useSavedValuations = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['saved-valuations', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<SavedValuation[]> => {
      const { data: results, error } = await supabase
        .from('valuation_results')
        .select('*')
        .eq('user_id', user!.id)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      const list = results ?? [];
      if (list.length === 0) return [];

      const assetIds = Array.from(new Set(list.map(r => r.asset_id)));
      const [assetsRes, pricesRes, fundsRes] = await Promise.all([
        supabase.from('assets').select('id, ticker, name').in('id', assetIds),
        supabase.from('price_cache').select('asset_id, last_price').in('asset_id', assetIds),
        supabase.from('fundamentals_cache').select('asset_id, dividend_yield').in('asset_id', assetIds),
      ]);

      const assets = assetsRes.data ?? [];
      const prices = pricesRes.data ?? [];
      const funds = fundsRes.data ?? [];

      return list.map(r => {
        const a = assets.find(x => x.id === r.asset_id);
        const p = prices.find(x => x.asset_id === r.asset_id);
        const f = funds.find(x => x.asset_id === r.asset_id);
        return {
          id: r.id,
          asset_id: r.asset_id,
          ticker: a?.ticker ?? '—',
          name: a?.name ?? null,
          model_type: r.model_type,
          fair_value: r.fair_value !== null ? Number(r.fair_value) : null,
          upside: r.upside !== null ? Number(r.upside) : null,
          max_buy_price: r.max_buy_price !== null ? Number(r.max_buy_price) : null,
          json_breakdown: (r.json_breakdown as Record<string, any>) ?? {},
          updated_at: r.updated_at,
          created_at: r.created_at,
          current_price: p?.last_price !== undefined && p?.last_price !== null ? Number(p.last_price) : null,
          dividend_yield: f?.dividend_yield !== undefined && f?.dividend_yield !== null ? Number(f.dividend_yield) : null,
        } as SavedValuation;
      });
    },
  });
};

export const useDeleteSavedValuation = () => {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('valuation_results')
        .delete()
        .eq('id', id)
        .eq('user_id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-valuations'] });
      toast.success('Valuation removido');
    },
    onError: (e: any) => toast.error(e.message),
  });
};
