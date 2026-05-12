import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';
import type { PortfolioAsset, Fundamentals } from './usePortfolio';

const toNum = (v: any): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface WatchlistRow extends PortfolioAsset {
  watchlist_id: string;
  notes: string | null;
  setor: string | null;
}

/** Returns watchlist items shaped like PortfolioAsset (so valuations/fundamentals reuse work). */
export const useWatchlist = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['watchlist', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<WatchlistRow[]> => {
      const { data: rows, error } = await supabase
        .from('watchlist')
        .select('*')
        .eq('user_id', user!.id)
        .order('ticker');
      if (error) throw error;
      if (!rows || rows.length === 0) return [];

      const assetIds = rows.map(r => r.asset_id).filter(Boolean) as string[];

      const [assetRes, priceRes, divRes, fundRes, overrideRes] = await Promise.all([
        assetIds.length
          ? supabase.from('assets').select('id, ticker, name, class_id, active').in('id', assetIds)
          : Promise.resolve({ data: [], error: null } as any),
        assetIds.length ? supabase.from('price_cache').select('*').in('asset_id', assetIds) : Promise.resolve({ data: [], error: null } as any),
        assetIds.length ? supabase.from('dividends_cache').select('*').in('asset_id', assetIds) : Promise.resolve({ data: [], error: null } as any),
        assetIds.length ? supabase.from('fundamentals_cache').select('*').in('asset_id', assetIds) : Promise.resolve({ data: [], error: null } as any),
        assetIds.length ? supabase.from('fundamentals_overrides').select('asset_id, override_json').eq('user_id', user!.id).in('asset_id', assetIds) : Promise.resolve({ data: [], error: null } as any),
      ]);

      const assets = assetRes.data ?? [];
      const prices = priceRes.data ?? [];
      const divs = divRes.data ?? [];
      const funds = fundRes.data ?? [];
      const overrides = overrideRes.data ?? [];

      return rows.map((r: any) => {
        const asset = assets.find((a: any) => a.id === r.asset_id);
        const price = prices.find((p: any) => p.asset_id === r.asset_id);
        const div = divs.find((d: any) => d.asset_id === r.asset_id);
        const fund = funds.find((f: any) => f.asset_id === r.asset_id);
        const ov = overrides.find((o: any) => o.asset_id === r.asset_id);
        const ovJson = (ov?.override_json ?? {}) as Record<string, any>;

        const eff = (key: string, cacheVal: number | null): number | null => {
          const m = ovJson[key];
          if (m != null && typeof m === 'number' && Number.isFinite(m)) return m;
          return cacheVal;
        };

        const fundamentals: Fundamentals | null = fund || Object.keys(ovJson).length > 0
          ? {
              lpa: eff('lpa', toNum(fund?.lpa)),
              vpa: eff('vpa', toNum(fund?.vpa)),
              roe: eff('roe', toNum(fund?.roe)),
              roe_5y: toNum(fund?.roe_5y),
              payout: eff('payout', toNum(fund?.payout)),
              payout_5y: toNum(fund?.payout_5y),
              pe_ratio: eff('pe_ratio', toNum(fund?.pe_ratio)),
              pb_ratio: eff('pb_ratio', toNum(fund?.pb_ratio)),
              ev: eff('ev', toNum(fund?.ev)),
              ebitda: eff('ebitda', toNum(fund?.ebitda)),
              net_debt: eff('net_debt', toNum(fund?.net_debt)),
              total_shares: toNum(fund?.total_shares),
              dividend_yield: eff('dividend_yield', toNum(fund?.dividend_yield)),
              margin: eff('margin', toNum(fund?.margin)),
              revenue_growth: eff('revenue_growth', toNum(fund?.revenue_growth)),
            }
          : null;

        const last_price = toNum(price?.last_price) ?? toNum(r.last_price);
        const dy_12m = toNum(div?.dy_12m) ?? toNum(r.dy_12m);
        const sector = (price as any)?.sector ?? r.setor ?? null;
        const industry = (price as any)?.industry ?? null;

        return {
          watchlist_id: r.id,
          notes: r.notes ?? null,
          setor: r.setor ?? null,

          id: asset?.id ?? r.asset_id ?? r.id,
          ticker: r.ticker,
          name: r.nome ?? asset?.name ?? null,
          class_id: asset?.class_id ?? '',
          active: false,

          position_id: null,
          quantity: 0,
          avg_price: 0,

          last_price,
          change_percent: toNum(price?.change_percent) ?? toNum(r.change_percent),
          logo_url: price?.logo_url ?? null,
          price_updated_at: price?.updated_at ?? r.price_updated_at ?? null,
          price_source: price?.source ?? 'watchlist',

          sector,
          industry,

          div_12m: toNum(div?.div_12m),
          dy_12m,

          fundamentals,
          effective_dy: fundamentals?.dividend_yield ?? dy_12m ?? null,
          overrides: ovJson,
        } as WatchlistRow;
      });
    },
  });
};

/** Lookup ticker on brapi: returns name, price, dy. */
export const useLookupTicker = () => {
  return useMutation({
    mutationFn: async (ticker: string) => {
      const t = ticker.trim().toUpperCase();
      if (!t) throw new Error('Informe um ticker');
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Sessão expirada.');

      const { data, error } = await supabase.functions.invoke('brapi-lookup', {
        headers: { Authorization: `Bearer ${token}` },
        body: { ticker: t },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.found) throw new Error('Ativo não encontrado');
      return data as { ticker: string; name: string | null; price: number | null; dy: number | null; sector: string | null };
    },
  });
};

export const useAddToWatchlist = () => {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { ticker: string; nome?: string | null; setor?: string | null; notes?: string | null; price?: number | null; dy?: number | null }) => {
      const ticker = input.ticker.toUpperCase().trim();

      // 1) ensure asset row exists (active=false if not pre-existing)
      const { data: existing } = await supabase
        .from('assets')
        .select('id, active')
        .eq('user_id', user!.id)
        .eq('ticker', ticker)
        .maybeSingle();

      let assetId = existing?.id ?? null;

      if (!assetId) {
        // need a class_id — pick "acoes" or first available
        const { data: cls } = await supabase.from('asset_classes').select('id, slug').order('name');
        const acoes = (cls ?? []).find((c: any) => c.slug === 'acoes') ?? (cls ?? [])[0];
        if (!acoes) throw new Error('Nenhuma classe de ativo encontrada');
        const { data: created, error: aErr } = await supabase
          .from('assets')
          .insert({ user_id: user!.id, ticker, name: input.nome ?? null, class_id: acoes.id, active: false })
          .select('id')
          .single();
        if (aErr) throw aErr;
        assetId = created.id;
      }

      // 2) insert watchlist row
      const { error: wErr } = await supabase.from('watchlist').insert({
        user_id: user!.id,
        asset_id: assetId,
        ticker,
        nome: input.nome ?? null,
        setor: input.setor ?? null,
        notes: input.notes ?? null,
        last_price: input.price ?? null,
        dy_12m: input.dy ?? null,
        price_updated_at: input.price != null ? new Date().toISOString() : null,
      });
      if (wErr) {
        if ((wErr as any).code === '23505') throw new Error('Ativo já está na watchlist');
        throw wErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlist'] });
      toast.success('Ativo adicionado à watchlist');
    },
    onError: (err: any) => toast.error(err.message),
  });
};

export const useRemoveFromWatchlist = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('watchlist').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlist'] });
      toast.success('Removido da watchlist');
    },
    onError: (err: any) => toast.error(err.message),
  });
};

export const useUpdateWatchlistNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; notes?: string | null; setor?: string | null }) => {
      const { error } = await supabase
        .from('watchlist')
        .update({ notes: input.notes ?? null, setor: input.setor ?? null })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlist'] });
      toast.success('Notas atualizadas');
    },
    onError: (err: any) => toast.error(err.message),
  });
};