import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface ClassTarget {
  id: string;
  class_id: string;
  target_percent: number;
  lower_band: number;
  upper_band: number;
}

export const useClassTargets = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['class_targets', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_targets')
        .select('*')
        .eq('user_id', user!.id);
      if (error) throw error;
      return (data ?? []).map(d => ({
        id: d.id,
        class_id: d.class_id,
        target_percent: Number(d.target_percent),
        lower_band: Number(d.lower_band),
        upper_band: Number(d.upper_band),
      })) as ClassTarget[];
    },
  });
};

export const useUpsertClassTarget = () => {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { class_id: string; target_percent: number; lower_band: number; upper_band: number }) => {
      const { error } = await supabase
        .from('class_targets')
        .upsert({
          user_id: user!.id,
          class_id: input.class_id,
          target_percent: input.target_percent,
          lower_band: input.lower_band,
          upper_band: input.upper_band,
        }, { onConflict: 'user_id,class_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['class_targets'] });
      toast.success('Meta salva');
    },
    onError: (err: any) => toast.error(err.message),
  });
};
