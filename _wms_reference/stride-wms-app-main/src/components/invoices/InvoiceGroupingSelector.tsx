import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';
import { GroupByOptions, PreviewCounts } from '@/lib/invoiceBuilder/types';

interface InvoiceGroupingSelectorProps {
  groupBy: GroupByOptions;
  onGroupByChange: (groupBy: GroupByOptions) => void;
  previewCounts: PreviewCounts;
}

type PresetType = 'account' | 'sidemark' | 'chargeType' | 'custom';

export function InvoiceGroupingSelector({
  groupBy,
  onGroupByChange,
  previewCounts,
}: InvoiceGroupingSelectorProps) {

  // Determine which preset is active
  const getActivePreset = (): PresetType => {
    if (groupBy.account && !groupBy.sidemark && !groupBy.chargeType) return 'account';
    if (groupBy.account && groupBy.sidemark && !groupBy.chargeType) return 'sidemark';
    if (!groupBy.account && !groupBy.sidemark && groupBy.chargeType) return 'chargeType';
    return 'custom';
  };

  const activePreset = getActivePreset();

  const handlePresetClick = (preset: PresetType) => {
    switch (preset) {
      case 'account':
        onGroupByChange({ account: true, sidemark: false, chargeType: false });
        break;
      case 'sidemark':
        onGroupByChange({ account: true, sidemark: true, chargeType: false });
        break;
      case 'chargeType':
        onGroupByChange({ account: false, sidemark: false, chargeType: true });
        break;
      case 'custom':
        // Keep current
        break;
    }
  };

  const handleCheckboxChange = (field: keyof GroupByOptions, checked: boolean) => {
    onGroupByChange({ ...groupBy, [field]: checked });
  };

  const presets = [
    {
      id: 'account' as PresetType,
      icon: 'folder',
      label: 'One Per Account',
      count: previewCounts.byAccount,
      description: 'One invoice per account',
    },
    {
      id: 'sidemark' as PresetType,
      icon: 'folder_open',
      label: 'One Per Sidemark',
      count: previewCounts.bySidemark,
      description: 'Separate by account and sidemark',
    },
    {
      id: 'chargeType' as PresetType,
      icon: 'label',
      label: 'One Per Charge Type',
      count: previewCounts.byChargeType,
      description: 'Storage vs Receiving etc',
    },
    {
      id: 'custom' as PresetType,
      icon: 'tune',
      label: 'Custom',
      count: previewCounts.custom,
      description: 'Configure options below',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Grouping Strategy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Presets */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {presets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handlePresetClick(preset.id)}
              className={cn(
                "flex flex-col items-center p-4 rounded-lg border-2 transition-all",
                "hover:border-primary/50 hover:bg-accent/50",
                activePreset === preset.id
                  ? "border-primary bg-accent"
                  : "border-border"
              )}
            >
              <MaterialIcon
                name={preset.icon}
                className={cn(
                  "mb-2",
                  activePreset === preset.id ? "text-primary" : "text-muted-foreground"
                )}
                size="md"
              />
              <span className="font-medium text-sm">{preset.label}</span>
              <span className="text-xs text-muted-foreground mt-1">
                {preset.count} invoice{preset.count !== 1 ? 's' : ''}
              </span>
            </button>
          ))}
        </div>

        {/* Custom Options */}
        <div className="border-t pt-4">
          <p className="text-sm font-medium mb-3">Custom Options</p>
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="group-account"
                checked={groupBy.account}
                onCheckedChange={(checked) => handleCheckboxChange('account', !!checked)}
              />
              <Label htmlFor="group-account" className="text-sm">
                Group by Account <span className="text-muted-foreground">(separate invoice for each account)</span>
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="group-sidemark"
                checked={groupBy.sidemark}
                onCheckedChange={(checked) => handleCheckboxChange('sidemark', !!checked)}
              />
              <Label htmlFor="group-sidemark" className="text-sm">
                Group by Sidemark <span className="text-muted-foreground">(separate invoice for each sidemark within account)</span>
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="group-chargeType"
                checked={groupBy.chargeType}
                onCheckedChange={(checked) => handleCheckboxChange('chargeType', !!checked)}
              />
              <Label htmlFor="group-chargeType" className="text-sm">
                Group by Charge Type <span className="text-muted-foreground">(separate invoice for Storage vs Receiving etc)</span>
              </Label>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-3">
            Preview: <span className="font-medium">{previewCounts.custom}</span> invoice{previewCounts.custom !== 1 ? 's' : ''} will be created
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
