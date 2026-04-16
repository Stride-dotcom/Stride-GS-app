import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { COMMUNICATION_VARIABLES } from '@/hooks/useCommunications';

export function VariablesTab() {
  const [search, setSearch] = useState('');
  const [copiedVar, setCopiedVar] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState('all');

  const groups = ['all', ...new Set(COMMUNICATION_VARIABLES.map(v => v.group))];
  
  const filteredVariables = COMMUNICATION_VARIABLES.filter(v => {
    const matchesSearch = !search || 
      v.key.toLowerCase().includes(search.toLowerCase()) ||
      v.label.toLowerCase().includes(search.toLowerCase()) ||
      v.description.toLowerCase().includes(search.toLowerCase());
    const matchesGroup = activeGroup === 'all' || v.group === activeGroup;
    return matchesSearch && matchesGroup;
  });

  const copyToClipboard = (key: string) => {
    navigator.clipboard.writeText(`{{${key}}}`);
    setCopiedVar(key);
    setTimeout(() => setCopiedVar(null), 2000);
  };

  const copyAll = () => {
    const allVars = COMMUNICATION_VARIABLES.map(v => `{{${v.key}}}`).join('\n');
    navigator.clipboard.writeText(allVars);
    setCopiedVar('all');
    setTimeout(() => setCopiedVar(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Template Variables</h3>
        <p className="text-sm text-muted-foreground">
          Use these variables in your email and SMS templates. Click to copy.
        </p>
      </div>

      {/* Search and Copy All - Stack on mobile */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-center">
        <div className="relative flex-1 sm:max-w-md">
          <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search variables..."
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={copyAll} className="w-full sm:w-auto">
          {copiedVar === 'all' ? (
            <>
              <MaterialIcon name="check" size="sm" className="mr-2 text-green-500" />
              Copied All
            </>
          ) : (
            <>
              <MaterialIcon name="content_copy" size="sm" className="mr-2" />
              Copy All Variables
            </>
          )}
        </Button>
      </div>

      {/* Category Tabs - Horizontal scroll on mobile */}
      <Tabs value={activeGroup} onValueChange={setActiveGroup}>
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="inline-flex h-auto gap-1 p-1 whitespace-nowrap">
            {groups.map(group => (
              <TabsTrigger key={group} value={group} className="capitalize flex-shrink-0">
                {group}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {/* Variable Cards Grid - Responsive */}
      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {filteredVariables.map((variable) => (
          <Card
            key={variable.key}
            className="cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => copyToClipboard(variable.key)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-xs sm:text-sm font-mono bg-muted px-2 py-0.5 rounded break-all">
                      {`{{${variable.key}}}`}
                    </code>
                    {copiedVar === variable.key && (
                      <MaterialIcon name="check" size="sm" className="text-green-500 flex-shrink-0" />
                    )}
                  </div>
                  <p className="font-medium text-sm">{variable.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{variable.description}</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge variant="secondary" className="text-xs">
                      {variable.group}
                    </Badge>
                    <span className="text-xs text-muted-foreground truncate">
                      Sample: {variable.sample}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredVariables.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No variables found matching your search.
        </div>
      )}

      {/* All Variables Reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Variables Quick Reference</CardTitle>
          <CardDescription>
            Copy this list for reference when building templates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[200px] sm:h-[300px]">
            <pre className="text-xs font-mono bg-muted p-4 rounded-lg overflow-x-auto whitespace-pre-wrap break-all sm:whitespace-pre sm:break-normal">
              {COMMUNICATION_VARIABLES.map(v => `{{${v.key}}} - ${v.label}`).join('\n')}
            </pre>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Special Variables Info */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <MaterialIcon name="info" size="md" className="text-primary mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="font-medium text-sm">Special Variables</h4>
              <div className="text-sm text-muted-foreground mt-2 space-y-2">
                <p className="break-all sm:break-normal">
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{'{{items_list_html}}'}</code>
                  {' '}— Renders a card-style list of items with quantity, vendor, description, and location. Use in emails only.
                </p>
                <p className="break-all sm:break-normal">
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{'{{items_list_text}}'}</code>
                  {' '}— Plain text list of items formatted as "Qty x Vendor — ItemID — Desc". Use in SMS.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
