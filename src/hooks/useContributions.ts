import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface Contribution {
  id: string;
  user_id: string;
  contribution_date: string;
  total_amount: number;
  allocation_mode: string;
  note: string | null;
  created_at: string;
  items: ContributionItem[];
}

export interface ContributionItem {
  id: string;
  contribution_id: string;
  asset_id: string;
  amount: number;
  quantity: number;
  unit_price: number;
}

export const useContributions = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['contributions', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: contributions, error } = await supabase
        .from('contributions')
        .select('*')
        .eq('user_id', user!.id)
        .order('contribution_date', { ascending: false });

      if (error) throw error;

      const contribIds = (contributions ?? []).map(c => c.id);
      if (contribIds.length === 0) return [] as Contribution[];

      const { data: items, error: itemsErr } = await supabase
        .from('contribution_items')
        .select('*')
        .in('contribution_id', contribIds);

      if (itemsErr) throw itemsErr;

      return (contributions ?? []).map(c => ({
        id: c.id,
        user_id: c.user_id,
        contribution_date: c.contribution_date,
        total_amount: Number(c.total_amount),
        allocation_mode: c.allocation_mode,
        note: c.note,
        created_at: c.created_at,
        items: (items ?? [])
          .filter(i => i.contribution_id === c.id)
          .map(i => ({
            id: i.id,
            contribution_id: i.contribution_id,
            asset_id: i.asset_id,
            amount: Number(i.amount),
            quantity: Number(i.quantity),
            unit_price: Number(i.unit_price),
          })),
      })) as Contribution[];
    },
  });
};

export interface ConfirmContributionInput {
  contribution_date: string;
  total_amount: number;
  allocation_mode: string;
  note?: string;
  items: {
    asset_id: string;
    amount: number;
    quantity: number;
    unit_price: number;
  }[];
}

export const useConfirmContribution = () => {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: ConfirmContributionInput) => {
      // 1. Insert contribution
      const { data: contrib, error: cErr } = await supabase
        .from('contributions')
        .insert({
          user_id: user!.id,
          contribution_date: input.contribution_date,
          total_amount: input.total_amount,
          allocation_mode: input.allocation_mode,
          note: input.note ?? null,
        })
        .select('id')
        .single();

      if (cErr) throw cErr;

      // 2. Insert items
      if (input.items.length > 0) {
        const { error: iErr } = await supabase
          .from('contribution_items')
          .insert(
            input.items.map(item => ({
              contribution_id: contrib.id,
              asset_id: item.asset_id,
              amount: item.amount,
              quantity: item.quantity,
              unit_price: item.unit_price,
            }))
          );
        if (iErr) throw iErr;
      }

      // 3. Update positions for each item
      for (const item of input.items) {
        if (item.quantity <= 0) continue;

        // Get current position
        const { data: pos } = await supabase
          .from('positions')
          .select('id, quantity, avg_price')
          .eq('user_id', user!.id)
          .eq('asset_id', item.asset_id)
          .maybeSingle();

        if (pos) {
          const oldQty = Number(pos.quantity);
          const oldAvg = Number(pos.avg_price);
          const newQty = oldQty + item.quantity;
          const newAvg = newQty > 0
            ? ((oldQty * oldAvg) + (item.quantity * item.unit_price)) / newQty
            : item.unit_price;

          await supabase
            .from('positions')
            .update({ quantity: newQty, avg_price: newAvg })
            .eq('id', pos.id);
        } else {
          await supabase
            .from('positions')
            .insert({
              user_id: user!.id,
              asset_id: item.asset_id,
              quantity: item.quantity,
              avg_price: item.unit_price,
            });
        }
      }

      return contrib.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contributions'] });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      toast.success('Aporte confirmado e posições atualizadas!');
    },
    onError: (err: any) => toast.error(`Erro ao confirmar aporte: ${err.message}`),
  });
};

export const useDeleteContribution = () => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('contributions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contributions'] });
      toast.success('Aporte excluído');
    },
    onError: (err: any) => toast.error(err.message),
  });
};

export const useUpdateContributionNote = () => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { error } = await supabase
        .from('contributions')
        .update({ note })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contributions'] });
      toast.success('Observação atualizada');
    },
    onError: (err: any) => toast.error(err.message),
  });
};
