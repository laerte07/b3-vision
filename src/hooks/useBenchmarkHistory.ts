import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface BenchmarkPoint {
  benchmark_code: string;
  date: string;
  value: number;
}

/**
 * Fetches benchmark history from cache and auto-syncs when data is stale.
 * 
 * The hook:
 * 1. Reads from benchmark_history table (cache)
 * 2. Checks if data is stale (latest date > 3 days old)
 * 3. If stale or empty, triggers edge function to refresh
 * 4. Invalidates query on successful sync
 */
export function useBenchmarkHistory(
  benchmarkCodes: string[],
  startDate: Date | null,
) {
  const queryClient = useQueryClient();
  const syncTriggered = useRef(false);

  // 1. Read from Supabase cache
  const query = useQuery({
    queryKey: ['benchmark-history', benchmarkCodes, startDate?.toISOString()],
    queryFn: async (): Promise<BenchmarkPoint[]> => {
      if (!startDate || benchmarkCodes.length === 0) return [];
      const startStr = startDate.toISOString().slice(0, 10);

      // Type assertion needed because benchmark_history isn't in auto-generated types yet
      // Fetch each benchmark separately to avoid the 1000-row default limit
      const allData: BenchmarkPoint[] = [];
      for (const code of benchmarkCodes) {
        const { data: rows, error: err } = await (supabase as any)
          .from('benchmark_history')
          .select('benchmark_code, date, value')
          .eq('benchmark_code', code)
          .gte('date', startStr)
          .order('date', { ascending: true })
          .limit(2000);
        if (err) throw err;
        if (rows) allData.push(...rows);
      }
      const data = allData;

      // data is already assembled above

      if (import.meta.env.DEV) {
        const grouped: Record<string, number> = {};
        (data ?? []).forEach((r: any) => {
          grouped[r.benchmark_code] = (grouped[r.benchmark_code] ?? 0) + 1;
        });
        console.log('[useBenchmarkHistory] Loaded from cache:', grouped);
      }

      return (data ?? []) as BenchmarkPoint[];
    },
    enabled: benchmarkCodes.length > 0 && !!startDate,
    staleTime: 5 * 60 * 1000, // 5 min
  });

  // 2. Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      if (import.meta.env.DEV) {
        console.log('[useBenchmarkHistory] Syncing benchmarks:', benchmarkCodes);
      }
      const { data, error } = await supabase.functions.invoke('historical-benchmarks', {
        body: { benchmarks: benchmarkCodes },
      });
      if (error) throw error;
      if (import.meta.env.DEV) {
        console.log('[useBenchmarkHistory] Sync result:', data);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['benchmark-history'] });
    },
  });

  // 3. Auto-sync when data is stale or empty
  useEffect(() => {
    if (syncTriggered.current || syncMutation.isPending) return;
    if (!query.data) return; // still loading

    if (query.data.length === 0) {
      // No data at all → sync
      syncTriggered.current = true;
      syncMutation.mutate();
      return;
    }

    // Check freshness: latest date across all benchmarks
    const latestDate = query.data.reduce(
      (max, r) => (r.date > max ? r.date : max),
      '',
    );

    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const staleThreshold = threeDaysAgo.toISOString().slice(0, 10);

    if (latestDate < staleThreshold) {
      if (import.meta.env.DEV) {
        console.log(
          `[useBenchmarkHistory] Data stale (latest: ${latestDate}, threshold: ${staleThreshold}). Syncing...`,
        );
      }
      syncTriggered.current = true;
      syncMutation.mutate();
    }
  }, [query.data, syncMutation.isPending]);

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    isSyncing: syncMutation.isPending,
    syncError: syncMutation.error,
    triggerSync: () => syncMutation.mutate(),
  };
}
