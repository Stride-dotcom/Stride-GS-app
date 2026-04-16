import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface DisplaySettingsSectionProps {
  showWarehouseInLocation: boolean;
  onShowWarehouseInLocationChange: (value: boolean) => void;
}

export function DisplaySettingsSection({
  showWarehouseInLocation,
  onShowWarehouseInLocationChange,
}: DisplaySettingsSectionProps) {
  const [open, setOpen] = useState(true);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <MaterialIcon name="desktop_windows" size="sm" />
              Display Settings
            </CardTitle>
            <CardDescription className="text-xs">
              Configure how information is displayed
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
        <div className="flex items-center justify-between gap-3 py-1">
          <div className="flex items-center gap-2 min-w-0">
            <MaterialIcon name="location_on" size="sm" className="text-muted-foreground flex-shrink-0" />
            <div className="min-w-0">
              <Label className="text-sm">Show Warehouse in Location</Label>
              <p className="text-xs text-muted-foreground truncate">
                Display "Code (Warehouse)" format
              </p>
            </div>
          </div>
          <Switch
            checked={showWarehouseInLocation}
            onCheckedChange={onShowWarehouseInLocationChange}
          />
        </div>
      </CardContent>
      ) : null}
    </Card>
  );
}
