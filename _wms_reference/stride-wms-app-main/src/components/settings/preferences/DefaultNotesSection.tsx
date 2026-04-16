import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface DefaultNotesSectionProps {
  defaultShipmentNotes: string;
  onDefaultShipmentNotesChange: (value: string) => void;
}

export function DefaultNotesSection({
  defaultShipmentNotes,
  onDefaultShipmentNotesChange,
}: DefaultNotesSectionProps) {
  const [open, setOpen] = useState(true);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="description" size="md" />
              Default Shipment Notes
            </CardTitle>
            <CardDescription>
              Default notes to pre-populate on new shipments
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Collapse section' : 'Expand section'}
            title={open ? 'Collapse' : 'Expand'}
          >
            <MaterialIcon name={open ? 'expand_less' : 'expand_more'} size="sm" />
          </Button>
        </div>
      </CardHeader>
      {open ? (
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="default_notes">Default Notes</Label>
            <Textarea
              id="default_notes"
              placeholder="Enter default notes that will appear on new shipments..."
              rows={4}
              value={defaultShipmentNotes}
              onChange={(e) => onDefaultShipmentNotesChange(e.target.value)}
            />
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
