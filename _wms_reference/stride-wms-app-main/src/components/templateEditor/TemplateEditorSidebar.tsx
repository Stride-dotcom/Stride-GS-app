import React, { useState, useMemo } from 'react';
import { Search, Copy, ChevronDown, ChevronRight, Settings, Braces } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { Token } from '@/lib/templateEditor/tokens';
import { TemplateSettings } from './TemplateEditor';

interface SidebarProps {
  tokens: Token[];
  settings?: TemplateSettings;
  onInsertToken: (token: string) => void;
  onSettingsChange?: (settings: TemplateSettings) => void;
  activePanel: 'tokens' | 'settings';
  onPanelChange: (panel: 'tokens' | 'settings') => void;
  showSettings: boolean;
}

export function TemplateEditorSidebar({
  tokens,
  settings,
  onInsertToken,
  onSettingsChange,
  activePanel,
  onPanelChange,
  showSettings
}: SidebarProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['Company Information', 'Invoice Details']);

  // Group tokens by category
  const tokensByCategory = useMemo(() => {
    const filtered = searchQuery
      ? tokens.filter(t =>
          t.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.token.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.description.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : tokens;

    return filtered.reduce((acc, token) => {
      const category = token.category || 'Other';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(token);
      return acc;
    }, {} as Record<string, Token[]>);
  }, [tokens, searchQuery]);

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(`{{${token}}}`);
    toast({
      title: 'Copied',
      description: 'Token copied to clipboard',
    });
  };

  const defaultTableColumns = [
    { id: 'rowNumber', label: '#', enabled: true },
    { id: 'date', label: 'Date', enabled: true },
    { id: 'chargeType', label: 'Service', enabled: true },
    { id: 'description', label: 'Description', enabled: true },
    { id: 'quantity', label: 'Qty', enabled: true },
    { id: 'unitRate', label: 'Rate', enabled: true },
    { id: 'total', label: 'Total', enabled: true },
    { id: 'sidemark', label: 'Sidemark', enabled: false },
    { id: 'itemCode', label: 'Item Code', enabled: false },
  ];

  return (
    <div className="w-72 bg-slate-800 border-r border-slate-700 flex flex-col">
      {/* Panel Tabs */}
      <div className="flex border-b border-slate-700">
        <button
          onClick={() => onPanelChange('tokens')}
          className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
            activePanel === 'tokens'
              ? 'text-white bg-slate-700 border-b-2 border-orange-500'
              : 'text-slate-400 hover:text-white hover:bg-slate-750'
          }`}
        >
          <Braces className="h-4 w-4" />
          Tokens
        </button>
        {showSettings && (
          <button
            onClick={() => onPanelChange('settings')}
            className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activePanel === 'settings'
                ? 'text-white bg-slate-700 border-b-2 border-orange-500'
                : 'text-slate-400 hover:text-white hover:bg-slate-750'
            }`}
          >
            <Settings className="h-4 w-4" />
            Settings
          </button>
        )}
      </div>

      {/* Panel Content */}
      <ScrollArea className="flex-1">
        {activePanel === 'tokens' ? (
          <div className="p-4">
            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search tokens..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-slate-700 border-slate-600 text-white placeholder:text-slate-400"
              />
            </div>

            {/* Token Categories */}
            <div className="space-y-2">
              {Object.entries(tokensByCategory).map(([category, categoryTokens]) => (
                <Collapsible
                  key={category}
                  open={expandedCategories.includes(category)}
                  onOpenChange={() => toggleCategory(category)}
                >
                  <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors">
                    {expandedCategories.includes(category) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    {category}
                    <span className="ml-auto text-xs text-slate-500">
                      {categoryTokens.length}
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pl-4 space-y-1 mt-1">
                    {categoryTokens.map(token => (
                      <div
                        key={token.id}
                        className="group p-2 rounded bg-slate-750 hover:bg-slate-700 cursor-pointer transition-colors"
                        style={{ backgroundColor: 'rgba(51, 65, 85, 0.5)' }}
                        onClick={() => onInsertToken(token.token)}
                      >
                        <div className="flex items-center justify-between">
                          <code className="text-xs text-orange-400 font-mono">
                            {`{{${token.token}}}`}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToken(token.token);
                            }}
                          >
                            <Copy className="h-3 w-3 text-slate-400" />
                          </Button>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          {token.description}
                        </p>
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-6">
            {/* Settings Panel Content - for invoice templates */}
            <div>
              <h3 className="text-sm font-medium text-white mb-3">Colors</h3>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-slate-400">Primary Color</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="color"
                      value={settings?.colors?.primary || '#E85D2D'}
                      onChange={(e) => onSettingsChange?.({
                        ...settings,
                        colors: { ...settings?.colors, primary: e.target.value }
                      })}
                      className="w-8 h-8 rounded cursor-pointer"
                    />
                    <Input
                      value={settings?.colors?.primary || '#E85D2D'}
                      onChange={(e) => onSettingsChange?.({
                        ...settings,
                        colors: { ...settings?.colors, primary: e.target.value }
                      })}
                      className="flex-1 h-8 bg-slate-700 border-slate-600 text-white text-xs"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-slate-400">Secondary Color</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="color"
                      value={settings?.colors?.secondary || '#1E293B'}
                      onChange={(e) => onSettingsChange?.({
                        ...settings,
                        colors: { ...settings?.colors, secondary: e.target.value }
                      })}
                      className="w-8 h-8 rounded cursor-pointer"
                    />
                    <Input
                      value={settings?.colors?.secondary || '#1E293B'}
                      onChange={(e) => onSettingsChange?.({
                        ...settings,
                        colors: { ...settings?.colors, secondary: e.target.value }
                      })}
                      className="flex-1 h-8 bg-slate-700 border-slate-600 text-white text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-white mb-3">Content Options</h3>
              <div className="space-y-2">
                {[
                  { id: 'showLogo', label: 'Show company logo' },
                  { id: 'showRemitTo', label: 'Show remit-to address' },
                  { id: 'showPaymentTerms', label: 'Show payment terms' },
                  { id: 'showPaymentLink', label: 'Show payment link button' },
                  { id: 'showNotes', label: 'Show notes section' },
                  { id: 'showTerms', label: 'Show terms & conditions' },
                ].map(option => (
                  <div key={option.id} className="flex items-center gap-2">
                    <Checkbox
                      id={option.id}
                      checked={settings?.contentOptions?.[option.id as keyof typeof settings.contentOptions] ?? true}
                      onCheckedChange={(checked) => onSettingsChange?.({
                        ...settings,
                        contentOptions: {
                          ...settings?.contentOptions,
                          [option.id]: checked
                        }
                      })}
                    />
                    <Label htmlFor={option.id} className="text-xs text-slate-300 cursor-pointer">
                      {option.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-white mb-3">Line Items Columns</h3>
              <div className="space-y-2">
                {(settings?.tableColumns || defaultTableColumns).map((col) => (
                  <div key={col.id} className="flex items-center gap-2">
                    <Checkbox
                      id={col.id}
                      checked={col.enabled}
                      onCheckedChange={(checked) => {
                        const columns = settings?.tableColumns || defaultTableColumns;
                        const updated = columns.map((c) =>
                          c.id === col.id ? { ...c, enabled: !!checked } : c
                        );
                        onSettingsChange?.({ ...settings, tableColumns: updated });
                      }}
                    />
                    <Label htmlFor={col.id} className="text-xs text-slate-300 cursor-pointer">
                      {col.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
