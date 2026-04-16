/**
 * ActivityDetailsDisplay - Shared expandable "View details" renderer for activity feeds.
 *
 * Goals:
 * - Keep Activity globally interactive: entity codes become tappable links.
 * - Render document references (storage_key) with Open/Download actions.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { getDocumentSignedUrl } from '@/lib/scanner/uploadService';
import { parseMessageWithLinks, type EntityMap } from '@/utils/parseEntityLinks';

function isDocumentRef(
  value: unknown
): value is { storage_key: string; file_name?: string | null; label?: string | null } {
  if (!value || typeof value !== 'object') return false;
  const v = value as any;
  return typeof v.storage_key === 'string' && v.storage_key.length > 0;
}

function asDocumentRefArray(
  value: unknown
): Array<{ storage_key: string; file_name?: string | null; label?: string | null }> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const refs = value.filter(isDocumentRef);
  if (refs.length !== value.length) return null;
  return refs;
}

export function ActivityDetailsDisplay({
  details,
  entityMap,
  linkVariant = 'inline',
}: {
  details: Record<string, unknown>;
  entityMap?: EntityMap;
  linkVariant?: 'chip' | 'inline';
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();
  const [busyStorageKey, setBusyStorageKey] = useState<string | null>(null);

  const entries = Object.entries(details).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return null;

  const openDocument = async (storageKey: string) => {
    setBusyStorageKey(storageKey);
    try {
      const url = await getDocumentSignedUrl(storageKey, 300);
      window.open(url, '_blank');
    } catch {
      toast({
        variant: 'destructive',
        title: 'Document Error',
        description: 'Failed to open document',
      });
    } finally {
      setBusyStorageKey(null);
    }
  };

  const downloadDocument = async (storageKey: string, fileName?: string | null) => {
    setBusyStorageKey(storageKey);
    try {
      const url = await getDocumentSignedUrl(storageKey, 300);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName || storageKey.split('/').pop() || 'document';
      link.click();
    } catch {
      toast({
        variant: 'destructive',
        title: 'Document Error',
        description: 'Failed to download document',
      });
    } finally {
      setBusyStorageKey(null);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="mt-1 p-1 h-auto text-xs text-muted-foreground hover:text-foreground">
          <MaterialIcon name="info" className="text-[12px] mr-1" />
          {isOpen ? 'Hide' : 'View'} details
          <MaterialIcon name={isOpen ? 'expand_less' : 'expand_more'} className="text-[12px] ml-1" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 p-2 bg-background rounded border text-xs space-y-1">
          {entries.map(([key, value]) => {
            const docs = asDocumentRefArray(value);
            if (docs) {
              return (
                <div key={key} className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground pt-1">{key.replace(/_/g, ' ')}:</span>
                  <div className="space-y-1">
                    {docs.map((doc) => {
                      const displayName = doc.label || doc.file_name || doc.storage_key.split('/').pop() || 'Document';
                      const isBusy = busyStorageKey === doc.storage_key;
                      return (
                        <div key={doc.storage_key} className="flex items-center gap-2">
                          <span className="font-medium truncate max-w-[180px]" title={displayName}>
                            {displayName}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={isBusy}
                            onClick={() => void openDocument(doc.storage_key)}
                          >
                            <MaterialIcon
                              name={isBusy ? 'progress_activity' : 'open_in_new'}
                              className={isBusy ? 'animate-spin text-[12px]' : 'text-[12px]'}
                            />
                            <span className="ml-1">Open</span>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={isBusy}
                            onClick={() => void downloadDocument(doc.storage_key, doc.file_name)}
                          >
                            <MaterialIcon name="download" className="text-[12px]" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }

            if (isDocumentRef(value)) {
              const displayName = value.label || value.file_name || value.storage_key.split('/').pop() || 'Document';
              const isBusy = busyStorageKey === value.storage_key;
              return (
                <div key={key} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{key.replace(/_/g, ' ')}:</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate max-w-[180px]" title={displayName}>
                      {displayName}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={isBusy}
                      onClick={() => void openDocument(value.storage_key)}
                    >
                      <MaterialIcon
                        name={isBusy ? 'progress_activity' : 'open_in_new'}
                        className={isBusy ? 'animate-spin text-[12px]' : 'text-[12px]'}
                      />
                      <span className="ml-1">Open</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={isBusy}
                      onClick={() => void downloadDocument(value.storage_key, value.file_name)}
                    >
                      <MaterialIcon name="download" className="text-[12px]" />
                    </Button>
                  </div>
                </div>
              );
            }

            const display =
              typeof value === 'string'
                ? parseMessageWithLinks(value, entityMap, { variant: linkVariant })
                : typeof value === 'number' || typeof value === 'boolean'
                  ? String(value)
                  : parseMessageWithLinks(JSON.stringify(value), entityMap, { variant: linkVariant });

            return (
              <div key={key} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{key.replace(/_/g, ' ')}:</span>
                <span className="font-medium text-right break-words max-w-[260px]">
                  {display}
                </span>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

