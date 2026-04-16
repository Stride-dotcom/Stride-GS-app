import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { HelpTip } from '@/components/ui/help-tip';
import { useManifestImport, type ImportRow } from '@/hooks/useManifestImport';
import * as JSZip from 'jszip';

interface ManifestImportDialogProps {
  shipmentId: string;
  open: boolean;
  onClose: () => void;
}

type Step = 'upload' | 'preview' | 'result';

export default function ManifestImportDialog({
  shipmentId,
  open,
  onClose,
}: ManifestImportDialogProps) {
  const { parseFile, executeImport, parsedRows, warnings, parsing, importing } =
    useManifestImport();

  const [step, setStep] = useState<Step>('upload');
  const [photoFiles, setPhotoFiles] = useState<Map<string, File>>(new Map());
  const [importResult, setImportResult] = useState<{
    imported: number;
    photosAttached: number;
    missingPhotos: string[];
    errors: string[];
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const handleSpreadsheetUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const rows = await parseFile(file);
      if (rows.length > 0) {
        setStep('preview');
      }
    },
    [parseFile]
  );

  const handleZipUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const zip = await JSZip.loadAsync(file);
      const photos = new Map<string, File>();

      for (const [filename, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        const baseName = filename.split('/').pop() || filename;
        const blob = await zipEntry.async('blob');
        const photoFile = new File([blob], baseName, {
          type: blob.type || 'image/jpeg',
        });
        photos.set(baseName, photoFile);
      }

      setPhotoFiles(photos);
    } catch (err) {
      // ZIP parsing failed silently; photos won't be attached
    }
  }, []);

  const handleImport = useCallback(async () => {
    const result = await executeImport(
      shipmentId,
      parsedRows,
      photoFiles.size > 0 ? photoFiles : undefined
    );
    setImportResult(result);
    setStep('result');
  }, [shipmentId, parsedRows, photoFiles, executeImport]);

  const handleClose = () => {
    setStep('upload');
    setPhotoFiles(new Map());
    setImportResult(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="upload_file" size="md" />
            Import Manifest Items
            <HelpTip
              tooltip="Upload a CSV or XLSX file with item details. Optionally include a ZIP file with photos to auto-attach."
              pageKey="incoming.manifest_import"
              fieldKey="spreadsheet_upload"
            />
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload a spreadsheet (CSV/XLSX) with item details.'}
            {step === 'preview' && `${parsedRows.length} rows parsed. Review and confirm import.`}
            {step === 'result' && 'Import complete.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Spreadsheet File (CSV / XLSX)</label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={parsing}
                >
                  {parsing ? (
                    <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-1" />
                  ) : (
                    <MaterialIcon name="description" size="sm" className="mr-1" />
                  )}
                  Choose File
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={handleSpreadsheetUpload}
                />
                <a
                  href="/manifest-import-template.csv"
                  download
                  className="text-sm text-primary hover:underline"
                >
                  Download template
                </a>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Photo ZIP (Optional)</label>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => zipInputRef.current?.click()}>
                  <MaterialIcon name="photo_library" size="sm" className="mr-1" />
                  Choose ZIP
                </Button>
                <input
                  ref={zipInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={handleZipUpload}
                />
                {photoFiles.size > 0 && (
                  <Badge variant="secondary">{photoFiles.size} photos loaded</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Filenames in the ZIP must match the photo_filename column in your spreadsheet.
              </p>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4 py-2">
            {warnings.length > 0 && (
              <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/20 p-3 border border-yellow-200 dark:border-yellow-800">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-1">
                  Warnings ({warnings.length})
                </p>
                <ul className="text-xs text-yellow-700 dark:text-yellow-300 list-disc pl-4 max-h-24 overflow-y-auto">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-md border max-h-[40vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Sidemark</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Photo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{row.description || '-'}</TableCell>
                      <TableCell>{row.vendor || '-'}</TableCell>
                      <TableCell>{row.sidemark || '-'}</TableCell>
                      <TableCell className="text-right">{row.ordered_qty}</TableCell>
                      <TableCell>
                        {row.photo_filename ? (
                          <Badge
                            variant={
                              photoFiles.has(row.photo_filename) ? 'default' : 'destructive'
                            }
                          >
                            {photoFiles.has(row.photo_filename) ? 'Found' : 'Missing'}
                          </Badge>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {photoFiles.size > 0 && (
              <p className="text-sm text-muted-foreground">
                {photoFiles.size} photos in ZIP &middot;{' '}
                {parsedRows.filter((r) => r.photo_filename && photoFiles.has(r.photo_filename)).length} matched
              </p>
            )}
          </div>
        )}

        {step === 'result' && importResult && (
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-md bg-green-50 dark:bg-green-950/20 p-4 text-center">
                <div className="text-2xl font-bold text-green-700 dark:text-green-300">
                  {importResult.imported}
                </div>
                <div className="text-sm text-green-600 dark:text-green-400">Items Imported</div>
              </div>
              <div className="rounded-md bg-blue-50 dark:bg-blue-950/20 p-4 text-center">
                <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                  {importResult.photosAttached}
                </div>
                <div className="text-sm text-blue-600 dark:text-blue-400">Photos Attached</div>
              </div>
            </div>

            {importResult.missingPhotos.length > 0 && (
              <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/20 p-3 border border-yellow-200 dark:border-yellow-800">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  Missing photos ({importResult.missingPhotos.length})
                </p>
                <ul className="text-xs text-yellow-700 dark:text-yellow-300 list-disc pl-4">
                  {importResult.missingPhotos.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}

            {importResult.errors.length > 0 && (
              <div className="rounded-md bg-red-50 dark:bg-red-950/20 p-3 border border-red-200 dark:border-red-800">
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  Errors ({importResult.errors.length})
                </p>
                <ul className="text-xs text-red-700 dark:text-red-300 list-disc pl-4">
                  {importResult.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'upload' && (
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setStep('upload')}>
                Back
              </Button>
              <Button onClick={handleImport} disabled={importing || parsedRows.length === 0}>
                {importing ? (
                  <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-1" />
                ) : (
                  <MaterialIcon name="upload" size="sm" className="mr-1" />
                )}
                Import {parsedRows.length} Items
              </Button>
            </>
          )}
          {step === 'result' && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
