import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { COMMUNICATION_VARIABLES, CommunicationDesignElement } from '@/hooks/useCommunications';
import { toast } from '@/lib/toastShim';

interface VariablesDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  designElements: CommunicationDesignElement[];
  onInsertVariable: (variable: string) => void;
  onInsertDesignElement?: (element: CommunicationDesignElement) => void;
}

export function VariablesDrawer({
  open,
  onOpenChange,
  designElements,
  onInsertVariable,
  onInsertDesignElement,
}: VariablesDrawerProps) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'variables' | 'design'>('variables');
  const [copiedVar, setCopiedVar] = useState<string | null>(null);

  const filteredVariables = COMMUNICATION_VARIABLES.filter(v =>
    v.key.toLowerCase().includes(search.toLowerCase()) ||
    v.label.toLowerCase().includes(search.toLowerCase()) ||
    v.group.toLowerCase().includes(search.toLowerCase())
  );

  const filteredDesignElements = designElements.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.category.toLowerCase().includes(search.toLowerCase())
  );

  const groupedVariables = filteredVariables.reduce((acc, v) => {
    if (!acc[v.group]) acc[v.group] = [];
    acc[v.group].push(v);
    return acc;
  }, {} as Record<string, typeof COMMUNICATION_VARIABLES>);

  const handleInsertVariable = (key: string) => {
    onInsertVariable(`{{${key}}}`);
    toast.success(`Inserted {{${key}}}`);
  };

  const handleCopyVariable = (key: string) => {
    navigator.clipboard.writeText(`{{${key}}}`);
    setCopiedVar(key);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopiedVar(null), 2000);
  };

  const handleInsertDesign = (element: CommunicationDesignElement) => {
    if (onInsertDesignElement) {
      onInsertDesignElement(element);
      toast.success(`Inserted ${element.name}`);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-hidden flex flex-col">
        <SheetHeader className="flex-shrink-0">
          <SheetTitle>Insert Content</SheetTitle>
        </SheetHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'variables' | 'design')}
          className="flex-1 flex flex-col mt-4 overflow-hidden"
        >
          <TabsList className="grid w-full grid-cols-2 flex-shrink-0">
            <TabsTrigger value="variables" className="gap-2">
              <MaterialIcon name="data_object" size="sm" />
              Variables
            </TabsTrigger>
            <TabsTrigger value="design" className="gap-2">
              <MaterialIcon name="palette" size="sm" />
              Design
            </TabsTrigger>
          </TabsList>

          <div className="relative mt-4 flex-shrink-0">
            <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <TabsContent value="variables" className="flex-1 mt-4 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="space-y-6 pr-4">
                {Object.entries(groupedVariables).map(([group, vars]) => (
                  <div key={group}>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      {group}
                    </h4>
                    <div className="space-y-1">
                      {vars.map((variable) => (
                        <div
                          key={variable.key}
                          className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer group"
                          onClick={() => handleInsertVariable(variable.key)}
                        >
                          <div className="flex-1 min-w-0">
                            <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded break-all">
                              {`{{${variable.key}}}`}
                            </code>
                            <p className="text-sm text-muted-foreground mt-1 truncate">
                              {variable.label}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyVariable(variable.key);
                            }}
                          >
                            {copiedVar === variable.key ? (
                              <MaterialIcon name="check" size="sm" className="text-green-500" />
                            ) : (
                              <MaterialIcon name="content_copy" size="sm" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {filteredVariables.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    No variables found
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="design" className="flex-1 mt-4 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="space-y-2 pr-4">
                {filteredDesignElements.map((element) => (
                  <div
                    key={element.id}
                    className="p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                    onClick={() => handleInsertDesign(element)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{element.name}</span>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {element.category.replace('_', ' ')}
                      </Badge>
                    </div>
                    {element.is_system && (
                      <Badge variant="outline" className="text-xs mt-2">System</Badge>
                    )}
                  </div>
                ))}
                {filteredDesignElements.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    No design elements found
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
