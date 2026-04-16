import { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { HelpTip } from '@/components/ui/help-tip';
import { CommunicationAlert, CommunicationTemplate, TriggerCatalogEntry, TRIGGER_EVENTS } from '@/hooks/useCommunications';
import { format } from 'date-fns';
import { CreateAlertDialog } from './CreateAlertDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSmsAddonActivation } from '@/hooks/useSmsAddonActivation';
import {
  MobileDataCard,
  MobileDataCardHeader,
  MobileDataCardTitle,
  MobileDataCardDescription,
  MobileDataCardContent,
  MobileDataCardActions,
} from '@/components/ui/mobile-data-card';
import { SendTestDialog } from '@/components/settings/communications/SendTestDialog';

// ---------------------------------------------------------------------------
// Module group display config
// ---------------------------------------------------------------------------

const MODULE_GROUP_ORDER = [
  'shipments', 'tasks', 'claims', 'quotes', 'items',
  'onboarding', 'stocktake', 'billing', 'system',
] as const;

const MODULE_GROUP_LABELS: Record<string, { label: string; icon: string; tooltip: string }> = {
  shipments:  { label: 'Shipments',  icon: 'local_shipping', tooltip: 'Alerts related to inbound/outbound shipments, releases, and receiving.' },
  tasks:      { label: 'Tasks',      icon: 'task_alt',       tooltip: 'Alerts related to tasks, inspections, and assignments.' },
  claims:     { label: 'Claims',     icon: 'gavel',          tooltip: 'Alerts related to claim filing, approval, and resolution.' },
  quotes:     { label: 'Quotes',     icon: 'request_quote',  tooltip: 'Alerts related to repair quotes and estimates.' },
  items:      { label: 'Items',      icon: 'inventory_2',    tooltip: 'Alerts related to inventory items, flags, and location changes.' },
  onboarding: { label: 'Onboarding', icon: 'person_add',     tooltip: 'Alerts when clients create shipments, tasks, or claims via the portal.' },
  stocktake:  { label: 'Stocktake',  icon: 'fact_check',     tooltip: 'Alerts related to stock counts and cycle counts.' },
  billing:    { label: 'Billing',    icon: 'receipt_long',   tooltip: 'Alerts related to billing events, invoices, and payments.' },
  system:     { label: 'System',     icon: 'settings',       tooltip: 'Custom and system-level alerts.' },
};

const AUDIENCE_BADGES: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline'; className: string }> = {
  internal: { label: 'Internal',      variant: 'outline',    className: 'text-xs' },
  client:   { label: 'Client-Facing', variant: 'secondary',  className: 'text-xs bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' },
  both:     { label: 'Both',          variant: 'secondary',  className: 'text-xs bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800' },
};

const SEVERITY_ICONS: Record<string, { icon: string; className: string }> = {
  info:     { icon: 'info',    className: 'text-blue-500' },
  warn:     { icon: 'warning', className: 'text-amber-500' },
  critical: { icon: 'error',   className: 'text-red-500' },
};

type AudienceFilter = 'all' | 'internal' | 'client' | 'both';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AlertListProps {
  alerts: CommunicationAlert[];
  templates: CommunicationTemplate[];
  triggerCatalog: TriggerCatalogEntry[];
  tenantId: string;
  onCreateAlert: (alert: Omit<CommunicationAlert, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>) => Promise<CommunicationAlert | null>;
  onUpdateAlert: (id: string, updates: Partial<CommunicationAlert>) => Promise<boolean>;
  onDeleteAlert: (id: string) => Promise<boolean>;
  onSelectAlert: (alert: CommunicationAlert) => void;
}

// Enriched alert = tenant alert + catalog metadata
interface EnrichedAlert {
  alert: CommunicationAlert;
  catalog: TriggerCatalogEntry | null;
  moduleGroup: string;
  audience: string;
  severity: string;
  displayName: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AlertList({
  alerts,
  templates,
  triggerCatalog,
  tenantId,
  onCreateAlert,
  onUpdateAlert,
  onDeleteAlert,
  onSelectAlert,
}: AlertListProps) {
  const { data: smsAddonState } = useSmsAddonActivation();
  const smsAddonActive = smsAddonState?.is_active === true;
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [alertToDelete, setAlertToDelete] = useState<CommunicationAlert | null>(null);
  const [testAlert, setTestAlert] = useState<CommunicationAlert | null>(null);
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>('all');
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [showLegacyTriggers, setShowLegacyTriggers] = useState(false);
  const isMobile = useIsMobile();

  // Build catalog lookup by trigger_event key
  const catalogByKey = useMemo(() => {
    const map = new Map<string, TriggerCatalogEntry>();
    for (const entry of triggerCatalog) {
      map.set(entry.key, entry);
    }
    return map;
  }, [triggerCatalog]);

  // Enrich alerts with catalog metadata
  const enrichedAlerts = useMemo((): EnrichedAlert[] => {
    return alerts.map((alert) => {
      const catalog = catalogByKey.get(alert.trigger_event) || null;
      return {
        alert,
        catalog,
        moduleGroup: catalog?.module_group || '_ungrouped',
        audience: catalog?.audience || 'internal',
        severity: catalog?.severity || 'info',
        displayName: catalog?.display_name || alert.name,
      };
    });
  }, [alerts, catalogByKey]);

  const isLegacyAlert = useCallback((ea: EnrichedAlert) => {
    if (ea.catalog?.is_legacy) return true;
    if (ea.displayName.toLowerCase().includes('(legacy)')) return true;
    return false;
  }, []);

  // Apply audience filter
  const filteredAlerts = useMemo(() => {
    const audienceFiltered = audienceFilter === 'all' ? enrichedAlerts : enrichedAlerts.filter((ea) => {
      if (audienceFilter === 'internal') return ea.audience === 'internal' || ea.audience === 'both';
      if (audienceFilter === 'client') return ea.audience === 'client' || ea.audience === 'both';
      return ea.audience === audienceFilter;
    });
    if (showLegacyTriggers) return audienceFiltered;
    return audienceFiltered.filter((ea) => !isLegacyAlert(ea));
  }, [enrichedAlerts, audienceFilter, showLegacyTriggers, isLegacyAlert]);

  const legacyHiddenCount = useMemo(() => {
    if (showLegacyTriggers) return 0;
    return enrichedAlerts.filter((ea) => isLegacyAlert(ea)).length;
  }, [enrichedAlerts, showLegacyTriggers, isLegacyAlert]);

  // Group by module
  const groupedAlerts = useMemo(() => {
    const groups = new Map<string, EnrichedAlert[]>();

    // Initialise in display order
    for (const g of MODULE_GROUP_ORDER) {
      groups.set(g, []);
    }
    groups.set('_ungrouped', []);

    for (const ea of filteredAlerts) {
      const g = groups.get(ea.moduleGroup) || groups.get('_ungrouped')!;
      g.push(ea);
    }

    // Remove empty groups
    for (const [key, val] of groups) {
      if (val.length === 0) groups.delete(key);
    }

    return groups;
  }, [filteredAlerts]);

  const getTemplateForAlert = (alertId: string, channel: 'email' | 'sms') => {
    return templates.find(t => t.alert_id === alertId && t.channel === channel);
  };

  const handleDeleteAlert = async () => {
    if (!alertToDelete) return;
    await onDeleteAlert(alertToDelete.id);
    setAlertToDelete(null);
  };

  const toggleEnabled = async (e: React.MouseEvent, alert: CommunicationAlert) => {
    e.stopPropagation();
    await onUpdateAlert(alert.id, { is_enabled: !alert.is_enabled });
  };

  const getTriggerLabel = (triggerEvent: string) => {
    return TRIGGER_EVENTS.find(e => e.value === triggerEvent)?.label || triggerEvent;
  };

  // ─── Audience filter tabs ──────────────────────────────────────────────
  const audienceTabs = (
    <div className="space-y-2">
      <div className="flex items-center gap-1 rounded-lg border p-1 bg-muted/30">
        {([
          { key: 'all', label: 'All' },
          { key: 'internal', label: 'Internal' },
          { key: 'client', label: 'Client-Facing' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setAudienceFilter(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              audienceFilter === key
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
        <HelpTip
          tooltip="Internal alerts go to your team (warehouse staff, managers). Client-facing alerts go to your customers' contacts. 'Both' means the alert targets both audiences."
          pageKey="settings.alerts"
          fieldKey="audience_filter_help"
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border p-2">
        <div className="text-xs text-muted-foreground">
          Legacy triggers are hidden by default.
          {!showLegacyTriggers && legacyHiddenCount > 0 ? ` (${legacyHiddenCount} hidden)` : ''}
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-medium">
          Show legacy
          <Switch
            checked={showLegacyTriggers}
            onCheckedChange={setShowLegacyTriggers}
          />
        </label>
      </div>
    </div>
  );

  // ─── Render a single alert row ─────────────────────────────────────────
  const renderAlertRow = (ea: EnrichedAlert) => {
    const { alert, audience, severity } = ea;
    const severityInfo = SEVERITY_ICONS[severity] || SEVERITY_ICONS.info;
    const audienceInfo = AUDIENCE_BADGES[audience] || AUDIENCE_BADGES.internal;

    return (
      <TableRow
        key={alert.id}
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => onSelectAlert(alert)}
      >
        <TableCell className="w-[34%]">
          <div className="flex items-center gap-2">
            <MaterialIcon name={severityInfo.icon} size="sm" className={severityInfo.className} />
            <span className="font-medium">{ea.displayName}</span>
            {isLegacyAlert(ea) && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Legacy
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="w-[130px]">
          <Badge variant={audienceInfo.variant} className={audienceInfo.className}>
            {audienceInfo.label}
          </Badge>
        </TableCell>
        <TableCell className="w-[110px]">
          <Switch
            checked={alert.is_enabled}
            onCheckedChange={() => {}}
            onClick={(e) => toggleEnabled(e, alert)}
          />
        </TableCell>
        <TableCell className="w-[280px] min-w-[280px]">
          <div className="flex items-center gap-1.5 flex-nowrap">
            {alert.channels.email && (
              <Badge variant="secondary" className="gap-1 text-xs whitespace-nowrap">
                <MaterialIcon name="mail" size="sm" />
                Email
              </Badge>
            )}
            {alert.channels.sms && (
              <Badge
                variant={smsAddonActive ? "secondary" : "outline"}
                className={`gap-1 text-xs whitespace-nowrap ${smsAddonActive ? "" : "text-muted-foreground"}`}
              >
                <MaterialIcon name={smsAddonActive ? "chat" : "lock"} size="sm" />
                {smsAddonActive ? "SMS" : "SMS Locked"}
              </Badge>
            )}
            {alert.channels.in_app && (
              <Badge variant="secondary" className="gap-1 text-xs whitespace-nowrap">
                <MaterialIcon name="notifications" size="sm" />
                In-App
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="w-[130px] text-muted-foreground text-sm whitespace-nowrap">
          {format(new Date(alert.updated_at), 'MMM d, yyyy')}
        </TableCell>
        <TableCell className="w-[100px]">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); setTestAlert(alert); }}
              title="Send Test"
            >
              <MaterialIcon name="send" size="sm" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); setAlertToDelete(alert); }}
            >
              <MaterialIcon name="delete" size="sm" className="text-destructive" />
            </Button>
            <MaterialIcon name="chevron_right" size="sm" className="text-muted-foreground" />
          </div>
        </TableCell>
      </TableRow>
    );
  };

  // ─── Render a single mobile card ───────────────────────────────────────
  const renderMobileCard = (ea: EnrichedAlert) => {
    const { alert, audience, severity } = ea;
    const audienceInfo = AUDIENCE_BADGES[audience] || AUDIENCE_BADGES.internal;

    return (
      <MobileDataCard key={alert.id} onClick={() => onSelectAlert(alert)}>
        <MobileDataCardHeader>
          <div className="flex-1 min-w-0">
            <MobileDataCardTitle>{ea.displayName}</MobileDataCardTitle>
            <MobileDataCardDescription>
              <div className="flex items-center gap-1.5 mt-1">
                <Badge variant={audienceInfo.variant} className={audienceInfo.className}>
                  {audienceInfo.label}
                </Badge>
                {isLegacyAlert(ea) && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    Legacy
                  </Badge>
                )}
                <code className="text-xs bg-muted px-2 py-0.5 rounded">{alert.key}</code>
              </div>
            </MobileDataCardDescription>
          </div>
          <Switch
            checked={alert.is_enabled}
            onCheckedChange={() => {}}
            onClick={(e) => toggleEnabled(e, alert)}
          />
        </MobileDataCardHeader>
        <MobileDataCardContent>
          <div className="flex flex-wrap items-center gap-2">
            {alert.channels.email && (
              <Badge variant="secondary" className="gap-1">
                <MaterialIcon name="mail" size="sm" />
                Email
              </Badge>
            )}
            {alert.channels.sms && (
              <Badge variant={smsAddonActive ? "secondary" : "outline"} className={`gap-1 ${smsAddonActive ? "" : "text-muted-foreground"}`}>
                <MaterialIcon name={smsAddonActive ? "chat" : "lock"} size="sm" />
                {smsAddonActive ? "SMS" : "SMS Locked"}
              </Badge>
            )}
            {alert.channels.in_app && (
              <Badge variant="secondary" className="gap-1">
                <MaterialIcon name="notifications" size="sm" />
                In-App
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {getTriggerLabel(alert.trigger_event)}
            </Badge>
          </div>
        </MobileDataCardContent>
        <MobileDataCardActions>
          <span className="text-xs text-muted-foreground">
            {format(new Date(alert.updated_at), 'MMM d, yyyy')}
          </span>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setTestAlert(alert); }}>
            <MaterialIcon name="send" size="sm" />
          </Button>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setAlertToDelete(alert); }}>
            <MaterialIcon name="delete" size="sm" className="text-destructive" />
          </Button>
          <MaterialIcon name="chevron_right" size="sm" className="text-muted-foreground" />
        </MobileDataCardActions>
      </MobileDataCard>
    );
  };

  // ─── Main render ───────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Alerts</h3>
          <p className="text-sm text-muted-foreground">
            Configure notification alerts and their templates
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewMode(viewMode === 'grouped' ? 'flat' : 'grouped')}
            className="gap-1.5"
          >
            <MaterialIcon name={viewMode === 'grouped' ? 'view_list' : 'view_module'} size="sm" />
            {viewMode === 'grouped' ? 'Flat' : 'Grouped'}
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <MaterialIcon name="add" size="sm" className="mr-2" />
            <span className="hidden sm:inline">Create Alert</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>
      </div>

      {/* Audience filter */}
      {audienceTabs}

      {/* Content */}
      {filteredAlerts.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">
          {alerts.length === 0
            ? 'No alerts configured. Create your first alert to get started.'
            : 'No alerts match the selected audience filter.'}
        </div>
      ) : viewMode === 'grouped' ? (
        /* ── Grouped view ─────────────────────────────────────────── */
        <div className="space-y-6">
          {Array.from(groupedAlerts.entries()).map(([groupKey, groupAlerts]) => {
            const meta = MODULE_GROUP_LABELS[groupKey];
            const label = meta?.label || 'Ungrouped / Legacy';
            const icon = meta?.icon || 'help_outline';
            const tooltip = meta?.tooltip || 'Alerts that do not yet have a catalog entry. They will continue to work as before.';

            return (
              <div key={groupKey} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <MaterialIcon name={icon} size="sm" className="text-muted-foreground" />
                  <h4 className="text-sm font-semibold text-foreground">{label}</h4>
                  <HelpTip
                    tooltip={tooltip}
                    pageKey="settings.alerts"
                    fieldKey="module_group_help"
                  />
                  <Badge variant="outline" className="text-xs ml-auto">{groupAlerts.length}</Badge>
                </div>
                {isMobile ? (
                  <div className="space-y-3">
                    {groupAlerts.map(renderMobileCard)}
                  </div>
                ) : (
                  <div className="rounded-lg border bg-card">
                    <Table className="table-fixed">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[34%]">Name</TableHead>
                          <TableHead className="w-[130px]">Audience</TableHead>
                          <TableHead className="w-[110px]">Enabled</TableHead>
                          <TableHead className="w-[280px] min-w-[280px]">Channels</TableHead>
                          <TableHead className="w-[130px]">Updated</TableHead>
                          <TableHead className="w-[100px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {groupAlerts.map(renderAlertRow)}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Flat view ────────────────────────────────────────────── */
        isMobile ? (
          <div className="space-y-3">
            {filteredAlerts.map(renderMobileCard)}
          </div>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[34%]">Name</TableHead>
                  <TableHead className="w-[130px]">Audience</TableHead>
                  <TableHead className="w-[110px]">Enabled</TableHead>
                  <TableHead className="w-[280px] min-w-[280px]">Channels</TableHead>
                  <TableHead className="w-[130px]">Updated</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAlerts.map(renderAlertRow)}
              </TableBody>
            </Table>
          </div>
        )
      )}

      <CreateAlertDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreateAlert={onCreateAlert}
        triggerCatalog={triggerCatalog}
      />

      <AlertDialog open={!!alertToDelete} onOpenChange={() => setAlertToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Alert</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{alertToDelete?.name}&rdquo;? This will also delete all associated templates and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAlert} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Send Test Dialog */}
      {testAlert && (
        <SendTestDialog
          open={!!testAlert}
          onOpenChange={(open) => !open && setTestAlert(null)}
          tenantId={tenantId}
          channel={testAlert.channels.email ? 'email' : 'sms'}
          subject={getTemplateForAlert(testAlert.id, 'email')?.subject_template || ''}
          bodyHtml={getTemplateForAlert(testAlert.id, 'email')?.body_template || ''}
          bodyText={getTemplateForAlert(testAlert.id, 'sms')?.body_template || ''}
        />
      )}
    </div>
  );
}
