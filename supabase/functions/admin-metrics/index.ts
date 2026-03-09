import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';

const ADMIN_EMAILS = ['viniciuslaerte7@gmail.com'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1. Authenticate user with JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Usuário não encontrado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Verify admin status
    const userEmail = user.email?.toLowerCase();
    if (!userEmail || !ADMIN_EMAILS.includes(userEmail)) {
      return new Response(JSON.stringify({ error: 'Acesso negado. Apenas administradores.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Use service role client for admin queries
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Parse URL parameters
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'metrics';

    // Handle different actions
    if (action === 'users') {
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const search = url.searchParams.get('search') || '';
      const offset = (page - 1) * limit;

      // Get users from auth.users
      const { data: authUsersData } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
      const allUsers = authUsersData?.users || [];

      // Filter by search
      let filteredUsers = allUsers;
      if (search) {
        filteredUsers = allUsers.filter(u => 
          u.email?.toLowerCase().includes(search.toLowerCase()) || 
          u.user_metadata?.display_name?.toLowerCase().includes(search.toLowerCase())
        );
      }

      // Apply pagination
      const paginatedUsers = filteredUsers.slice(offset, offset + limit);

      // Enrich user data with statistics
      const enrichedUsers = await Promise.all(
        paginatedUsers.map(async (authUser) => {
          // Count assets
          const { count: assetsCount } = await adminClient
            .from('assets')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', authUser.id);

          // Count contributions
          const { count: contributionsCount } = await adminClient
            .from('contributions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', authUser.id);

          // Check if has active positions
          const { count: positionsCount } = await adminClient
            .from('positions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', authUser.id)
            .gt('quantity', 0);

          // Get profile data
          const { data: profile } = await adminClient
            .from('profiles')
            .select('display_name')
            .eq('id', authUser.id)
            .single();

          return {
            id: authUser.id,
            email: authUser.email,
            display_name: profile?.display_name || authUser.user_metadata?.display_name,
            created_at: authUser.created_at,
            last_sign_in_at: authUser.last_sign_in_at,
            confirmed_at: authUser.confirmed_at,
            assets_count: assetsCount || 0,
            contributions_count: contributionsCount || 0,
            positions_count: positionsCount || 0,
            status: contributionsCount > 0 ? 'Ativo' : positionsCount > 0 ? 'Moderado' : 'Novo'
          };
        })
      );

      return new Response(
        JSON.stringify({
          users: enrichedUsers,
          pagination: {
            page,
            limit,
            total: filteredUsers.length,
            pages: Math.ceil(filteredUsers.length / limit)
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'activity') {
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const filter = url.searchParams.get('filter') || 'all';
      const offset = (page - 1) * limit;

      let query = adminClient
        .from('admin_activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (filter !== 'all') {
        query = query.ilike('action', `%${filter}%`);
      }

      const { data: logs, error: logsError } = await query;
      if (logsError) throw logsError;

      const { count, error: countError } = await adminClient
        .from('admin_activity_logs')
        .select('id', { count: 'exact', head: true });

      return new Response(
        JSON.stringify({
          logs: logs || [],
          pagination: {
            page,
            limit,
            total: count || 0,
            pages: Math.ceil((count || 0) / limit)
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default metrics action
    const [
      usersResult,
      assetsResult,
      positionsResult,
      contributionsResult,
      transactionsResult,
      scoresResult,
    ] = await Promise.all([
      adminClient.auth.admin.listUsers({ perPage: 1000 }),
      adminClient.from('assets').select('id', { count: 'exact', head: true }),
      adminClient.from('positions').select('id', { count: 'exact', head: true }).gt('quantity', 0),
      adminClient.from('contributions').select('id', { count: 'exact', head: true }),
      adminClient.from('transactions').select('id', { count: 'exact', head: true }),
      adminClient.from('score_history').select('id', { count: 'exact', head: true }),
    ]);

    const allUsers = usersResult.data?.users || [];
    const totalUsers = allUsers.length;
    
    // Calculate active users (with last sign in within 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const activeUsers = allUsers.filter(u => 
      u.last_sign_in_at && new Date(u.last_sign_in_at) > thirtyDaysAgo
    ).length;

    // Calculate users with portfolios
    const { data: usersWithPositions } = await adminClient
      .from('positions')
      .select('user_id')
      .gt('quantity', 0);
    
    const uniqueUsersWithPortfolios = new Set(usersWithPositions?.map(p => p.user_id)).size;

    // Recent activity count
    const { count: recentActivity } = await adminClient
      .from('admin_activity_logs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', thirtyDaysAgo.toISOString());

    // Recent users list (last 5)
    const recentUsers = allUsers
      .sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, 5)
      .map(u => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
      }));

    const metrics = {
      total_users: totalUsers,
      active_users: activeUsers,
      users_with_portfolios: uniqueUsersWithPortfolios,
      total_assets: assetsResult.count ?? 0,
      total_contributions: contributionsResult.count ?? 0,
      total_positions: positionsResult.count ?? 0,
      total_scores: scoresResult.count ?? 0,
      recent_activity: recentActivity || 0,
      recent_users: recentUsers,
    };

    return new Response(JSON.stringify(metrics), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Admin metrics error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
