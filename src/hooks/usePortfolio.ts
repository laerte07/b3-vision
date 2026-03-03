import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface Fundamentals {
  lpa: number | null;
  vpa: number | null;
  roe: number | null;
  roe_5y: number | null;
  payout: number | null;
  payout_5y: number | null;
  pe_ratio: number | null;
  pb_ratio: number | null;
  ev: number | null;
  ebitda: number | null;
  net_debt: number | null;
  total_shares: number | null;
  dividend_yield: number | null;
  margin: number | null;
  revenue_growth: number | null;
}

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
  fundamentals: Fundamentals | null;
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

      const [posRes, priceRes, divRes, fundRes] = await Promise.all([
        supabase.from('positions').select('*').eq('user_id', user!.id).in('asset_id', assetIds),
        supabase.from('price_cache').select('*').in('asset_id', assetIds),
        supabase.from('dividends_cache').select('*').in('asset_id', assetIds),
        supabase.from('fundamentals_cache').select('*').in('asset_id', assetIds),
      ]);

      return assets.map(asset => {
        const pos = posRes.data?.find(p => p.asset_id === asset.id);
        const price = priceRes.data?.find(p => p.asset_id === asset.id);
        const div = divRes.data?.find(d => d.asset_id === asset.id);
        const fund = fundRes.data?.find(f => f.asset_id === asset.id);
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
          fundamentals: fund ? {
            lpa: fund.lpa != null ? Number(fund.lpa) : null,
            vpa: fund.vpa != null ? Number(fund.vpa) : null,
            roe: fund.roe != null ? Number(fund.roe) : null,
            roe_5y: fund.roe_5y != null ? Number(fund.roe_5y) : null,
            payout: fund.payout != null ? Number(fund.payout) : null,
            payout_5y: fund.payout_5y != null ? Number(fund.payout_5y) : null,
            pe_ratio: fund.pe_ratio != null ? Number(fund.pe_ratio) : null,
            pb_ratio: fund.pb_ratio != null ? Number(fund.pb_ratio) : null,
            ev: fund.ev != null ? Number(fund.ev) : null,
            ebitda: fund.ebitda != null ? Number(fund.ebitda) : null,
            net_debt: fund.net_debt != null ? Number(fund.net_debt) : null,
            total_shares: fund.total_shares != null ? Number(fund.total_shares) : null,
            dividend_yield: fund.dividend_yield != null ? Number(fund.dividend_yield) : null,
            margin: fund.margin != null ? Number(fund.margin) : null,
            revenue_growth: fund.revenue_growth != null ? Number(fund.revenue_growth) : null,
          } : null,
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
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Sessão expirada. Faça login novamente.');

      const { data, error } = await supabase.functions.invoke('brapi-quote', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      // Check if response indicates an error
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      const failed = data?.results?.filter((r: any) => r.error)?.length ?? 0;
      const successCount = (data?.updated ?? 0) - failed;
      if (failed > 0) {
        toast.success(`Mercado atualizado: ${successCount} ativos OK, ${failed} com erro`);
      } else {
        toast.success(`Mercado atualizado: ${data?.updated ?? 0} ativos`);
      }
    },
    onError: (err: any) => toast.error(`Erro ao atualizar: ${err.message}`),
  });
};
