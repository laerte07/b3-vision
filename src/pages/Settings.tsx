import { useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Upload, Shield, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAssetClasses } from '@/hooks/useAssetClasses';
import { useClassTargets, useUpsertClassTarget } from '@/hooks/useClassTargets';
import { toast } from 'sonner';

const Settings = () => {
  const { user } = useAuth();
  const { data: classes = [] } = useAssetClasses();
  const { data: targets = [] } = useClassTargets();
  const upsertTarget = useUpsertClassTarget();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editTargets, setEditTargets] = useState<Record<string, { target: string; lower: string; upper: string }>>({});

  const getTargetValues = (classId: string) => {
    if (editTargets[classId]) return editTargets[classId];
    const existing = targets.find(t => t.class_id === classId);
    return { target: String(existing?.target_percent ?? 0), lower: String(existing?.lower_band ?? 0), upper: String(existing?.upper_band ?? 0) };
  };

  const updateField = (classId: string, field: 'target' | 'lower' | 'upper', value: string) => {
    const current = getTargetValues(classId);
    setEditTargets(prev => ({ ...prev, [classId]: { ...current, [field]: value } }));
  };

  const saveTarget = (classId: string) => {
    const vals = getTargetValues(classId);
    upsertTarget.mutate({ class_id: classId, target_percent: Number(vals.target), lower_band: Number(vals.lower), upper_band: Number(vals.upper) });
  };

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
      version: '1.0', exported_at: new Date().toISOString(),
      assets: assets.data ?? [], positions: positions.data ?? [],
      class_targets: classTargets.data ?? [], valuation_models: valuationModels.data ?? [],
      correlation_matrix: correlations.data ?? [],
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `fortuna-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
    toast.success('Backup exportado');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      if (!backup.version || !backup.assets) { toast.error('Arquivo inválido'); return; }
      let created = 0, updated = 0;
      for (const asset of backup.assets) {
        const { data: existing } = await supabase.from('assets').select('id').eq('user_id', user.id).eq('ticker', asset.ticker).maybeSingle();
        if (existing) {
          await supabase.from('assets').update({ name: asset.name, class_id: asset.class_id, active: asset.active }).eq('id', existing.id);
          updated++;
          const pos = backup.positions?.find((p: any) => p.asset_id === asset.id);
          if (pos) await supabase.from('positions').upsert({ user_id: user.id, asset_id: existing.id, quantity: pos.quantity, avg_price: pos.avg_price }, { onConflict: 'id' });
        } else {
          const { data: newAsset } = await supabase.from('assets').insert({ user_id: user.id, ticker: asset.ticker, name: asset.name, class_id: asset.class_id, active: asset.active ?? true }).select('id').single();
          created++;
          if (newAsset) {
            const pos = backup.positions?.find((p: any) => p.asset_id === asset.id);
            if (pos) await supabase.from('positions').insert({ user_id: user.id, asset_id: newAsset.id, quantity: pos.quantity, avg_price: pos.avg_price });
          }
        }
      }
      for (const ct of (backup.class_targets ?? [])) {
        await supabase.from('class_targets').upsert({ user_id: user.id, class_id: ct.class_id, target_percent: ct.target_percent, lower_band: ct.lower_band, upper_band: ct.upper_band }, { onConflict: 'user_id,class_id' });
      }
      toast.success(`Importação: ${created} criados, ${updated} atualizados`);
      window.location.reload();
    } catch (err) { toast.error('Erro: ' + (err as Error).message); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Calculate sum of all target percents for validation
  const targetSum = classes.reduce((sum, cls) => {
    const vals = getTargetValues(cls.id);
    return sum + Number(vals.target);
  }, 0);
  const targetSumOk = Math.abs(targetSum - 100) < 0.01;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <p className="kpi-label mb-1">Parâmetros</p>
        <h1 className="text-xl font-semibold tracking-tight">Configurações</h1>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b border-border/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-primary" />
            <h3 className="section-title">Metas por Classe (%)</h3>
          </div>
          <span className={cn(
            'text-xs font-mono font-medium px-2 py-0.5 rounded',
            targetSumOk ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative'
          )}>
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
                  <TableCell className="text-right"><Input type="number" value={vals.target} onChange={e => updateField(cls.id, 'target', e.target.value)} className="w-20 ml-auto font-mono h-8 text-right text-sm" step="1" /></TableCell>
                  <TableCell className="text-right"><Input type="number" value={vals.lower} onChange={e => updateField(cls.id, 'lower', e.target.value)} className="w-20 ml-auto font-mono h-8 text-right text-sm" step="1" /></TableCell>
                  <TableCell className="text-right"><Input type="number" value={vals.upper} onChange={e => updateField(cls.id, 'upper', e.target.value)} className="w-20 ml-auto font-mono h-8 text-right text-sm" step="1" /></TableCell>
                  <TableCell><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => saveTarget(cls.id)}><Save className="h-3.5 w-3.5" /></Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="glass-card p-5">
        <h3 className="section-title mb-4">Backup & Restauração</h3>
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
    </div>
  );
};

export default Settings;
