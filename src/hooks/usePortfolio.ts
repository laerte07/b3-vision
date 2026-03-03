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
  dividend_yield: number | null; // DY efetivo vindo do fundamentals_cache (se houver)
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

  // dividendos/cache
  div_12m: number | null;
  dy_12m: number | null;

  fundamentals: Fundamentals | null;

  /**
   * DY efetivo para usar na UI/score:
   * prioridade: fundamentals.dividend_yield (API) -> dividends_cache.dy_12m -> null
   */
  effective_dy: number | null;
}

const toNum = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

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

      const assetIds = (assets ?? []).map((a) => a.id);
      if (assetIds.length === 0) return [];

      const [posRes, priceRes, divRes, fundRes] = await Promise.all([
        supabase.from('positions').select('*').eq('user_id', user!.id).in('asset_id', assetIds),
        supabase.from('price_cache').select('*').in('asset_id', assetIds),
        supabase.from('dividends_cache').select('*').in('asset_id', assetIds),
        supabase.from('fundamentals_cache').select('*').in('asset_id', assetIds),
      ]);

      // ✅ não mascarar erro silencioso
      if (posRes.error) throw posRes.error;
      if (priceRes.error) throw priceRes.error;
      if (divRes.error) throw divRes.error;
      if (fundRes.error) throw fundRes.error;

      const positions = posRes.data ?? [];
      const prices = priceRes.data ?? [];
      const divs = divRes.data ?? [];
      const funds = fundRes.data ?? [];

      return (assets ?? []).map((asset) => {
        const pos = positions.find((p) => p.asset_id === asset.id);
        const price = prices.find((p) => p.asset_id === asset.id);
        const div = divs.find((d) => d.asset_id === asset.id);
        const fund = funds.find((f) => f.asset_id === asset.id);

        const fundamentals: Fundamentals | null = fund
          ? {
              lpa: toNum(fund.lpa),
              vpa: toNum(fund.vpa),
              roe: toNum(fund.roe),
              roe_5y: toNum(fund.roe_5y),
              payout: toNum(fund.payout),
              payout_5y: toNum(fund.payout_5y),
              pe_ratio: toNum(fund.pe_ratio),
              pb_ratio: toNum(fund.pb_ratio),
              ev: toNum(fund.ev),
              ebitda: toNum(fund.ebitda),
              net_debt: toNum(fund.net_debt),
              total_shares: toNum(fund.total_shares),
              dividend_yield: toNum(fund.dividend_yield),
              margin: toNum(fund.margin),
              revenue_growth: toNum(fund.revenue_growth),
            }
          : null;

        const div_12m = toNum(div?.div_12m);
        const dy_12m = toNum(div?.dy_12m);

        // ✅ DY efetivo (é isso que sua UI deveria usar na coluna DY)
        const effective_dy = fundamentals?.dividend_yield ?? dy_12m ?? null;

        return {
          id: asset.id,
          ticker: asset.ticker,
          name: asset.name,
          class_id: asset.class_id,
          active: asset.active,

          position_id: pos?.id ?? null,
          quantity: Number(pos?.quantity ?? 0),
          avg_price: Number(pos?.avg_price ?? 0),

          last_price: toNum(price?.last_price),
          change_percent: toNum(price?.change_percent),
          logo_url: price?.logo_url ?? null,
          price_updated_at: price?.updated_at ?? null,
          price_source: price?.source ?? null,

          div_12m,
          dy_12m,

          fundamentals,
          effective_dy,
        } as PortfolioAsset;
      });
    },
  });
};

export const useAddAsset = () => {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      ticker: string;
      name?: string;
      class_id: string;
      quantity: number;
      avg_price: number;
    }) => {
      const { data: asset, error: aErr } = await supabase
        .from('assets')
        .insert({
          user_id: user!.id,
          ticker: input.ticker.toUpperCase(),
          name: input.name || null,
          class_id: input.class_id,
        })
        .select('id')
        .single();

      if (aErr) throw aErr;

      const { error: pErr } = await supabase.from('positions').insert({
        user_id: user!.id,
        asset_id: asset.id,
        quantity: input.quantity,
        avg_price: input.avg_price,
      });

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
    mutationFn: async (input: {
      asset_id: string;
      position_id: string | null;
      quantity: number;
      avg_price: number;
      name?: string;
    }) => {
      await supabase.from('assets').update({ name: input.name || null }).eq('id', input.asset_id);

      if (input.position_id) {
        const { error } = await supabase
          .from('positions')
          .update({ quantity: input.quantity, avg_price: input.avg_price })
          .eq('id', input.position_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('positions').insert({
          user_id: user!.id,
          asset_id: input.asset_id,
          quantity: input.quantity,
          avg_price: input.avg_price,
        });
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
      if (data?.error) throw new Error(data.error);

      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['portfolio'] });

  console.log("RETORNO COMPLETO EDGE FUNCTION:", data);

  const ok = Number(data?.ok_count ?? data?.updated ?? 0);
  const err = Number(data?.error_count ?? 0);

  if (err > 0) {
    toast.success(`Mercado atualizado: ${ok} ativos OK, ${err} com erro`);
  } else {
    toast.success(`Mercado atualizado: ${ok} ativos`);
  }
},

      // ✅ novo payload da edge function:
      // { updated: ok_count, ok_count, error_count, results: [{ok, step, error...}] }
      const ok = Number(data?.ok_count ?? data?.updated ?? 0);
      const err = Number(data?.error_count ?? 0);

      if (err > 0) {
        toast.success(`Mercado atualizado: ${ok} ativos OK, ${err} com erro`);
        // útil p/ debug
        console.log('Erros BRAPI:', data?.results?.filter((r: any) => !r.ok));
      } else {
        toast.success(`Mercado atualizado: ${ok} ativos`);
      }
    },
    onError: (err: any) => toast.error(`Erro ao atualizar: ${err.message}`),
  });
};
