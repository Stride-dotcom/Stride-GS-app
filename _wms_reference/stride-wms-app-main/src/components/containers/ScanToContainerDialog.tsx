import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { HelpTip } from '@/components/ui/help-tip';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { supabase } from '@/integrations/supabase/client';
import { useContainerActions } from '@/hooks/useContainerActions';
import { useToast } from '@/hooks/use-toast';

interface ScannedUnit {
  id: string;
  ic_code: string;
  status: string;
  class: string | null;
  location_id: string;
  container_id: string | null;
  added: boolean;
}

interface ScanToContainerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  containerId: string;
  containerCode: string;
  onSuccess: () => void;
}

export function ScanToContainerDialog({
  open,
  onOpenChange,
  containerId,
  containerCode,
  onSuccess,
}: ScanToContainerDialogProps) {
  const [scanInput, setScanInput] = useState('');
  const [scannedUnits, setScannedUnits] = useState<ScannedUnit[]>([]);
  const [scanning, setScanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addUnitToContainer, loading: actionLoading } = useContainerActions();
  const { toast } = useToast();

  const handleScan = useCallback(async () => {
    const code = scanInput.trim();
    if (!code) return;

    // Check if already scanned
    if (scannedUnits.some((u) => u.ic_code === code)) {
      toast({
        variant: 'destructive',
        title: 'Already Scanned',
        description: `${code} is already in the scan list.`,
      });
      setScanInput('');
      inputRef.current?.focus();
      return;
    }

    setScanning(true);
    try {
      // Look up the unit by ic_code
      const { data, error } = await supabase
        .from('inventory_units')
        .select('id, ic_code, status, class, location_id, container_id')
        .eq('ic_code', code)
        .single();

      if (error || !data) {
        toast({
          variant: 'destructive',
          title: 'Unit Not Found',
          description: `No inventory unit found with code "${code}".`,
        });
        setScanInput('');
        inputRef.current?.focus();
        return;
      }

      if (data.container_id === containerId) {
        toast({
          title: 'Already in Container',
          description: `${code} is already in ${containerCode}.`,
        });
        setScanInput('');
        inputRef.current?.focus();
        return;
      }

      // Add to container via RPC
      const result = await addUnitToContainer(data.id, containerId);

      setScannedUnits((prev) => [
        ...prev,
        {
          ...data,
          added: !!result,
        },
      ]);

      setScanInput('');
      inputRef.current?.focus();
    } catch (error) {
      console.error('Scan error:', error);
      toast({
        variant: 'destructive',
        title: 'Scan Error',
        description: 'Failed to process scanned unit.',
      });
    } finally {
      setScanning(false);
    }
  }, [scanInput, containerId, containerCode, scannedUnits, addUnitToContainer, toast]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleScan();
    }
  };

  const handleClose = () => {
    if (scannedUnits.some((u) => u.added)) {
      onSuccess();
    }
    setScannedUnits([]);
    setScanInput('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            <HelpTip
              tooltip="Scan or type IC codes to add inventory units into this container. Units will be moved to the container's location automatically."
              pageKey="containers.scan_to_container_dialog"
              fieldKey="scan_units"
            >
              Scan to Container
            </HelpTip>
          </DialogTitle>
          <DialogDescription>
            Adding units to <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">{containerCode}</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Scan Input */}
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              placeholder="Scan or type IC code..."
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDown}
              disabled={scanning || actionLoading}
              className="font-mono flex-1"
              autoFocus
            />
            <Button
              onClick={handleScan}
              disabled={!scanInput.trim() || scanning || actionLoading}
            >
              {scanning ? (
                <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
              ) : (
                <MaterialIcon name="qr_code_scanner" size="sm" />
              )}
              <span className="ml-2">Add</span>
            </Button>
          </div>

          {/* Scanned Units List */}
          {scannedUnits.length > 0 && (
            <div className="rounded-md border max-h-[300px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>IC Code</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead className="w-[70px]">Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scannedUnits.map((unit) => (
                    <TableRow key={unit.id}>
                      <TableCell className="font-mono text-sm">{unit.ic_code}</TableCell>
                      <TableCell>
                        <StatusIndicator status={unit.status} size="sm" />
                      </TableCell>
                      <TableCell>{unit.class || '—'}</TableCell>
                      <TableCell>
                        {unit.added ? (
                          <Badge className="bg-green-600 text-white">Added</Badge>
                        ) : (
                          <Badge variant="destructive">Failed</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {scannedUnits.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {scannedUnits.filter((u) => u.added).length} of {scannedUnits.length} units added successfully.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
