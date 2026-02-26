import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Download, Upload, Shield } from 'lucide-react';

const Settings = () => (
  <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
      <p className="text-sm text-muted-foreground">Parâmetros globais e backup de dados</p>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Limites de Concentração
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Concentração máxima por ativo (%)</Label>
            <Input type="number" defaultValue={15} className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Concentração máxima por classe (%)</Label>
            <Input type="number" defaultValue={50} className="font-mono" />
          </div>
          <Button variant="outline" className="w-full">Salvar Limites</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Fonte de Dados</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">API preferencial</Label>
            <Input defaultValue="brapi.dev" disabled className="font-mono" />
            <p className="text-[11px] text-muted-foreground">Dados B3 via brapi.dev (ações, FIIs, ETFs)</p>
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader><CardTitle className="text-base">Backup & Restauração</CardTitle></CardHeader>
        <CardContent className="flex gap-3">
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" /> Exportar Backup (JSON)
          </Button>
          <Button variant="outline" className="gap-2">
            <Upload className="h-4 w-4" /> Importar Backup
          </Button>
        </CardContent>
      </Card>
    </div>
  </div>
);

export default Settings;
