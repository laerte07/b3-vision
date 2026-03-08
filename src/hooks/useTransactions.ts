import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface Transaction {
  id: string;
  asset_id: string;
  type: string;       // 'compra' | 'venda'
  date: string;        // YYYY-MM-DD
  price: number;
  quantity: number;
  fees: number;
}

export const useTransactions = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['transactions', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, asset_id, type, date, price, quantity, fees')
        .eq('user_id', user!.id)
        .order('date', { ascending: true });

      if (error) throw error;

      return (data ?? []).map(t => ({
        id: t.id,
        asset_id: t.asset_id,
        type: t.type,
        date: t.date,
        price: Number(t.price),
        quantity: Number(t.quantity),
        fees: Number(t.fees),
      })) as Transaction[];
    },
  });
};
