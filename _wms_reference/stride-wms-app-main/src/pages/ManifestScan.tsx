import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { QRScanner } from '@/components/scan/QRScanner';
import { useManifestScan, ManifestScanResult } from '@/hooks/useManifests';
import { useManifests } from '@/hooks/useManifests';
import { useLocations } from '@/hooks/useLocations';
import { supabase } from '@/integrations/supabase/client';
import {
  hapticLight,
  hapticMedium,
  hapticSuccess,
  hapticError,
} from '@/lib/haptics';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn, isValidUuid } from '@/lib/utils';
import { format } from 'date-fns';
import { parseScanPayload } from '@/lib/scan/parseScanPayload';
import { useItemWorkflowScanMode } from '@/lib/scan/modes/useItemWorkflowScanMode';

const scanResultConfig: Record<ManifestScanResult, {
  color: string;
  bgColor: string;
  icon: string;
  label: string;
  isError: boolean;
}> = {
  valid: {
    color: 'text-green-400',
    bgColor: 'bg-green-500/20 border-green-500/30',
    icon: 'check_circle',
    label: 'Valid',
    isError: false,
  },
  not_on_manifest: {
    color: 'text-red-400',
    bgColor: 'bg-red-500/20 border-red-500/30',
    icon: 'block',
    label: 'NOT ON MANIFEST',
    isError: true,
  },
  duplicate: {
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20 border-yellow-500/30',
    icon: 'refresh',
    label: 'Already Scanned',
    isError: true,
  },
  wrong_location: {
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20 border-orange-500/30',
    icon: 'warning',
    label: 'Wrong Location',
    isError: false,
  },
  item_not_found: {
    color: 'text-red-400',
    bgColor: 'bg-red-500/20 border-red-500/30',
    icon: 'cancel',
    label: 'Not Found',
    isError: true,
  },
};

interface LastScanResult {
  itemCode: string;
  result: ManifestScanResult;
  message: string;
  isError: boolean;
}

export default function ManifestScan() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [lastScan, setLastScan] = useState<LastScanResult | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualItemCode, setManualItemCode] = useState('');
  const [viewMode, setViewMode] = useState<'scan' | 'list'>('scan');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmComplete, setConfirmComplete] = useState(false);

  const lastScanTimeoutRef = useRef<NodeJS.Timeout>();
  const errorFlashRef = useRef<NodeJS.Timeout>();

  const {
    manifest,
    items,
    scans,
    stats,
    loading,
    recordScan,
    refetch,
  } = useManifestScan(id || '');

  const { completeManifest } = useManifests();
  const { locations } = useLocations(manifest?.warehouse_id);
  const isActive = manifest?.status === 'active' || manifest?.status === 'in_progress';

  // Filter locations to only those in the manifest zone
  const manifestLocations = manifest?.location_ids
    ? locations.filter(l => (manifest.location_ids as string[]).includes(l.id))
    : locations;

  // Auto-select first location if none selected
  useEffect(() => {
    if (!activeLocationId && manifestLocations.length > 0) {
      setActiveLocationId(manifestLocations[0].id);
    }
  }, [activeLocationId, manifestLocations]);

  // Clear last scan after delay (longer for errors)
  useEffect(() => {
    if (lastScan) {
      const delay = lastScan.isError ? 5000 : 3000;
      lastScanTimeoutRef.current = setTimeout(() => {
        setLastScan(null);
      }, delay);

      return () => {
        if (lastScanTimeoutRef.current) {
          clearTimeout(lastScanTimeoutRef.current);
        }
      };
    }
  }, [lastScan]);

  // Play audio feedback
  const playAudio = useCallback((type: 'success' | 'error') => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      if (type === 'success') {
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(1000, audioContext.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
      } else {
        // Error sound - two low tones
        oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.15);

        setTimeout(() => {
          const osc2 = audioContext.createOscillator();
          const gain2 = audioContext.createGain();
          osc2.connect(gain2);
          gain2.connect(audioContext.destination);
          osc2.frequency.setValueAtTime(150, audioContext.currentTime);
          gain2.gain.setValueAtTime(0.5, audioContext.currentTime);
          osc2.start(audioContext.currentTime);
          osc2.stop(audioContext.currentTime + 0.3);
        }, 200);
      }
    } catch (error) {
      console.error('Audio playback error:', error);
    }
  }, []);

  const flashScanError = useCallback(() => {
    document.body.classList.add('error-flash');
    if (errorFlashRef.current) clearTimeout(errorFlashRef.current);
    errorFlashRef.current = setTimeout(() => {
      document.body.classList.remove('error-flash');
    }, 500);
  }, []);

  const getBlockingReason = useCallback((result: ManifestScanResult): string => {
    if (result === 'not_on_manifest') return 'ITEM NOT ON MANIFEST';
    if (result === 'duplicate') return 'DUPLICATE SCAN';
    if (result === 'wrong_location') return 'WRONG LOCATION';
    return 'ITEM NOT FOUND';
  }, []);

  const manifestScanEngine = useItemWorkflowScanMode({
    enabled: !!activeLocationId && isActive,
    processing,
    setProcessing,
    allowedTypes: ['item', 'unknown'],
    onBlockedType: async (event, controls) => {
      const code = (event.code || event.raw).trim();
      setLastScan({
        itemCode: code,
        result: 'item_not_found',
        message: 'This is a non-item barcode. Please scan an item barcode/QR code.',
        isError: true,
      });
      hapticError();
      playAudio('error');
      flashScanError();
      controls.block({
        title: 'SCAN ERROR',
        reason: 'WRONG BARCODE TYPE',
        code,
      });
      return true;
    },
    onScan: async (event, controls) => {
      if (!activeLocationId || !manifest) return;

      const trimmed = event.raw.trim();
      if (!trimmed) return;
      hapticLight();

      const payload = parseScanPayload(trimmed);
      const displayCode = (payload?.code || payload?.id || trimmed).trim();

      if (payload?.type === 'location' || payload?.type === 'container') {
        setLastScan({
          itemCode: displayCode,
          result: 'item_not_found',
          message: 'This is a non-item barcode. Please scan an item barcode/QR code.',
          isError: true,
        });
        hapticError();
        playAudio('error');
        flashScanError();
        controls.block({
          title: 'SCAN ERROR',
          reason: 'WRONG BARCODE TYPE',
          code: displayCode,
        });
        return;
      }

      const codeCandidate = (payload?.code || payload?.id || trimmed).trim();
      const idCandidate =
        (payload?.type === 'item' && payload.id && isValidUuid(payload.id))
          ? payload.id
          : ((payload?.type === 'unknown' || payload?.type === 'item') && isValidUuid(codeCandidate))
            ? codeCandidate
            : null;

      let query = supabase
        .from('items')
        .select('id, item_code')
        .eq('tenant_id', manifest.tenant_id);

      if (idCandidate) {
        query = query.eq('id', idCandidate);
      } else {
        query = query.eq('item_code', codeCandidate);
      }

      const { data: item } = await query.maybeSingle();
      if (!item?.id) {
        setLastScan({
          itemCode: displayCode,
          result: 'item_not_found',
          message: 'Item not found in system',
          isError: true,
        });
        hapticError();
        playAudio('error');
        flashScanError();
        controls.block({
          title: 'SCAN ERROR',
          reason: 'ITEM NOT FOUND',
          code: displayCode,
        });
        return;
      }

      const itemCode = item.item_code || codeCandidate;
      const result = await recordScan(activeLocationId, item.id, itemCode);
      const shouldBlock = result.result !== 'valid';

      setLastScan({
        itemCode,
        result: result.result,
        message: result.message,
        isError: shouldBlock || result.triggerErrorFeedback,
      });

      if (shouldBlock || result.triggerErrorFeedback) {
        hapticError();
        playAudio('error');
        flashScanError();
        controls.block({
          title: 'SCAN ERROR',
          reason: getBlockingReason(result.result),
          code: itemCode,
        });
        return;
      }

      hapticSuccess();
      playAudio('success');
    },
    onUnexpectedError: (error, raw) => {
      console.error('Scan error:', error);
      const code = raw.trim();
      setLastScan({
        itemCode: code,
        result: 'item_not_found',
        message: error instanceof Error ? error.message : 'Failed to process scan',
        isError: true,
      });
      hapticError();
      playAudio('error');
      flashScanError();
    },
  });

  useEffect(() => {
    if (!activeLocationId || !isActive) {
      manifestScanEngine.reset();
    }
  }, [activeLocationId, isActive, manifestScanEngine.reset]);

  // Handle manual entry
  const handleManualEntry = () => {
    if (!manualItemCode.trim()) return;
    manifestScanEngine.onScan(manualItemCode.trim());
    setManualItemCode('');
    setShowManualEntry(false);
  };

  // Handle complete
  const handleComplete = async () => {
    await completeManifest(id!);
    setConfirmComplete(false);
    navigate(`/manifests/${id}`);
  };

  // Filter items for list view
  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(
      i => i.item_code.toLowerCase().includes(query) ||
           i.item_description?.toLowerCase().includes(query)
    );
  }, [items, searchQuery]);

  // Progress calculation
  const progressPercent = stats?.progress_percent || 0;
  const scannedCount = manifest?.scanned_item_count || 0;
  const totalCount = manifest?.expected_item_count || 0;
  const remainingCount = totalCount - scannedCount;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (!manifest) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <MaterialIcon name="warning" size="xl" className="mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Manifest not found</h2>
          <Button variant="link" onClick={() => navigate('/manifests')}>
            Back to Manifests
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {/* Add error flash CSS */}
      <style>{`
        .error-flash {
          animation: error-flash 0.5s ease-out;
        }
        @keyframes error-flash {
          0%, 100% { background-color: transparent; }
          50% { background-color: rgba(239, 68, 68, 0.3); }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/manifests/${id}`)}>
          <MaterialIcon name="arrow_back" size="sm" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{manifest.name}</h1>
          <p className="text-sm text-muted-foreground font-mono">{manifest.manifest_number}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={viewMode === 'scan' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('scan')}
          >
            <MaterialIcon name="qr_code_scanner" size="sm" className="mr-1" />
            Scan
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('list')}
          >
            <MaterialIcon name="list" size="sm" className="mr-1" />
            List
          </Button>
        </div>
      </div>

      {/* Progress Card */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex gap-6">
              <div>
                <span className="text-sm text-muted-foreground">Scanned</span>
                <p className="text-2xl font-bold text-green-400">{scannedCount}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Remaining</span>
                <p className="text-2xl font-bold text-yellow-400">{remainingCount}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Total</span>
                <p className="text-2xl font-bold">{totalCount}</p>
              </div>
            </div>
            {isActive && (
              <Button onClick={() => setConfirmComplete(true)}>
                <MaterialIcon name="check_circle" size="sm" className="mr-2" />
                Complete
              </Button>
            )}
          </div>
          <Progress value={progressPercent} className="h-3" />
          <p className="text-sm text-muted-foreground mt-1 text-right">{progressPercent}% complete</p>
        </CardContent>
      </Card>

      {viewMode === 'scan' ? (
        <>
          {/* Location Selector */}
          <Card className="mb-4">
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <MaterialIcon name="location_on" size="md" className="text-muted-foreground" />
                <div className="flex-1">
                  <label className="text-sm font-medium">Current Location</label>
                  <Select
                    value={activeLocationId || ''}
                    onValueChange={setActiveLocationId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      {manifestLocations.map((loc) => (
                        <SelectItem key={loc.id} value={loc.id}>
                          {loc.code} {loc.name && `- ${loc.name}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Last Scan Feedback */}
          {lastScan && (
            <Card
              className={cn(
                'mb-4 border-2 transition-all',
                scanResultConfig[lastScan.result]?.bgColor,
                lastScan.isError && 'animate-pulse'
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {(() => {
                    const config = scanResultConfig[lastScan.result];
                    const iconName = config?.icon || 'warning';
                    return (
                      <MaterialIcon name={iconName} size="lg" className={cn(config?.color || 'text-muted-foreground')} />
                    );
                  })()}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-lg">{lastScan.itemCode}</span>
                      <Badge className={scanResultConfig[lastScan.result]?.bgColor}>
                        {scanResultConfig[lastScan.result]?.label}
                      </Badge>
                    </div>
                    <p className={cn(
                      'text-sm mt-1',
                      lastScan.isError ? 'text-red-400 font-semibold' : 'text-muted-foreground'
                    )}>
                      {lastScan.message}
                    </p>
                    {lastScan.isError && lastScan.result === 'not_on_manifest' && (
                      <p className="text-red-400 font-bold mt-2 text-lg">
                        THIS ITEM IS NOT ON THE MANIFEST!
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Scanner */}
          <Card className="mb-4">
            <CardContent className="p-4">
              {!showManualEntry ? (
                <div className="space-y-4">
                  {activeLocationId && isActive && (
                    <QRScanner
                      onScan={manifestScanEngine.onScan}
                      paused={manifestScanEngine.isOverlayBlocked}
                      blockingOverlay={
                        manifestScanEngine.overlay
                          ? {
                              open: true,
                              title: manifestScanEngine.overlay.title,
                              reason: manifestScanEngine.overlay.reason,
                              code: manifestScanEngine.overlay.code,
                              hint: 'Tap to dismiss',
                              dismissLabel: 'Dismiss / Continue Scanning',
                              onDismiss: manifestScanEngine.dismissOverlay,
                            }
                          : null
                      }
                    />
                  )}
                  {(!activeLocationId || !isActive) && (
                    <div className="flex items-center justify-center h-64 bg-muted rounded-lg">
                      <p className="text-muted-foreground">
                        {!activeLocationId ? 'Select a location to start scanning' :
                         'Manifest is not active'}
                      </p>
                    </div>
                  )}
                  <div className="flex justify-center">
                    <Button
                      variant="outline"
                      onClick={() => setShowManualEntry(true)}
                      disabled={!activeLocationId || !isActive}
                    >
                      <MaterialIcon name="keyboard" size="sm" className="mr-2" />
                      Manual Entry
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter item code"
                      value={manualItemCode}
                      onChange={(e) => setManualItemCode(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleManualEntry()}
                      autoFocus
                      className="font-mono"
                    />
                    <Button onClick={handleManualEntry} disabled={processing || !isActive}>
                      {processing ? (
                        <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                      ) : (
                        <MaterialIcon name="check_circle" size="sm" />
                      )}
                    </Button>
                  </div>
                  <div className="flex justify-center">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowManualEntry(false);
                        setManualItemCode('');
                      }}
                    >
                      <MaterialIcon name="qr_code_scanner" size="sm" className="mr-2" />
                      Use Scanner
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Scans */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-medium mb-3 flex items-center gap-2">
                <MaterialIcon name="schedule" size="sm" />
                Recent Scans
              </h3>
              {scans.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No scans yet. Start scanning items.
                </p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {scans.slice(0, 10).map((scan) => {
                    const config = scanResultConfig[scan.scan_result as ManifestScanResult];
                    const iconName = config?.icon || 'warning';
                    return (
                      <div
                        key={scan.id}
                        className={cn(
                          'flex items-center gap-3 p-2 rounded border',
                          config?.bgColor
                        )}
                      >
                        <MaterialIcon name={iconName} size="sm" className={cn(config?.color)} />
                        <span className="font-mono flex-1">{scan.item_code}</span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(scan.scanned_at), 'h:mm a')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        /* List View */
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-4 mb-4">
              <div className="relative flex-1">
                <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search items..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button variant="outline" size="icon" onClick={() => refetch()}>
                <MaterialIcon name="refresh" size="sm" />
              </Button>
            </div>

            {filteredItems.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">No items found</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Item Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Location</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          {item.scanned ? (
                            <Badge className="bg-green-500/20 text-green-400">
                              <MaterialIcon name="check_circle" size="sm" className="mr-1" />
                              Scanned
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              <MaterialIcon name="schedule" size="sm" className="mr-1" />
                              Pending
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono font-medium">
                          {item.item_code}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {item.item_description || '-'}
                        </TableCell>
                        <TableCell>
                          {item.expected_location?.code || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Complete Confirmation */}
      <AlertDialog open={confirmComplete} onOpenChange={setConfirmComplete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete Manifest?</AlertDialogTitle>
            <AlertDialogDescription>
              {remainingCount > 0 ? (
                <>
                  There are still <strong>{remainingCount} items</strong> that haven't been scanned.
                  Are you sure you want to complete this manifest?
                </>
              ) : (
                'All items have been scanned. Complete this manifest?'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleComplete}>
              Complete Manifest
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
