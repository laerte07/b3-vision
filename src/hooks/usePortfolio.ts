import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface PortfolioAsset {
  id: string;
  ticker: string;
  name: string | null;
  class_id: string;
  active: boolean;
  position_id: string | null;
  quantity: number;
  avg_price: number;
  last_price: number | null;
  change_percent: number | null;
  logo_url: string | null;
  price_updated_at: string | null;
  price_source: string | null;
  div_12m: number | null;
  dy_12m: number | null;
}

export const usePortfolio = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['portfolio', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: assets, error } = await supabase
        .from('assets')
        .select('id, ticker, name, class_id, active')
        .eq('user_id', user!.id)
        .eq('active', true)
        .order('ticker');
      if (error) throw error;

      const assetIds = assets.map(a => a.id);
      if (assetIds.length === 0) return [];

      const [posRes, priceRes, divRes] = await Promise.all([
        supabase.from('positions').select('*').eq('user_id', user!.id).in('asset_id', assetIds),
        supabase.from('price_cache').select('*').in('asset_id', assetIds),
        supabase.from('dividends_cache').select('*').in('asset_id', assetIds),
      ]);

      return assets.map(asset => {
        const pos = posRes.data?.find(p => p.asset_id === asset.id);
        const price = priceRes.data?.find(p => p.asset_id === asset.id);
        const div = divRes.data?.find(d => d.asset_id === asset.id);
        return {
          id: asset.id,
          ticker: asset.ticker,
          name: asset.name,
          class_id: asset.class_id,
          active: asset.active,
          position_id: pos?.id ?? null,
          quantity: Number(pos?.quantity ?? 0),
          avg_price: Number(pos?.avg_price ?? 0),
          last_price: price?.last_price != null ? Number(price.last_price) : null,
          change_percent: price?.change_percent != null ? Number(price.change_percent) : null,
          logo_url: price?.logo_url ?? null,
          price_updated_at: price?.updated_at ?? null,
          price_source: price?.source ?? null,
          div_12m: div?.div_12m != null ? Number(div.div_12m) : null,
          dy_12m: div?.dy_12m != null ? Number(div.dy_12m) : null,
        } as PortfolioAsset;
      });
    },
  });
};

export const useAddAsset = () => {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { ticker: string; name?: string; class_id: string; quantity: number; avg_price: number }) => {
      const { data: asset, error: aErr } = await supabase
        .from('assets')
        .insert({ user_id: user!.id, ticker: input.ticker.toUpperCase(), name: input.name || null, class_id: input.class_id })
        .select('id')
        .single();
      if (aErr) throw aErr;

      const { error: pErr } = await supabase
        .from('positions')
        .insert({ user_id: user!.id, asset_id: asset.id, quantity: input.quantity, avg_price: input.avg_price });
      if (pErr) throw pErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      toast.success('Ativo adicionado com sucesso');
    },
    onError: (err: any) => toast.error(err.message),
  });
};

export const useUpdatePosition = () => {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { asset_id: string; position_id: string | null; quantity: number; avg_price: number; name?: string }) => {
      await supabase.from('assets').update({ name: input.name || null }).eq('id', input.asset_id);

      if (input.position_id) {
        const { error } = await supabase.from('positions').update({ quantity: input.quantity, avg_price: input.avg_price }).eq('id', input.position_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('positions').insert({ user_id: user!.id, asset_id: input.asset_id, quantity: input.quantity, avg_price: input.avg_price });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      toast.success('Posição atualizada');
    },
    onError: (err: any) => toast.error(err.message),
  });
};

export const useDeleteAsset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assetId: string) => {
      const { error } = await supabase.from('assets').delete().eq('id', assetId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      toast.success('Ativo excluído');
    },
    onError: (err: any) => toast.error(err.message),
  });
};

export const useRefreshMarket = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('brapi-quote');
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      toast.success(`Mercado atualizado: ${data?.updated ?? 0} ativos`);
    },
    onError: (err: any) => toast.error(`Erro ao atualizar: ${err.message}`),
  });
};
