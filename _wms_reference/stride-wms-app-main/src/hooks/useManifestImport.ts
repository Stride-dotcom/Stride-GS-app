import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { readWorkbook, sheetToJson } from '@/lib/excelUtils';

export interface ImportRow {
  vendor: string;
  description: string;
  ordered_qty: number;
  sidemark: string;
  room: string;
  notes: string;
  photo_filename: string;
  primary_photo: boolean;
}

export interface ImportSummary {
  imported: number;
  photosAttached: number;
  missingPhotos: string[];
  errors: string[];
}

export function useManifestImport() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const parseFile = useCallback(async (file: File): Promise<ImportRow[]> => {
    setParsing(true);
    setWarnings([]);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = await readWorkbook(arrayBuffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error('No worksheet found');
      const rawRows = sheetToJson<Record<string, unknown>>(sheet);

      const warns: string[] = [];
      const rows: ImportRow[] = rawRows.map((raw, idx) => {
        const desc = String(raw['description'] || raw['Description'] || '').trim();
        const qty = Number(raw['ordered_qty'] || raw['Ordered Qty'] || raw['qty'] || 0);

        if (!desc) warns.push(`Row ${idx + 2}: missing description`);
        if (!qty || qty <= 0) warns.push(`Row ${idx + 2}: invalid ordered_qty`);

        return {
          vendor: String(raw['vendor'] || raw['Vendor'] || '').trim(),
          description: desc,
          ordered_qty: qty > 0 ? qty : 1,
          sidemark: String(raw['sidemark'] || raw['Sidemark'] || '').trim(),
          room: String(raw['room'] || raw['Room'] || '').trim(),
          notes: String(raw['notes'] || raw['Notes'] || '').trim(),
          photo_filename: String(raw['photo_filename'] || raw['Photo Filename'] || '').trim(),
          primary_photo: raw['primary_photo'] === true || raw['primary_photo'] === 'true' || raw['Primary Photo'] === 'true',
        };
      });

      setWarnings(warns);
      setParsedRows(rows);
      return rows;
    } catch (error) {
      console.error('Error parsing import file:', error);
      toast({ variant: 'destructive', title: 'Parse Error', description: 'Failed to parse import file.' });
      return [];
    } finally {
      setParsing(false);
    }
  }, [toast]);

  const executeImport = useCallback(async (
    shipmentId: string,
    rows: ImportRow[],
    photoFiles?: Map<string, File>
  ): Promise<ImportSummary> => {
    if (!profile?.tenant_id) {
      return { imported: 0, photosAttached: 0, missingPhotos: [], errors: ['Not authenticated'] };
    }

    setImporting(true);
    const summary: ImportSummary = { imported: 0, photosAttached: 0, missingPhotos: [], errors: [] };

    try {
      for (const row of rows) {
        // Insert shipment item
        const { data: item, error: itemError } = await supabase
          .from('shipment_items')
          .insert({
            shipment_id: shipmentId,
            expected_quantity: row.ordered_qty,
            expected_vendor: row.vendor || null,
            expected_description: row.description || null,
            expected_sidemark: row.sidemark || null,
            room: row.room || null,
            notes: row.notes || null,
            status: 'pending',
            allocated_qty: 0,
          })
          .select()
          .single();

        if (itemError) {
          summary.errors.push(`Failed to import: ${row.description} - ${itemError.message}`);
          continue;
        }

        summary.imported++;

        // Handle photo if provided
        if (row.photo_filename && photoFiles) {
          const photoFile = photoFiles.get(row.photo_filename);
          if (photoFile) {
            const storageKey = `${profile.tenant_id}/shipment-items/${item.id}/${row.photo_filename}`;
            const { error: uploadError } = await supabase.storage
              .from('photos')
              .upload(storageKey, photoFile, { upsert: true });

            if (!uploadError) {
              const { data: urlData } = supabase.storage.from('photos').getPublicUrl(storageKey);

              const { data: photoRow } = await supabase
                .from('shipment_item_photos')
                .insert({
                  tenant_id: profile.tenant_id,
                  shipment_item_id: item.id,
                  storage_key: storageKey,
                  storage_url: urlData.publicUrl,
                  file_name: row.photo_filename,
                  file_size: photoFile.size,
                  mime_type: photoFile.type,
                  is_primary: row.primary_photo,
                  uploaded_by: profile.id,
                })
                .select()
                .single();

              if (photoRow && row.primary_photo) {
                await supabase
                  .from('shipment_items')
                  .update({ primary_photo_id: photoRow.id })
                  .eq('id', item.id);
              }

              summary.photosAttached++;
            }
          } else {
            summary.missingPhotos.push(row.photo_filename);
          }
        }
      }

      toast({
        title: 'Import Complete',
        description: `${summary.imported} items imported, ${summary.photosAttached} photos attached.`,
      });
    } catch (error) {
      console.error('Error during import:', error);
      summary.errors.push('Unexpected error during import');
    } finally {
      setImporting(false);
    }

    return summary;
  }, [profile?.tenant_id, profile?.id, toast]);

  return {
    parseFile,
    executeImport,
    parsedRows,
    warnings,
    parsing,
    importing,
    setParsedRows,
  };
}
