import { useState, useCallback, useMemo } from 'react';
import { Reader, renderToStaticMarkup, TReaderDocument } from '@usewaypoint/email-builder';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  CommunicationBrandSettings,
  COMMUNICATION_VARIABLES,
} from '@/hooks/useCommunications';

// Default empty document structure
const DEFAULT_EMAIL_DOCUMENT: TReaderDocument = {
  root: {
    type: 'EmailLayout',
    data: {
      backdropColor: '#F5F5F5',
      canvasColor: '#FFFFFF',
      textColor: '#262626',
      fontFamily: 'MODERN_SANS',
      childrenIds: [],
    },
  },
};

// Block type definitions
type BlockType = 'Heading' | 'Text' | 'Button' | 'Image' | 'Divider' | 'Spacer';

interface BlockConfig {
  type: BlockType;
  label: string;
  iconName: string;
  defaultData: Record<string, unknown>;
}

const BLOCK_TYPES: BlockConfig[] = [
  {
    type: 'Heading',
    label: 'Heading',
    iconName: 'title',
    defaultData: {
      props: { text: 'New Heading', level: 'h2' },
      style: { textAlign: 'left', fontWeight: 'bold' },
    },
  },
  {
    type: 'Text',
    label: 'Text',
    iconName: 'text_fields',
    defaultData: {
      props: { text: 'Enter your text here...', markdown: false },
      style: { textAlign: 'left', padding: { top: 8, bottom: 8, left: 0, right: 0 } },
    },
  },
  {
    type: 'Button',
    label: 'Button',
    iconName: 'link',
    defaultData: {
      props: { text: 'Click Here', url: 'https://example.com' },
      style: {
        backgroundColor: '#FD5A2A',
        textColor: '#FFFFFF',
        padding: { top: 12, bottom: 12, left: 24, right: 24 },
        borderRadius: 4,
      },
    },
  },
  {
    type: 'Image',
    label: 'Image',
    iconName: 'image',
    defaultData: {
      props: { url: '', alt: 'Image', width: '100%' },
      style: { textAlign: 'center' },
    },
  },
  {
    type: 'Divider',
    label: 'Divider',
    iconName: 'remove',
    defaultData: {
      props: { lineColor: '#E5E7EB' },
      style: { padding: { top: 16, bottom: 16, left: 0, right: 0 } },
    },
  },
  {
    type: 'Spacer',
    label: 'Spacer',
    iconName: 'check_box_outline_blank',
    defaultData: {
      props: { height: 32 },
    },
  },
];

interface EmailWysiwygEditorProps {
  initialJson: TReaderDocument | null;
  initialHtml: string;
  brandSettings: CommunicationBrandSettings | null;
  onJsonChange: (json: TReaderDocument) => void;
  onHtmlChange: (html: string) => void;
}

export function EmailWysiwygEditor({
  initialJson,
  initialHtml,
  brandSettings,
  onJsonChange,
  onHtmlChange,
}: EmailWysiwygEditorProps) {
  const [editorMode, setEditorMode] = useState<'visual' | 'code'>('visual');
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [document, setDocument] = useState<TReaderDocument>(
    initialJson || DEFAULT_EMAIL_DOCUMENT
  );
  const [rawHtml, setRawHtml] = useState(initialHtml);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [showVariables, setShowVariables] = useState(false);

  // Get the root block's children IDs
  const getChildrenIds = useCallback((): string[] => {
    const root = document.root;
    if (root && root.data && 'childrenIds' in root.data) {
      return (root.data as { childrenIds: string[] }).childrenIds || [];
    }
    return [];
  }, [document]);

  // Update document and propagate changes
  const updateDocument = useCallback(
    (newDocument: TReaderDocument) => {
      setDocument(newDocument);
      onJsonChange(newDocument);

      // Convert to HTML
      try {
        const html = renderToStaticMarkup(newDocument, { rootBlockId: 'root' });
        onHtmlChange(html);
        setRawHtml(html);
      } catch (e) {
        console.error('Error rendering email HTML:', e);
      }
    },
    [onJsonChange, onHtmlChange]
  );

  // Generate unique block ID
  const generateBlockId = useCallback(() => {
    return `block_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }, []);

  // Add a new block
  const addBlock = useCallback(
    (blockConfig: BlockConfig, afterBlockId?: string) => {
      const blockId = generateBlockId();
      const childrenIds = getChildrenIds();
      let newChildrenIds: string[];

      if (afterBlockId) {
        const index = childrenIds.indexOf(afterBlockId);
        newChildrenIds = [
          ...childrenIds.slice(0, index + 1),
          blockId,
          ...childrenIds.slice(index + 1),
        ];
      } else {
        newChildrenIds = [...childrenIds, blockId];
      }

      const newDocument = {
        ...document,
        root: {
          ...document.root,
          data: {
            ...document.root.data,
            childrenIds: newChildrenIds,
          },
        },
        [blockId]: {
          type: blockConfig.type,
          data: blockConfig.defaultData,
        },
      } as TReaderDocument;

      updateDocument(newDocument);
      setEditingBlockId(blockId);
    },
    [document, generateBlockId, getChildrenIds, updateDocument]
  );

  // Remove a block
  const removeBlock = useCallback(
    (blockId: string) => {
      const childrenIds = getChildrenIds();
      const newChildrenIds = childrenIds.filter((id) => id !== blockId);

      const newDocument = { ...document } as Record<string, any>;
      delete newDocument[blockId];
      newDocument.root = {
        ...newDocument.root,
        data: {
          ...newDocument.root.data,
          childrenIds: newChildrenIds,
        },
      };

      updateDocument(newDocument);
      if (editingBlockId === blockId) {
        setEditingBlockId(null);
      }
    },
    [document, editingBlockId, getChildrenIds, updateDocument]
  );

  // Move a block up or down
  const moveBlock = useCallback(
    (blockId: string, direction: 'up' | 'down') => {
      const childrenIds = getChildrenIds();
      const index = childrenIds.indexOf(blockId);
      if (index === -1) return;

      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= childrenIds.length) return;

      const newChildrenIds = [...childrenIds];
      [newChildrenIds[index], newChildrenIds[newIndex]] = [
        newChildrenIds[newIndex],
        newChildrenIds[index],
      ];

      const newDocument = {
        ...document,
        root: {
          ...document.root,
          data: {
            ...document.root.data,
            childrenIds: newChildrenIds,
          },
        },
      } as TReaderDocument;

      updateDocument(newDocument);
    },
    [document, getChildrenIds, updateDocument]
  );

  // Update a block's data
  const updateBlock = useCallback(
    (blockId: string, updates: Record<string, unknown>) => {
      if (!document[blockId]) return;

      const newDocument = {
        ...document,
        [blockId]: {
          ...document[blockId],
          data: {
            ...document[blockId].data,
            ...updates,
          },
        },
      } as TReaderDocument;

      updateDocument(newDocument);
    },
    [document, updateDocument]
  );

  // When raw HTML changes in code mode
  const handleRawHtmlChange = useCallback(
    (html: string) => {
      setRawHtml(html);
      onHtmlChange(html);
    },
    [onHtmlChange]
  );

  // Insert a variable at cursor in HTML mode
  const insertVariable = useCallback(
    (variable: string) => {
      if (editorMode === 'code') {
        setRawHtml((prev) => prev + `{{${variable}}}`);
        onHtmlChange(rawHtml + `{{${variable}}}`);
      }
    },
    [editorMode, rawHtml, onHtmlChange]
  );

  // Get block type config
  const getBlockConfig = (type: string) => {
    return BLOCK_TYPES.find((b) => b.type === type);
  };

  // Render block editor dialog
  const editingBlock = editingBlockId ? document[editingBlockId] : null;
  const editingBlockConfig = editingBlock ? getBlockConfig(editingBlock.type) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 border-b bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Tabs value={editorMode} onValueChange={(v) => setEditorMode(v as 'visual' | 'code')}>
            <TabsList>
              <TabsTrigger value="visual" className="gap-2">
                <MaterialIcon name="visibility" size="sm" />
                Visual
              </TabsTrigger>
              <TabsTrigger value="code" className="gap-2">
                <MaterialIcon name="code" size="sm" />
                Code
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {editorMode === 'visual' && (
            <div className="flex items-center gap-1 ml-4">
              <Button
                variant={previewMode === 'desktop' ? 'secondary' : 'ghost'}
                size="icon"
                onClick={() => setPreviewMode('desktop')}
              >
                <MaterialIcon name="desktop_windows" size="sm" />
              </Button>
              <Button
                variant={previewMode === 'mobile' ? 'secondary' : 'ghost'}
                size="icon"
                onClick={() => setPreviewMode('mobile')}
              >
                <MaterialIcon name="smartphone" size="sm" />
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {editorMode === 'visual' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MaterialIcon name="add" size="sm" className="mr-2" />
                  Add Block
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {BLOCK_TYPES.map((block) => (
                  <DropdownMenuItem
                    key={block.type}
                    onClick={() => addBlock(block)}
                    className="gap-2"
                  >
                    <MaterialIcon name={block.iconName} size="sm" />
                    {block.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <DropdownMenu open={showVariables} onOpenChange={setShowVariables}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {'{{ }}'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 max-h-64 overflow-auto">
              {COMMUNICATION_VARIABLES.map((v) => (
                <DropdownMenuItem
                  key={v.key}
                  onClick={() => {
                    if (editorMode === 'code') {
                      insertVariable(v.key);
                    }
                    setShowVariables(false);
                  }}
                  disabled={editorMode === 'visual'}
                  className="flex flex-col items-start"
                >
                  <span className="font-mono text-xs">{`{{${v.key}}}`}</span>
                  <span className="text-xs text-muted-foreground">{v.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 overflow-hidden">
        {editorMode === 'visual' ? (
          <div className="h-full overflow-auto p-4 bg-muted/30">
            <div
              className={`mx-auto bg-background border rounded-lg shadow-sm overflow-hidden transition-all ${
                previewMode === 'mobile' ? 'max-w-[375px]' : 'max-w-[600px]'
              }`}
            >
              {/* Block List */}
              <div className="min-h-[400px]">
                {getChildrenIds().length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <p className="mb-4">No blocks yet. Add your first block to get started.</p>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline">
                          <MaterialIcon name="add" size="sm" className="mr-2" />
                          Add Block
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {BLOCK_TYPES.map((block) => (
                          <DropdownMenuItem
                            key={block.type}
                            onClick={() => addBlock(block)}
                            className="gap-2"
                          >
                            <MaterialIcon name={block.iconName} size="sm" />
                            {block.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : (
                  <div>
                    {getChildrenIds().map((blockId, index) => {
                      const block = document[blockId];
                      if (!block) return null;

                      const blockConfig = getBlockConfig(block.type);
                      const childrenIds = getChildrenIds();

                      return (
                        <div
                          key={blockId}
                          className="group relative border-b last:border-b-0 hover:bg-muted/20"
                        >
                          {/* Block Controls */}
                          <div className="absolute left-0 top-0 bottom-0 flex flex-col items-center justify-center gap-1 p-1 opacity-0 group-hover:opacity-100 transition-opacity bg-muted/50 z-10">
                            <MaterialIcon name="drag_indicator" size="sm" className="text-muted-foreground" />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => moveBlock(blockId, 'up')}
                              disabled={index === 0}
                            >
                              <MaterialIcon name="expand_less" size="sm" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => moveBlock(blockId, 'down')}
                              disabled={index === childrenIds.length - 1}
                            >
                              <MaterialIcon name="expand_more" size="sm" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive"
                              onClick={() => removeBlock(blockId)}
                            >
                              <MaterialIcon name="delete" size="sm" />
                            </Button>
                          </div>

                          {/* Block Content - Click to edit */}
                          <div
                            className="cursor-pointer p-4 pl-10"
                            onClick={() => setEditingBlockId(blockId)}
                          >
                            <BlockPreview block={block} brandSettings={brandSettings} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <Textarea
            value={rawHtml}
            onChange={(e) => handleRawHtmlChange(e.target.value)}
            className="w-full h-full font-mono text-sm resize-none rounded-none border-0 focus-visible:ring-0"
            placeholder="Enter your HTML template here..."
          />
        )}
      </div>

      {/* Block Editor Dialog */}
      <Dialog open={!!editingBlockId} onOpenChange={(open) => !open && setEditingBlockId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Edit {editingBlockConfig?.label || 'Block'}
            </DialogTitle>
          </DialogHeader>

          {editingBlock && editingBlockId && (
            <BlockEditorForm
              blockId={editingBlockId}
              block={editingBlock}
              brandSettings={brandSettings}
              onUpdate={(updates) => updateBlock(editingBlockId, updates)}
            />
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingBlockId(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Block Preview Component
interface BlockPreviewProps {
  block: TReaderDocument[string];
  brandSettings: CommunicationBrandSettings | null;
}

function BlockPreview({ block, brandSettings }: BlockPreviewProps) {
  const data = block.data as Record<string, unknown>;
  const props = (data?.props as Record<string, unknown>) || {};
  const style = (data?.style as Record<string, unknown>) || {};

  switch (block.type) {
    case 'Heading':
      return (
        <h2
          className="font-bold text-xl"
          style={{
            textAlign: (style.textAlign as 'left' | 'center' | 'right') || 'left',
          }}
        >
          {(props.text as string) || 'Heading'}
        </h2>
      );

    case 'Text':
      return (
        <p
          style={{
            textAlign: (style.textAlign as 'left' | 'center' | 'right') || 'left',
          }}
        >
          {(props.text as string) || 'Text content'}
        </p>
      );

    case 'Button':
      return (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <span
            className="inline-block px-6 py-3 rounded text-white font-medium"
            style={{
              backgroundColor:
                (style.backgroundColor as string) ||
                brandSettings?.brand_primary_color ||
                '#FD5A2A',
            }}
          >
            {(props.text as string) || 'Button'}
          </span>
        </div>
      );

    case 'Image': {
      const imageUrl = props.url as string;
      return imageUrl ? (
        <div style={{ textAlign: (style.textAlign as 'left' | 'center' | 'right') || 'center' }}>
          <img
            src={imageUrl}
            alt={(props.alt as string) || 'Image'}
            className="max-w-full h-auto"
            style={{ width: props.width as string }}
          />
        </div>
      ) : (
        <div className="p-4 border-2 border-dashed border-muted-foreground/30 rounded text-center text-muted-foreground">
          <MaterialIcon name="image" size="lg" className="mx-auto mb-2 opacity-50" />
          <p>Click to add image URL</p>
        </div>
      );
    }

    case 'Divider':
      return (
        <hr
          className="my-4"
          style={{
            borderColor: (props.lineColor as string) || '#E5E7EB',
          }}
        />
      );

    case 'Spacer':
      return (
        <div
          className="bg-muted/30"
          style={{
            height: (props.height as number) || 32,
          }}
        />
      );

    default:
      return <div className="p-4 text-muted-foreground">Unknown block type: {block.type}</div>;
  }
}

// Block Editor Form Component
interface BlockEditorFormProps {
  blockId: string;
  block: TReaderDocument[string];
  brandSettings: CommunicationBrandSettings | null;
  onUpdate: (updates: Record<string, unknown>) => void;
}

function BlockEditorForm({ block, brandSettings, onUpdate }: BlockEditorFormProps) {
  const data = block.data as Record<string, unknown>;
  const props = (data?.props as Record<string, unknown>) || {};
  const style = (data?.style as Record<string, unknown>) || {};

  const updateProps = (updates: Record<string, unknown>) => {
    onUpdate({ props: { ...props, ...updates } });
  };

  const updateStyle = (updates: Record<string, unknown>) => {
    onUpdate({ style: { ...style, ...updates } });
  };

  switch (block.type) {
    case 'Heading':
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Heading Text</Label>
            <Input
              value={(props.text as string) || ''}
              onChange={(e) => updateProps({ text: e.target.value })}
              placeholder="Enter heading text..."
            />
          </div>
          <div className="space-y-2">
            <Label>Text Alignment</Label>
            <Select
              value={(style.textAlign as string) || 'left'}
              onValueChange={(v) => updateStyle({ textAlign: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="center">Center</SelectItem>
                <SelectItem value="right">Right</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );

    case 'Text':
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Text Content</Label>
            <Textarea
              value={(props.text as string) || ''}
              onChange={(e) => updateProps({ text: e.target.value })}
              placeholder="Enter text content..."
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Use {'{{variable_name}}'} to insert dynamic content
            </p>
          </div>
          <div className="space-y-2">
            <Label>Text Alignment</Label>
            <Select
              value={(style.textAlign as string) || 'left'}
              onValueChange={(v) => updateStyle({ textAlign: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="center">Center</SelectItem>
                <SelectItem value="right">Right</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );

    case 'Button':
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Button Text</Label>
            <Input
              value={(props.text as string) || ''}
              onChange={(e) => updateProps({ text: e.target.value })}
              placeholder="Button text..."
            />
          </div>
          <div className="space-y-2">
            <Label>Button URL</Label>
            <Input
              type="url"
              value={(props.url as string) || ''}
              onChange={(e) => updateProps({ url: e.target.value })}
              placeholder="https://..."
            />
            <p className="text-xs text-muted-foreground">
              Use {'{{variable_name}}'} for dynamic links
            </p>
          </div>
          <div className="space-y-2">
            <Label>Button Color</Label>
            <div className="flex gap-2">
              <Input
                type="color"
                value={(style.backgroundColor as string) || brandSettings?.brand_primary_color || '#FD5A2A'}
                onChange={(e) => updateStyle({ backgroundColor: e.target.value })}
                className="w-12 h-10 p-1"
              />
              <Input
                value={(style.backgroundColor as string) || brandSettings?.brand_primary_color || '#FD5A2A'}
                onChange={(e) => updateStyle({ backgroundColor: e.target.value })}
                placeholder="#FD5A2A"
                className="flex-1"
              />
            </div>
          </div>
        </div>
      );

    case 'Image':
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Image URL</Label>
            <Input
              type="url"
              value={(props.url as string) || ''}
              onChange={(e) => updateProps({ url: e.target.value })}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-2">
            <Label>Alt Text</Label>
            <Input
              value={(props.alt as string) || ''}
              onChange={(e) => updateProps({ alt: e.target.value })}
              placeholder="Describe the image..."
            />
          </div>
          <div className="space-y-2">
            <Label>Alignment</Label>
            <Select
              value={(style.textAlign as string) || 'center'}
              onValueChange={(v) => updateStyle({ textAlign: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="center">Center</SelectItem>
                <SelectItem value="right">Right</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );

    case 'Divider':
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Line Color</Label>
            <div className="flex gap-2">
              <Input
                type="color"
                value={(props.lineColor as string) || '#E5E7EB'}
                onChange={(e) => updateProps({ lineColor: e.target.value })}
                className="w-12 h-10 p-1"
              />
              <Input
                value={(props.lineColor as string) || '#E5E7EB'}
                onChange={(e) => updateProps({ lineColor: e.target.value })}
                placeholder="#E5E7EB"
                className="flex-1"
              />
            </div>
          </div>
        </div>
      );

    case 'Spacer':
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Height (pixels)</Label>
            <Input
              type="number"
              value={(props.height as number) || 32}
              onChange={(e) => updateProps({ height: parseInt(e.target.value) || 32 })}
              min={8}
              max={200}
            />
          </div>
        </div>
      );

    default:
      return <div>No editor available for this block type</div>;
  }
}
