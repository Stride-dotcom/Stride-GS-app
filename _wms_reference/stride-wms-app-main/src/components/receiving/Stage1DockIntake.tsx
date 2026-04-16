import { type ReactNode, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { HelpTip } from '@/components/ui/help-tip';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { AutosaveIndicator } from './AutosaveIndicator';
import { useReceivingAutosave } from '@/hooks/useReceivingAutosave';
import { BigCounter } from './BigCounter';
import { PhotoScannerButton } from '@/components/common/PhotoScannerButton';
import { PhotoUploadButton } from '@/components/common/PhotoUploadButton';
import { TaggablePhotoGrid, type TaggablePhoto, getPhotoUrls } from '@/components/common/TaggablePhotoGrid';
import {
  SHIPMENT_EXCEPTION_CODE_META,
  useShipmentExceptions,
  type ShipmentExceptionCode,
} from '@/hooks/useShipmentExceptions';
import { SignaturePad } from '@/components/shipments/SignaturePad';
import { ShipmentExceptionBadge } from '@/components/shipments/ShipmentExceptionBadge';
import { AccountSelect } from '@/components/ui/account-select';
import { SidemarkSelect } from '@/components/ui/sidemark-select';
import { DocumentCapture } from '@/components/scanner/DocumentCapture';
import { useDocuments } from '@/hooks/useDocuments';
import { JobTimerWidget } from '@/components/time/JobTimerWidget';
import { BillingCalculator } from '@/components/billing/BillingCalculator';
import { AddAddonDialog } from '@/components/billing/AddAddonDialog';
import { AddCreditDialog } from '@/components/billing/AddCreditDialog';
import { promptResumePausedTask } from '@/lib/time/promptResumePausedTask';
import { timerEndJob } from '@/lib/time/timerClient';
import { RETURN_INTAKE_TYPE, isReturnIntakeShipment } from '@/lib/shipments/returnIntake';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type ExceptionChip = ShipmentExceptionCode;

const EXCEPTION_OPTIONS: { value: ExceptionChip; label: string; icon: string }[] = [
  // Shipment-level exceptions observed during intake/receiving.
  { value: 'DAMAGE', ...SHIPMENT_EXCEPTION_CODE_META.DAMAGE },
  { value: 'WET', ...SHIPMENT_EXCEPTION_CODE_META.WET },
  { value: 'OPEN', ...SHIPMENT_EXCEPTION_CODE_META.OPEN },
  { value: 'MISSING_DOCS', ...SHIPMENT_EXCEPTION_CODE_META.MISSING_DOCS },
  { value: 'CRUSHED_TORN_CARTONS', ...SHIPMENT_EXCEPTION_CODE_META.CRUSHED_TORN_CARTONS },
  { value: 'MIS_SHIP', ...SHIPMENT_EXCEPTION_CODE_META.MIS_SHIP },
  { value: 'SHORTAGE', ...SHIPMENT_EXCEPTION_CODE_META.SHORTAGE },
  { value: 'OVERAGE', ...SHIPMENT_EXCEPTION_CODE_META.OVERAGE },
  { value: 'OTHER', ...SHIPMENT_EXCEPTION_CODE_META.OTHER },
];

export interface MatchingParamsUpdate {
  pieces: number;
  dockCount: number;
  accountId: string | null;
  trackingNumber: string | null;
  referenceNumber: string | null;
  shipper: string | null;
}

/** Sections that Stage1DockIntake can expose for external layout placement. */
export interface Stage1Sections {
  /** Account selector, carrier/tracking/PO fields, counters, unit breakdown */
  shipmentSummaryContent: ReactNode;
  /** Signature pad/display card content */
  signatureContent: ReactNode;
  /** Photo grid and buttons */
  photosContent: ReactNode;
  /** DocumentCapture */
  documentsContent: ReactNode;
  /** Exception chips with notes (for Notes tab) */
  exceptionsContent: ReactNode;
  /** AutosaveIndicator element */
  autosaveIndicator: ReactNode;
  /** Complete Stage 1 handler */
  onCompleteStage1: () => void;
  /** Whether stage1 completion is in progress */
  completing: boolean;
  /** Whether editing is allowed */
  canEdit: boolean;
  /** Dialogs that must remain mounted (signature dialog, required note dialog) */
  dialogs: ReactNode;
}

interface Stage1DockIntakeProps {
  shipmentId: string;
  shipmentNumber: string;
  shipment: {
    shipment_type?: string | null;
    account_id: string | null;
    vendor_name: string | null;
    carrier?: string | null;
    tracking_number?: string | null;
    po_number?: string | null;
    signed_pieces: number | null;
    received_pieces: number | null;
    signature_data: string | null;
    signature_name: string | null;
    signature_timestamp?: string | null;
    driver_name?: string | null;
    receiving_photos?: Json | null;
    dock_intake_breakdown: Record<string, unknown> | null;
    return_type?: string | null;
    notes: string | null;
    created_at?: string | null;
    received_at?: string | null;
  };
  onComplete: () => void;
  onRefresh: () => void;
  /** Called whenever fields that affect matching change, so the matching panel can update reactively */
  onMatchingParamsChange?: (params: MatchingParamsUpdate) => void;
  onOpenExceptions?: () => void;
  /** Stage 2 row-count (each row = 1 carton/package/piece) */
  entryCount?: number;
  /**
   * External refresh key for the BillingCalculator (e.g., Stage 2 autosaves).
   * Stage 1 also maintains its own internal refresh key for Add Charge/Credit.
   */
  externalBillingRefreshKey?: number;
  /** Draft-only: show the "Complete Dock Intake" action */
  showCompleteButton?: boolean;
  /** Render in read-only mode (view-only). */
  readOnly?: boolean;
  /** Show/hide inline billing section (for external placement in parent layout). */
  showBillingCalculator?: boolean;
  /**
   * When provided, Stage1 exposes its sections via this callback instead of rendering
   * its own default card-based layout. The parent can place sections freely.
   */
  renderLayout?: (sections: Stage1Sections) => ReactNode;
}

export function Stage1DockIntake({
  shipmentId,
  shipmentNumber,
  shipment,
  onComplete,
  onRefresh,
  onMatchingParamsChange,
  onOpenExceptions,
  entryCount = 0,
  externalBillingRefreshKey = 0,
  showCompleteButton = true,
  readOnly = false,
  showBillingCalculator = true,
  renderLayout,
}: Stage1DockIntakeProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { hasRole } = usePermissions();
  const canEdit = !readOnly;
  const isReturnShipmentType = shipment.shipment_type === 'return';

  // Form state
  const [accountId, setAccountId] = useState<string>(shipment.account_id || '');
  const [sidemarkId, setSidemarkId] = useState<string>((shipment as any).sidemark_id || '');
  const [accountDefaultShipmentNotes, setAccountDefaultShipmentNotes] = useState<string>('');
  const [accountHighlightShipmentNotes, setAccountHighlightShipmentNotes] = useState(false);
  const [carrierName, setCarrierName] = useState((shipment as any).carrier || '');
  const [trackingNumber, setTrackingNumber] = useState((shipment as any).tracking_number || '');
  const [poNumber, setPoNumber] = useState((shipment as any).po_number || '');
  const [signedPieces, setSignedPieces] = useState<number>(shipment.signed_pieces || 0);
  const [dockCount, setDockCount] = useState<number>(shipment.received_pieces || 0);
  // True when the user has manually set dock count via the counter (not via breakdown).
  // When true, breakdown changes won't overwrite the dock count.
  const [dockCountManual, setDockCountManual] = useState(() => {
    const saved = shipment.received_pieces || 0;
    const bd = (shipment.dock_intake_breakdown as any) || {};
    const breakdownSum = (Number(bd.cartons) || 0) + (Number(bd.pallets) || 0) + (Number(bd.crates) || 0);
    // If saved dock count differs from the breakdown sum, user must have set it manually.
    return saved > 0 && saved !== breakdownSum;
  });
  const [exceptions, setExceptions] = useState<ExceptionChip[]>([]);
  const [exceptionNotes, setExceptionNotes] = useState<Record<ShipmentExceptionCode, string>>({} as Record<ShipmentExceptionCode, string>);
  const [activeExceptionCode, setActiveExceptionCode] = useState<ShipmentExceptionCode | null>(null);
  const [pendingRequiredNoteCode, setPendingRequiredNoteCode] = useState<ShipmentExceptionCode | null>(null);
  const [pendingRequiredNote, setPendingRequiredNote] = useState('');
  const [autoPieceCountException, setAutoPieceCountException] = useState<ShipmentExceptionCode | null>(null);
  const [breakdown, setBreakdown] = useState<{ cartons: number; pallets: number; crates: number }>({
    cartons: 0,
    pallets: 0,
    crates: 0,
    ...(shipment.dock_intake_breakdown as any || {}),
  });
  const [isReturnIntake, setIsReturnIntake] = useState<boolean>(
    isReturnIntakeShipment({
      shipment_type: shipment.shipment_type,
      return_type: shipment.return_type,
    })
  );

  // Signature
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(shipment.signature_data || null);
  const [signatureName, setSignatureName] = useState(shipment.signature_name || '');
  const [signatureTimestamp, setSignatureTimestamp] = useState<string | null>(
    (shipment as any).signature_timestamp || null
  );
  // Draft signature fields (edited in dialog; persisted on save)
  const [signatureDraftData, setSignatureDraftData] = useState<string | null>(null);
  const [signatureDraftName, setSignatureDraftName] = useState('');

  // Submitting
  const [completing, setCompleting] = useState(false);

  // Billing UI (manager/admin only)
  const [billingRefreshKey, setBillingRefreshKey] = useState(0);
  const effectiveBillingRefreshKey = billingRefreshKey + externalBillingRefreshKey;
  const [addChargeOpen, setAddChargeOpen] = useState(false);
  const [addCreditOpen, setAddCreditOpen] = useState(false);
  const canSeeBilling = hasRole('admin') || hasRole('manager') || hasRole('billing_manager');
  const canAddCredit = hasRole('admin') || hasRole('billing_manager');

  // If the shipment account changes, refresh billing preview/rates.
  useEffect(() => {
    if (!canSeeBilling) return;
    if (!accountId) return;
    setBillingRefreshKey((prev) => prev + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, canSeeBilling]);

  // Autosave - disable while completing to prevent race conditions
  const autosave = useReceivingAutosave(shipmentId, !completing);

  // Photos (legacy incoming shipments style) stored on shipments.receiving_photos
  const [receivingPhotos, setReceivingPhotos] = useState<(string | TaggablePhoto)[]>(() => {
    const existing = (shipment as any)?.receiving_photos;
    return Array.isArray(existing) ? (existing as (string | TaggablePhoto)[]) : [];
  });
  const [legacyPhotosBootstrapped, setLegacyPhotosBootstrapped] = useState(false);

  // Shipment exceptions
  const {
    openExceptions,
    upsertOpenException,
    removeOpenException,
    refetch: refetchExceptions,
  } = useShipmentExceptions(shipmentId);

  const { documents, refetch: refetchDocuments } = useDocuments({ contextType: 'shipment', contextId: shipmentId });

  // Emit matching params whenever relevant fields change
  useEffect(() => {
    onMatchingParamsChange?.({
      pieces: signedPieces,
      dockCount,
      accountId: accountId || null,
      trackingNumber: trackingNumber.trim() || null,
      referenceNumber: poNumber.trim() || null,
      shipper: carrierName.trim() || null,
    });
  }, [signedPieces, dockCount, accountId, trackingNumber, poNumber, carrierName, onMatchingParamsChange]);

  useEffect(() => {
    setAccountId(shipment.account_id || '');
  }, [shipment.account_id]);

  // Show account-level default shipment notes under the Stage 1 status bar (if present).
  useEffect(() => {
    let cancelled = false;

    const fetchAccountNotes = async () => {
      if (!accountId) {
        setAccountDefaultShipmentNotes('');
        setAccountHighlightShipmentNotes(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('accounts')
          .select('default_shipment_notes, highlight_shipment_notes')
          .eq('id', accountId)
          .maybeSingle();
        if (cancelled) return;
        if (error) throw error;
        const note = (data?.default_shipment_notes || '').trim();
        setAccountDefaultShipmentNotes(note);
        setAccountHighlightShipmentNotes(!!data?.highlight_shipment_notes);
      } catch (err) {
        if (!cancelled) {
          setAccountDefaultShipmentNotes('');
          setAccountHighlightShipmentNotes(false);
        }
      }
    };

    void fetchAccountNotes();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  useEffect(() => {
    setCarrierName((shipment as any).carrier || '');
  }, [(shipment as any).carrier]);

  useEffect(() => {
    setTrackingNumber((shipment as any).tracking_number || '');
  }, [(shipment as any).tracking_number]);

  useEffect(() => {
    setPoNumber((shipment as any).po_number || '');
  }, [(shipment as any).po_number]);

  useEffect(() => {
    setDockCount(shipment.received_pieces || 0);
  }, [shipment.received_pieces]);

  useEffect(() => {
    setIsReturnIntake(
      isReturnIntakeShipment({
        shipment_type: shipment.shipment_type,
        return_type: shipment.return_type,
      })
    );
  }, [shipment.shipment_type, shipment.return_type]);

  useEffect(() => {
    setSignatureTimestamp((shipment as any).signature_timestamp || null);
  }, [(shipment as any).signature_timestamp]);

  // Keep local photo state aligned with the persisted shipment JSON field.
  useEffect(() => {
    const existing = shipment.receiving_photos;
    setReceivingPhotos(Array.isArray(existing) ? (existing as unknown as (string | TaggablePhoto)[]) : []);
  }, [shipment.receiving_photos]);

  // Autosave handlers
  const handleAccountChange = (value: string) => {
    setAccountId(value);
    setSidemarkId(''); // Reset sidemark when account changes
    autosave.saveField('account_id', value || null);
    autosave.saveField('sidemark_id', null);
  };

  const handleSidemarkChange = (value: string) => {
    setSidemarkId(value);
    autosave.saveField('sidemark_id', value || null);
  };

  const handleCarrierNameChange = (value: string) => {
    setCarrierName(value);
    autosave.saveField('carrier', value || null);
  };

  const handleTrackingNumberChange = (value: string) => {
    setTrackingNumber(value);
    autosave.saveField('tracking_number', value || null);
  };

  const handlePoNumberChange = (value: string) => {
    setPoNumber(value);
    autosave.saveField('po_number', value || null);
  };

  const handleSignedPiecesChange = (value: number) => {
    setSignedPieces(value);
    autosave.saveField('signed_pieces', value);
  };

  const handleDockCountChange = (value: number) => {
    setDockCount(value);
    setDockCountManual(value > 0);
    autosave.saveField('received_pieces', value);
  };

  const handleBreakdownChange = (field: string, value: number) => {
    const newBreakdown = { ...breakdown, [field]: value };
    setBreakdown(newBreakdown);
    autosave.saveField('dock_intake_breakdown', newBreakdown);
    // Unit breakdown is purely informational metadata — it should never
    // auto-update the Dock count (received_pieces). The operator sets the
    // Dock counter independently via the BigCounter control.
  };

  const handleReturnIntakeChange = (checked: boolean) => {
    if (!canEdit || isReturnShipmentType) return;
    setIsReturnIntake(checked);
    autosave.saveField('return_type', checked ? RETURN_INTAKE_TYPE : null);
  };

  // Sync local chips with persisted open exceptions
  useEffect(() => {
    if (openExceptions.length === 0) {
      setExceptions([]);
      setExceptionNotes({} as Record<ShipmentExceptionCode, string>);
      return;
    }

    const selected = openExceptions.map((e) => e.code as ExceptionChip);
    const notesMap = {} as Record<ShipmentExceptionCode, string>;
    openExceptions.forEach((e) => {
      notesMap[e.code] = e.note || '';
    });
    setExceptions(selected);
    setExceptionNotes(notesMap);
  }, [openExceptions]);

  useEffect(() => {
    if (exceptions.length === 0) {
      setActiveExceptionCode(null);
      return;
    }
    if (!activeExceptionCode || !exceptions.includes(activeExceptionCode)) {
      setActiveExceptionCode(exceptions[0]);
    }
  }, [exceptions, activeExceptionCode]);

  const openExceptionNoteDialog = (chip: ExceptionChip) => {
    if (!canEdit) return;
    setPendingRequiredNoteCode(chip);
    setPendingRequiredNote(exceptionNotes[chip] || '');
  };

  const removeException = async (chip: ExceptionChip) => {
    // Shortage/Overage can be auto-synced + locked when carrier vs dock counts mismatch.
    if (autoPieceCountException === chip) {
      toast({
        variant: 'destructive',
        title: 'Locked Exception',
        description: 'Shortage/Overage is locked until Carrier and Dock counts match.',
      });
      return;
    }

    const removed = await removeOpenException(chip);
    if (!removed) return;

    setExceptions((prev) => prev.filter((e) => e !== chip));
    setExceptionNotes((prev) => {
      const next = { ...prev };
      delete next[chip];
      return next;
    });
    setActiveExceptionCode((prev) => (prev === chip ? null : prev));
  };

  const toggleException = (chip: ExceptionChip) => {
    if (exceptions.includes(chip)) {
      void removeException(chip);
      return;
    }
    openExceptionNoteDialog(chip);
  };

  // Carrier vs Dock mismatch should auto-sync Shortage/Overage (and lock until corrected).
  useEffect(() => {
    const carrier = Number(signedPieces) || 0;
    const dock = Number(dockCount) || 0;
    const mismatch = carrier > 0 && dock > 0 && carrier !== dock;

    const required: ShipmentExceptionCode | null = mismatch
      ? (dock > carrier ? 'OVERAGE' : 'SHORTAGE')
      : null;

    const run = async () => {
      // If mismatch resolved, remove any auto-applied piece-count exception.
      if (!required) {
        if (autoPieceCountException) {
          await removeOpenException(autoPieceCountException);
          setAutoPieceCountException(null);
        }
        return;
      }

      const opposite: ShipmentExceptionCode = required === 'OVERAGE' ? 'SHORTAGE' : 'OVERAGE';

      // Remove previously auto-applied code if direction changed.
      if (autoPieceCountException && autoPieceCountException !== required) {
        await removeOpenException(autoPieceCountException);
      }

      // Ensure required mismatch exception exists.
      if (!exceptions.includes(required)) {
        await upsertOpenException(required, exceptionNotes[required]?.trim() || null);
      }

      // Ensure the opposite code is not selected simultaneously.
      if (exceptions.includes(opposite)) {
        await removeOpenException(opposite);
      }

      setAutoPieceCountException(required);
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedPieces, dockCount, exceptions, autoPieceCountException]);

  const handleSaveRequiredNote = async () => {
    if (!pendingRequiredNoteCode) return;
    if (!pendingRequiredNote.trim()) {
      toast({
        variant: 'destructive',
        title: 'Note Required',
        description: `${SHIPMENT_EXCEPTION_CODE_META[pendingRequiredNoteCode].label} requires a note.`,
      });
      return;
    }

    const note = pendingRequiredNote.trim();
    const code = pendingRequiredNoteCode;
    const saved = await upsertOpenException(code, note);
    if (!saved) return;

    setExceptionNotes((prev) => ({ ...prev, [code]: note }));
    setExceptions((prev) => (prev.includes(code) ? prev : [...prev, code]));
    setActiveExceptionCode(code);
    setPendingRequiredNoteCode(null);
    setPendingRequiredNote('');
  };

  const handleExceptionNoteBlur = async (code: ShipmentExceptionCode) => {
    if (!exceptions.includes(code)) return;
    const note = exceptionNotes[code]?.trim() || null;
    if (!note) return;
    await upsertOpenException(code, note);
  };

  const saveReceivingPhotosToShipment = async (nextPhotos: TaggablePhoto[]) => {
    setReceivingPhotos(nextPhotos);
    const { error } = await (supabase as any)
      .from('shipments')
      .update({ receiving_photos: nextPhotos as unknown as Json })
      .eq('id', shipmentId);
    if (error) throw error;
  };

  const mergeAndSaveReceivingPhotoUrls = async (urls: string[]) => {
    const existingUrls = getPhotoUrls(receivingPhotos);
    const newUrls = urls.filter((u) => !existingUrls.includes(u));
    const newTaggablePhotos: TaggablePhoto[] = newUrls.map((url) => ({
      url,
      isPrimary: false,
      needsAttention: false,
      isRepair: false,
    }));
    const normalizedExisting: TaggablePhoto[] = receivingPhotos.map((p) =>
      typeof p === 'string'
        ? { url: p, isPrimary: false, needsAttention: false, isRepair: false }
        : p
    );
    const allPhotos = [...normalizedExisting, ...newTaggablePhotos];
    await saveReceivingPhotosToShipment(allPhotos);
  };

  // Backwards compatibility:
  // Earlier Dock Intake builds stored photos in shipment_photos (split into paperwork/condition).
  // This UI now uses shipments.receiving_photos; bootstrap once so users don't "lose" existing photos.
  useEffect(() => {
    if (legacyPhotosBootstrapped) return;
    if (!profile?.tenant_id) return;

    // If we already have photos on the shipment JSON field, nothing to do.
    if (getPhotoUrls(receivingPhotos).length > 0) {
      setLegacyPhotosBootstrapped(true);
      return;
    }

    // Mark attempted immediately to prevent duplicate fetches.
    setLegacyPhotosBootstrapped(true);

    const bootstrap = async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('shipment_photos')
          .select('storage_key')
          .eq('tenant_id', profile.tenant_id)
          .eq('shipment_id', shipmentId)
          .order('created_at', { ascending: true });

        if (error) throw error;

        const urls = (data || [])
          .map((p: { storage_key: string }) => {
            const { data: urlData } = supabase.storage.from('photos').getPublicUrl(p.storage_key);
            return urlData?.publicUrl || '';
          })
          .filter((u: string) => !!u);

        if (urls.length > 0) {
          await mergeAndSaveReceivingPhotoUrls(urls);
        }
      } catch (err) {
        console.warn('[Stage1DockIntake] legacy shipment_photos bootstrap failed:', err);
      }
    };

    void bootstrap();
  }, [legacyPhotosBootstrapped, profile?.tenant_id, shipmentId, receivingPhotos]);

  // Signature handlers
  const handleSignatureComplete = async (data: string | null, name: string) => {
    if (!canEdit) return;
    const normalizedName = name.trim();
    const normalizedData = data?.trim() ? data : null;

    setSignatureData(normalizedData);
    setSignatureName(normalizedName);
    const nowIso = new Date().toISOString();
    setSignatureTimestamp(nowIso);
    setSignatureDraftData(null);
    setSignatureDraftName('');
    setShowSignatureDialog(false);

    // Save signature to shipment (awaited with error handling)
    try {
      const { error } = await (supabase as any)
        .from('shipments')
        .update({
          signature_data: normalizedData,
          signature_name: normalizedName || null,
          driver_name: normalizedName || null,
          signature_timestamp: nowIso,
        })
        .eq('id', shipmentId);

      if (error) throw error;
      toast({ title: 'Signature saved' });
      onRefresh();
    } catch (err: any) {
      console.error('[Stage1] signature save error:', err);
      toast({
        variant: 'destructive',
        title: 'Signature Error',
        description: err?.message || 'Failed to save signature',
      });
    }
  };

  const handleClearSignature = async () => {
    if (!canEdit) return;
    const prevSignatureData = signatureData;
    const prevSignatureName = signatureName;
    const prevSignatureTimestamp = signatureTimestamp;

    setSignatureData(null);
    setSignatureName('');
    setSignatureTimestamp(null);
    setSignatureDraftData(null);
    setSignatureDraftName('');
    setShowSignatureDialog(false);

    try {
      const { error } = await (supabase as any)
        .from('shipments')
        .update({
          signature_data: null,
          signature_name: null,
          driver_name: null,
          signature_timestamp: null,
        })
        .eq('id', shipmentId);

      if (error) throw error;
      toast({ title: 'Signature cleared' });
      onRefresh();
    } catch (err: any) {
      console.error('[Stage1] signature clear error:', err);
      setSignatureData(prevSignatureData);
      setSignatureName(prevSignatureName);
      setSignatureTimestamp(prevSignatureTimestamp);
      toast({
        variant: 'destructive',
        title: 'Signature Error',
        description: err?.message || 'Failed to clear signature',
      });
    }
  };

  const handleSignatureDialogOpenChange = (open: boolean) => {
    if (open && !canEdit) return;
    if (!open) {
      setShowSignatureDialog(false);
      setSignatureDraftData(null);
      setSignatureDraftName('');
      return;
    }

    // Initialize drafts from the currently-saved signature
    setSignatureDraftData(signatureData);
    setSignatureDraftName(signatureName);
    setShowSignatureDialog(true);
  };

  const formatSignedAt = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  };

  const formatSummaryDate = (iso?: string | null) => {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Validation
  const validate = (): string[] => {
    const errors: string[] = [];
    if (!accountId) errors.push('Account is required');
    if (signedPieces <= 0) errors.push('Carrier count must be greater than 0');
    if (dockCount <= 0) errors.push('Dock Count must be greater than 0');
    for (const ex of exceptions) {
      if (!exceptionNotes[ex]?.trim()) {
        errors.push(`Exception note required: ${SHIPMENT_EXCEPTION_CODE_META[ex].label}`);
      }
    }
    // Carrier vs Dock mismatch: block completion until corrected OR exception+note is present.
    if (signedPieces > 0 && dockCount > 0 && signedPieces !== dockCount) {
      const required: ShipmentExceptionCode = dockCount > signedPieces ? 'OVERAGE' : 'SHORTAGE';
      if (!exceptionNotes[required]?.trim()) {
        errors.push(
          `Counts mismatch requires a ${SHIPMENT_EXCEPTION_CODE_META[required].label} exception note (or fix the counts).`
        );
      }
    }
    if (getPhotoUrls(receivingPhotos).length < 1) errors.push('At least 1 photo is required');
    return errors;
  };

  // Complete Stage 1
  const handleComplete = async () => {
    try {
      if (!canEdit) {
        toast({
          title: 'Permission denied',
          description: 'You do not have edit access to complete this stage.',
          variant: 'destructive',
        });
        return;
      }
      const errors = validate();
      if (errors.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Cannot Complete Stage 1',
          description: errors.join('. '),
        });
        return;
      }

      setCompleting(true);

      // Flush any pending autosave
      await autosave.saveNow();

      // Persist exception notes even if the user hasn't blurred the textarea yet.
      if (exceptions.length > 0) {
        const results = await Promise.all(
          exceptions.map(async (code) => {
            const note = exceptionNotes[code]?.trim() || null;
            return upsertOpenException(code, note);
          })
        );

        if (results.some((r) => !r)) {
          throw new Error('Failed to save exceptions');
        }
      }

      // Update shipment: set inbound_status to stage1_complete
      // Include all current field values to prevent stale autosave overwrites
      const updateData: Record<string, unknown> = {
        inbound_status: 'stage1_complete',
        account_id: accountId || null,
        signed_pieces: signedPieces,
        received_pieces: dockCount,
        dock_intake_breakdown: breakdown,
      };

      // Keep explicit return shipments unchanged; for inbound dock-intake records
      // this flag distinguishes return-intake processing from normal intake.
      if (!isReturnShipmentType) {
        updateData.return_type = isReturnIntake ? RETURN_INTAKE_TYPE : null;
      }

      // Include signature data if captured
      if (signatureData) {
        updateData.signature_data = signatureData;
        updateData.signature_name = signatureName;
      }

      const { error } = await (supabase as any)
        .from('shipments')
        .update(updateData)
        .eq('id', shipmentId);

      if (error) throw error;

      // Stop Stage 1 timer interval (best-effort)
      try {
        await timerEndJob({
          tenantId: profile?.tenant_id,
          userId: profile?.id,
          jobType: 'shipment',
          jobId: shipmentId,
          reason: 'stage1_complete',
        });
      } catch (timerErr) {
        console.warn('[Stage1] Failed to end timer interval:', timerErr);
      }

      toast({ title: 'Stage 1 Complete', description: 'Dock intake has been recorded.' });
      promptResumePausedTask();
      onComplete();
    } catch (err: any) {
      console.error('[Stage1] complete error:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err?.message || 'Failed to complete Stage 1',
      });
    } finally {
      setCompleting(false);
    }
  };

  // --- renderLayout path: expose sections for parent-controlled placement ---
  if (renderLayout) {
    const shipmentSummaryContent = (
      <>
        {accountDefaultShipmentNotes ? (
          <div className={`rounded-xl border-2 px-4 py-3 mb-4 ${accountHighlightShipmentNotes ? 'border-yellow-400 bg-yellow-50' : 'border-border/60 bg-muted/30'}`}>
            <div className={`flex items-center gap-2 text-xs font-semibold ${accountHighlightShipmentNotes ? 'text-yellow-800' : 'text-muted-foreground'}`}>
              <MaterialIcon name="sticky_note_2" size="sm" />
              Default Shipment Notes
            </div>
            <div className={`mt-1 text-sm whitespace-pre-wrap ${accountHighlightShipmentNotes ? 'text-yellow-900 font-medium' : 'text-foreground'}`}>
              {accountDefaultShipmentNotes}
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label>
            Account <span className="text-red-500">*</span>
          </Label>
          <AccountSelect
            value={accountId}
            onChange={handleAccountChange}
            placeholder="Select account..."
            clearable={false}
            className="w-full"
            disabled={!canEdit}
          />
        </div>

        <div className="mt-4 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="return-intake-stage1" className="text-sm font-medium">
                Return Intake
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Use when items are returning to the warehouse after delivery/pickup.
              </p>
              {isReturnShipmentType ? (
                <p className="text-xs text-muted-foreground mt-1">
                  This shipment is already typed as a return.
                </p>
              ) : null}
            </div>
            <Switch
              id="return-intake-stage1"
              checked={isReturnIntake}
              onCheckedChange={handleReturnIntakeChange}
              disabled={!canEdit || isReturnShipmentType}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          <div className="space-y-2">
            <Label>Initiated</Label>
            <div className="h-10 rounded-md border bg-muted/30 px-3 text-sm flex items-center">
              {formatSummaryDate(shipment.created_at)}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Received</Label>
            <div className="h-10 rounded-md border bg-muted/30 px-3 text-sm flex items-center">
              {formatSummaryDate(shipment.received_at)}
            </div>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="carrier_name">Carrier Name</Label>
            <Input
              id="carrier_name"
              placeholder="Enter carrier..."
              value={carrierName}
              onChange={(e) => handleCarrierNameChange(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tracking_number">Tracking #</Label>
            <Input
              id="tracking_number"
              placeholder="Enter tracking..."
              value={trackingNumber}
              onChange={(e) => handleTrackingNumberChange(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="po_number">Reference / PO #</Label>
            <Input
              id="po_number"
              placeholder="Enter reference..."
              value={poNumber}
              onChange={(e) => handlePoNumberChange(e.target.value)}
              disabled={!canEdit}
            />
          </div>
        </div>

        {accountId && (
          <div className="space-y-2 mt-4">
            <Label>Sidemark / Project</Label>
            <SidemarkSelect
              accountId={accountId}
              value={sidemarkId || null}
              onChange={handleSidemarkChange}
              placeholder="Select sidemark..."
              disabled={!canEdit}
              allowCreate
            />
          </div>
        )}

        <Separator className="my-4" />

        {/* Mini counters row */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="carrier_count" className="text-xs">
                Carrier <span className="text-red-500">*</span>
              </Label>
              <HelpTip
                tooltip="Carrier paperwork piece count (what you sign for)."
                pageKey="receiving.stage1"
                fieldKey="carrier_count"
              />
            </div>
            <BigCounter
              id="carrier_count"
              value={signedPieces}
              onChange={handleSignedPiecesChange}
              min={0}
              step={1}
              disabled={!canEdit}
              compact
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="dock_count" className="text-xs">
                Dock <span className="text-red-500">*</span>
              </Label>
              <HelpTip
                tooltip="Physical piece count at the dock (Stage 1 actual count)."
                pageKey="receiving.stage1"
                fieldKey="dock_count"
              />
            </div>
            <BigCounter
              id="dock_count"
              value={dockCount}
              onChange={handleDockCountChange}
              min={0}
              step={1}
              disabled={!canEdit}
              compact
            />
          </div>
          <div className="space-y-1 col-span-2 sm:col-span-1 flex flex-col items-center">
            <div className="flex items-center gap-1">
              <Label className="text-xs">Entry</Label>
              <HelpTip
                tooltip="Read-only. Calculated from Stage 2 item rows."
                pageKey="receiving.stage1"
                fieldKey="entry_count"
              />
            </div>
            <div className="text-center text-2xl sm:text-3xl font-bold tabular-nums text-muted-foreground pt-1">
              {entryCount}
            </div>
          </div>
        </div>

        {/* Carrier vs Dock mismatch indicator */}
        {signedPieces > 0 && dockCount > 0 && signedPieces !== dockCount && (
          <div className="flex justify-center mt-2">
            <Badge variant="destructive" className="gap-1">
              <MaterialIcon name="warning" size="sm" />
              {dockCount > signedPieces ? 'Overage' : 'Shortage'} by {Math.abs(dockCount - signedPieces)}
            </Badge>
          </div>
        )}

        {/* Unit Breakdown (collapsible via dashed border) */}
        <div className="border border-dashed rounded-md p-3 mt-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MaterialIcon name="inventory" size="sm" />
            Unit Breakdown (optional)
            <HelpTip
              tooltip="Enter cartons/pallets/crates. Dock Count will auto-calculate as the sum."
              pageKey="receiving.stage1"
              fieldKey="unit_breakdown"
            />
          </div>
          <div className="grid gap-4 grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="cartons" className="text-xs">Cartons</Label>
              <Input
                id="cartons"
                type="number"
                min={0}
                value={breakdown.cartons || ''}
                onChange={(e) => handleBreakdownChange('cartons', parseInt(e.target.value) || 0)}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pallets" className="text-xs">Pallets</Label>
              <Input
                id="pallets"
                type="number"
                min={0}
                value={breakdown.pallets || ''}
                onChange={(e) => handleBreakdownChange('pallets', parseInt(e.target.value) || 0)}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="crates" className="text-xs">Crates</Label>
              <Input
                id="crates"
                type="number"
                min={0}
                value={breakdown.crates || ''}
                onChange={(e) => handleBreakdownChange('crates', parseInt(e.target.value) || 0)}
                disabled={!canEdit}
              />
            </div>
          </div>
        </div>
      </>
    );

    const signatureContent = (
      <div className="space-y-3">
        <div className="border rounded-md p-2 bg-white">
          {signatureData ? (
            <img src={signatureData} alt="Signature" className="max-h-24 mx-auto" />
          ) : signatureName.trim() ? (
            <div className="min-h-24 flex items-center justify-center">
              <span className="text-3xl font-cursive italic text-gray-800">
                {signatureName.trim()}
              </span>
            </div>
          ) : (
            <div className="min-h-24 flex items-center justify-center text-sm text-muted-foreground">
              No signature captured
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            {signatureName.trim() ? (
              <>
                Signed by:{' '}
                <span className="text-foreground">{signatureName.trim()}</span>
                {formatSignedAt(signatureTimestamp) ? (
                  <>
                    {' '}
                    · Signed at:{' '}
                    <span className="text-foreground">{formatSignedAt(signatureTimestamp)}</span>
                  </>
                ) : null}
              </>
            ) : (
              <span>Optional</span>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleSignatureDialogOpenChange(true)} disabled={!canEdit}>
              <MaterialIcon name={signatureData || signatureName.trim() ? 'edit' : 'draw'} size="sm" className="mr-2" />
              {signatureData || signatureName.trim() ? 'Edit' : 'Capture'}
            </Button>
            {signatureData || signatureName.trim() ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleClearSignature()}
                disabled={!canEdit}
                className="text-red-600 hover:text-red-700"
              >
                <MaterialIcon name="delete" size="sm" className="mr-1" />
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );

    const photosContent = (
      <>
        {getPhotoUrls(receivingPhotos).length > 0 ? (
          <TaggablePhotoGrid
            photos={receivingPhotos}
            enableTagging={canEdit}
            readonly={!canEdit}
            onPhotosChange={
              canEdit
                ? async (photos) => {
                    try {
                      await saveReceivingPhotosToShipment(photos);
                    } catch (err: any) {
                      toast({
                        variant: 'destructive',
                        title: 'Photo Error',
                        description: err?.message || 'Failed to save photos',
                      });
                    }
                  }
                : undefined
            }
          />
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No photos yet. At least 1 required.
          </p>
        )}

        {canEdit && getPhotoUrls(receivingPhotos).length < 20 && (
          <div className="flex gap-2 pt-3">
            <PhotoScannerButton
              entityType="shipment"
              entityId={shipmentId}
              tenantId={profile?.tenant_id}
              existingPhotos={getPhotoUrls(receivingPhotos)}
              maxPhotos={20}
              size="sm"
              variant="outline"
              label="Scan"
              showCount={false}
              className="flex-1"
              onPhotosSaved={async (urls) => {
                try {
                  await mergeAndSaveReceivingPhotoUrls(urls);
                } catch (err: any) {
                  toast({
                    variant: 'destructive',
                    title: 'Photo Error',
                    description: err?.message || 'Failed to save photos',
                  });
                }
              }}
            />
            <PhotoUploadButton
              entityType="shipment"
              entityId={shipmentId}
              tenantId={profile?.tenant_id}
              existingPhotos={getPhotoUrls(receivingPhotos)}
              maxPhotos={20}
              size="sm"
              variant="outline"
              label="Upload"
              className="flex-1"
              showHint={false}
              onPhotosSaved={async (urls) => {
                try {
                  await mergeAndSaveReceivingPhotoUrls(urls);
                } catch (err: any) {
                  toast({
                    variant: 'destructive',
                    title: 'Photo Error',
                    description: err?.message || 'Failed to save photos',
                  });
                }
              }}
            />
          </div>
        )}
      </>
    );

    const documentsContent = (
      <DocumentCapture
        context={{ type: 'shipment', shipmentId, shipmentNumber }}
        maxDocuments={12}
        ocrEnabled={true}
        canEdit={canEdit}
        onDocumentAdded={() => {
          void refetchDocuments();
        }}
        onDocumentRemoved={() => {
          void refetchDocuments();
        }}
      />
    );

    const availableExceptionOptions = EXCEPTION_OPTIONS.filter((opt) => !exceptions.includes(opt.value));

    const exceptionsContent = (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            Add exception
          </Label>
          {availableExceptionOptions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {availableExceptionOptions.map((opt) => (
                <Button
                  key={opt.value}
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => openExceptionNoteDialog(opt.value)}
                  disabled={!canEdit}
                >
                  <MaterialIcon name={opt.icon} size="sm" />
                  {opt.label}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">All exception types are already selected.</p>
          )}
        </div>

        {exceptions.length > 0 ? (
          <div className="space-y-3 rounded-md border bg-muted/10 p-3">
            <Label className="text-xs text-muted-foreground">Selected exceptions</Label>
            <div className="flex flex-wrap gap-2">
              {exceptions.map((code) => {
                const meta = SHIPMENT_EXCEPTION_CODE_META[code];
                return (
                  <Button
                    key={code}
                    type="button"
                    variant={activeExceptionCode === code ? 'default' : 'outline'}
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setActiveExceptionCode(code)}
                    disabled={!canEdit}
                  >
                    <MaterialIcon name={meta.icon} size="sm" />
                    {meta.label}
                  </Button>
                );
              })}
            </div>

            {activeExceptionCode ? (
              <div className="space-y-2 pt-1">
                <Label className="text-xs text-muted-foreground">
                  Note for {SHIPMENT_EXCEPTION_CODE_META[activeExceptionCode].label}
                  <span className="text-red-500"> *</span>
                </Label>
                <Textarea
                  placeholder="Required: describe the exception..."
                  rows={3}
                  value={exceptionNotes[activeExceptionCode] || ''}
                  onChange={(e) =>
                    setExceptionNotes((prev) => ({ ...prev, [activeExceptionCode]: e.target.value }))
                  }
                  onBlur={() => void handleExceptionNoteBlur(activeExceptionCode)}
                  disabled={!canEdit}
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void removeException(activeExceptionCode)}
                    disabled={!canEdit}
                    className="text-red-600 hover:text-red-700"
                  >
                    <MaterialIcon name="delete" size="sm" className="mr-1" />
                    Remove Exception
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No exceptions selected.</p>
        )}
      </div>
    );

    const autosaveIndicator = (
      <AutosaveIndicator status={autosave.status} onRetry={autosave.retryNow} />
    );

    const dialogs = (
      <>
        {/* Required Exception Note Dialog */}
        <Dialog open={!!pendingRequiredNoteCode} onOpenChange={(open) => !open && setPendingRequiredNoteCode(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MaterialIcon name="edit_note" size="sm" />
                {pendingRequiredNoteCode
                  ? `Add note for ${SHIPMENT_EXCEPTION_CODE_META[pendingRequiredNoteCode].label}`
                  : 'Add exception note'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label>
                Note <span className="text-red-500">*</span>
              </Label>
              <Textarea
                value={pendingRequiredNote}
                onChange={(e) => setPendingRequiredNote(e.target.value)}
                rows={4}
                placeholder="Describe the exception. A note is required before this exception can be added."
                disabled={!canEdit}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPendingRequiredNoteCode(null)}>
                Cancel
              </Button>
              <Button onClick={() => void handleSaveRequiredNote()} disabled={!canEdit}>
                Add Exception
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Signature Dialog */}
        <Dialog open={showSignatureDialog} onOpenChange={handleSignatureDialogOpenChange}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MaterialIcon name="draw" size="sm" />
                Delivery Signature
              </DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sig-name">Driver name <span className="text-red-500">*</span></Label>
                  <Input
                    id="sig-name"
                    value={signatureDraftName}
                    onChange={(e) => setSignatureDraftName(e.target.value)}
                    placeholder="Driver name (required if drawing)"
                    disabled={!canEdit}
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional overall. If you draw a signature, Driver name is required.
                  </p>
                </div>
                <SignaturePad
                  onSignatureChange={(data) => {
                    setSignatureDraftData(data.signatureData);
                    if (data.signatureName) setSignatureDraftName(data.signatureName);
                  }}
                  initialName={signatureDraftName}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleSignatureDialogOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  void handleSignatureComplete(signatureDraftData, signatureDraftName);
                }}
                disabled={!canEdit || !signatureDraftName.trim() || (!!signatureDraftData && !signatureDraftName.trim())}
              >
                <MaterialIcon name="check" size="sm" className="mr-2" />
                Save Signature
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );

    return renderLayout({
      shipmentSummaryContent,
      signatureContent,
      photosContent,
      documentsContent,
      exceptionsContent,
      autosaveIndicator,
      onCompleteStage1: handleComplete,
      completing,
      canEdit,
      dialogs,
    }) as JSX.Element;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-primary">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="local_shipping" size="md" className="text-primary" />
                Stage 1 — Dock Intake
                <Badge variant="outline" className="font-mono whitespace-nowrap">{shipmentNumber}</Badge>
                <ShipmentExceptionBadge
                  shipmentId={shipmentId}
                  onClick={onOpenExceptions}
                />
              </CardTitle>
              <CardDescription className="mt-1">
                Record the delivery at the dock. All fields autosave.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <JobTimerWidget
                jobType="shipment"
                jobId={shipmentId}
                variant="inline"
                showControls={false}
              />
              <AutosaveIndicator status={autosave.status} onRetry={autosave.retryNow} />
            </div>
          </div>
        </CardHeader>
        {accountDefaultShipmentNotes ? (
          <CardContent className="pt-0">
            <div className={`rounded-xl border-2 px-4 py-3 ${accountHighlightShipmentNotes ? 'border-yellow-400 bg-yellow-50' : 'border-border/60 bg-muted/30'}`}>
              <div className={`flex items-center gap-2 text-xs font-semibold ${accountHighlightShipmentNotes ? 'text-yellow-800' : 'text-muted-foreground'}`}>
                <MaterialIcon name="sticky_note_2" size="sm" />
                Default Shipment Notes
              </div>
              <div className={`mt-1 text-sm whitespace-pre-wrap ${accountHighlightShipmentNotes ? 'text-yellow-900 font-medium' : 'text-foreground'}`}>
                {accountDefaultShipmentNotes}
              </div>
            </div>
          </CardContent>
        ) : null}
      </Card>

      {/* Shipment Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MaterialIcon name="business" size="sm" />
            Shipment Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>
              Account <span className="text-red-500">*</span>
            </Label>
            <AccountSelect
              value={accountId}
              onChange={handleAccountChange}
              placeholder="Select account..."
              clearable={false}
              className="w-full"
              disabled={!canEdit}
            />
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="return-intake-stage1-default" className="text-sm font-medium">
                  Return Intake
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Use when items are returning to the warehouse after delivery/pickup.
                </p>
                {isReturnShipmentType ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    This shipment is already typed as a return.
                  </p>
                ) : null}
              </div>
              <Switch
                id="return-intake-stage1-default"
                checked={isReturnIntake}
                onCheckedChange={handleReturnIntakeChange}
                disabled={!canEdit || isReturnShipmentType}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Initiated</Label>
              <div className="h-10 rounded-md border bg-muted/30 px-3 text-sm flex items-center">
                {formatSummaryDate(shipment.created_at)}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Received</Label>
              <div className="h-10 rounded-md border bg-muted/30 px-3 text-sm flex items-center">
                {formatSummaryDate(shipment.received_at)}
              </div>
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="carrier_name">Carrier Name</Label>
              <Input
                id="carrier_name"
                placeholder="Enter carrier..."
                value={carrierName}
                onChange={(e) => handleCarrierNameChange(e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tracking_number">Tracking #</Label>
              <Input
                id="tracking_number"
                placeholder="Enter tracking..."
                value={trackingNumber}
                onChange={(e) => handleTrackingNumberChange(e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="po_number">Reference / PO #</Label>
              <Input
                id="po_number"
                placeholder="Enter reference..."
                value={poNumber}
                onChange={(e) => handlePoNumberChange(e.target.value)}
                disabled={!canEdit}
              />
            </div>
          </div>

          {accountId && (
            <div className="space-y-2">
              <Label>Sidemark / Project</Label>
              <SidemarkSelect
                accountId={accountId}
                value={sidemarkId || null}
                onChange={handleSidemarkChange}
                placeholder="Select sidemark..."
                disabled={!canEdit}
                allowCreate
              />
            </div>
          )}

          <Separator />

          <div className="space-y-6">
            {/* Carrier count */}
            <div className="space-y-2">
              <div className="flex items-center gap-1 justify-center">
                <Label htmlFor="carrier_count">
                  Carrier count <span className="text-red-500">*</span>
                </Label>
                <HelpTip
                  tooltip="Carrier paperwork piece count (what you sign for)."
                  pageKey="receiving.stage1"
                  fieldKey="carrier_count"
                />
              </div>
              <BigCounter
                id="carrier_count"
                value={signedPieces}
                onChange={handleSignedPiecesChange}
                min={0}
                step={1}
                disabled={!canEdit}
              />
            </div>

            {/* Dock Count */}
            <div className="space-y-2">
              <div className="flex items-center gap-1 justify-center">
                <Label htmlFor="dock_count">
                  Dock Count <span className="text-red-500">*</span>
                </Label>
                <HelpTip
                  tooltip="Physical piece count at the dock (Stage 1 actual count)."
                  pageKey="receiving.stage1"
                  fieldKey="dock_count"
                />
              </div>
              <BigCounter
                id="dock_count"
                value={dockCount}
                onChange={handleDockCountChange}
                min={0}
                step={1}
                disabled={!canEdit}
              />
            </div>

            {/* Entry Count */}
            <div className="space-y-2">
              <div className="flex items-center gap-1 justify-center">
                <Label htmlFor="entry_count">Entry Count</Label>
                <HelpTip
                  tooltip="Read-only. Calculated from Stage 2 item rows (each row = 1 carton / package / piece)."
                  pageKey="receiving.stage1"
                  fieldKey="entry_count"
                />
              </div>
              <div className="flex flex-col items-center gap-2">
                <div
                  id="entry_count"
                  className="min-w-20 text-center text-5xl font-bold tabular-nums text-muted-foreground"
                  aria-label="Entry Count (read-only)"
                >
                  {entryCount}
                </div>
                <p className="text-xs text-muted-foreground">Read-only</p>
              </div>
            </div>

            {/* Carrier vs Dock mismatch indicator */}
            {signedPieces > 0 && dockCount > 0 && signedPieces !== dockCount && (
              <div className="flex justify-center">
                <Badge variant="destructive" className="gap-1">
                  <MaterialIcon name="warning" size="sm" />
                  {dockCount > signedPieces ? 'Overage' : 'Shortage'} by {Math.abs(dockCount - signedPieces)}
                </Badge>
              </div>
            )}
          </div>

        </CardContent>
      </Card>

      {/* Mixed Unit Breakdown (optional) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MaterialIcon name="inventory" size="sm" />
            Unit Breakdown (optional)
            <HelpTip
              tooltip="Enter cartons/pallets/crates. Dock Count will auto-calculate as the sum when you use this breakdown (you can still type Carrier count and Dock Count directly)."
              pageKey="receiving.stage1"
              fieldKey="unit_breakdown"
            />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="cartons">Cartons</Label>
              <Input
                id="cartons"
                type="number"
                min={0}
                value={breakdown.cartons || ''}
                onChange={(e) => handleBreakdownChange('cartons', parseInt(e.target.value) || 0)}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pallets">Pallets</Label>
              <Input
                id="pallets"
                type="number"
                min={0}
                value={breakdown.pallets || ''}
                onChange={(e) => handleBreakdownChange('pallets', parseInt(e.target.value) || 0)}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="crates">Crates</Label>
              <Input
                id="crates"
                type="number"
                min={0}
                value={breakdown.crates || ''}
                onChange={(e) => handleBreakdownChange('crates', parseInt(e.target.value) || 0)}
                disabled={!canEdit}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Exceptions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MaterialIcon name="report_problem" size="sm" />
            Exceptions (optional)
            <HelpTip
              tooltip="Select any exceptions observed at the dock. If you select an exception, add a note for each selected chip. Shortage/Overage auto-syncs when Carrier and Dock counts differ."
              pageKey="receiving.stage1"
              fieldKey="exceptions"
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {EXCEPTION_OPTIONS.map((opt) => {
              const isSelected = exceptions.includes(opt.value);
              return (
                <Button
                  key={opt.value}
                  variant={isSelected ? 'default' : 'outline'}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => toggleException(opt.value)}
                  disabled={!canEdit}
                >
                  <MaterialIcon name={opt.icon} size="sm" />
                  {opt.label}
                </Button>
              );
            })}
          </div>

          {/* Exception notes for selected exceptions */}
          {exceptions.map((ex) => (
            <div key={ex} className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Note for {EXCEPTION_OPTIONS.find((o) => o.value === ex)?.label}
                <span className="text-red-500"> *</span>
              </Label>
              <Textarea
                placeholder="Required: describe the exception..."
                rows={2}
                value={exceptionNotes[ex] || ''}
                onChange={(e) => setExceptionNotes((prev) => ({ ...prev, [ex]: e.target.value }))}
                onBlur={() => void handleExceptionNoteBlur(ex)}
                disabled={!canEdit}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Photos (single field — legacy incoming shipments style) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MaterialIcon name="photo_camera" size="sm" />
            Photos <span className="text-red-500">*</span>
            <Badge variant={getPhotoUrls(receivingPhotos).length >= 1 ? 'default' : 'destructive'}>
              {getPhotoUrls(receivingPhotos).length}
            </Badge>
            <HelpTip
              tooltip="Capture or upload photos (paperwork, condition, etc.)."
              pageKey="receiving.stage1"
              fieldKey="photos"
            />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {getPhotoUrls(receivingPhotos).length > 0 ? (
            <TaggablePhotoGrid
              photos={receivingPhotos}
              enableTagging={canEdit}
              readonly={!canEdit}
              onPhotosChange={
                canEdit
                  ? async (photos) => {
                      try {
                        await saveReceivingPhotosToShipment(photos);
                      } catch (err: any) {
                        toast({
                          variant: 'destructive',
                          title: 'Photo Error',
                          description: err?.message || 'Failed to save photos',
                        });
                      }
                    }
                  : undefined
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No photos yet. At least 1 required.
            </p>
          )}

          {/* Buttons (match Documents layout) */}
          {canEdit && getPhotoUrls(receivingPhotos).length < 20 && (
            <div className="flex gap-2 pt-3">
              <PhotoScannerButton
                entityType="shipment"
                entityId={shipmentId}
                tenantId={profile?.tenant_id}
                existingPhotos={getPhotoUrls(receivingPhotos)}
                maxPhotos={20}
                size="sm"
                variant="outline"
                label="Scan"
                showCount={false}
                className="flex-1"
                onPhotosSaved={async (urls) => {
                  try {
                    await mergeAndSaveReceivingPhotoUrls(urls);
                  } catch (err: any) {
                    toast({
                      variant: 'destructive',
                      title: 'Photo Error',
                      description: err?.message || 'Failed to save photos',
                    });
                  }
                }}
              />
              <PhotoUploadButton
                entityType="shipment"
                entityId={shipmentId}
                tenantId={profile?.tenant_id}
                existingPhotos={getPhotoUrls(receivingPhotos)}
                maxPhotos={20}
                size="sm"
                variant="outline"
                label="Upload"
                className="flex-1"
                showHint={false}
                onPhotosSaved={async (urls) => {
                  try {
                    await mergeAndSaveReceivingPhotoUrls(urls);
                  } catch (err: any) {
                    toast({
                      variant: 'destructive',
                      title: 'Photo Error',
                      description: err?.message || 'Failed to save photos',
                    });
                  }
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Documents */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MaterialIcon name="description" size="sm" />
            Documents
            <Badge variant="outline">{documents.length}</Badge>
            <HelpTip
              tooltip="Capture or upload delivery paperwork. Tap a document thumbnail to open it, or use the download icon to email/print."
              pageKey="receiving.stage1"
              fieldKey="documents"
            />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentCapture
            context={{ type: 'shipment', shipmentId, shipmentNumber }}
            maxDocuments={12}
            ocrEnabled={true}
            canEdit={canEdit}
            onDocumentAdded={() => {
              void refetchDocuments();
            }}
            onDocumentRemoved={() => {
              void refetchDocuments();
            }}
          />
        </CardContent>
      </Card>

      {/* Billing (Manager/Admin Only) */}
      {canSeeBilling && showBillingCalculator ? (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MaterialIcon name="attach_money" size="sm" className="text-primary" />
              Billing Calculator
              <HelpTip
                tooltip="Shows billing preview + recorded charges. Use Add Charge/Add Credit to adjust billing. (Manager/Admin only)"
                pageKey="receiving.stage1"
                fieldKey="billing"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAddChargeOpen(true)}
                disabled={!accountId || !canEdit}
              >
                <MaterialIcon name="attach_money" size="sm" />
                Add Charge
              </Button>
              {canAddCredit ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setAddCreditOpen(true)}
                  disabled={!accountId || !canEdit}
                >
                  <MaterialIcon name="money_off" size="sm" />
                  Add Credit
                </Button>
              ) : null}
            </div>
          </div>

          {accountId ? (
            <BillingCalculator
              shipmentId={shipmentId}
              refreshKey={effectiveBillingRefreshKey}
              title="Billing Calculator"
            />
          ) : (
            <Card>
              <CardContent className="py-4 text-sm text-muted-foreground">
                Select an account to view and edit billing.
              </CardContent>
            </Card>
          )}

          {/* Add Charge Dialog */}
          {accountId ? (
            <AddAddonDialog
              open={addChargeOpen}
              onOpenChange={setAddChargeOpen}
              accountId={accountId}
              shipmentId={shipmentId}
              onSuccess={() => {
                setBillingRefreshKey((prev) => prev + 1);
                onRefresh();
              }}
            />
          ) : null}

          {/* Add Credit Dialog (Admin only) */}
          {accountId ? (
            <AddCreditDialog
              open={addCreditOpen}
              onOpenChange={setAddCreditOpen}
              accountId={accountId}
              shipmentId={shipmentId}
              onSuccess={() => {
                setBillingRefreshKey((prev) => prev + 1);
                onRefresh();
              }}
            />
          ) : null}
        </div>
      ) : null}

      {/* Signature (optional) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MaterialIcon name="draw" size="sm" />
            Signature (optional)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="border rounded-md p-2 bg-white">
            {signatureData ? (
              <img src={signatureData} alt="Signature" className="max-h-24 mx-auto" />
            ) : signatureName.trim() ? (
              <div className="min-h-24 flex items-center justify-center">
                <span className="text-3xl font-cursive italic text-gray-800">
                  {signatureName.trim()}
                </span>
              </div>
            ) : (
              <div className="min-h-24 flex items-center justify-center text-sm text-muted-foreground">
                No signature captured
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="text-sm text-muted-foreground">
              {signatureName.trim() ? (
                <>
                  Signed by:{' '}
                  <span className="text-foreground">{signatureName.trim()}</span>
                  {formatSignedAt(signatureTimestamp) ? (
                    <>
                      {' '}
                      · Signed at:{' '}
                      <span className="text-foreground">{formatSignedAt(signatureTimestamp)}</span>
                    </>
                  ) : null}
                </>
              ) : (
                <span>Optional</span>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => handleSignatureDialogOpenChange(true)} disabled={!canEdit}>
                <MaterialIcon name={signatureData || signatureName.trim() ? 'edit' : 'draw'} size="sm" className="mr-2" />
                {signatureData || signatureName.trim() ? 'Edit' : 'Capture'}
              </Button>
              {signatureData || signatureName.trim() ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleClearSignature()}
                  disabled={!canEdit}
                  className="text-red-600 hover:text-red-700"
                >
                  <MaterialIcon name="delete" size="sm" className="mr-1" />
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Complete Stage 1 */}
      {showCompleteButton ? (
        <div className="flex flex-col sm:flex-row gap-3 justify-end">
          <Button
            size="lg"
            onClick={handleComplete}
            disabled={completing || !canEdit}
            className="gap-2"
          >
            {completing ? (
              <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
            ) : (
              <MaterialIcon name="check_circle" size="sm" />
            )}
            Complete Dock Intake
          </Button>
        </div>
      ) : null}

      {/* Required Exception Note Dialog */}
      <Dialog open={!!pendingRequiredNoteCode} onOpenChange={(open) => !open && setPendingRequiredNoteCode(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="edit_note" size="sm" />
              {pendingRequiredNoteCode
                ? `Add note for ${SHIPMENT_EXCEPTION_CODE_META[pendingRequiredNoteCode].label}`
                : 'Add exception note'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>
              Note <span className="text-red-500">*</span>
            </Label>
            <Textarea
              value={pendingRequiredNote}
              onChange={(e) => setPendingRequiredNote(e.target.value)}
              rows={4}
              placeholder="Describe the exception. A note is required before this exception can be added."
              disabled={!canEdit}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRequiredNoteCode(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSaveRequiredNote()} disabled={!canEdit}>
              Add Exception
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Signature Dialog */}
      <Dialog open={showSignatureDialog} onOpenChange={handleSignatureDialogOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="draw" size="sm" />
              Delivery Signature
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sig-name">Driver name <span className="text-red-500">*</span></Label>
                <Input
                  id="sig-name"
                  value={signatureDraftName}
                  onChange={(e) => setSignatureDraftName(e.target.value)}
                  placeholder="Driver name (required if drawing)"
                  disabled={!canEdit}
                />
                <p className="text-xs text-muted-foreground">
                  Optional overall. If you draw a signature, Driver name is required.
                </p>
              </div>
              <SignaturePad
                onSignatureChange={(data) => {
                  setSignatureDraftData(data.signatureData);
                  if (data.signatureName) setSignatureDraftName(data.signatureName);
                }}
                initialName={signatureDraftName}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleSignatureDialogOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handleSignatureComplete(signatureDraftData, signatureDraftName);
              }}
              disabled={!canEdit || !signatureDraftName.trim() || (!!signatureDraftData && !signatureDraftName.trim())}
            >
              <MaterialIcon name="check" size="sm" className="mr-2" />
              Save Signature
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
