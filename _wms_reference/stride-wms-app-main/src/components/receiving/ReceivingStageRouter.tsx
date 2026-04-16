import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useSearchParams, useNavigate } from 'react-router-dom';
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
import { Stage1DockIntake } from './Stage1DockIntake';
import type { MatchingParamsUpdate, Stage1Sections } from './Stage1DockIntake';
import { Stage2DetailedReceiving } from './Stage2DetailedReceiving';
import type { ItemMatchingParams } from './Stage2DetailedReceiving';
import { StatusBar } from './StatusBar';
import { ExceptionsTab } from './ExceptionsTab';
import { useShipmentExceptions } from '@/hooks/useShipmentExceptions';
import DockIntakeMatchingPanel from '@/components/incoming/DockIntakeMatchingPanel';
import type { CandidateParams } from '@/hooks/useInboundCandidates';
import { downloadReceivingPdf, storeReceivingPdf, type ReceivingPdfData } from '@/lib/receivingPdf';
import {
  queueReceivingDiscrepancyAlert,
  queueReturnShipmentProcessedAlert,
  queueShipmentReceivedAlert,
} from '@/lib/alertQueue';
import { ShipmentExceptionBadge } from '@/components/shipments/ShipmentExceptionBadge';
import { ShipmentNumberBadge } from '@/components/shipments/ShipmentNumberBadge';
import { DockIntakeNotesPanel } from '@/components/receiving/DockIntakeNotesPanel';
import { EntityActivityFeed } from '@/components/activity/EntityActivityFeed';
import { BillingCalculator } from '@/components/billing/BillingCalculator';
import { AddAddonDialog } from '@/components/billing/AddAddonDialog';
import { AddCreditDialog } from '@/components/billing/AddCreditDialog';
import { timerEndJob, timerStartJob } from '@/lib/time/timerClient';
import { JobTimerWidget } from '@/components/time/JobTimerWidget';
import { isReturnIntakeShipment } from '@/lib/shipments/returnIntake';

interface ShipmentData {
  id: string;
  shipment_number: string;
  shipment_type: string;
  inbound_status: string | null;
  inbound_kind: string | null;
  account_id: string | null;
  vendor_name: string | null;
  signed_pieces: number | null;
  received_pieces: number | null;
  created_at: string;
  received_at: string | null;
  driver_name: string | null;
  signature_data: string | null;
  signature_name: string | null;
  dock_intake_breakdown: Record<string, unknown> | null;
  notes: string | null;
  warehouse_id: string | null;
  sidemark_id: string | null;
  metadata: Record<string, unknown> | null;
  shipment_exception_type: string | null;
  return_type: string | null;
}

interface ReceivingStageRouterProps {
  shipmentId: string;
}

type InboundStatus = 'draft' | 'stage1_complete' | 'receiving' | 'closed';

export function ReceivingStageRouter({ shipmentId }: ReceivingStageRouterProps) {
  const { profile } = useAuth();
  const { hasRole } = usePermissions();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [shipment, setShipment] = useState<ShipmentData | null>(null);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileMatchingOpen, setMobileMatchingOpen] = useState(false);
  const [pdfRetrying, setPdfRetrying] = useState(false);
  const { openCount } = useShipmentExceptions(shipmentId);

  const notesSectionRef = useRef<HTMLDivElement>(null);
  const [notesSubTab, setNotesSubTab] = useState<'public' | 'internal' | 'exceptions'>(() => {
    const tab = searchParams.get('tab');
    if (tab === 'exceptions') return 'exceptions';
    return 'internal';
  });

  const [liveMatchingParams, setLiveMatchingParams] = useState<MatchingParamsUpdate | null>(null);
  const [itemMatchingParams, setItemMatchingParams] = useState<ItemMatchingParams | null>(null);
  const [entryCount, setEntryCount] = useState<number>(0);

  const [billingRefreshKey, setBillingRefreshKey] = useState(0);
  const [addChargeOpen, setAddChargeOpen] = useState(false);
  const [addCreditOpen, setAddCreditOpen] = useState(false);
  const canSeeBilling = hasRole('admin') || hasRole('manager') || hasRole('billing_manager');
  const canAddCredit = hasRole('admin') || hasRole('billing_manager');

  const stage2ScrollAnchorId = `receiving.stage2.anchor.${shipmentId}`;
  const [startingStage2, setStartingStage2] = useState(false);
  const [closedEditMode, setClosedEditMode] = useState(false);
  const [pendingStage2Jump, setPendingStage2Jump] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleDeleteShipment = async () => {
    const { error } = await (supabase as any)
      .from('shipments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', shipmentId);
    if (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete shipment' });
    } else {
      toast({ title: 'Deleted', description: 'Shipment has been removed.' });
      navigate('/incoming');
    }
  };

  useEffect(() => {
    if (shipment?.inbound_status !== 'closed') {
      setClosedEditMode(false);
    }
  }, [shipment?.inbound_status]);

  useEffect(() => {
    if (!pendingStage2Jump) return;
    const inboundStatus = (shipment?.inbound_status || 'draft') as InboundStatus;
    if (inboundStatus !== 'receiving' && inboundStatus !== 'closed') return;

    const raf = window.requestAnimationFrame(() => {
      const el = document.getElementById(stage2ScrollAnchorId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });

      const stage2Container = el?.nextElementSibling ?? el?.parentElement;
      const focusable =
        (stage2Container?.querySelector('input, textarea') as HTMLElement | null) ??
        (stage2Container?.querySelector('input, textarea, button') as HTMLElement | null);
      focusable?.focus?.();

      setPendingStage2Jump(false);
    });

    return () => window.cancelAnimationFrame(raf);
  }, [pendingStage2Jump, shipment?.inbound_status, stage2ScrollAnchorId]);

  const [stage2ConfirmOpen, setStage2ConfirmOpen] = useState(false);
  const [stage2ConfirmLoading, setStage2ConfirmLoading] = useState(false);
  const [stage2ActiveJobLabel, setStage2ActiveJobLabel] = useState<string | null>(null);

  const fetchShipment = useCallback(async () => {
    if (!shipmentId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('shipments')
        .select('*')
        .eq('id', shipmentId)
        .single();

      if (error) throw error;
      setShipment(data as any);

      if ((data as any).account_id) {
        const { data: account } = await supabase
          .from('accounts')
          .select('account_name')
          .eq('id', (data as any).account_id)
          .single();
        setAccountName(account?.account_name || null);
      }
    } catch (err) {
      console.error('[ReceivingStageRouter] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => {
    fetchShipment();
  }, [fetchShipment]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'exceptions') {
      setNotesSubTab('exceptions');
      setTimeout(() => {
        notesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } else if (tab === 'notes') {
      setTimeout(() => {
        notesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [searchParams]);

  const setTab = (tab: 'receiving' | 'exceptions' | 'notes') => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'exceptions') {
      next.set('tab', 'exceptions');
      setNotesSubTab('exceptions');
      setTimeout(() => {
        notesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } else if (tab === 'notes') {
      next.set('tab', 'notes');
      setNotesSubTab('internal');
      setTimeout(() => {
        notesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } else {
      next.delete('tab');
    }
    setSearchParams(next, { replace: true });
  };

  const handleStageChange = () => {
    setItemMatchingParams(null);
    fetchShipment();
  };

  const handleMatchingParamsChange = useCallback((params: MatchingParamsUpdate) => {
    setLiveMatchingParams(params);
  }, []);

  const handleItemMatchingParamsChange = useCallback((params: ItemMatchingParams) => {
    setItemMatchingParams(params);
  }, []);

  const handleStartStage2 = async () => {
    if (startingStage2) return;
    setStartingStage2(true);
    try {
      let timerStarted = false;

      const timerResult = await timerStartJob({
        tenantId: profile?.tenant_id,
        userId: profile?.id,
        jobType: 'shipment',
        jobId: shipmentId,
        pauseExisting: false,
      });
      if (timerResult?.ok === false) {
        if (timerResult.error_code === 'ACTIVE_TIMER_EXISTS') {
          let label = 'another job';
          try {
            if (timerResult.active_job_type === 'task' && timerResult.active_job_id) {
              const { data: t } = await (supabase.from('tasks') as any)
                .select('title, task_type')
                .eq('tenant_id', profile?.tenant_id || '')
                .eq('id', timerResult.active_job_id)
                .maybeSingle();
              label = t?.title || (t?.task_type ? `${t.task_type} task` : 'another task');
            } else if (timerResult.active_job_type === 'shipment' && timerResult.active_job_id) {
              const { data: s } = await (supabase.from('shipments') as any)
                .select('shipment_number')
                .eq('tenant_id', profile?.tenant_id || '')
                .eq('id', timerResult.active_job_id)
                .maybeSingle();
              label = s?.shipment_number ? `Shipment ${s.shipment_number}` : 'another shipment';
            } else if (timerResult.active_job_type) {
              label = `${timerResult.active_job_type} job`;
            }
          } catch {
            // Best-effort
          }

          setStage2ActiveJobLabel(label);
          setStage2ConfirmOpen(true);
          return;
        }
        throw new Error(timerResult.error_message || 'Failed to start timer');
      }
      timerStarted = true;

      const { error } = await supabase
        .from('shipments')
        .update({ inbound_status: 'receiving' } as any)
        .eq('id', shipmentId);

      if (error) {
        if (timerStarted) {
          try {
            await timerEndJob({
              tenantId: profile?.tenant_id,
              userId: profile?.id,
              jobType: 'shipment',
              jobId: shipmentId,
              reason: 'rollback',
            });
          } catch {
            // ignore
          }
        }
        throw error;
      }

      setPendingStage2Jump(true);

      toast({
        type: 'success',
        title: 'Stage 2 started',
        description: 'You can now enter item details.',
      });
      handleStageChange();
    } catch (err: any) {
      console.error('[ReceivingStageRouter] start stage2 error:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err?.message || 'Failed to start Stage 2',
      });
    } finally {
      setStartingStage2(false);
    }
  };

  const buildPdfData = async (s: ShipmentData): Promise<ReceivingPdfData> => {
    const { data: company } = await supabase
      .from('tenant_company_settings')
      .select('company_name, company_address, company_phone, company_email, logo_url')
      .eq('tenant_id', profile!.tenant_id)
      .maybeSingle();

    let warehouseName: string | null = null;
    if (s.warehouse_id) {
      const { data: wh } = await supabase
        .from('warehouses')
        .select('name')
        .eq('id', s.warehouse_id)
        .single();
      warehouseName = wh?.name || null;
    }

    const { data: items } = await (supabase as any)
      .from('shipment_items')
      .select('expected_description, actual_quantity, expected_vendor, expected_sidemark')
      .eq('shipment_id', shipmentId)
      .eq('status', 'received');

    return {
      shipmentNumber: s.shipment_number,
      vendorName: s.vendor_name,
      accountName: accountName,
      signedPieces: s.signed_pieces,
      receivedPieces: s.received_pieces,
      driverName: s.driver_name,
      companyName: company?.company_name || 'Stride WMS',
      companyAddress: company?.company_address || null,
      companyPhone: company?.company_phone || null,
      companyEmail: company?.company_email || null,
      warehouseName,
      signatureData: s.signature_data,
      signatureName: s.signature_name || null,
      items: (items || []).map((i: any) => ({
        description: i.expected_description || '-',
        quantity: i.actual_quantity || 0,
        vendor: i.expected_vendor || null,
        sidemark: i.expected_sidemark || null,
      })),
      receivedAt: new Date().toISOString(),
    };
  };

  const handleReceivingComplete = async () => {
    if (shipment && profile?.tenant_id) {
      try {
        const pdfData = await buildPdfData(shipment);
        const result = await storeReceivingPdf(pdfData, shipmentId, profile.tenant_id, profile.id);
        if (!result.success) {
          toast({
            variant: 'destructive',
            title: 'Receiving Document not saved',
            description: 'Receiving was completed, but the Receiving Document could not be saved. You can retry from the PDF section.',
          });
        }
      } catch {
        console.warn('[ReceivingStageRouter] PDF generation failed (non-blocking)');
      }

      try {
        const isReturnIntake = isReturnIntakeShipment({
          shipment_type: shipment.shipment_type,
          return_type: shipment.return_type,
        });

        if (isReturnIntake) {
          // Return-intake flow: send only return-processed notification.
          void queueReturnShipmentProcessedAlert(
            profile.tenant_id,
            shipmentId,
            shipment.shipment_number,
            entryCount
          );
        } else {
          // Standard inbound flow: shipment received notification.
          void queueShipmentReceivedAlert(
            profile.tenant_id,
            shipmentId,
            shipment.shipment_number,
            entryCount
          );
        }

        const { data: exceptions } = await (supabase as any)
          .from('shipment_exceptions')
          .select('id')
          .eq('shipment_id', shipmentId)
          .eq('tenant_id', profile.tenant_id)
          .eq('status', 'open');

        if (exceptions && exceptions.length > 0) {
          queueReceivingDiscrepancyAlert(
            profile.tenant_id,
            shipmentId,
            shipment.shipment_number,
            exceptions.length
          );
        }
      } catch {
        // Alert failure is non-blocking
      }
    }

    fetchShipment();
  };

  const handleDownloadPdf = async () => {
    if (!shipment || !profile?.tenant_id) return;

    const meta = shipment.metadata as Record<string, unknown> | null;
    const pdfKey = meta?.receiving_pdf_key as string | undefined;

    if (pdfKey) {
      const { data, error } = await supabase.storage
        .from('documents-private')
        .createSignedUrl(pdfKey, 300);

      if (!error && data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
        return;
      }
    }

    try {
      const pdfData = await buildPdfData(shipment);
      downloadReceivingPdf(pdfData);
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'PDF Error',
        description: err?.message || 'Failed to generate PDF',
      });
    }
  };

  const handleRetryPdf = async () => {
    if (!shipment || !profile?.tenant_id) return;
    setPdfRetrying(true);
    try {
      const pdfData = await buildPdfData(shipment);
      const result = await storeReceivingPdf(pdfData, shipmentId, profile.tenant_id, profile.id);
      if (result.success) {
        toast({ title: 'PDF Generated', description: 'Receiving PDF has been stored.' });
        fetchShipment();
      } else {
        throw new Error('Storage failed');
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'PDF Retry Failed',
        description: err?.message || 'Could not generate PDF. Try again later.',
      });
    } finally {
      setPdfRetrying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
      </div>
    );
  }

  if (!shipment) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <MaterialIcon name="error" size="xl" className="mb-2 opacity-40" />
        <p>Shipment not found.</p>
      </div>
    );
  }

  const status = (shipment.inbound_status || 'draft') as InboundStatus;

  const matchingParams: CandidateParams = {
    accountId: liveMatchingParams?.accountId ?? shipment.account_id,
    vendorName: shipment.vendor_name || liveMatchingParams?.shipper || null,
    trackingNumber: liveMatchingParams?.trackingNumber ?? ((shipment as any).tracking_number || null),
    referenceNumber: liveMatchingParams?.referenceNumber ?? ((shipment as any).po_number || null),
    shipper: liveMatchingParams?.shipper ?? ((shipment as any).carrier || null),
    pieces: liveMatchingParams?.pieces ?? shipment.signed_pieces,
    itemDescription: itemMatchingParams?.itemDescription || null,
    itemVendor: itemMatchingParams?.itemVendor || null,
    itemSku: itemMatchingParams?.itemSku || null,
  };

  const hasPdf = !!(shipment.metadata as Record<string, unknown> | null)?.receiving_pdf_key;
  const showMatchingPanel = status !== 'closed';
  const effectiveAccountId = liveMatchingParams?.accountId ?? shipment.account_id ?? null;

  const matchingPanelContent = showMatchingPanel ? (
    <DockIntakeMatchingPanel
      dockIntakeId={shipmentId}
      params={matchingParams}
      onLinked={fetchShipment}
      showItemRefinement={status === 'receiving'}
    />
  ) : null;

  const billingPanelContent = canSeeBilling ? (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <MaterialIcon name="attach_money" size="sm" className="text-primary" />
            Billing
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAddChargeOpen(true)}
              disabled={!effectiveAccountId}
              className="h-7 px-2 text-xs"
            >
              + Charge
            </Button>
            {canAddCredit ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAddCreditOpen(true)}
                disabled={!effectiveAccountId}
                className="h-7 px-2 text-xs"
              >
                + Credit
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {effectiveAccountId ? (
          <BillingCalculator
            shipmentId={shipmentId}
            refreshKey={billingRefreshKey}
            title="Billing Calculator"
          />
        ) : (
          <div className="rounded-md border bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
            Select an account in Stage 1 to view and edit billing.
          </div>
        )}
      </CardContent>
    </Card>
  ) : null;

  const renderStatusBarActions = () => {
    switch (status) {
      case 'draft':
        return null;
      case 'stage1_complete':
        return (
          <Button onClick={() => void handleStartStage2()} disabled={startingStage2} size="sm" className="gap-2">
            {startingStage2 ? (
              <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
            ) : (
              <MaterialIcon name="play_arrow" size="sm" />
            )}
            Start Stage 2
          </Button>
        );
      case 'receiving':
        return (
          <JobTimerWidget
            jobType="shipment"
            jobId={shipmentId}
            variant="inline"
            showControls={false}
          />
        );
      case 'closed':
        return (
          <>
            <Button variant="outline" size="sm" onClick={handleDownloadPdf}>
              <MaterialIcon name="picture_as_pdf" size="sm" className="mr-1" />
              {hasPdf ? 'Download PDF' : 'Generate PDF'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleRetryPdf} disabled={pdfRetrying}>
              {pdfRetrying ? (
                <MaterialIcon name="progress_activity" size="sm" className="mr-1 animate-spin" />
              ) : (
                <MaterialIcon name="refresh" size="sm" className="mr-1" />
              )}
              Regenerate PDF
            </Button>
            <Button
              variant={closedEditMode ? 'secondary' : 'default'}
              size="sm"
              onClick={() => setClosedEditMode((prev) => !prev)}
            >
              <MaterialIcon name={closedEditMode ? 'lock' : 'edit'} size="sm" className="mr-1" />
              {closedEditMode ? 'Done' : 'Edit'}
            </Button>
          </>
        );
      default:
        return null;
    }
  };

  // Common Stage1 props (shared across all statuses)
  const stage1CommonProps = {
    shipmentId,
    shipmentNumber: shipment.shipment_number,
    shipment: shipment as any,
    onComplete: handleStageChange,
    onRefresh: fetchShipment,
    onMatchingParamsChange: handleMatchingParamsChange,
    onOpenExceptions: () => setTab('exceptions'),
    entryCount,
    externalBillingRefreshKey: billingRefreshKey,
    showCompleteButton: false,
    showBillingCalculator: false,
  };

  // We need to capture stage1 sections for layout placement.
  // Use a ref-based approach: Stage1 calls renderLayout synchronously during render,
  // so we capture the sections in a variable.
  let stage1Sections: Stage1Sections | null = null;
  const captureStage1Layout = (sections: Stage1Sections) => {
    stage1Sections = sections;
    // Only return elements that must remain mounted; visible sections are placed by this parent.
    return (
      <>
        {sections.autosaveIndicator}
        {sections.dialogs}
      </>
    );
  };

  // Render the Stage1 component to capture its sections
  const stage1Element = (
    <Stage1DockIntake
      {...stage1CommonProps}
      readOnly={status === 'closed' ? !closedEditMode : false}
      renderLayout={captureStage1Layout}
    />
  );

  // After rendering stage1Element, stage1Sections is populated
  // We need to render it first, then use the captured sections


  return (
    <div className="space-y-0 overflow-x-hidden">
      {/* Page Header */}
      <div className="flex items-center gap-3 mb-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/incoming')}
          className="gap-1"
        >
          <MaterialIcon name="arrow_back" size="sm" />
          Back
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <ShipmentNumberBadge
              shipmentNumber={shipment.shipment_number}
              exceptionType={shipment.shipment_exception_type}
            />
            <ShipmentExceptionBadge
              shipmentId={shipmentId}
              onClick={() => setTab('exceptions')}
            />
            {status === 'closed' && closedEditMode ? (
              <Badge variant="secondary" className="text-xs">Editing unlocked</Badge>
            ) : null}
          </div>
          {accountName ? (
            <p className="text-sm text-muted-foreground mt-0.5">{accountName}</p>
          ) : null}
        </div>
        {status === 'draft' && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <MaterialIcon name="delete" size="md" />
          </Button>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar statusKey={status as any}>
        {renderStatusBarActions()}
      </StatusBar>

      {/* Stage 1 content via renderLayout — two-column grid with sidebar */}
      <Stage1DockIntake
        shipmentId={shipmentId}
        shipmentNumber={shipment.shipment_number}
        shipment={shipment as any}
        onComplete={handleStageChange}
        onRefresh={fetchShipment}
        onMatchingParamsChange={handleMatchingParamsChange}
        onOpenExceptions={() => setTab('exceptions')}
        entryCount={entryCount}
        externalBillingRefreshKey={billingRefreshKey}
        showCompleteButton={false}
        showBillingCalculator={false}
        readOnly={status === 'closed' ? !closedEditMode : false}
        renderLayout={(sections: Stage1Sections) => (
          <>
            <div className="mt-6 mx-auto w-full max-w-[1500px]">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                {/* Left column content (summary + signature) */}
                <div className="min-w-0 flex flex-col gap-6">

                  <div className="lg:hidden">
                    {billingPanelContent}
                  </div>

                  {/* Shipment Summary Card */}
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <MaterialIcon name="local_shipping" size="sm" className="text-primary" />
                          Shipment Summary
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          {sections.autosaveIndicator}
                        </div>
                      </div>
                      <CardDescription>
                        Dock intake details · All fields autosave
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {sections.shipmentSummaryContent}
                    </CardContent>
                  </Card>

                  {/* Signature Card */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <MaterialIcon name="draw" size="sm" />
                        Signature
                        <span className="text-xs font-normal text-muted-foreground">Optional</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {sections.signatureContent}
                    </CardContent>
                  </Card>

                </div>

                {/* Sidebar: Billing + Matching (not sticky — sits alongside summary/notes) */}
                <div className="hidden lg:block min-w-0">
                  <div className="space-y-4">
                    {billingPanelContent}
                    {matchingPanelContent}
                  </div>
                </div>
              </div>

              {/* Full-width sections below the grid */}
              <div className="mt-6 space-y-6">
                {/* Stage 2 — Items (full width) */}
                {(status === 'receiving' || status === 'closed') && (
                  <>
                    <div id={stage2ScrollAnchorId} className="scroll-mt-24" />
                    <Stage2DetailedReceiving
                      shipmentId={shipmentId}
                      shipmentNumber={shipment.shipment_number}
                      shipment={shipment as any}
                      dockCount={liveMatchingParams?.dockCount ?? shipment.received_pieces ?? null}
                      onComplete={handleReceivingComplete}
                      onRefresh={fetchShipment}
                      onItemMatchingParamsChange={handleItemMatchingParamsChange}
                      onEntryCountChange={setEntryCount}
                      onOpenExceptions={() => setTab('exceptions')}
                      onOpenNotes={() => setTab('notes')}
                      onBillingRefresh={() => setBillingRefreshKey((prev) => prev + 1)}
                      readOnly={status === 'closed' ? !closedEditMode : false}
                      showCompleteButton={status === 'receiving'}
                      hideHeader
                    />
                  </>
                )}

            {/* Signature Card */}
            {stage1Sections?.signatureContent && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <MaterialIcon name="draw" size="sm" />
                    Signature (optional)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {stage1Sections.signatureContent}
                </CardContent>
              </Card>
            )}

            {/* Notes / Exceptions Section */}
            <div ref={notesSectionRef} className="scroll-mt-24">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MaterialIcon name="chat" size="sm" />
                    Notes & Exceptions
                    {openCount > 0 && (
                      <Badge variant="destructive" className="h-5 min-w-5 text-xs">
                        {openCount}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs value={notesSubTab} onValueChange={(v) => setNotesSubTab(v as typeof notesSubTab)}>
                    <TabsList className="h-auto gap-1 mb-4">
                      <TabsTrigger value="internal" className="gap-1.5 text-xs">
                        <MaterialIcon name="lock" size="sm" />
                        Internal
                      </TabsTrigger>
                      <TabsTrigger value="public" className="gap-1.5 text-xs">
                        <MaterialIcon name="public" size="sm" />
                        Public
                      </TabsTrigger>
                      <TabsTrigger value="exceptions" className="gap-1.5 text-xs">
                        <MaterialIcon name="report_problem" size="sm" />
                        Exceptions
                        {openCount > 0 && (
                          <Badge variant="destructive" className="ml-1 h-4 min-w-4 text-[10px]">
                            {openCount}
                          </Badge>
                        )}
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="internal">
                      <DockIntakeNotesPanel shipmentId={shipmentId} noteType="internal" />
                    </TabsContent>

                    <TabsContent value="public">
                      <DockIntakeNotesPanel shipmentId={shipmentId} noteType="public" />
                    </TabsContent>

                    <TabsContent value="exceptions">
                      {stage1Sections?.exceptionsContent ? (
                        <div className="space-y-6">
                          {/* Inline exception chips from Stage 1 */}
                          {stage1Sections.exceptionsContent}
                          <div className="border-t pt-4">
                            <ExceptionsTab shipmentId={shipmentId} />
                          </div>
                        </div>
                      ) : (
                        <ExceptionsTab shipmentId={shipmentId} />
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </div>

            {/* Stage 2 rendered inside Stage1DockIntake renderLayout above — no duplicate here */}

            {/* Stage 2 placeholder for draft/stage1_complete */}
            {status === 'draft' && (
              <Card className="border-dashed">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MaterialIcon name="inventory_2" size="sm" />
                    Stage 2 — Detailed Receiving
                  </CardTitle>
                  <CardDescription>
                    Complete Stage 1 to unlock Stage 2 item entry.
                  </CardDescription>
                </CardHeader>
              </Card>
            )}

            {status === 'stage1_complete' && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                          <CardTitle className="text-base flex items-center gap-2">
                            <MaterialIcon name="inventory_2" size="sm" className="text-primary" />
                            Stage 2 — Detailed Receiving
                          </CardTitle>
                          <CardDescription className="mt-1">
                            Stage 1 is complete. Tap Start Stage 2 when you're ready to enter item rows.
                          </CardDescription>
                        </div>
                        <Button onClick={() => void handleStartStage2()} disabled={startingStage2} className="gap-2">
                          {startingStage2 ? (
                            <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                          ) : (
                            <MaterialIcon name="play_arrow" size="sm" />
                          )}
                          Start Stage 2
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      Entry Count will update automatically as you add/remove Stage 2 rows.
                    </CardContent>
                  </Card>
                )}

                {/* Photos (full width) */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MaterialIcon name="photo_camera" size="sm" />
                      Photos
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {sections.photosContent}
                  </CardContent>
                </Card>

                {/* Documents (full width) */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MaterialIcon name="description" size="sm" />
                      Documents
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {sections.documentsContent}
                  </CardContent>
                </Card>

                {/* Complete Stage 1 button (draft only) */}
                {status === 'draft' && (
                  <div className="flex justify-end">
                    <Button
                      size="lg"
                      onClick={sections.onCompleteStage1}
                      disabled={sections.completing || !sections.canEdit}
                      className="gap-2"
                    >
                      {sections.completing ? (
                        <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                      ) : (
                        <MaterialIcon name="check_circle" size="sm" />
                      )}
                      Complete Stage 1
                    </Button>
                  </div>
                )}

                {/* Activity Feed (full width) */}
                <Card>
                  <CardContent className="pt-6">
                    <EntityActivityFeed
                      entityType="shipment"
                      entityId={shipmentId}
                      title="Activity"
                      description="Timeline of actions on this shipment"
                    />
                  </CardContent>
                </Card>
              </div>
            </div>

            {sections.dialogs}
          </>
        )}
      />

      {/* Mobile: matching bottom sheet entry point */}
      {showMatchingPanel ? (
        <>
          <div className="fixed bottom-6 right-6 lg:hidden z-40">
            <Button
              size="lg"
              className="rounded-full h-14 w-14 shadow-lg"
              onClick={() => setMobileMatchingOpen(true)}
            >
              <MaterialIcon name="search" size="md" />
            </Button>
          </div>

          <Sheet open={mobileMatchingOpen} onOpenChange={setMobileMatchingOpen}>
            <SheetContent
              side="bottom"
              className="h-auto max-h-[85vh] rounded-t-xl"
            >
              <SheetHeader>
                <SheetTitle>Matching Candidates</SheetTitle>
              </SheetHeader>
              <div className="mt-4 overflow-y-auto max-h-[calc(85vh-80px)]">
                <DockIntakeMatchingPanel
                  dockIntakeId={shipmentId}
                  params={matchingParams}
                  onLinked={() => {
                    fetchShipment();
                    setMobileMatchingOpen(false);
                  }}
                  showItemRefinement={status === 'receiving'}
                />
              </div>
            </SheetContent>
          </Sheet>
        </>
      ) : null}

      {/* Addon / Credit dialogs */}
      {effectiveAccountId ? (
        <AddAddonDialog
          open={addChargeOpen}
          onOpenChange={setAddChargeOpen}
          accountId={effectiveAccountId}
          shipmentId={shipmentId}
          onSuccess={() => {
            setBillingRefreshKey((prev) => prev + 1);
            fetchShipment();
          }}
        />
      ) : null}

      {canAddCredit && effectiveAccountId ? (
        <AddCreditDialog
          open={addCreditOpen}
          onOpenChange={setAddCreditOpen}
          accountId={effectiveAccountId}
          shipmentId={shipmentId}
          onSuccess={() => {
            setBillingRefreshKey((prev) => prev + 1);
            fetchShipment();
          }}
        />
      ) : null}

      {/* Pause existing job confirmation (Start Stage 2) */}
      <AlertDialog open={stage2ConfirmOpen} onOpenChange={setStage2ConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause current job?</AlertDialogTitle>
            <AlertDialogDescription>
              It looks like you already have a job in progress{stage2ActiveJobLabel ? ` (${stage2ActiveJobLabel})` : ''}.
              Do you want to pause it and start Stage 2?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setStage2ActiveJobLabel(null)}
              disabled={stage2ConfirmLoading}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                setStage2ConfirmLoading(true);
                try {
                  let timerStarted = false;

                  const timerResult = await timerStartJob({
                    tenantId: profile?.tenant_id,
                    userId: profile?.id,
                    jobType: 'shipment',
                    jobId: shipmentId,
                    pauseExisting: true,
                  });
                  if (timerResult?.ok === false) {
                    toast({
                      variant: 'destructive',
                      title: 'Unable to start Stage 2',
                      description: timerResult.error_message || 'Failed to start timer',
                    });
                    return;
                  }
                  timerStarted = true;

                  const { error } = await supabase
                    .from('shipments')
                    .update({ inbound_status: 'receiving' } as any)
                    .eq('id', shipmentId);

                  if (error) {
                    if (timerStarted) {
                      try {
                        await timerEndJob({
                          tenantId: profile?.tenant_id,
                          userId: profile?.id,
                          jobType: 'shipment',
                          jobId: shipmentId,
                          reason: 'rollback',
                        });
                      } catch {
                        // ignore
                      }
                    }
                    throw error;
                  }

                  setPendingStage2Jump(true);

                  toast({
                    type: 'success',
                    title: 'Stage 2 started',
                    description: 'You can now enter item details.',
                  });
                  handleStageChange();

                  setStage2ConfirmOpen(false);
                  setStage2ActiveJobLabel(null);
                } catch (err: any) {
                  console.error('[ReceivingStageRouter] start stage2 confirm error:', err);
                  toast({
                    variant: 'destructive',
                    title: 'Error',
                    description: err?.message || 'Failed to start Stage 2',
                  });
                } finally {
                  setStage2ConfirmLoading(false);
                }
              }}
              disabled={stage2ConfirmLoading}
            >
              Pause & Start
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete shipment confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Shipment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the shipment from all lists. This action cannot be easily undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteShipment}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
