import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Separator } from '@/components/ui/separator';
import type { LabelConfig, LabelFieldConfig } from '@/hooks/useTenantPreferences';
import { DEFAULT_LABEL_CONFIG } from '@/hooks/useTenantPreferences';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface LabelCustomizationSectionProps {
  config: LabelConfig;
  onChange: (config: LabelConfig) => void;
}

// Sample data for preview
const SAMPLE_ITEM = {
  account: 'Acme Moving Co.',
  sidemark: 'Johnson Family',
  room: 'Living Room',
  itemCode: 'ITM-00042',
  sku: 'SKU-12345',
  vendor: 'Ashley Furniture',
  description: 'Brown leather sofa, 3-seat with recliner',
  warehouseName: 'Main Warehouse',
  locationCode: 'A-01-03',
};

function SortableFieldRow({
  field,
  onToggle,
  onFontSizeChange,
  onBoldToggle,
}: {
  field: LabelFieldConfig;
  onToggle: (key: string) => void;
  onFontSizeChange: (key: string, size: number) => void;
  onBoldToggle: (key: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.key,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-md border px-3 py-2 bg-background ${
        !field.enabled ? 'opacity-50' : ''
      }`}
    >
      <button
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <MaterialIcon name="drag_indicator" size="sm" />
      </button>

      <Switch checked={field.enabled} onCheckedChange={() => onToggle(field.key)} />

      <span className="text-sm font-medium min-w-[80px]">{field.label}</span>

      <div className="flex items-center gap-2 ml-auto">
        <button
          onClick={() => onBoldToggle(field.key)}
          className={`px-1.5 py-0.5 text-xs rounded border ${
            field.bold
              ? 'bg-foreground text-background border-foreground font-bold'
              : 'bg-background text-muted-foreground border-input hover:border-foreground'
          }`}
          title="Toggle bold"
        >
          B
        </button>

        <div className="flex items-center gap-1.5 min-w-[120px]">
          <Slider
            value={[field.fontSize]}
            onValueChange={([v]) => onFontSizeChange(field.key, v)}
            min={8}
            max={36}
            step={1}
            className="w-[70px]"
          />
          <span className="text-xs text-muted-foreground w-[28px] text-right tabular-nums">
            {field.fontSize}pt
          </span>
        </div>
      </div>
    </div>
  );
}

function LabelPreview({ config }: { config: LabelConfig }) {
  const enabledFields = config.fields.filter(f => f.enabled);

  // Scale factor: preview is ~200px wide representing 4" (288pt) label
  const scale = 200 / 288;
  const previewHeight = 432 * scale; // 6" label

  return (
    <div
      className="mx-auto bg-white rounded"
      style={{
        width: 200,
        height: previewHeight,
        border: config.showBorder ? '2px solid #000' : '1px solid #e5e7eb',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflow: 'hidden',
        fontFamily: 'Helvetica, Arial, sans-serif',
      }}
    >
      {/* Render fields */}
      <div className="flex flex-col items-center w-full gap-0.5" style={{ flex: '1 1 auto', minHeight: 0 }}>
        {enabledFields.map((field, idx) => {
          const value = SAMPLE_ITEM[field.key as keyof typeof SAMPLE_ITEM] || '';
          if (!value) return null;

          const scaledSize = Math.max(7, Math.round(field.fontSize * scale));
          const isHeaderField = field.key === 'account' || field.key === 'sidemark' || field.key === 'room';
          const isFirstNonHeader = !isHeaderField && idx > 0 && enabledFields.slice(0, idx).some(
            f => f.key === 'account' || f.key === 'sidemark' || f.key === 'room'
          );

          return (
            <div key={field.key} className="w-full text-center">
              {isFirstNonHeader && idx > 0 && (
                <Separator className="my-1 mx-auto w-4/5" />
              )}
              <div
                style={{
                  fontSize: scaledSize,
                  fontWeight: field.bold ? 700 : 400,
                  color: field.bold ? '#000' : '#555',
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: field.key === 'description' ? 'normal' : 'nowrap',
                }}
              >
                {field.key === 'room' ? `Room: ${value}` : value}
              </div>
            </div>
          );
        })}
      </div>

      {/* QR placeholder */}
      {config.showQR && (
        <div
          className="flex-shrink-0 mt-auto flex flex-col items-center"
          style={{ paddingTop: 4 }}
        >
          <div
            style={{
              width: config.qrSize * scale,
              height: config.qrSize * scale,
              border: '1px solid #ccc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 8,
              color: '#999',
              background: '#fafafa',
            }}
          >
            QR Code
          </div>
          <span style={{ fontSize: 6, color: '#999', marginTop: 2 }}>
            Scan QR to view item details
          </span>
        </div>
      )}
    </div>
  );
}

export function LabelCustomizationSection({ config, onChange }: LabelCustomizationSectionProps) {
  const [open, setOpen] = useState(true);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const updateField = useCallback(
    (key: string, updates: Partial<LabelFieldConfig>) => {
      onChange({
        ...config,
        fields: config.fields.map(f => (f.key === key ? { ...f, ...updates } : f)),
      });
    },
    [config, onChange]
  );

  const handleToggle = useCallback((key: string) => {
    const field = config.fields.find(f => f.key === key);
    if (field) updateField(key, { enabled: !field.enabled });
  }, [config.fields, updateField]);

  const handleFontSizeChange = useCallback((key: string, size: number) => {
    updateField(key, { fontSize: size });
  }, [updateField]);

  const handleBoldToggle = useCallback((key: string) => {
    const field = config.fields.find(f => f.key === key);
    if (field) updateField(key, { bold: !field.bold });
  }, [config.fields, updateField]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = config.fields.findIndex(f => f.key === active.id);
      const newIndex = config.fields.findIndex(f => f.key === over.id);
      onChange({
        ...config,
        fields: arrayMove(config.fields, oldIndex, newIndex),
      });
    }
  };

  const handleReset = () => {
    onChange({ ...DEFAULT_LABEL_CONFIG });
  };

  const fieldIds = useMemo(() => config.fields.map(f => f.key), [config.fields]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MaterialIcon name="label" size="sm" />
              Item Label Customization
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Choose which fields appear on item labels, adjust font sizes, and reorder by dragging. Changes apply to all label printing.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={handleReset} title="Reset to defaults">
              <MaterialIcon name="restart_alt" size="sm" className="mr-1" />
              Reset
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? 'Collapse section' : 'Expand section'}
              title={open ? 'Collapse' : 'Expand'}
            >
              <MaterialIcon name={open ? 'expand_less' : 'expand_more'} size="sm" />
            </Button>
          </div>
        </div>
      </CardHeader>
      {open ? (
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6">
          {/* Left: Field configuration */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Fields & Order</Label>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={fieldIds} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1.5">
                    {config.fields.map(field => (
                      <SortableFieldRow
                        key={field.key}
                        field={field}
                        onToggle={handleToggle}
                        onFontSizeChange={handleFontSizeChange}
                        onBoldToggle={handleBoldToggle}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>

            <Separator />

            {/* Global options */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Label Options</Label>

              <div className="flex items-center justify-between gap-3 py-1">
                <div className="flex items-center gap-2">
                  <MaterialIcon name="qr_code" size="sm" className="text-muted-foreground" />
                  <div>
                    <span className="text-sm">Show QR Code</span>
                  </div>
                </div>
                <Switch
                  checked={config.showQR}
                  onCheckedChange={(v) => onChange({ ...config, showQR: v })}
                />
              </div>

              {config.showQR && (
                <div className="flex items-center gap-3 pl-7">
                  <Label className="text-xs text-muted-foreground min-w-[50px]">QR Size</Label>
                  <Slider
                    value={[config.qrSize]}
                    onValueChange={([v]) => onChange({ ...config, qrSize: v })}
                    min={80}
                    max={220}
                    step={10}
                    className="flex-1"
                  />
                  <span className="text-xs text-muted-foreground w-[36px] text-right tabular-nums">
                    {config.qrSize}px
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 py-1">
                <div className="flex items-center gap-2">
                  <MaterialIcon name="crop_square" size="sm" className="text-muted-foreground" />
                  <span className="text-sm">Show Border</span>
                </div>
                <Switch
                  checked={config.showBorder}
                  onCheckedChange={(v) => onChange({ ...config, showBorder: v })}
                />
              </div>
            </div>
          </div>

          {/* Right: Live preview */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-center block">Preview (4x6&quot;)</Label>
            <div className="border rounded-lg p-4 bg-muted/30 flex items-start justify-center min-w-[232px]">
              <LabelPreview config={config} />
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              Preview uses sample data. Actual labels render with real item data.
            </p>
          </div>
        </div>
      </CardContent>
      ) : null}
    </Card>
  );
}
