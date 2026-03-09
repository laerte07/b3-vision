import { useState, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { fadeUp, stagger } from '@/lib/motion-variants';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Download, Upload, Shield, Save, User, Lock, Database,
  Settings as SettingsIcon, Eye, EyeOff, Users, BarChart3,
  LogOut, AlertTriangle, Trash2, CheckCircle2, XCircle,
  Activity, CreditCard, Mail, Calendar, Clock, Search,
  ChevronLeft, ChevronRight, Filter, TrendingUp, TrendingDown,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useClassTargets, useUpsertClassTarget } from '@/hooks/useClassTargets';
import {
  useProfile,
  useUpdateProfile,
  useIsAdmin,
  useAdminMetrics,
  useAdminUsers,
  useAdminActivity,
  useChangePassword,
  useSignOutOthers,
  useDeleteAccount,
} from '@/hooks/useProfile';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ─── Password validation ────────────────────────────────────
const PASSWORD_MIN_LENGTH = 8;
const passwordRules = [
  { id: 'length', label: 'Mínimo 8 caracteres', test: (p: string) => p.length >= PASSWORD_MIN_LENGTH },
  { id: 'letter', label: 'Pelo menos 1 letra', test: (p: string) => /[a-zA-Z]/.test(p) },
  { id: 'number', label: 'Pelo menos 1 número', test: (p: string) => /\d/.test(p) },
];

const Settings = () => {
  const { user } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const { isAdmin } = useIsAdmin();
  const { data: adminMetrics } = useAdminMetrics();
  const changePassword = useChangePassword();
  const signOutOthers = useSignOutOthers();
  const deleteAccount = useDeleteAccount();

  const { data: classes = [] } = useAssetClasses();
  const { data: targets = [] } = useClassTargets();
  const upsertTarget = useUpsertClassTarget();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState('conta');

  // Profile editing
  const [displayName, setDisplayName] = useState('');
  const [displayNameEditing, setDisplayNameEditing] = useState(false);

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Delete account
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Admin state
  const [adminUsersPage, setAdminUsersPage] = useState(1);
  const [adminUsersSearch, setAdminUsersSearch] = useState('');
  const [adminActivityPage, setAdminActivityPage] = useState(1);
  const [adminActivityFilter, setAdminActivityFilter] = useState('all');

  // Admin queries
  const { data: adminUsersData } = useAdminUsers(adminUsersPage, adminUsersSearch);
  const { data: adminActivityData } = useAdminActivity(adminActivityPage, adminActivityFilter);

  // Class targets
  const [editTargets, setEditTargets] = useState<Record<string, { target: string; lower: string; upper: string }>>({});

  // Password validation state
  const passwordValid = passwordRules.every(r => r.test(newPassword));
  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;

  // Sync profile display name
  const effectiveDisplayName = displayNameEditing ? displayName : (profile?.display_name ?? '');

  // Target helpers
  const getTargetValues = (classId: string) => {
    if (editTargets[classId]) return editTargets[classId];
    const existing = targets.find(t => t.class_id === classId);
    return {
      target: String(existing?.target_percent ?? 0),
      lower: String(existing?.lower_band ?? 0),
      upper: String(existing?.upper_band ?? 0),
    };
  };

  const updateField = (classId: string, field: 'target' | 'lower' | 'upper', value: string) => {
    const current = getTargetValues(classId);
    setEditTargets(prev => ({ ...prev, [classId]: { ...current, [field]: value } }));
  };

  const saveTarget = (classId: string) => {
    const vals = getTargetValues(classId);
    upsertTarget.mutate({
      class_id: classId,
      target_percent: Number(vals.target),
      lower_band: Number(vals.lower),
      upper_band: Number(vals.upper),
    });
  };

  const targetSum = classes.reduce((sum, cls) => sum + Number(getTargetValues(cls.id).target), 0);
  const targetSumOk = Math.abs(targetSum - 100) < 0.01;

  // Handlers
  const handleSaveDisplayName = () => {
    updateProfile.mutate({ display_name: displayName || null });
    setDisplayNameEditing(false);
  };

  const handleChangePassword = () => {
    if (!passwordValid || !passwordsMatch) return;
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
        },
      }
    );
  };

  const handleDeleteAccount = () => {
    deleteAccount.mutate(deleteConfirmEmail);
  };

  // Export/Import
  const handleExport = async () => {
    if (!user) return;
    const [assets, positions, classTargets, valuationModels, correlations] = await Promise.all([
      supabase.from('assets').select('*').eq('user_id', user.id),
      supabase.from('positions').select('*').eq('user_id', user.id),
      supabase.from('class_targets').select('*').eq('user_id', user.id),
      supabase.from('valuation_models').select('*').eq('user_id', user.id),
      supabase.from('correlation_matrix').select('*').eq('user_id', user.id),
    ]);
    const backup = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      assets: assets.data ?? [],
      positions: positions.data ?? [],
      class_targets: classTargets.data ?? [],
      valuation_models: valuationModels.data ?? [],
      correlation_matrix: correlations.data ?? [],
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fortuna-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Backup exportado');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      if (!backup.version || !backup.assets) {
        toast.error('Arquivo inválido');
        return;
      }
      let created = 0,
        updated = 0;
      for (const asset of backup.assets) {
        const { data: existing } = await supabase
          .from('assets')
          .select('id')
          .eq('user_id', user.id)
          .eq('ticker', asset.ticker)
          .maybeSingle();
        if (existing) {
          await supabase
            .from('assets')
            .update({ name: asset.name, class_id: asset.class_id, active: asset.active })
            .eq('id', existing.id);
          updated++;
          const pos = backup.positions?.find((p: any) => p.asset_id === asset.id);
          if (pos)
            await supabase
              .from('positions')
              .upsert(
                { user_id: user.id, asset_id: existing.id, quantity: pos.quantity, avg_price: pos.avg_price },
                { onConflict: 'id' }
              );
        } else {
          const { data: newAsset } = await supabase
            .from('assets')
            .insert({
              user_id: user.id,
              ticker: asset.ticker,
              name: asset.name,
              class_id: asset.class_id,
              active: asset.active ?? true,
            })
            .select('id')
            .single();
          created++;
          if (newAsset) {
            const pos = backup.positions?.find((p: any) => p.asset_id === asset.id);
            if (pos)
              await supabase
                .from('positions')
                .insert({ user_id: user.id, asset_id: newAsset.id, quantity: pos.quantity, avg_price: pos.avg_price });
          }
        }
      }
      for (const ct of backup.class_targets ?? []) {
        await supabase
          .from('class_targets')
          .upsert(
            {
              user_id: user.id,
              class_id: ct.class_id,
              target_percent: ct.target_percent,
              lower_band: ct.lower_band,
              upper_band: ct.upper_band,
            },
            { onConflict: 'user_id,class_id' }
          );
      }
      toast.success(`Importação: ${created} criados, ${updated} atualizados`);
      window.location.reload();
    } catch (err) {
      toast.error('Erro: ' + (err as Error).message);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: ptBR });
  };

  return (
    <motion.div
      className="space-y-6"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      <motion.div variants={fadeUp} custom={0}>
        <p className="kpi-label mb-1">Parâmetros</p>
        <h1 className="text-xl font-semibold tracking-tight">Configurações</h1>
      </motion.div>

      <motion.div variants={fadeUp} custom={1}>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-card/50 border border-border/30">
            <TabsTrigger value="conta" className="gap-2 data-[state=active]:bg-primary/10">
              <User className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Conta</span>
            </TabsTrigger>
            <TabsTrigger value="seguranca" className="gap-2 data-[state=active]:bg-primary/10">
              <Lock className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Segurança</span>
            </TabsTrigger>
            <TabsTrigger value="preferencias" className="gap-2 data-[state=active]:bg-primary/10">
              <SettingsIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Preferências</span>
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="admin" className="gap-2 data-[state=active]:bg-primary/10">
                <Shield className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Admin</span>
              </TabsTrigger>
            )}
          </TabsList>

          {/* ─── CONTA TAB ─── */}
          <TabsContent value="conta" className="space-y-4">
            <div className="glass-card p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Informações da Conta</h3>
                  <p className="text-sm text-muted-foreground">Gerencie seu perfil e dados pessoais</p>
                </div>
              </div>

              <div className="space-y-5">
                {/* Email */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">E-mail</Label>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-sm">{user?.email ?? '—'}</span>
                    <Badge variant="outline" className="text-xs ml-2">
                      <CheckCircle2 className="h-3 w-3 mr-1 text-positive" />
                      Verificado
                    </Badge>
                  </div>
                </div>

                {/* Display Name */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Nome de exibição</Label>
                  {displayNameEditing ? (
                    <div className="flex gap-2">
                      <Input
                        value={displayName}
                        onChange={e => setDisplayName(e.target.value)}
                        placeholder="Seu nome"
                        className="max-w-xs"
                      />
                      <Button size="sm" onClick={handleSaveDisplayName} disabled={updateProfile.isPending}>
                        <Save className="h-3.5 w-3.5 mr-1" />
                        Salvar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDisplayNameEditing(false)}>
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{profile?.display_name || <span className="text-muted-foreground italic">Não definido</span>}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => {
                          setDisplayName(profile?.display_name ?? '');
                          setDisplayNameEditing(true);
                        }}
                      >
                        Editar
                      </Button>
                    </div>
                  )}
                </div>

                {/* Account Status */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Status da conta</Label>
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-positive" />
                    <span className="text-sm">Ativa</span>
                  </div>
                </div>

                {/* Member Since */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Membro desde</Label>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{user?.created_at ? new Date(user.created_at).toLocaleDateString('pt-BR') : '—'}</span>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ─── SEGURANÇA TAB ─── */}
          <TabsContent value="seguranca" className="space-y-4">
            {/* Change Password */}
            <div className="glass-card p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Lock className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Alterar Senha</h3>
                  <p className="text-sm text-muted-foreground">Atualize sua senha de acesso</p>
                </div>
              </div>

              <div className="grid gap-4 max-w-md">
                {/* Current Password */}
                <div className="space-y-2">
                  <Label htmlFor="current-password">Senha atual</Label>
                  <div className="relative">
                    <Input
                      id="current-password"
                      type={showCurrentPassword ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    >
                      {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* New Password */}
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nova senha</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  {/* Password rules */}
                  {newPassword.length > 0 && (
                    <div className="space-y-1 mt-2">
                      {passwordRules.map(rule => (
                        <div key={rule.id} className="flex items-center gap-2 text-xs">
                          {rule.test(newPassword) ? (
                            <CheckCircle2 className="h-3 w-3 text-positive" />
                          ) : (
                            <XCircle className="h-3 w-3 text-muted-foreground" />
                          )}
                          <span className={rule.test(newPassword) ? 'text-positive' : 'text-muted-foreground'}>
                            {rule.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Confirm Password */}
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirmar nova senha</Label>
                  <div className="relative">
                    <Input
                      id="confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  {confirmPassword.length > 0 && !passwordsMatch && (
                    <p className="text-xs text-negative flex items-center gap-1">
                      <XCircle className="h-3 w-3" />
                      As senhas não coincidem
                    </p>
                  )}
                  {passwordsMatch && (
                    <p className="text-xs text-positive flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Senhas conferem
                    </p>
                  )}
                </div>

                <Button
                  onClick={handleChangePassword}
                  disabled={!passwordValid || !passwordsMatch || !currentPassword || changePassword.isPending}
                  className="mt-2"
                >
                  {changePassword.isPending ? 'Alterando...' : 'Alterar Senha'}
                </Button>
              </div>
            </div>

            {/* Sessions */}
            <div className="glass-card p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-full bg-chart-2/10 flex items-center justify-center">
                  <LogOut className="h-5 w-5 text-chart-2" />
                </div>
                <div>
                  <h3 className="font-semibold">Sessões e Segurança</h3>
                  <p className="text-sm text-muted-foreground">Gerencie suas sessões ativas</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full bg-positive animate-pulse" />
                    <div>
                      <p className="text-sm font-medium">Sessão atual</p>
                      <p className="text-xs text-muted-foreground">Este dispositivo</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">Ativa</Badge>
                </div>

                <Button
                  variant="outline"
                  onClick={() => signOutOthers.mutate()}
                  disabled={signOutOthers.isPending}
                  className="gap-2"
                >
                  <LogOut className="h-4 w-4" />
                  {signOutOthers.isPending ? 'Encerrando...' : 'Encerrar outras sessões'}
                </Button>

                <p className="text-xs text-muted-foreground">
                  Isso irá desconectar todos os outros dispositivos que estão usando sua conta.
                </p>
              </div>
            </div>

            {/* 2FA Placeholder */}
            <div className="glass-card p-6 opacity-60">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-full bg-warning/10 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <h3 className="font-semibold">Autenticação em dois fatores</h3>
                  <p className="text-sm text-muted-foreground">Adicione uma camada extra de segurança</p>
                </div>
              </div>
              <Badge variant="outline" className="text-xs">Em breve</Badge>
            </div>

            {/* Danger Zone */}
            <div className="glass-card p-6 border-negative/20 bg-negative/[0.02]">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-full bg-negative/10 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-negative" />
                </div>
                <div>
                  <h3 className="font-semibold text-negative">Zona de Perigo</h3>
                  <p className="text-sm text-muted-foreground">Ações irreversíveis</p>
                </div>
              </div>

              <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="gap-2">
                    <Trash2 className="h-4 w-4" />
                    Excluir minha conta
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2 text-negative">
                      <AlertTriangle className="h-5 w-5" />
                      Excluir conta permanentemente
                    </AlertDialogTitle>
                    <AlertDialogDescription className="space-y-3">
                      <p>Esta ação é <strong>irreversível</strong>. Todos os seus dados serão excluídos permanentemente:</p>
                      <ul className="list-disc list-inside text-sm space-y-1">
                        <li>Carteira e posições</li>
                        <li>Histórico de aportes</li>
                        <li>Transações e configurações</li>
                        <li>Modelos de valuation</li>
                      </ul>
                      <p className="font-medium pt-2">Digite seu e-mail para confirmar:</p>
                      <Input
                        value={deleteConfirmEmail}
                        onChange={e => setDeleteConfirmEmail(e.target.value)}
                        placeholder={user?.email}
                        className="font-mono"
                      />
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setDeleteConfirmEmail('')}>Cancelar</AlertDialogCancel>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteAccount}
                      disabled={deleteConfirmEmail.toLowerCase() !== user?.email?.toLowerCase() || deleteAccount.isPending}
                    >
                      {deleteAccount.isPending ? 'Excluindo...' : 'Excluir permanentemente'}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <p className="text-xs text-muted-foreground mt-3">
                Ao excluir sua conta, todos os dados serão permanentemente removidos e não poderão ser recuperados.
              </p>
            </div>
          </TabsContent>

          {/* ─── PREFERÊNCIAS TAB ─── */}
          <TabsContent value="preferencias" className="space-y-4">
            {/* Class Targets */}
            <div className="glass-card overflow-hidden">
              <div className="p-4 border-b border-border/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-3.5 w-3.5 text-primary" />
                  <h3 className="section-title">Metas por Classe (%)</h3>
                </div>
                <span
                  className={cn(
                    'text-xs font-mono font-medium px-2 py-0.5 rounded',
                    targetSumOk ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative'
                  )}
                >
                  Soma: {targetSum.toFixed(1)}%{!targetSumOk && ' ≠ 100%'}
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border/30">
                    <TableHead className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Classe</TableHead>
                    <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">% Alvo</TableHead>
                    <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Banda Inferior</TableHead>
                    <TableHead className="text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Banda Superior</TableHead>
                    <TableHead className="w-14" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {classes.map(cls => {
                    const vals = getTargetValues(cls.id);
                    return (
                      <TableRow key={cls.id} className="data-row">
                        <TableCell className="font-medium text-sm">{cls.name}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={vals.target}
                            onChange={e => updateField(cls.id, 'target', e.target.value)}
                            className="w-20 ml-auto font-mono h-8 text-right text-sm"
                            step="1"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={vals.lower}
                            onChange={e => updateField(cls.id, 'lower', e.target.value)}
                            className="w-20 ml-auto font-mono h-8 text-right text-sm"
                            step="1"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={vals.upper}
                            onChange={e => updateField(cls.id, 'upper', e.target.value)}
                            className="w-20 ml-auto font-mono h-8 text-right text-sm"
                            step="1"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => saveTarget(cls.id)}
                          >
                            <Save className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Backup */}
            <div className="glass-card p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-full bg-chart-2/10 flex items-center justify-center">
                  <Database className="h-5 w-5 text-chart-2" />
                </div>
                <div>
                  <h3 className="font-semibold">Backup & Restauração</h3>
                  <p className="text-sm text-muted-foreground">Exporte ou importe seus dados</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="gap-2 text-sm" onClick={handleExport}>
                  <Download className="h-4 w-4" /> Exportar (JSON)
                </Button>
                <Button variant="outline" className="gap-2 text-sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Importar
                </Button>
                <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
              </div>
            </div>
          </TabsContent>

          {/* ─── ADMIN TAB ─── */}
          {isAdmin && (
            <TabsContent value="admin" className="space-y-6">
              <div className="glass-card p-6 border-primary/20 bg-primary/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Shield className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Painel Administrativo</h3>
                    <p className="text-sm text-muted-foreground">Visão geral do sistema e gestão de usuários</p>
                  </div>
                  <Badge className="ml-auto bg-primary/10 text-primary border-primary/20">Admin</Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Usuários Totais', value: adminMetrics?.total_users ?? '—', icon: Users, color: 'text-primary' },
                  { label: 'Usuários Ativos', value: adminMetrics?.active_users ?? '—', icon: Activity, color: 'text-positive' },
                  { label: 'Com Carteiras', value: adminMetrics?.users_with_portfolios ?? '—', icon: CreditCard, color: 'text-chart-2' },
                  { label: 'Atividade Recente', value: adminMetrics?.recent_activity ?? '—', icon: Clock, color: 'text-chart-4' },
                ].map(metric => (
                  <div key={metric.label} className="glass-card p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <metric.icon className={cn('h-4 w-4', metric.color)} />
                    </div>
                    <p className="text-2xl font-bold font-mono mb-1">{metric.value}</p>
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">{metric.label}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Ativos', value: adminMetrics?.total_assets ?? '—', icon: Database },
                  { label: 'Aportes', value: adminMetrics?.total_contributions ?? '—', icon: BarChart3 },
                  { label: 'Posições', value: adminMetrics?.total_positions ?? '—', icon: TrendingUp },
                ].map(m => (
                  <div key={m.label} className="glass-card p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <m.icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">{m.label}</span>
                    </div>
                    <p className="text-xl font-bold font-mono">{m.value}</p>
                  </div>
                ))}
              </div>

              {/* Users Management */}
              <div className="glass-card overflow-hidden">
                <div className="p-4 border-b border-border/30">
                  <div className="flex items-center gap-2 mb-4">
                    <Users className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold">Gestão de Usuários</h3>
                  </div>
                  <div className="relative max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Buscar por e-mail ou nome..." value={adminUsersSearch} onChange={(e) => { setAdminUsersSearch(e.target.value); setAdminUsersPage(1); }} className="pl-10 h-9" />
                  </div>
                </div>
                {adminUsersData?.users && (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-b border-border/30">
                            <TableHead className="text-xs font-medium text-muted-foreground uppercase">E-mail</TableHead>
                            <TableHead className="text-xs font-medium text-muted-foreground uppercase">Nome</TableHead>
                            <TableHead className="text-xs font-medium text-muted-foreground uppercase">Cadastro</TableHead>
                            <TableHead className="text-xs font-medium text-muted-foreground uppercase">Status</TableHead>
                            <TableHead className="text-xs font-medium text-muted-foreground uppercase">Ativos</TableHead>
                            <TableHead className="text-xs font-medium text-muted-foreground uppercase">Aportes</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {adminUsersData.users.map(u => (
                            <TableRow key={u.id} className="data-row hover:bg-muted/30">
                              <TableCell className="font-mono text-sm">{u.email}</TableCell>
                              <TableCell className="text-sm">{u.display_name || '—'}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{new Date(u.created_at).toLocaleDateString('pt-BR')}</TableCell>
                              <TableCell><Badge variant={u.status === 'Ativo' ? 'default' : 'secondary'} className="text-xs">{u.status}</Badge></TableCell>
                              <TableCell className="text-sm font-mono">{u.assets_count}</TableCell>
                              <TableCell className="text-sm font-mono">{u.contributions_count}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {adminUsersData.pagination.pages > 1 && (
                      <div className="p-4 border-t border-border/30 flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Página {adminUsersData.pagination.page} de {adminUsersData.pagination.pages} ({adminUsersData.pagination.total} usuários)</span>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setAdminUsersPage(p => Math.max(1, p - 1))} disabled={adminUsersData.pagination.page === 1}><ChevronLeft className="h-4 w-4" /></Button>
                          <Button variant="outline" size="sm" onClick={() => setAdminUsersPage(p => p + 1)} disabled={adminUsersData.pagination.page >= adminUsersData.pagination.pages}><ChevronRight className="h-4 w-4" /></Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Activity Log */}
              <div className="glass-card overflow-hidden">
                <div className="p-4 border-b border-border/30">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold">Log de Atividades</h3>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {['all', 'login', 'security', 'backup', 'system'].map(f => (
                      <Button key={f} variant={adminActivityFilter === f ? 'default' : 'ghost'} size="sm" onClick={() => { setAdminActivityFilter(f); setAdminActivityPage(1); }} className="text-xs">
                        {f === 'all' ? 'Todas' : f === 'login' ? 'Logins' : f === 'security' ? 'Segurança' : f === 'backup' ? 'Backups' : 'Sistema'}
                      </Button>
                    ))}
                  </div>
                </div>
                {adminActivityData?.logs ? (
                  <div className="divide-y divide-border/30">
                    {adminActivityData.logs.length === 0 ? (
                      <div className="p-8 text-center">
                        <Activity className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">Nenhuma atividade registrada</p>
                      </div>
                    ) : adminActivityData.logs.map(log => (
                      <div key={log.id} className="p-4 hover:bg-muted/20 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium">{log.action}</span>
                              <Badge variant="outline" className="text-xs font-mono">{log.user_email}</Badge>
                            </div>
                            {log.details && <p className="text-sm text-muted-foreground">{log.details}</p>}
                            <p className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: ptBR })}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center"><p className="text-sm text-muted-foreground">Carregando...</p></div>
                )}
              </div>

              {/* Recent Users */}
              {adminMetrics?.recent_users && adminMetrics.recent_users.length > 0 && (
                <div className="glass-card p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <h4 className="text-sm font-medium">Últimos Cadastros</h4>
                  </div>
                  <div className="space-y-2">
                    {adminMetrics.recent_users.slice(0, 5).map(u => (
                      <div key={u.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/20">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center"><User className="h-3 w-3 text-primary" /></div>
                          <span className="text-sm font-mono">{u.email}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(u.created_at), { addSuffix: true, locale: ptBR })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      </motion.div>
    </motion.div>
  );
};

export default Settings;
