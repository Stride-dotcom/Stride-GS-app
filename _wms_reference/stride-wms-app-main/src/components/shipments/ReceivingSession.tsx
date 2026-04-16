import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useReceivingSession } from '@/hooks/useReceivingSession';
import { PhotoScannerButton } from '@/components/common/PhotoScannerButton';
import { PhotoGrid } from '@/components/common/PhotoGrid';
import { DocumentCapture } from '@/components/scanner/DocumentCapture';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface ShipmentItem {
  id: string;
  expected_description: string | null;
  expected_quantity: number | null;
  actual_quantity: number | null;
}

interface ReceivingSessionProps {
  shipmentId: string;
  shipmentNumber: string;
  expectedItems: ShipmentItem[];
  onComplete: () => void;
  onReceivingComplete?: (itemIds: string[]) => void;
  onPhotosChange: (type: 'photos' | 'documents', urls: string[]) => void;
  existingPhotos: string[];
  existingDocuments: string[];
}

export function ReceivingSession({
  shipmentId,
  shipmentNumber,
  expectedItems,
  onComplete,
  onReceivingComplete,
  onPhotosChange,
  existingPhotos,
  existingDocuments,
}: ReceivingSessionProps) {
  const {
    session,
    loading,
    fetchSession,
    startSession,
    updateSessionNotes,
    finishSession,
    cancelSession,
  } = useReceivingSession(shipmentId);

  const { toast } = useToast();

  const [notes, setNotes] = useState('');
  const [trackingNumbers, setTrackingNumbers] = useState<string[]>(['']);
  const [receivedItems, setReceivedItems] = useState<{ shipment_item_id?: string; description: string; quantity: number; receivedWithoutId: boolean }[]>([]);
  const [showFinishDialog, setShowFinishDialog] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [ocrEnabled, setOcrEnabled] = useState(true);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    // Initialize received items from expected items - include shipment_item_id for linking
    if (expectedItems.length > 0 && receivedItems.length === 0) {
      setReceivedItems(
        expectedItems.map(item => ({
          shipment_item_id: item.id,
          description: item.expected_description || '',
          quantity: item.expected_quantity || 0,
          receivedWithoutId: false,
        }))
      );
    }
  }, [expectedItems]);

  const handleStartReceiving = async () => {
    const newSession = await startSession();
    if (newSession) {
      // Session started successfully
    }
  };

  const handleNotesBlur = () => {
    if (session) {
      updateSessionNotes(notes);
    }
  };

  const handleAddTrackingNumber = () => {
    setTrackingNumbers([...trackingNumbers, '']);
  };

  const handleTrackingChange = (index: number, value: string) => {
    const newNumbers = [...trackingNumbers];
    newNumbers[index] = value;
    setTrackingNumbers(newNumbers);
  };

  const handleReceivedQuantityChange = (index: number, quantity: number) => {
    const newItems = [...receivedItems];
    newItems[index] = { ...newItems[index], quantity };
    setReceivedItems(newItems);
  };

  const handleReceivedWithoutIdChange = (index: number, value: boolean) => {
    const newItems = [...receivedItems];
    newItems[index] = { ...newItems[index], receivedWithoutId: value };
    setReceivedItems(newItems);
  };

  const handleFinishReceiving = async () => {
    setFinishing(true);

    // Build verification data
    const discrepancies = receivedItems
      .map((item, index) => {
        const expected = expectedItems[index]?.expected_quantity || 0;
        if (item.quantity !== expected) {
          return {
            description: item.description,
            expected,
            received: item.quantity,
          };
        }
        return null;
      })
      .filter(Boolean) as { description: string; expected: number; received: number }[];

    const backorderItems = discrepancies
      .filter(d => d.received < d.expected)
      .map(d => ({
        description: d.description,
        quantity: d.expected - d.received,
      }));

    const verificationData = {
      expected_items: expectedItems.map(item => ({
        description: item.expected_description || '',
        quantity: item.expected_quantity || 0,
      })),
      received_items: receivedItems,
      discrepancies,
      backorder_items: backorderItems,
      tracking_numbers: trackingNumbers.filter(t => t.trim()),
      notes,
    };

    const result = await finishSession(verificationData);
    setFinishing(false);

    if (result.success) {
      setShowFinishDialog(false);
      // Trigger print prompt callback with created item IDs
      if (result.createdItemIds.length > 0) {
        onReceivingComplete?.(result.createdItemIds);
      }
      onComplete();
    }
  };

  const handleCancelSession = async () => {
    await cancelSession();
  };

  // If another user has an active session
  if (session && session.started_by !== session.started_by) {
    const userName = session.started_by_user
      ? `${session.started_by_user.first_name || ''} ${session.started_by_user.last_name || ''}`.trim() || session.started_by_user.email
      : 'Another user';

    return (
      <Card className="border-orange-200 bg-orange-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-700">
            <MaterialIcon name="lock" size="md" />
            Receiving in Progress
          </CardTitle>
          <CardDescription className="text-orange-600">
            This shipment is currently being received by another user
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <MaterialIcon name="person" size="sm" />
              <span>{userName}</span>
            </div>
            <div className="flex items-center gap-2">
              <MaterialIcon name="schedule" size="sm" />
              <span>Started {format(new Date(session.started_at), 'MMM d, h:mm a')}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No active session - show start button
  if (!session) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="inventory_2" size="md" />
            Receive Shipment
          </CardTitle>
          <CardDescription>
            Start the receiving process to verify and create inventory items
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleStartReceiving} disabled={loading} size="lg">
            {loading ? (
              <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
            ) : (
              <MaterialIcon name="play_arrow" size="sm" className="mr-2" />
            )}
            Start Receiving Shipment
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Active session - show receiving UI
  return (
    <div className="space-y-6">
      {/* Session Header */}
      <Card className="border-primary">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="inventory_2" size="md" className="text-primary" />
                Receiving {shipmentNumber}
              </CardTitle>
              <CardDescription>
                Started {format(new Date(session.started_at), 'MMM d, yyyy h:mm a')}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleCancelSession}>
                <MaterialIcon name="close" size="sm" className="mr-2" />
                Cancel
              </Button>
              <Button size="sm" onClick={() => setShowFinishDialog(true)}>
                <MaterialIcon name="check_circle" size="sm" className="mr-2" />
                Finish Receiving
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Photos & Documents */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MaterialIcon name="photo_camera" size="sm" />
              Receiving Photos ({existingPhotos.length})
            </CardTitle>
            <PhotoScannerButton
              entityType="receiving"
              entityId={shipmentId}
              existingPhotos={existingPhotos}
              maxPhotos={20}
              onPhotosSaved={(urls) => onPhotosChange('photos', urls)}
              size="sm"
              label="Take Photos"
              showCount={false}
            />
          </CardHeader>
          <CardContent>
            {existingPhotos.length > 0 ? (
              <PhotoGrid
                photos={existingPhotos}
                onPhotosChange={(urls) => onPhotosChange('photos', urls)}
              />
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No photos yet. Tap "Take Photos" to capture.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <MaterialIcon name="description" size="sm" />
                Receiving Documents
              </CardTitle>
              <div className="flex items-center gap-2">
                <Label htmlFor="ocr-toggle" className="text-sm text-muted-foreground">
                  OCR
                </Label>
                <Switch
                  id="ocr-toggle"
                  checked={ocrEnabled}
                  onCheckedChange={setOcrEnabled}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <DocumentCapture
              context={{ type: 'shipment', shipmentId, shipmentNumber }}
              maxDocuments={10}
              ocrEnabled={ocrEnabled}
            />
          </CardContent>
        </Card>
      </div>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MaterialIcon name="sticky_note_2" size="sm" />
            Receiving Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Add any notes about this receiving..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={handleNotesBlur}
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Tracking Numbers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tracking / Reference Numbers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {trackingNumbers.map((number, index) => (
            <Input
              key={index}
              placeholder="Enter tracking number"
              value={number}
              onChange={(e) => handleTrackingChange(index, e.target.value)}
            />
          ))}
          <Button variant="outline" size="sm" onClick={handleAddTrackingNumber}>
            Add Another
          </Button>
        </CardContent>
      </Card>

      {/* Finish Receiving Dialog */}
      <Dialog open={showFinishDialog} onOpenChange={setShowFinishDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Verify & Complete Receiving</DialogTitle>
            <DialogDescription>
              Confirm the quantities received. Any discrepancies will be noted.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[400px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right w-24">Expected</TableHead>
                  <TableHead className="text-right w-32">Received</TableHead>
                  <TableHead className="w-32 text-center">No ID</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receivedItems.map((item, index) => {
                  const expected = expectedItems[index]?.expected_quantity || 0;
                  const hasDiscrepancy = item.quantity !== expected;
                  return (
                    <TableRow key={index}>
                      <TableCell>{item.description || '-'}</TableCell>
                      <TableCell className="text-right">{expected}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          value={item.quantity}
                          onChange={(e) => handleReceivedQuantityChange(index, parseInt(e.target.value) || 0)}
                          className="w-24 text-right"
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Checkbox
                            id={`no-id-${index}`}
                            checked={item.receivedWithoutId}
                            onCheckedChange={(checked) => handleReceivedWithoutIdChange(index, checked as boolean)}
                          />
                          <Label htmlFor={`no-id-${index}`} className="text-xs text-muted-foreground flex items-center gap-1">
                            <MaterialIcon name="help" className="text-xs" />
                          </Label>
                        </div>
                      </TableCell>
                      <TableCell>
                        {hasDiscrepancy ? (
                          <Badge variant="destructive" className="gap-1">
                            <MaterialIcon name="warning" className="text-xs" />
                            {item.quantity < expected ? 'Short' : 'Over'}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-green-600">
                            <MaterialIcon name="check_circle" className="text-xs" />
                            OK
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFinishDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleFinishReceiving} disabled={finishing}>
              {finishing ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <MaterialIcon name="check_circle" size="sm" className="mr-2" />
                  Complete Receiving
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
