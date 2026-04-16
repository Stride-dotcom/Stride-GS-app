import React from 'react';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Link,
  Image,
  Table,
  Undo,
  Redo,
  Eye,
  EyeOff,
  PanelLeftOpen,
  Type,
  Highlighter,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';

interface ToolbarProps {
  editor: Editor;
  onTogglePreview: () => void;
  isPreviewMode: boolean;
  onToggleSidebar: () => void;
}

const FONT_FAMILIES = [
  { value: 'Inter, sans-serif', label: 'Inter' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Times New Roman, serif', label: 'Times New Roman' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Courier New, monospace', label: 'Courier New' },
];

const FONT_SIZES = [
  '8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt', '28pt', '32pt', '36pt', '48pt', '72pt'
];

const COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#B7B7B7', '#CCCCCC', '#D9D9D9', '#EFEFEF', '#F3F3F3', '#FFFFFF',
  '#980000', '#FF0000', '#FF9900', '#FFFF00', '#00FF00', '#00FFFF', '#4A86E8', '#0000FF', '#9900FF', '#FF00FF',
  '#E6B8AF', '#F4CCCC', '#FCE5CD', '#FFF2CC', '#D9EAD3', '#D0E0E3', '#C9DAF8', '#CFE2F3', '#D9D2E9', '#EAD1DC',
  '#E85D2D', '#1E293B', '#64748B', '#16A34A', '#DC2626', '#7C3AED', '#0891B2', '#CA8A04'
];

export function TemplateEditorToolbar({
  editor,
  onTogglePreview,
  isPreviewMode,
  onToggleSidebar
}: ToolbarProps) {

  const ToolbarButton = ({
    onClick,
    isActive = false,
    disabled = false,
    tooltip,
    children
  }: {
    onClick: () => void;
    isActive?: boolean;
    disabled?: boolean;
    tooltip: string;
    children: React.ReactNode;
  }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClick}
          disabled={disabled}
          className={`h-8 w-8 p-0 ${isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700'}`}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );

  const Divider = () => (
    <div className="w-px h-6 bg-slate-600 mx-1" />
  );

  return (
    <TooltipProvider>
      <div className="template-editor-toolbar bg-slate-800 border-b border-slate-700">
        {/* Row 1: Block type, Insert, Lists, Alignment */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-700 flex-wrap">
          {/* Toggle Sidebar */}
          <ToolbarButton onClick={onToggleSidebar} tooltip="Toggle Sidebar">
            <PanelLeftOpen className="h-4 w-4" />
          </ToolbarButton>

          <Divider />

          {/* Block Type */}
          <Select
            value={editor.isActive('heading', { level: 1 }) ? 'h1' :
                   editor.isActive('heading', { level: 2 }) ? 'h2' :
                   editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'}
            onValueChange={(value) => {
              if (value === 'p') {
                editor.chain().focus().setParagraph().run();
              } else {
                const level = parseInt(value.replace('h', ''));
                editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run();
              }
            }}
          >
            <SelectTrigger className="w-32 h-8 bg-slate-700 border-slate-600 text-slate-200">
              <SelectValue placeholder="Paragraph" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="p">Paragraph</SelectItem>
              <SelectItem value="h1">Heading 1</SelectItem>
              <SelectItem value="h2">Heading 2</SelectItem>
              <SelectItem value="h3">Heading 3</SelectItem>
            </SelectContent>
          </Select>

          <Divider />

          {/* Insert Actions */}
          <ToolbarButton
            onClick={() => {
              const url = window.prompt('Enter link URL:');
              if (url) {
                editor.chain().focus().setLink({ href: url }).run();
              }
            }}
            isActive={editor.isActive('link')}
            tooltip="Insert Link"
          >
            <Link className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => {
              const url = window.prompt('Enter image URL:');
              if (url) {
                editor.chain().focus().setImage({ src: url }).run();
              }
            }}
            tooltip="Insert Image"
          >
            <Image className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => {
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
            }}
            tooltip="Insert Table"
          >
            <Table className="h-4 w-4" />
          </ToolbarButton>

          <Divider />

          {/* Lists */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive('bulletList')}
            tooltip="Bullet List"
          >
            <List className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive('orderedList')}
            tooltip="Numbered List"
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>

          <Divider />

          {/* Alignment */}
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            isActive={editor.isActive({ textAlign: 'left' })}
            tooltip="Align Left"
          >
            <AlignLeft className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            isActive={editor.isActive({ textAlign: 'center' })}
            tooltip="Align Center"
          >
            <AlignCenter className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            isActive={editor.isActive({ textAlign: 'right' })}
            tooltip="Align Right"
          >
            <AlignRight className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign('justify').run()}
            isActive={editor.isActive({ textAlign: 'justify' })}
            tooltip="Justify"
          >
            <AlignJustify className="h-4 w-4" />
          </ToolbarButton>

          <div className="flex-1" />

          {/* Preview Toggle */}
          <ToolbarButton
            onClick={onTogglePreview}
            isActive={isPreviewMode}
            tooltip={isPreviewMode ? 'Edit Mode' : 'Preview Mode'}
          >
            {isPreviewMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </ToolbarButton>
        </div>

        {/* Row 2: Text Formatting */}
        <div className="flex items-center gap-1 px-3 py-2 flex-wrap">
          {/* Bold, Italic, Underline, Strikethrough */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive('bold')}
            tooltip="Bold (Ctrl+B)"
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive('italic')}
            tooltip="Italic (Ctrl+I)"
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            isActive={editor.isActive('underline')}
            tooltip="Underline (Ctrl+U)"
          >
            <Underline className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            isActive={editor.isActive('strike')}
            tooltip="Strikethrough"
          >
            <Strikethrough className="h-4 w-4" />
          </ToolbarButton>

          <Divider />

          {/* Font Family */}
          <Select
            value={editor.getAttributes('textStyle').fontFamily || 'Inter, sans-serif'}
            onValueChange={(value) => {
              editor.chain().focus().setFontFamily(value).run();
            }}
          >
            <SelectTrigger className="w-36 h-8 bg-slate-700 border-slate-600 text-slate-200">
              <SelectValue placeholder="Font" />
            </SelectTrigger>
            <SelectContent>
              {FONT_FAMILIES.map(font => (
                <SelectItem key={font.value} value={font.value} style={{ fontFamily: font.value }}>
                  {font.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Font Size */}
          <Select
            defaultValue="12pt"
            onValueChange={(value) => {
              editor.chain().focus().setMark('textStyle', { fontSize: value }).run();
            }}
          >
            <SelectTrigger className="w-20 h-8 bg-slate-700 border-slate-600 text-slate-200">
              <SelectValue placeholder="Size" />
            </SelectTrigger>
            <SelectContent>
              {FONT_SIZES.map(size => (
                <SelectItem key={size} value={size}>{size}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Divider />

          {/* Text Color */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-300 hover:text-white hover:bg-slate-700">
                <div className="flex flex-col items-center">
                  <Type className="h-3 w-3" />
                  <div className="w-4 h-1 rounded" style={{ backgroundColor: editor.getAttributes('textStyle').color || '#000' }} />
                </div>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2">
              <div className="grid grid-cols-10 gap-1">
                {COLORS.map(color => (
                  <button
                    key={color}
                    className="w-5 h-5 rounded border border-slate-300 hover:scale-110 transition-transform"
                    style={{ backgroundColor: color }}
                    onClick={() => editor.chain().focus().setColor(color).run()}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Highlight Color */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-300 hover:text-white hover:bg-slate-700">
                <Highlighter className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2">
              <div className="grid grid-cols-10 gap-1">
                {COLORS.map(color => (
                  <button
                    key={color}
                    className="w-5 h-5 rounded border border-slate-300 hover:scale-110 transition-transform"
                    style={{ backgroundColor: color }}
                    onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <Divider />

          {/* Undo/Redo */}
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            tooltip="Undo (Ctrl+Z)"
          >
            <Undo className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            tooltip="Redo (Ctrl+Y)"
          >
            <Redo className="h-4 w-4" />
          </ToolbarButton>
        </div>
      </div>
    </TooltipProvider>
  );
}
