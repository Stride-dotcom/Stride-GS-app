/**
 * DocumentThumbnail Component
 * Displays first-page preview of a document with delete button
 */

import { useState, useEffect, useMemo } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { getDocumentSignedUrl } from '@/lib/scanner/uploadService';
import { renderPdfFirstPageThumbnail } from '@/lib/scanner/pdfThumbnails';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface DocumentThumbnailProps {
  documentId: string;
  storageKey: string;
  fileName: string;
  label?: string | null;
  mimeType?: string;
  onRemove?: () => void;
  className?: string;
}

export function DocumentThumbnail({
  documentId,
  storageKey,
  fileName,
  label,
  mimeType,
  onRemove,
  className,
}: DocumentThumbnailProps) {
  const { toast } = useToast();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  const fileType = useMemo(() => {
    const lower = (fileName || '').toLowerCase();
    const isPdf = mimeType === 'application/pdf' || lower.endsWith('.pdf');
    const isImage =
      (mimeType ? mimeType.startsWith('image/') : false) ||
      /\.(png|jpe?g|gif|webp)$/i.test(lower);
    return { isPdf, isImage };
  }, [fileName, mimeType]);

  useEffect(() => {
    let mounted = true;

    const loadThumbnail = async () => {
      try {
        setLoading(true);
        setError(false);

        if (fileType.isImage) {
          const url = await getDocumentSignedUrl(storageKey);
          if (mounted) setThumbnailUrl(url);
          return;
        }

        if (fileType.isPdf) {
          const url = await getDocumentSignedUrl(storageKey);
          const dataUrl = await renderPdfFirstPageThumbnail(url, { maxDim: 360, quality: 0.82 });
          if (mounted) setThumbnailUrl(dataUrl);
          return;
        }

        // Non-previewable docs show an icon + name.
        if (mounted) setThumbnailUrl(null);
      } catch {
        if (mounted) setError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadThumbnail();

    return () => {
      mounted = false;
    };
  }, [storageKey, fileType]);

  const displayName = label || fileName;

  const openViewer = () => {
    setViewerUrl(null);
    setViewerOpen(true);
  };

  useEffect(() => {
    let mounted = true;
    if (!viewerOpen) return;

    const loadViewerUrl = async () => {
      setViewerLoading(true);
      try {
        const url = await getDocumentSignedUrl(storageKey);
        if (mounted) setViewerUrl(url);
      } catch {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to open document',
        });
        if (mounted) setViewerOpen(false);
      } finally {
        if (mounted) setViewerLoading(false);
      }
    };

    void loadViewerUrl();
    return () => {
      mounted = false;
    };
  }, [viewerOpen, storageKey, toast]);

  const handleOpenInNewTab = async () => {
    const newWindow = window.open('about:blank', '_blank');
    try {
      const url = await getDocumentSignedUrl(storageKey);
      if (newWindow) {
        newWindow.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch {
      if (newWindow) newWindow.close();
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to open document',
      });
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const url = await getDocumentSignedUrl(storageKey);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
    } catch {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to download document',
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={cn('space-y-1', className)}>
      <div className="relative group aspect-square w-full rounded-lg overflow-hidden bg-muted">
        <button
          type="button"
          onClick={openViewer}
          className="absolute inset-0 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-primary/40"
          aria-label={`Open ${displayName}`}
        >
          {loading ? (
            <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
          ) : thumbnailUrl && !error ? (
            <img
              src={thumbnailUrl}
              alt={displayName}
              className="w-full h-full object-cover"
              onError={() => setError(true)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center p-2">
              <MaterialIcon
                name={fileType.isPdf ? 'picture_as_pdf' : 'description'}
                className="text-muted-foreground"
                style={{ fontSize: '34px' }}
              />
            </div>
          )}

          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
            <MaterialIcon name="zoom_in" size="lg" className="text-white" />
          </div>
        </button>

        {/* Action buttons - visible on mobile, hover on desktop */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <div className="flex gap-1 justify-end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleDownload();
              }}
              className="p-1.5 text-white hover:text-blue-400"
              aria-label={`Download ${displayName}`}
              disabled={downloading}
            >
              <MaterialIcon
                name={downloading ? 'progress_activity' : 'download'}
                size="sm"
                className={downloading ? 'animate-spin' : undefined}
              />
            </button>
            {onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                className="p-1.5 text-white hover:text-destructive"
                aria-label={`Delete ${displayName}`}
              >
                <MaterialIcon name="close" size="sm" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* File name (always visible) */}
      <p className="text-[11px] leading-snug text-muted-foreground text-center line-clamp-2 break-words" title={displayName}>
        {displayName}
      </p>

      {/* Full-screen-ish viewer */}
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] h-[calc(100vh-1.5rem)] max-w-6xl max-h-[calc(100vh-1.5rem)] overflow-hidden p-4 sm:p-6">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="description" size="sm" className="text-muted-foreground" />
              <span className="truncate">{displayName}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center justify-end gap-2 flex-wrap">
            <Button type="button" variant="outline" size="sm" onClick={() => void handleOpenInNewTab()}>
              <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
              Open
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void handleDownload()} disabled={downloading}>
              <MaterialIcon name={downloading ? 'progress_activity' : 'download'} size="sm" className={cn('mr-2', downloading ? 'animate-spin' : undefined)} />
              Download
            </Button>
            {onRemove ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  onRemove();
                  setViewerOpen(false);
                }}
              >
                <MaterialIcon name="delete" size="sm" className="mr-2" />
                Delete
              </Button>
            ) : null}
          </div>

          <div className="flex-1 min-h-0 rounded-lg border bg-background/40 overflow-hidden">
            {viewerLoading ? (
              <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
                <MaterialIcon name="progress_activity" size="lg" className="mr-2 animate-spin" />
                Loading…
              </div>
            ) : viewerUrl ? (
              fileType.isPdf ? (
                <iframe
                  key={documentId}
                  src={viewerUrl}
                  className="w-full h-full"
                  title={displayName}
                />
              ) : fileType.isImage ? (
                <img
                  src={viewerUrl}
                  alt={displayName}
                  className="w-full h-full object-contain bg-black/5"
                />
              ) : (
                <div className="h-full w-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
                  <MaterialIcon name="description" className="mb-2" style={{ fontSize: '42px' }} />
                  <p className="text-sm font-medium">Preview not available</p>
                  <p className="text-xs mt-1">Use Open or Download.</p>
                </div>
              )
            ) : (
              <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
                Unable to load document.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
