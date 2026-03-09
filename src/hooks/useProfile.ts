import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface Profile {
  id: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export const useProfile = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['profile', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('profiles')
        .select('*')
        .eq('id', user!.id)
        .single();
      if (error) throw error;
      return data as Profile;
    },
  });
};

export const useUpdateProfile = () => {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (updates: Partial<Pick<Profile, 'display_name'>>) => {
      const { error } = await (supabase as any)
        .from('profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      toast.success('Perfil atualizado');
    },
    onError: (err: any) => toast.error(err.message),
  });
};

// Check if current user is admin (server-side verified)
const ADMIN_EMAILS = ['viniciuslaerte7@gmail.com'];

export const useIsAdmin = () => {
  const { user } = useAuth();
  // Quick client-side check (used for UI rendering)
  // Real protection is enforced server-side in edge function
  const isAdmin = user?.email ? ADMIN_EMAILS.includes(user.email.toLowerCase()) : false;
  return { isAdmin, loading: false };
};

// Fetch admin metrics
export interface AdminMetrics {
  total_users: number;
  active_users: number;
  users_with_portfolios: number;
  total_assets: number;
  total_positions: number;
  total_contributions: number;
  total_scores: number;
  recent_activity: number;
  recent_users: Array<{
    id: string;
    email: string;
    created_at: string;
    last_sign_in_at: string | null;
  }>;
}

export interface AdminUser {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  confirmed_at: string | null;
  assets_count: number;
  contributions_count: number;
  positions_count: number;
  status: string;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface AdminActivityLog {
  id: string;
  user_email: string;
  action: string;
  details: string | null;
  created_at: string;
}

export interface AdminActivityResponse {
  logs: AdminActivityLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export const useAdminMetrics = () => {
  const { isAdmin } = useIsAdmin();

  return useQuery({
    queryKey: ['admin-metrics'],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-metrics');
      if (error) throw error;
      return data as AdminMetrics;
    },
    refetchInterval: 60000, // Refresh every minute
  });
};

export const useAdminUsers = (page: number, search: string) => {
  const { isAdmin } = useIsAdmin();

  return useQuery({
    queryKey: ['admin-users', page, search],
    enabled: isAdmin,
    queryFn: async () => {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/admin-metrics?action=users&page=${page}&limit=20&search=${encodeURIComponent(search)}`,
        { headers: { Authorization: `Bearer ${session?.access_token}` } }
      );
      if (!res.ok) throw new Error('Failed to fetch users');
      return await res.json() as AdminUsersResponse;
    },
  });
};

export const useAdminActivity = (page: number, filter: string) => {
  const { isAdmin } = useIsAdmin();

  return useQuery({
    queryKey: ['admin-activity', page, filter],
    enabled: isAdmin,
    queryFn: async () => {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/admin-metrics?action=activity&page=${page}&limit=50&filter=${filter}`,
        { headers: { Authorization: `Bearer ${session?.access_token}` } }
      );
      if (!res.ok) throw new Error('Failed to fetch activity');
      return await res.json() as AdminActivityResponse;
    },
  });
};

// Change password mutation
export const useChangePassword = () => {
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
      if (!user?.email) throw new Error('Usuário não encontrado');

      // 1. Verify current password by re-authenticating
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      if (signInError) {
        throw new Error('Senha atual incorreta');
      }

      // 2. Update to new password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        throw new Error(updateError.message);
      }
    },
    onSuccess: () => {
      toast.success('Senha alterada com sucesso');
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });
};

// Sign out other sessions
export const useSignOutOthers = () => {
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut({ scope: 'others' });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Outras sessões encerradas');
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });
};

// Delete account
export const useDeleteAccount = () => {
  return useMutation({
    mutationFn: async (confirmationEmail: string) => {
      const { data, error } = await supabase.functions.invoke('delete-account', {
        body: { confirmationEmail },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: async () => {
      toast.success('Conta excluída com sucesso');
      await supabase.auth.signOut();
      window.location.href = '/auth';
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });
};
