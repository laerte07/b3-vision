import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface CorrEntry {
  id: string;
  item_a: string;
  item_b: string;
  corr_value: number;
  note: string | null;
}

const Correlation = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ a: '', b: '', value: '0', note: '' });

  const { data: correlations = [] } = useQuery({
    queryKey: ['correlations', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from('correlation_matrix').select('*').eq('user_id', user!.id).order('created_at');
      if (error) throw error;
      return (data ?? []).map(d => ({ ...d, corr_value: Number(d.corr_value) })) as CorrEntry[];
    },
  });

  const addCorr = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('correlation_matrix').upsert({
        user_id: user!.id,
        item_a: form.a.toUpperCase(),
        item_b: form.b.toUpperCase(),
        corr_value: Number(form.value),
        note: form.note || null,
      }, { onConflict: 'user_id,item_a,item_b' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['correlations'] });
      setOpen(false);
      setForm({ a: '', b: '', value: '0', note: '' });
      toast.success('Correlação salva');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const delCorr = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('correlation_matrix').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['correlations'] });
      toast.success('Removido');
    },
  });

  const positive = correlations.filter(c => c.corr_value >= 0);
  const negative = correlations.filter(c => c.corr_value < 0);

  const renderTable = (items: CorrEntry[], title: string) => (
    <Card className="overflow-hidden">
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold">Ativo A</TableHead>
              <TableHead className="font-semibold">Ativo B</TableHead>
              <TableHead className="text-right font-semibold">Correlação</TableHead>
              <TableHead className="font-semibold">Nota</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Nenhuma entrada</TableCell></TableRow>
            ) : items.map(c => (
              <TableRow key={c.id} className="hover:bg-muted/30">
                <TableCell className="font-mono font-semibold text-primary">{c.item_a}</TableCell>
                <TableCell className="font-mono font-semibold text-primary">{c.item_b}</TableCell>
                <TableCell className="text-right font-mono font-medium">
                  <span className={c.corr_value > 0.5 ? 'text-negative' : c.corr_value < 0 ? 'text-positive' : 'text-muted-foreground'}>
                    {c.corr_value > 0 ? '+' : ''}{c.corr_value.toFixed(2)}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.note || '—'}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => delCorr.mutate(c.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Correlação & Diversificação</h1>
          <p className="text-sm text-muted-foreground">Análise de correlação entre ativos da carteira</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> Adicionar</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova Correlação</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Ativo A</Label><Input value={form.a} onChange={e => setForm({ ...form, a: e.target.value })} className="font-mono" placeholder="ITSA4" /></div>
                <div className="space-y-1"><Label className="text-xs">Ativo B</Label><Input value={form.b} onChange={e => setForm({ ...form, b: e.target.value })} className="font-mono" placeholder="BBSE3" /></div>
              </div>
              <div className="space-y-1"><Label className="text-xs">Correlação (-1 a +1)</Label><Input type="number" step="0.01" min="-1" max="1" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} className="font-mono" /></div>
              <div className="space-y-1"><Label className="text-xs">Nota estratégica</Label><Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Ex: Ambos setor financeiro" /></div>
              <Button className="w-full" onClick={() => addCorr.mutate()} disabled={!form.a || !form.b || addCorr.isPending}>{addCorr.isPending ? 'Salvando...' : 'Salvar'}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {renderTable(positive, 'Correlação Positiva')}
      {renderTable(negative, 'Correlação Negativa')}

      <p className="text-xs text-muted-foreground">* Valores manuais. Cálculo automático por histórico será implementado quando houver API de dados históricos.</p>
    </div>
  );
};

export default Correlation;
