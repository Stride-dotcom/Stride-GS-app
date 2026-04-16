import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { HelpTip } from '@/components/ui/help-tip';
import { useToast } from '@/hooks/use-toast';
import {
  SHIPMENT_EXCEPTION_CODE_META,
  useShipmentExceptions,
  type ShipmentExceptionCode,
} from '@/hooks/useShipmentExceptions';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ExceptionsTab } from '@/components/receiving/ExceptionsTab';

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

interface ShipmentExceptionsChipsProps {
  shipmentId: string;
  /** Codes missing required notes (e.g. when completion is blocked) */
  missingNoteCodes?: ShipmentExceptionCode[];
  /** Called when a previously-missing note becomes non-empty */
  onMissingNoteCodeFilled?: (code: ShipmentExceptionCode) => void;
  /**
   * If true, show the intake-style ExceptionsTab (view/resolve/reopen) below the chips UI.
   * The chips UI manages only OPEN exceptions (add/remove + note editing).
   */
  showHistory?: boolean;
}

/**
 * Intake-style exceptions workflow:
 * - Select exception chips (creates/removes OPEN shipment_exceptions rows)
 * - Provide a note per selected exception (saved on blur)
 * - "OTHER" requires a note before insert (DB rule)
 */
export function ShipmentExceptionsChips({
  shipmentId,
  missingNoteCodes,
  onMissingNoteCodeFilled,
  showHistory = false,
}: ShipmentExceptionsChipsProps) {
  const { toast } = useToast();
  const { openExceptions, loading, upsertOpenException, removeOpenException } = useShipmentExceptions(shipmentId);

  const [exceptions, setExceptions] = useState<ExceptionChip[]>([]);
  const [exceptionNotes, setExceptionNotes] = useState<Record<ShipmentExceptionCode, string>>(
    {} as Record<ShipmentExceptionCode, string>
  );
  const [pendingRequiredNoteCode, setPendingRequiredNoteCode] = useState<ShipmentExceptionCode | null>(null);
  const [pendingRequiredNote, setPendingRequiredNote] = useState('');

  const labelByCode = useMemo(() => {
    const map = new Map<ShipmentExceptionCode, string>();
    EXCEPTION_OPTIONS.forEach((o) => map.set(o.value, o.label));
    return map;
  }, []);

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

  // DB-enforced required-note codes (must collect a note before inserting)
  const isDbRequiredNoteCode = (code: ShipmentExceptionCode) => code === 'OTHER';

  const toggleException = async (chip: ExceptionChip) => {
    const selected = exceptions.includes(chip);
    if (selected) {
      const removed = await removeOpenException(chip);
      if (!removed) return;
      setExceptions((prev) => prev.filter((e) => e !== chip));
      setExceptionNotes((prev) => {
        const next = { ...prev };
        delete next[chip];
        return next;
      });
      return;
    }

    if (isDbRequiredNoteCode(chip)) {
      setPendingRequiredNoteCode(chip);
      setPendingRequiredNote(exceptionNotes[chip] || '');
      return;
    }

    const saved = await upsertOpenException(chip, exceptionNotes[chip] || null);
    if (saved) {
      setExceptions((prev) => [...prev, chip]);
    }
  };

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
    setPendingRequiredNoteCode(null);
    setPendingRequiredNote('');
  };

  const handleExceptionNoteBlur = async (code: ShipmentExceptionCode) => {
    if (!exceptions.includes(code)) return;
    const note = exceptionNotes[code]?.trim() || null;
    if (isDbRequiredNoteCode(code) && !note) return;
    await upsertOpenException(code, note);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
                  type="button"
                  variant={isSelected ? 'default' : 'outline'}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void toggleException(opt.value)}
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
                Note for {labelByCode.get(ex) || ex}
                <span className="text-red-500"> *</span>
              </Label>
              {missingNoteCodes?.includes(ex) && !exceptionNotes[ex]?.trim() ? (
                <p className="text-xs text-destructive">Note required.</p>
              ) : null}
              <Textarea
                placeholder="Required: describe the exception..."
                rows={2}
                value={exceptionNotes[ex] || ''}
                onChange={(e) => {
                  const nextVal = e.target.value;
                  setExceptionNotes((prev) => ({ ...prev, [ex]: nextVal }));
                  if (onMissingNoteCodeFilled && nextVal.trim() && missingNoteCodes?.includes(ex)) {
                    onMissingNoteCodeFilled(ex);
                  }
                }}
                onBlur={() => void handleExceptionNoteBlur(ex)}
                className={
                  missingNoteCodes?.includes(ex) && !exceptionNotes[ex]?.trim()
                    ? 'border-destructive focus-visible:ring-destructive'
                    : undefined
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {showHistory ? <ExceptionsTab shipmentId={shipmentId} /> : null}

      {/* Required Exception Note Dialog */}
      <Dialog open={!!pendingRequiredNoteCode} onOpenChange={(open) => !open && setPendingRequiredNoteCode(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="edit_note" size="sm" />
              {pendingRequiredNoteCode
                ? `${SHIPMENT_EXCEPTION_CODE_META[pendingRequiredNoteCode].label} requires a note`
                : 'Exception note required'}
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
              placeholder="Please describe the exception."
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingRequiredNoteCode(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSaveRequiredNote()}>
              Save Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

