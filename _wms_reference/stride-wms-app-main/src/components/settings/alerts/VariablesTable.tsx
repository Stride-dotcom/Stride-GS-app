import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { COMMUNICATION_VARIABLES } from '@/hooks/useCommunications';
import { useToast } from '@/hooks/use-toast';

interface VariablesTableProps {
  onInsertVariable?: (variable: string) => void;
  filterGroups?: string[];
}

export function VariablesTable({ onInsertVariable, filterGroups }: VariablesTableProps) {
  const [search, setSearch] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const { toast } = useToast();

  const filteredVariables = COMMUNICATION_VARIABLES.filter(v => {
    const matchesSearch = 
      v.key.toLowerCase().includes(search.toLowerCase()) ||
      v.label.toLowerCase().includes(search.toLowerCase()) ||
      v.description.toLowerCase().includes(search.toLowerCase());
    
    const matchesGroup = !filterGroups || filterGroups.length === 0 || filterGroups.includes(v.group);
    
    return matchesSearch && matchesGroup;
  });

  const handleCopy = async (key: string) => {
    const variable = `[[${key}]]`;
    await navigator.clipboard.writeText(variable);
    setCopiedKey(key);
    toast({
      description: `Copied ${variable} to clipboard`,
    });
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleInsert = (key: string) => {
    if (onInsertVariable) {
      onInsertVariable(`[[${key}]]`);
    }
  };

  return (
    <div className="border-t bg-muted/30">
      <div className="p-3 border-b">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Available tokens</h3>
          <div className="relative w-64">
            <MaterialIcon name="search" size="sm" className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search tokens..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>
      </div>
      <ScrollArea className="h-[200px]">
        <div className="p-2">
          <table className="w-full">
            <tbody>
              {filteredVariables.map((variable) => (
                <tr 
                  key={variable.key} 
                  className="hover:bg-muted/50 cursor-pointer group"
                  onClick={() => handleInsert(variable.key)}
                >
                  <td className="py-1.5 px-2 w-[300px]">
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant="secondary" 
                        className="font-mono text-xs bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer"
                      >
                        [[{variable.key}]]
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(variable.key);
                        }}
                      >
                        {copiedKey === variable.key ? (
                          <MaterialIcon name="check" size="sm" className="text-green-600" />
                        ) : (
                          <MaterialIcon name="content_copy" size="sm" />
                        )}
                      </Button>
                    </div>
                  </td>
                  <td className="py-1.5 px-2 text-sm text-muted-foreground">
                    {variable.description}
                  </td>
                </tr>
              ))}
              {filteredVariables.length === 0 && (
                <tr>
                  <td colSpan={2} className="py-8 text-center text-muted-foreground text-sm">
                    No tokens found matching "{search}"
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ScrollArea>
    </div>
  );
}
