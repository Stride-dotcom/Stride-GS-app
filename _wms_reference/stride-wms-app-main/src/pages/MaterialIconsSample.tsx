import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function MaterialIconsSample() {
  const navigate = useNavigate();

  // Common WMS-related icons
  const warehouseIcons = [
    'warehouse', 'inventory_2', 'package_2', 'local_shipping', 'forklift',
    'pallet', 'dolly', 'trolley', 'conveyor_belt', 'qr_code_scanner'
  ];

  const actionIcons = [
    'add', 'edit', 'delete', 'search', 'filter_list',
    'sort', 'refresh', 'download', 'upload', 'print'
  ];

  const statusIcons = [
    'check_circle', 'cancel', 'pending', 'schedule', 'priority_high',
    'warning', 'error', 'info', 'help', 'verified'
  ];

  const navigationIcons = [
    'home', 'menu', 'arrow_back', 'arrow_forward', 'expand_more',
    'chevron_right', 'close', 'fullscreen', 'settings', 'account_circle'
  ];

  const taskIcons = [
    'task_alt', 'assignment', 'checklist', 'fact_check', 'rule',
    'grading', 'rate_review', 'approval', 'thumb_up', 'thumb_down'
  ];

  const renderIconGrid = (icons: string[], title: string) => (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-5 gap-4">
          {icons.map((icon) => (
            <div key={icon} className="flex flex-col items-center gap-2 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
              <MaterialIcon name={icon} size="lg" />
              <span className="text-xs text-muted-foreground text-center">{icon}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Google Material Symbols Sample</h1>
        </div>

        {/* Size Variations */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Size Variations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-8">
              <div className="flex flex-col items-center gap-2">
                <MaterialIcon name="inventory_2" size="sm" />
                <span className="text-xs text-muted-foreground">sm (16px)</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <MaterialIcon name="inventory_2" size="md" />
                <span className="text-xs text-muted-foreground">md (20px)</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <MaterialIcon name="inventory_2" size="lg" />
                <span className="text-xs text-muted-foreground">lg (24px)</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <MaterialIcon name="inventory_2" size="xl" />
                <span className="text-xs text-muted-foreground">xl (36px)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Fill Variations */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Filled vs Outlined</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-8">
              {['favorite', 'star', 'check_circle', 'bookmark', 'notifications'].map((icon) => (
                <div key={icon} className="flex flex-col items-center gap-4">
                  <div className="flex gap-4">
                    <div className="flex flex-col items-center gap-1">
                      <MaterialIcon name={icon} size="lg" />
                      <span className="text-xs text-muted-foreground">outlined</span>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <MaterialIcon name={icon} size="lg" filled />
                      <span className="text-xs text-muted-foreground">filled</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Weight Variations */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Weight Variations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              {[100, 200, 300, 400, 500, 600, 700].map((weight) => (
                <div key={weight} className="flex flex-col items-center gap-2">
                  <MaterialIcon name="settings" size="lg" weight={weight as any} />
                  <span className="text-xs text-muted-foreground">{weight}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Icon Categories */}
        {renderIconGrid(warehouseIcons, 'Warehouse & Logistics')}
        {renderIconGrid(actionIcons, 'Actions')}
        {renderIconGrid(statusIcons, 'Status')}
        {renderIconGrid(navigationIcons, 'Navigation')}
        {renderIconGrid(taskIcons, 'Tasks & Approvals')}

        {/* Usage Example */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Usage in Code</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">
{`import { MaterialIcon } from '@/components/ui/MaterialIcon';

// Basic usage
<MaterialIcon name="inventory_2" />

// With size
<MaterialIcon name="warehouse" size="lg" />

// Filled style
<MaterialIcon name="check_circle" filled />

// Custom weight
<MaterialIcon name="settings" weight={600} />

// With custom className
<MaterialIcon name="local_shipping" className="text-primary" />`}
            </pre>
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground text-center">
          Browse all icons at{' '}
          <a
            href="https://fonts.google.com/icons"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            fonts.google.com/icons
          </a>
        </p>
      </div>
    </div>
  );
}
