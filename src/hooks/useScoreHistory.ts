import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

interface ScoreEntry {
  asset_id: string;
  score_total: number;
  score_quality: number;
  score_growth: number;
  score_valuation: number;
  score_risk: number;
  score_dividends: number;
  json_details: Record<string, any>;
}

export const useScoreHistory = (assetId?: string) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['score_history', user?.id, assetId],
    enabled: !!user && !!assetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('score_history')
        .select('*')
        .eq('user_id', user!.id)
        .eq('asset_id', assetId!)
        .order('snapshot_date', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
};

export const useSaveScoreSnapshot = () => {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (entries: ScoreEntry[]) => {
      const today = new Date().toISOString().split('T')[0];
      const rows = entries.map(e => ({
        ...e,
        user_id: user!.id,
        snapshot_date: today,
      }));
      const { error } = await supabase
        .from('score_history')
        .upsert(rows, { onConflict: 'user_id,asset_id,snapshot_date' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['score_history'] });
      toast.success('Snapshot de scores salvo com sucesso');
    },
    onError: (err: any) => toast.error(err.message),
  });
};
