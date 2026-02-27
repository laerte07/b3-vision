import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AssetClass {
  id: string;
  name: string;
  slug: string;
}

export const useAssetClasses = () =>
  useQuery({
    queryKey: ['asset_classes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_classes')
        .select('id, name, slug')
        .order('name');
      if (error) throw error;
      return data as AssetClass[];
    },
    staleTime: Infinity,
  });
