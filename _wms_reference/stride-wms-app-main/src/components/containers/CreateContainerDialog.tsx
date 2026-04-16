import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HelpTip } from '@/components/ui/help-tip';
import { SaveButton } from '@/components/ui/SaveButton';
import { useContainers } from '@/hooks/useContainers';
import { useContainerTypes } from '@/hooks/useContainerTypes';
import { PrintContainerLabelsDialog } from '@/components/containers/PrintContainerLabelsDialog';
import type { ContainerLabelData } from '@/lib/labelGenerator';
import { supabase } from '@/integrations/supabase/client';

const containerSchema = z.object({
  // Optional override. If left blank, the system auto-generates a CNT-##### code.
  container_code: z.string().max(50).optional(),
  container_type: z.string().min(1, 'Container type is required'),
  footprint_cu_ft: z.number().optional(),
});

type ContainerFormData = z.infer<typeof containerSchema>;

interface CreateContainerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
  locationId?: string;
  onSuccess: () => void;
}

export function CreateContainerDialog({
  open,
  onOpenChange,
  warehouseId,
  locationId,
  onSuccess,
}: CreateContainerDialogProps) {
  const [saving, setSaving] = useState(false);
  const [printAfterCreate, setPrintAfterCreate] = useState(true);
  const [printOpen, setPrintOpen] = useState(false);
  const [printContainers, setPrintContainers] = useState<ContainerLabelData[]>([]);
  const [customTypeInput, setCustomTypeInput] = useState('');
  const [addingType, setAddingType] = useState(false);
  const { createContainer } = useContainers();
  const { containerTypes, addContainerType } = useContainerTypes();

  const form = useForm<ContainerFormData>({
    resolver: zodResolver(containerSchema),
    defaultValues: {
      container_code: '',
      container_type: 'Carton',
      footprint_cu_ft: undefined,
    },
  });

  useEffect(() => {
    const current = (form.getValues('container_type') || '').trim();
    if (current) return;
    if (containerTypes.length === 0) return;
    form.setValue('container_type', containerTypes[0], { shouldValidate: true });
  }, [containerTypes, form]);

  const handleAddCustomType = async () => {
    if (addingType) return;
    const next = customTypeInput.trim();
    if (!next) return;

    setAddingType(true);
    try {
      const added = await addContainerType(next);
      if (added) {
        form.setValue('container_type', added, { shouldValidate: true });
        setCustomTypeInput('');
      }
    } finally {
      setAddingType(false);
    }
  };

  const onSubmit = async (data: ContainerFormData) => {
    setSaving(true);
    try {
      const result = await createContainer({
        container_code: data.container_code?.trim() ? data.container_code.trim().toUpperCase() : null,
        container_type: data.container_type,
        warehouse_id: warehouseId,
        location_id: locationId ?? null,
        footprint_cu_ft: data.footprint_cu_ft ?? null,
      });

      if (result) {
        if (printAfterCreate) {
          let warehouseName: string | null = null;
          let locationCode: string | null = null;
          try {
            if (warehouseId) {
              const { data: wh } = await supabase
                .from('warehouses')
                .select('name')
                .eq('id', warehouseId)
                .maybeSingle();
              warehouseName = (wh as any)?.name ? String((wh as any).name) : null;
            }
            if (locationId) {
              const { data: loc } = await supabase
                .from('locations')
                .select('code')
                .eq('id', locationId)
                .maybeSingle();
              locationCode = (loc as any)?.code ? String((loc as any).code) : null;
            }
          } catch {
            // optional
          }

          setPrintContainers([
            {
              id: result.id,
              containerCode: result.container_code,
              containerType: result.container_type ?? data.container_type,
              warehouseName,
              locationCode,
            },
          ]);
          setPrintOpen(true);
        }

        form.reset();
        onOpenChange(false);
        onSuccess();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Create Container</DialogTitle>
          <DialogDescription>
            Add a new container to this location. Containers hold inventory units and can be moved between locations.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="container_code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <HelpTip
                      tooltip="Optional override. Leave blank to auto-generate a CNT-##### barcode code."
                      pageKey="containers.create_dialog"
                      fieldKey="container_code"
                    >
                      Container Code
                    </HelpTip>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Auto-generated (CNT-#####) or enter a code"
                      {...field}
                      onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      className="font-mono"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="container_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <HelpTip
                      tooltip="The physical type of container. Affects default handling and capacity calculations."
                      pageKey="containers.create_dialog"
                      fieldKey="container_type"
                    >
                      Type *
                    </HelpTip>
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {containerTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="mt-2 flex gap-2">
                    <Input
                      placeholder="Add custom type (e.g., Vault)"
                      value={customTypeInput}
                      onChange={(e) => setCustomTypeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleAddCustomType();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleAddCustomType()}
                      disabled={!customTypeInput.trim() || addingType}
                    >
                      {addingType ? 'Adding…' : 'Add'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Custom container types are saved for your tenant and available to all users.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="footprint_cu_ft"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <HelpTip
                      tooltip="The physical footprint volume of the container itself. Used in bounded footprint capacity calculations. Leave empty if unknown."
                      pageKey="containers.create_dialog"
                      fieldKey="container_footprint_cu_ft"
                    >
                      Footprint (cu ft)
                    </HelpTip>
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="Optional"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value ? Number(e.target.value) : undefined)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">Print label after create</div>
                <div className="text-xs text-muted-foreground">
                  Opens the container label print dialog with the new code.
                </div>
              </div>
              <Switch
                checked={printAfterCreate}
                onCheckedChange={setPrintAfterCreate}
                aria-label="Print container label after creating"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <SaveButton
                type="submit"
                label="Create Container"
                savingLabel="Creating..."
                savedLabel="Created"
                saveDisabled={saving}
                onClick={() => {}}
              />
            </DialogFooter>
          </form>
        </Form>
        </DialogContent>
      </Dialog>

      <PrintContainerLabelsDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        containers={printContainers}
      />
    </>
  );
}
