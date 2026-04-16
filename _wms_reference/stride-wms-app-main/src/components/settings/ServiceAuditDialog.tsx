/**
 * ServiceAuditDialog - View audit history for service events
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format, formatDistanceToNow } from 'date-fns';
import { ServiceEventAudit, useServiceEventsAdmin } from '@/hooks/useServiceEventsAdmin';
import { cn } from '@/lib/utils';

interface ServiceAuditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceCode: string | null;
}

function getActionIcon(action: string) {
  switch (action) {
    case 'INSERT':
      return <MaterialIcon name="add" size="sm" className="text-green-600" />;
    case 'UPDATE':
      return <MaterialIcon name="edit" size="sm" className="text-blue-600" />;
    case 'DELETE':
      return <MaterialIcon name="delete" size="sm" className="text-red-600" />;
    default:
      return <MaterialIcon name="history" size="sm" />;
  }
}

function getActionBadge(action: string) {
  switch (action) {
    case 'INSERT':
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Created</Badge>;
    case 'UPDATE':
      return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Updated</Badge>;
    case 'DELETE':
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Deleted</Badge>;
    default:
      return <Badge variant="outline">{action}</Badge>;
  }
}

function formatFieldName(field: string): string {
  return field
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value: any): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    // Check if it looks like a rate
    if (value % 1 !== 0 || value >= 1) {
      return `$${value.toFixed(2)}`;
    }
    return value.toString();
  }
  return String(value);
}

interface AuditEntryProps {
  audit: ServiceEventAudit;
}

function AuditEntry({ audit }: AuditEntryProps) {
  const [expanded, setExpanded] = useState(false);

  const userName = audit.user
    ? `${audit.user.first_name} ${audit.user.last_name}`
    : 'System';

  const changedAt = new Date(audit.changed_at);
  const timeAgo = formatDistanceToNow(changedAt, { addSuffix: true });
  const fullDate = format(changedAt, 'PPpp');

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50 cursor-pointer border-b">
          <div className="flex items-center gap-2">
            {expanded ? (
              <MaterialIcon name="expand_more" size="sm" className="text-muted-foreground" />
            ) : (
              <MaterialIcon name="chevron_right" size="sm" className="text-muted-foreground" />
            )}
            {getActionIcon(audit.action)}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {getActionBadge(audit.action)}
              {audit.class_code && (
                <Badge variant="outline" className="font-mono text-xs">
                  {audit.class_code}
                </Badge>
              )}
              {audit.action === 'UPDATE' && audit.changed_fields && (
                <span className="text-sm text-muted-foreground">
                  {audit.changed_fields.length} field{audit.changed_fields.length !== 1 ? 's' : ''} changed
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <MaterialIcon name="person" size="sm" />
              <span>{userName}</span>
            </div>
            <div className="flex items-center gap-1" title={fullDate}>
              <MaterialIcon name="calendar_today" size="sm" />
              <span>{timeAgo}</span>
            </div>
          </div>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="bg-muted/30 px-4 py-3 border-b">
          {audit.action === 'UPDATE' && audit.changed_fields && audit.changed_fields.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium mb-2">Changes:</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/3">Field</TableHead>
                    <TableHead className="w-1/3">Before</TableHead>
                    <TableHead className="w-1/3">After</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.changed_fields.map((field) => (
                    <TableRow key={field}>
                      <TableCell className="font-medium">
                        {formatFieldName(field)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatValue(audit.old_values?.[field])}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <MaterialIcon name="arrow_forward" size="sm" className="text-muted-foreground" />
                          <span className="font-medium">
                            {formatValue(audit.new_values?.[field])}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {audit.action === 'INSERT' && audit.new_values && (
            <div className="space-y-2">
              <p className="text-sm font-medium mb-2">Created with values:</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(audit.new_values)
                  .filter(([key]) => !['id', 'tenant_id', 'created_at', 'updated_at'].includes(key))
                  .map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <span className="text-muted-foreground">{formatFieldName(key)}:</span>
                      <span className="font-medium">{formatValue(value)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {audit.action === 'DELETE' && audit.old_values && (
            <div className="space-y-2">
              <p className="text-sm font-medium mb-2 text-red-600">Deleted values:</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(audit.old_values)
                  .filter(([key]) => !['id', 'tenant_id', 'created_at', 'updated_at'].includes(key))
                  .map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <span className="text-muted-foreground">{formatFieldName(key)}:</span>
                      <span className="font-medium line-through opacity-60">{formatValue(value)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground mt-3">
            {fullDate}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ServiceAuditDialog({
  open,
  onOpenChange,
  serviceCode,
}: ServiceAuditDialogProps) {
  const { fetchAuditHistory } = useServiceEventsAdmin();
  const [loading, setLoading] = useState(false);
  const [auditHistory, setAuditHistory] = useState<ServiceEventAudit[]>([]);

  useEffect(() => {
    if (open && serviceCode) {
      loadAuditHistory();
    }
  }, [open, serviceCode]);

  const loadAuditHistory = async () => {
    if (!serviceCode) return;

    setLoading(true);
    try {
      const history = await fetchAuditHistory(serviceCode);
      setAuditHistory(history);
    } catch (error) {
      console.error('Error loading audit history:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="history" size="md" />
            Audit History
          </DialogTitle>
          <DialogDescription>
            {serviceCode ? (
              <>
                Change history for service code{' '}
                <Badge variant="outline" className="font-mono">
                  {serviceCode}
                </Badge>
              </>
            ) : (
              'Select a service to view its history'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
            </div>
          ) : auditHistory.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MaterialIcon name="history" size="lg" className="mx-auto mb-4 opacity-50" />
              <p>No audit history found</p>
              <p className="text-sm">
                Changes to this service will appear here
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[400px] border rounded-lg">
              <div className="divide-y">
                {auditHistory.map((audit) => (
                  <AuditEntry key={audit.id} audit={audit} />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="flex justify-between items-center pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            {auditHistory.length} record{auditHistory.length !== 1 ? 's' : ''}
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
