# Stride WMS - Template Editor & Email Templates Implementation Specification

## Overview

This specification covers the implementation of:
1. **Unified Template Editor Component** - A reusable Word-like WYSIWYG editor
2. **Invoice Template Editor** - Page for creating/editing invoice PDF templates
3. **Updated Email Alert Templates** - All 23 email templates with new brand-consistent designs
4. **Updated Alert Template Editor UI** - Replace current broken Email HTML/Text editors

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Schema](#2-database-schema)
3. [Template Editor Component](#3-template-editor-component)
4. [Invoice Template Editor Page](#4-invoice-template-editor-page)
5. [Email Alert Templates](#5-email-alert-templates)
6. [Alert Template Editor UI Updates](#6-alert-template-editor-ui-updates)
7. [Token System](#7-token-system)
8. [API Endpoints](#8-api-endpoints)
9. [File Structure](#9-file-structure)
10. [Implementation Order](#10-implementation-order)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SHARED TEMPLATE EDITOR COMPONENT                      │
│                         (TipTap-based WYSIWYG Editor)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Used by:                                                                   │
│  ┌─────────────────────┐  ┌─────────────────────┐                          │
│  │ Invoice Template    │  │ Email Alert         │                          │
│  │ Editor Page         │  │ Template Editor     │                          │
│  │ /settings/invoices  │  │ /settings/alerts/*  │                          │
│  │ /invoice-templates  │  │                     │                          │
│  └─────────────────────┘  └─────────────────────┘                          │
│                                                                             │
│  Shared Features:                                                           │
│  • Word-like toolbar with formatting options                                │
│  • Token insertion sidebar                                                  │
│  • Live preview mode                                                        │
│  • HTML source view (toggle)                                                │
│  • Brand colors from Organization Settings                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Brand Settings Location

Move brand settings to **Organization Settings** (centralized):
- Logo URL
- Primary Color (default: `#E85D2D`)
- Secondary Color (default: `#1E293B`)
- Support Email
- Company Address
- Company Phone

These values are used across both invoice templates and email templates.

---

## 2. Database Schema

### 2.1 Invoice Templates Table

```sql
-- Invoice templates for PDF generation
CREATE TABLE invoice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Template identification
  name TEXT NOT NULL,
  description TEXT,
  
  -- Template content
  html_content TEXT NOT NULL,
  css_content TEXT,
  
  -- Template settings (JSON)
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Status
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  
  -- Audit fields
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id),
  
  -- Constraints
  CONSTRAINT unique_default_per_tenant UNIQUE (tenant_id, is_default) 
    WHERE is_default = true
);

-- Indexes
CREATE INDEX idx_invoice_templates_tenant ON invoice_templates(tenant_id);
CREATE INDEX idx_invoice_templates_default ON invoice_templates(tenant_id, is_default) WHERE is_default = true;

-- RLS Policies
ALTER TABLE invoice_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant's invoice templates"
  ON invoice_templates FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert invoice templates for their tenant"
  ON invoice_templates FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update their tenant's invoice templates"
  ON invoice_templates FOR UPDATE
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can delete their tenant's invoice templates"
  ON invoice_templates FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- Settings JSONB structure:
-- {
--   "colors": {
--     "primary": "#E85D2D",
--     "secondary": "#1E293B",
--     "accent": "#64748B"
--   },
--   "typography": {
--     "fontFamily": "Inter, sans-serif",
--     "baseFontSize": "12pt"
--   },
--   "tableColumns": [
--     { "id": "rowNumber", "label": "#", "enabled": true, "width": "40px" },
--     { "id": "date", "label": "Date", "enabled": true, "width": "90px" },
--     { "id": "chargeType", "label": "Service", "enabled": true, "width": "100px" },
--     { "id": "description", "label": "Description", "enabled": true, "width": "auto" },
--     { "id": "quantity", "label": "Qty", "enabled": true, "width": "60px" },
--     { "id": "unitRate", "label": "Rate", "enabled": true, "width": "80px" },
--     { "id": "total", "label": "Total", "enabled": true, "width": "90px" },
--     { "id": "sidemark", "label": "Sidemark", "enabled": false, "width": "100px" },
--     { "id": "itemCode", "label": "Item Code", "enabled": false, "width": "100px" }
--   ],
--   "pageSetup": {
--     "size": "letter",
--     "margins": "normal",
--     "orientation": "portrait"
--   },
--   "contentOptions": {
--     "showLogo": true,
--     "showRemitTo": true,
--     "showPaymentTerms": true,
--     "showPaymentLink": true,
--     "showNotes": true,
--     "showTerms": true
--   }
-- }
```

### 2.2 Update Organization/Tenant Settings

Add brand settings to the existing tenant or organization_settings table:

```sql
-- Add brand settings columns to tenants table (or create organization_settings)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_settings JSONB DEFAULT '{}'::jsonb;

-- Brand settings structure:
-- {
--   "logoUrl": "https://...",
--   "primaryColor": "#E85D2D",
--   "secondaryColor": "#1E293B",
--   "supportEmail": "support@company.com",
--   "portalUrl": "https://portal.company.com",
--   "companyAddress": "123 Main St",
--   "companyCity": "Kent",
--   "companyState": "WA",
--   "companyZip": "98031",
--   "companyPhone": "206-550-1848"
-- }
```

### 2.3 Update Alert Templates Table

The existing `alert_templates` table likely has these fields. Ensure it has:

```sql
-- Ensure alert_templates has proper structure
-- (This may already exist - verify and modify as needed)

ALTER TABLE alert_templates 
  ADD COLUMN IF NOT EXISTS html_template TEXT,
  ADD COLUMN IF NOT EXISTS text_template TEXT,
  ADD COLUMN IF NOT EXISTS subject_template TEXT,
  ADD COLUMN IF NOT EXISTS sms_template TEXT;
```

---

## 3. Template Editor Component

### 3.1 Component Structure

```
src/components/templateEditor/
├── TemplateEditor.tsx              # Main editor wrapper
├── TemplateEditorToolbar.tsx       # Formatting toolbar
├── TemplateEditorMenuBar.tsx       # File/Edit/View menus (optional)
├── TemplateEditorSidebar.tsx       # Tokens + Settings panels
├── TemplateEditorCanvas.tsx        # Paper-like editing area
├── TemplateEditorStatusBar.tsx     # Bottom status (optional)
├── panels/
│   ├── TokenPanel.tsx              # Token list with categories
│   ├── SettingsPanel.tsx           # Colors, fonts, columns
│   └── TableColumnConfig.tsx       # Line items column config
├── dialogs/
│   ├── InsertImageDialog.tsx       # Image upload/URL
│   ├── InsertLinkDialog.tsx        # Link modal
│   └── InsertTableDialog.tsx       # Table wizard
└── extensions/
    └── TokenExtension.ts           # TipTap extension for tokens
```

### 3.2 Main TemplateEditor Component

```tsx
// src/components/templateEditor/TemplateEditor.tsx

import React, { useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Placeholder from '@tiptap/extension-placeholder';
import { FontFamily } from '@tiptap/extension-font-family';

import { TemplateEditorToolbar } from './TemplateEditorToolbar';
import { TemplateEditorSidebar } from './TemplateEditorSidebar';
import { TokenExtension } from './extensions/TokenExtension';

interface Token {
  id: string;
  label: string;
  token: string;
  description: string;
  category: string;
}

interface TemplateEditorProps {
  initialContent: string;
  onChange: (html: string) => void;
  tokens: Token[];
  settings?: TemplateSettings;
  onSettingsChange?: (settings: TemplateSettings) => void;
  mode: 'invoice' | 'email';
  showSettings?: boolean;
  placeholder?: string;
}

interface TemplateSettings {
  colors?: {
    primary: string;
    secondary: string;
    accent: string;
  };
  typography?: {
    fontFamily: string;
    baseFontSize: string;
  };
  tableColumns?: TableColumn[];
  contentOptions?: Record<string, boolean>;
}

interface TableColumn {
  id: string;
  label: string;
  enabled: boolean;
  width: string;
}

export function TemplateEditor({
  initialContent,
  onChange,
  tokens,
  settings,
  onSettingsChange,
  mode,
  showSettings = true,
  placeholder = 'Start designing your template...'
}: TemplateEditorProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activePanel, setActivePanel] = useState<'tokens' | 'settings'>('tokens');
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6]
        }
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph']
      }),
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'template-link'
        }
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'template-image'
        }
      }),
      Table.configure({
        resizable: true
      }),
      TableRow,
      TableHeader,
      TableCell,
      FontFamily,
      Placeholder.configure({
        placeholder
      }),
      TokenExtension.configure({
        tokens
      })
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'template-editor-content prose prose-sm max-w-none focus:outline-none'
      }
    }
  });

  const insertToken = useCallback((token: string) => {
    if (editor) {
      editor.chain().focus().insertContent(`{{${token}}}`).run();
    }
  }, [editor]);

  const togglePreview = useCallback(() => {
    setIsPreviewMode(!isPreviewMode);
  }, [isPreviewMode]);

  if (!editor) {
    return <div className="animate-pulse bg-slate-200 h-96 rounded-lg" />;
  }

  return (
    <div className="template-editor flex flex-col h-full bg-slate-900 rounded-lg overflow-hidden">
      {/* Toolbar */}
      <TemplateEditorToolbar 
        editor={editor} 
        onTogglePreview={togglePreview}
        isPreviewMode={isPreviewMode}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <TemplateEditorSidebar
            tokens={tokens}
            settings={settings}
            onInsertToken={insertToken}
            onSettingsChange={onSettingsChange}
            activePanel={activePanel}
            onPanelChange={setActivePanel}
            showSettings={showSettings && mode === 'invoice'}
          />
        )}

        {/* Editor Canvas */}
        <div className="flex-1 overflow-auto bg-slate-700 p-8">
          <div 
            className={`
              mx-auto bg-white shadow-2xl rounded
              ${mode === 'invoice' ? 'max-w-[8.5in] min-h-[11in]' : 'max-w-[600px]'}
              ${isPreviewMode ? 'pointer-events-none' : ''}
            `}
            style={{ padding: mode === 'invoice' ? '0.75in' : '0' }}
          >
            {isPreviewMode ? (
              <div 
                className="template-preview"
                dangerouslySetInnerHTML={{ __html: renderPreview(editor.getHTML(), tokens) }}
              />
            ) : (
              <EditorContent editor={editor} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper to render preview with sample data
function renderPreview(html: string, tokens: Token[]): string {
  let preview = html;
  
  // Sample data for preview
  const sampleData: Record<string, string> = {
    // Company
    'company_name': 'Stride Warehouse Services',
    'company_address': '19803 87th Ave S',
    'company_city': 'Kent',
    'company_state': 'WA',
    'company_zip': '98031',
    'company_phone': '206-550-1848',
    'company_email': 'warehouse@stridenw.com',
    
    // Invoice
    'invoice_number': 'INV-00001',
    'invoice_date': 'January 30, 2026',
    'due_date': 'March 1, 2026',
    'period_start': 'Jan 1, 2026',
    'period_end': 'Jan 31, 2026',
    'subtotal': '$1,547.50',
    'tax_amount': '$0.00',
    'total_amount': '$1,547.50',
    'balance_due': '$1,547.50',
    
    // Customer
    'customer_name': 'Acme Corporation',
    'customer_code': 'ACME',
    'billing_contact_name': 'John Smith',
    'billing_address': '123 Business Ave, Suite 400',
    'billing_city': 'Seattle',
    'billing_state': 'WA',
    'billing_zip': '98101',
    'billing_email': 'billing@acmecorp.com',
    
    // Other
    'sidemark_name': 'Project Alpha',
    'current_date': new Date().toLocaleDateString(),
    'tenant_name': 'Stride Warehouse Services',
    'brand_support_email': 'warehouse@stridenw.com'
  };

  // Replace all tokens with sample data
  tokens.forEach(token => {
    const regex = new RegExp(`{{${token.token}}}`, 'g');
    preview = preview.replace(regex, sampleData[token.token] || `[${token.label}]`);
  });

  return preview;
}
```

### 3.3 Toolbar Component

```tsx
// src/components/templateEditor/TemplateEditorToolbar.tsx

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
  PanelLeftClose,
  PanelLeftOpen,
  Code,
  Palette,
  Highlighter,
  Type,
  Heading1,
  Heading2,
  Heading3
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
    <div className="template-editor-toolbar bg-slate-800 border-b border-slate-700">
      {/* Row 1: Block type, Insert, Lists, Alignment */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-700">
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
      <div className="flex items-center gap-1 px-3 py-2">
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
            // Note: TipTap doesn't have built-in font size, need custom extension
            // For now, use CSS class or inline style
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
  );
}
```

### 3.4 Sidebar Component

```tsx
// src/components/templateEditor/TemplateEditorSidebar.tsx

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
import { toast } from 'sonner';

interface Token {
  id: string;
  label: string;
  token: string;
  description: string;
  category: string;
}

interface SidebarProps {
  tokens: Token[];
  settings?: any;
  onInsertToken: (token: string) => void;
  onSettingsChange?: (settings: any) => void;
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
    toast.success('Token copied to clipboard');
  };

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
                      checked={settings?.contentOptions?.[option.id] ?? true}
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
                {(settings?.tableColumns || [
                  { id: 'rowNumber', label: '#', enabled: true },
                  { id: 'date', label: 'Date', enabled: true },
                  { id: 'chargeType', label: 'Service', enabled: true },
                  { id: 'description', label: 'Description', enabled: true },
                  { id: 'quantity', label: 'Qty', enabled: true },
                  { id: 'unitRate', label: 'Rate', enabled: true },
                  { id: 'total', label: 'Total', enabled: true },
                  { id: 'sidemark', label: 'Sidemark', enabled: false },
                  { id: 'itemCode', label: 'Item Code', enabled: false },
                ]).map((col: any) => (
                  <div key={col.id} className="flex items-center gap-2">
                    <Checkbox
                      id={col.id}
                      checked={col.enabled}
                      onCheckedChange={(checked) => {
                        const columns = settings?.tableColumns || [];
                        const updated = columns.map((c: any) => 
                          c.id === col.id ? { ...c, enabled: checked } : c
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
```

---

## 4. Invoice Template Editor Page

```tsx
// src/pages/InvoiceTemplateEditor.tsx

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, RotateCcw, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { TemplateEditor } from '@/components/templateEditor/TemplateEditor';
import { useInvoiceTemplates } from '@/hooks/useInvoiceTemplates';
import { INVOICE_TOKENS } from '@/lib/templateEditor/tokens';
import { DEFAULT_INVOICE_TEMPLATE } from '@/lib/templateEditor/defaultInvoiceTemplate';
import { toast } from 'sonner';

export default function InvoiceTemplateEditor() {
  const navigate = useNavigate();
  const { templateId } = useParams();
  
  const {
    templates,
    currentTemplate,
    isLoading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    setDefaultTemplate,
    loadTemplate
  } = useInvoiceTemplates();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(templateId || null);
  const [htmlContent, setHtmlContent] = useState(DEFAULT_INVOICE_TEMPLATE);
  const [settings, setSettings] = useState({});
  const [hasChanges, setHasChanges] = useState(false);

  // Load template when selection changes
  useEffect(() => {
    if (selectedTemplateId) {
      loadTemplate(selectedTemplateId);
    }
  }, [selectedTemplateId]);

  // Update local state when template loads
  useEffect(() => {
    if (currentTemplate) {
      setHtmlContent(currentTemplate.html_content);
      setSettings(currentTemplate.settings);
      setHasChanges(false);
    }
  }, [currentTemplate]);

  const handleContentChange = (html: string) => {
    setHtmlContent(html);
    setHasChanges(true);
  };

  const handleSettingsChange = (newSettings: any) => {
    setSettings(newSettings);
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      if (selectedTemplateId) {
        await updateTemplate(selectedTemplateId, {
          html_content: htmlContent,
          settings
        });
        toast.success('Template saved successfully');
      } else {
        const newTemplate = await createTemplate({
          name: 'New Invoice Template',
          html_content: htmlContent,
          settings
        });
        setSelectedTemplateId(newTemplate.id);
        toast.success('Template created successfully');
      }
      setHasChanges(false);
    } catch (error) {
      toast.error('Failed to save template');
    }
  };

  const handleReset = () => {
    setHtmlContent(DEFAULT_INVOICE_TEMPLATE);
    setSettings({});
    setHasChanges(true);
  };

  const handleCreateNew = async () => {
    const newTemplate = await createTemplate({
      name: `Invoice Template ${templates.length + 1}`,
      html_content: DEFAULT_INVOICE_TEMPLATE,
      settings: {}
    });
    setSelectedTemplateId(newTemplate.id);
    toast.success('New template created');
  };

  const handleDelete = async () => {
    if (selectedTemplateId) {
      await deleteTemplate(selectedTemplateId);
      setSelectedTemplateId(templates[0]?.id || null);
      toast.success('Template deleted');
    }
  };

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(-1)}
              className="text-slate-400 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            
            <div className="text-lg font-semibold text-white">
              Invoice Template Editor
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Template Selector */}
            <Select
              value={selectedTemplateId || ''}
              onValueChange={setSelectedTemplateId}
            >
              <SelectTrigger className="w-64 bg-slate-700 border-slate-600 text-white">
                <SelectValue placeholder="Select template..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map(template => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                    {template.is_default && ' (Default)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={handleCreateNew}
              className="border-slate-600 text-slate-300 hover:text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              New
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="border-slate-600 text-slate-300 hover:text-white"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>

            {selectedTemplateId && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-600 text-red-400 hover:text-red-300 hover:bg-red-950"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Template?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete this invoice template. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            <Button
              onClick={handleSave}
              disabled={!hasChanges}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              <Save className="h-4 w-4 mr-2" />
              Save Template
            </Button>
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <TemplateEditor
          initialContent={htmlContent}
          onChange={handleContentChange}
          tokens={INVOICE_TOKENS}
          settings={settings}
          onSettingsChange={handleSettingsChange}
          mode="invoice"
          showSettings={true}
        />
      </div>
    </div>
  );
}
```

---

## 5. Email Alert Templates

### 5.1 Template Constants

Create a file with all 23 email template HTML strings:

```tsx
// src/lib/emailTemplates/templates.ts

export interface EmailTemplate {
  key: string;
  name: string;
  subject: string;
  html: string;
  text: string;
}

// Base wrapper for all email templates
const emailWrapper = (content: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{subject}}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          ${content}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// Reusable components
const emailHeader = (badgeText: string, badgeStyle: 'info' | 'success' | 'warning' | 'error' | 'purple' = 'info') => {
  const badgeColors = {
    info: 'background:rgba(255,255,255,0.2);color:#ffffff;',
    success: 'background:#dcfce7;color:#166534;',
    warning: 'background:#fef3c7;color:#92400e;',
    error: 'background:#fee2e2;color:#991b1b;',
    purple: 'background:#e9d5ff;color:#7c3aed;'
  };
  
  return `
    <tr>
      <td style="background:#E85D2D;border-radius:12px 12px 0 0;padding:24px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#ffffff;border-radius:8px;width:36px;height:36px;text-align:center;vertical-align:middle;">
                    <img src="{{brand_logo_url}}" alt="Logo" width="24" height="24" style="display:block;margin:6px;">
                  </td>
                  <td style="padding-left:10px;color:#ffffff;font-size:18px;font-weight:600;">
                    {{tenant_name}}
                  </td>
                </tr>
              </table>
            </td>
            <td align="right">
              <span style="display:inline-block;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:600;text-transform:uppercase;${badgeColors[badgeStyle]}">
                ${badgeText}
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
};

const emailFooter = () => `
  <tr>
    <td style="background:#f8fafc;border-radius:0 0 12px 12px;padding:24px 32px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#1e293b;">{{tenant_name}}</p>
      <p style="margin:0 0 8px;font-size:12px;color:#64748b;">{{company_address}}</p>
      <p style="margin:0;font-size:12px;">
        <a href="mailto:{{brand_support_email}}" style="color:#E85D2D;text-decoration:none;">{{brand_support_email}}</a>
        <span style="color:#94a3b8;"> • </span>
        <span style="color:#64748b;">{{company_phone}}</span>
      </p>
    </td>
  </tr>
`;

const primaryButton = (text: string, url: string) => `
  <a href="${url}" style="display:inline-block;padding:14px 28px;background:#E85D2D;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">${text}</a>
`;

const secondaryButton = (text: string, url: string) => `
  <a href="${url}" style="display:inline-block;padding:14px 28px;background:#ffffff;color:#1e293b;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;border:2px solid #e2e8f0;">${text}</a>
`;

// ==================== INVOICE SENT ====================
export const INVOICE_SENT: EmailTemplate = {
  key: 'INVOICE_SENT',
  name: 'Invoice Sent',
  subject: 'Invoice {{invoice_number}} - Payment due {{invoice_due_date}}',
  html: emailWrapper(`
    ${emailHeader('Invoice', 'info')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <!-- Icon -->
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#fed7aa;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">💰</div>
            </td>
          </tr>
          <!-- Title -->
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Your Invoice is Ready</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">Payment due {{invoice_due_date}}</p>
            </td>
          </tr>
          <!-- Greeting -->
          <tr>
            <td>
              <p style="margin:0 0 16px;font-size:15px;color:#475569;">Dear {{billing_contact_name}},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">Your invoice for warehouse services has been generated and is ready for payment. Please find the details below.</p>
            </td>
          </tr>
          <!-- Info Card -->
          <tr>
            <td style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Invoice Number</p>
                          <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#1e293b;">{{invoice_number}}</p>
                        </td>
                        <td align="right">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Amount Due</p>
                          <p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#E85D2D;">{{total_amount}}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="50%" style="padding-right:8px;">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Invoice Date</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{invoice_date}}</p>
                        </td>
                        <td width="50%" style="padding-left:8px;">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Due Date</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{invoice_due_date}}</p>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="padding-right:8px;padding-top:16px;">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Billing Period</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{period_start}} - {{period_end}}</p>
                        </td>
                        <td width="50%" style="padding-left:8px;padding-top:16px;">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Account</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{account_name}}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Buttons -->
          <tr>
            <td align="center" style="padding:28px 0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:6px;">
                    ${primaryButton('Pay Now', '{{payment_link}}')}
                  </td>
                  <td style="padding-left:6px;">
                    ${secondaryButton('View Invoice', '{{invoice_link}}')}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Note -->
          <tr>
            <td style="padding-top:24px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:13px;color:#64748b;text-align:center;line-height:1.5;">The full invoice PDF is attached to this email. If you have questions about this invoice, please contact us.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Your Invoice is Ready

Dear {{billing_contact_name}},

Your invoice for warehouse services has been generated and is ready for payment.

Invoice Number: {{invoice_number}}
Invoice Date: {{invoice_date}}
Due Date: {{invoice_due_date}}
Amount Due: {{total_amount}}

View Invoice: {{invoice_link}}
Pay Now: {{payment_link}}

The full invoice PDF is attached to this email.

Thank you,
{{tenant_name}}
{{company_address}}
{{brand_support_email}}`
};

// ==================== PAYMENT RECEIVED ====================
export const PAYMENT_RECEIVED: EmailTemplate = {
  key: 'PAYMENT_RECEIVED',
  name: 'Payment Received',
  subject: 'Payment Received - {{invoice_number}}',
  html: emailWrapper(`
    ${emailHeader('Payment', 'success')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#dcfce7;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">✓</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Payment Received</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">Thank you for your payment</p>
            </td>
          </tr>
          <tr>
            <td>
              <p style="margin:0 0 16px;font-size:15px;color:#475569;">Dear {{billing_contact_name}},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">We have received your payment. Thank you for your prompt attention to this invoice.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Invoice Number</p>
                          <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#1e293b;">{{invoice_number}}</p>
                        </td>
                        <td align="right">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Amount Paid</p>
                          <p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#166534;">{{paid_amount}}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="50%">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Payment Date</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{payment_date}}</p>
                        </td>
                        <td width="50%">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Payment Method</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{payment_method}}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:28px;">
              ${primaryButton('View Receipt', '{{receipt_link}}')}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Payment Received

Dear {{billing_contact_name}},

We have received your payment. Thank you for your prompt attention to this invoice.

Invoice: {{invoice_number}}
Amount Paid: {{paid_amount}}
Payment Date: {{payment_date}}
Payment Method: {{payment_method}}

View Receipt: {{receipt_link}}

Thank you,
{{tenant_name}}`
};

// Continue with all other templates...
// I'll provide a few more key ones, the rest follow the same pattern

// ==================== SHIPMENT COMPLETED ====================
export const SHIPMENT_COMPLETED: EmailTemplate = {
  key: 'SHIPMENT_COMPLETED',
  name: 'Shipment Completed',
  subject: 'Shipment {{shipment_reference}} has been shipped',
  html: emailWrapper(`
    ${emailHeader('Completed', 'success')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#dcfce7;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">✅</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">Shipment Completed</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">Your shipment has been delivered</p>
            </td>
          </tr>
          <tr>
            <td>
              <p style="margin:0 0 16px;font-size:15px;color:#475569;">Dear {{contact_name}},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">Your outbound shipment has been completed and is on its way to the destination.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Shipment Reference</p>
                    <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#1e293b;">{{shipment_reference}}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="50%">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Ship Date</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{ship_date}}</p>
                        </td>
                        <td width="50%">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Carrier</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{carrier_name}}</p>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="padding-top:16px;">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Tracking #</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#E85D2D;">{{tracking_number}}</p>
                        </td>
                        <td width="50%" style="padding-top:16px;">
                          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Items Shipped</p>
                          <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{item_count}} items</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:6px;">
                    ${primaryButton('Track Shipment', '{{tracking_link}}')}
                  </td>
                  <td style="padding-left:6px;">
                    ${secondaryButton('View Details', '{{shipment_link}}')}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `Shipment Completed

Dear {{contact_name}},

Your outbound shipment has been completed and is on its way.

Shipment Reference: {{shipment_reference}}
Ship Date: {{ship_date}}
Carrier: {{carrier_name}}
Tracking #: {{tracking_number}}
Items Shipped: {{item_count}} items

Track Shipment: {{tracking_link}}

Thank you,
{{tenant_name}}`
};

// ==================== EMPLOYEE INVITE ====================
export const EMPLOYEE_INVITE: EmailTemplate = {
  key: 'EMPLOYEE_INVITE',
  name: 'Employee Invitation',
  subject: "You're invited to join {{tenant_name}}",
  html: emailWrapper(`
    ${emailHeader('Invitation', 'purple')}
    <tr>
      <td style="background:#ffffff;padding:40px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <div style="width:64px;height:64px;background:#e9d5ff;border-radius:50%;line-height:64px;text-align:center;font-size:28px;">🎉</div>
            </td>
          </tr>
          <tr>
            <td align="center">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">You're Invited!</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#64748b;">Join {{tenant_name}} on Stride WMS</p>
            </td>
          </tr>
          <tr>
            <td>
              <p style="margin:0 0 16px;font-size:15px;color:#475569;">Hi {{employee_name}},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">You've been invited to join {{tenant_name}}'s warehouse management system. Click the button below to create your account and get started.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%">
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Organization</p>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{tenant_name}}</p>
                  </td>
                  <td width="50%">
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Role</p>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{employee_role}}</p>
                  </td>
                </tr>
                <tr>
                  <td width="50%" style="padding-top:16px;">
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Invited By</p>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{invited_by}}</p>
                  </td>
                  <td width="50%" style="padding-top:16px;">
                    <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Expires</p>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1e293b;">{{expiry_date}}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:28px;">
              ${primaryButton('Accept Invitation', '{{invitation_link}}')}
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:13px;color:#64748b;text-align:center;line-height:1.5;">If you didn't expect this invitation, you can safely ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${emailFooter()}
  `),
  text: `You're Invited to {{tenant_name}}!

Hi {{employee_name}},

You've been invited to join {{tenant_name}}'s warehouse management system.

Organization: {{tenant_name}}
Role: {{employee_role}}
Invited By: {{invited_by}}
Expires: {{expiry_date}}

Accept Invitation: {{invitation_link}}

If you didn't expect this invitation, you can safely ignore this email.`
};

// Export all templates as an object for easy lookup
export const EMAIL_TEMPLATES: Record<string, EmailTemplate> = {
  INVOICE_SENT,
  INVOICE_CREATED: { ...INVOICE_SENT, key: 'INVOICE_CREATED', name: 'Invoice Created', subject: 'Invoice {{invoice_number}} Created' },
  PAYMENT_RECEIVED,
  SHIPMENT_RECEIVED: { ...SHIPMENT_COMPLETED, key: 'SHIPMENT_RECEIVED', name: 'Shipment Received', subject: 'Shipment {{shipment_reference}} Received' },
  SHIPMENT_COMPLETED,
  SHIPMENT_STATUS_CHANGED: { ...SHIPMENT_COMPLETED, key: 'SHIPMENT_STATUS_CHANGED', name: 'Shipment Status Update', subject: 'Shipment {{shipment_reference}} Status Update' },
  ITEM_RECEIVED: { ...SHIPMENT_COMPLETED, key: 'ITEM_RECEIVED', name: 'Item Received', subject: 'Item {{item_code}} Received' },
  ITEM_DAMAGED: { ...SHIPMENT_COMPLETED, key: 'ITEM_DAMAGED', name: 'Item Damaged', subject: 'Item Damage Report - {{item_code}}' },
  ITEM_LOCATION_CHANGED: { ...SHIPMENT_COMPLETED, key: 'ITEM_LOCATION_CHANGED', name: 'Item Location Changed', subject: 'Item {{item_code}} Location Update' },
  RELEASE_CREATED: { ...SHIPMENT_COMPLETED, key: 'RELEASE_CREATED', name: 'Release Created', subject: 'Release Order {{release_number}} Created' },
  RELEASE_APPROVED: { ...SHIPMENT_COMPLETED, key: 'RELEASE_APPROVED', name: 'Release Approved', subject: 'Release Order {{release_number}} Approved' },
  RELEASE_COMPLETED: { ...SHIPMENT_COMPLETED, key: 'RELEASE_COMPLETED', name: 'Release Completed', subject: 'Release Order {{release_number}} Completed' },
  TASK_CREATED: { ...EMPLOYEE_INVITE, key: 'TASK_CREATED', name: 'Task Created', subject: 'New Task: {{task_title}}' },
  TASK_ASSIGNED: { ...EMPLOYEE_INVITE, key: 'TASK_ASSIGNED', name: 'Task Assigned', subject: 'Task Assigned: {{task_title}}' },
  TASK_COMPLETED: { ...SHIPMENT_COMPLETED, key: 'TASK_COMPLETED', name: 'Task Completed', subject: 'Task Completed: {{task_title}}' },
  CLAIM_ATTACHMENT_ADDED: { ...SHIPMENT_COMPLETED, key: 'CLAIM_ATTACHMENT_ADDED', name: 'Claim Attachment Added', subject: 'New Attachment - Claim {{claim_reference}}' },
  CLAIM_DETERMINATION_SENT: { ...INVOICE_SENT, key: 'CLAIM_DETERMINATION_SENT', name: 'Claim Determination', subject: 'Claim Determination - {{claim_reference}}' },
  CLAIM_REQUIRES_APPROVAL: { ...INVOICE_SENT, key: 'CLAIM_REQUIRES_APPROVAL', name: 'Claim Requires Approval', subject: 'Approval Required - Claim {{claim_reference}}' },
  CLAIM_CLIENT_ACCEPTED: { ...SHIPMENT_COMPLETED, key: 'CLAIM_CLIENT_ACCEPTED', name: 'Client Accepted Claim', subject: 'Claim {{claim_reference}} Accepted' },
  CLAIM_CLIENT_COUNTERED: { ...INVOICE_SENT, key: 'CLAIM_CLIENT_COUNTERED', name: 'Client Countered Claim', subject: 'Counter Offer - Claim {{claim_reference}}' },
  CLAIM_CLIENT_DECLINED: { ...SHIPMENT_COMPLETED, key: 'CLAIM_CLIENT_DECLINED', name: 'Client Declined Claim', subject: 'Claim {{claim_reference}} Declined' },
  CLAIM_NOTE_ADDED: { ...SHIPMENT_COMPLETED, key: 'CLAIM_NOTE_ADDED', name: 'Claim Note Added', subject: 'New Note - Claim {{claim_reference}}' },
  EMPLOYEE_INVITE
};

// Helper to get template by key
export function getEmailTemplate(key: string): EmailTemplate | undefined {
  return EMAIL_TEMPLATES[key];
}
```

**Note:** The above shows the pattern for a few templates. The full implementation should have complete HTML for all 23 templates following the same structure shown in the `stride-updated-email-templates.html` preview file.

---

## 6. Alert Template Editor UI Updates

Replace the current Email HTML and Email Text tabs with the new unified editor.

### Changes Required:

1. **Remove "Brand Settings" tab** from alert editor - move to Organization Settings
2. **Replace "Email HTML" tab** - Use TemplateEditor component with email mode
3. **Replace "Email Text" tab** - Show plain text version with token support (simple textarea)
4. **Keep "SMS" tab** - Current implementation is fine
5. **Keep "Recipients" tab** - Current implementation is fine

```tsx
// Updated alert template editor tabs
// src/pages/settings/AlertTemplateEditor.tsx

import { TemplateEditor } from '@/components/templateEditor/TemplateEditor';
import { EMAIL_TOKENS } from '@/lib/templateEditor/tokens';

// In the tabs section, replace Email HTML content with:
{activeTab === 'email-html' && (
  <div className="h-[calc(100vh-300px)]">
    <TemplateEditor
      initialContent={template.html_template || ''}
      onChange={(html) => updateTemplate({ html_template: html })}
      tokens={EMAIL_TOKENS}
      mode="email"
      showSettings={false}
      placeholder="Design your email template..."
    />
  </div>
)}

// For Email Text tab, keep simple but styled:
{activeTab === 'email-text' && (
  <div className="space-y-4">
    <div className="flex items-center gap-4 text-sm text-slate-400">
      <span>Plain text version for email clients that don't support HTML</span>
    </div>
    <textarea
      value={template.text_template || ''}
      onChange={(e) => updateTemplate({ text_template: e.target.value })}
      className="w-full h-96 p-4 bg-slate-800 border border-slate-600 rounded-lg text-white font-mono text-sm resize-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
      placeholder="Enter plain text email content with tokens like {{invoice_number}}..."
    />
    {/* Show available tokens below */}
    <div className="p-4 bg-slate-800 rounded-lg">
      <p className="text-sm font-medium text-white mb-2">Available Tokens:</p>
      <div className="flex flex-wrap gap-2">
        {EMAIL_TOKENS.map(token => (
          <code 
            key={token.token}
            className="px-2 py-1 bg-slate-700 rounded text-xs text-orange-400 cursor-pointer hover:bg-slate-600"
            onClick={() => {
              // Insert at cursor position
              const textarea = document.querySelector('textarea');
              if (textarea) {
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const text = template.text_template || '';
                const newText = text.substring(0, start) + `{{${token.token}}}` + text.substring(end);
                updateTemplate({ text_template: newText });
              }
            }}
          >
            {`{{${token.token}}}`}
          </code>
        ))}
      </div>
    </div>
  </div>
)}
```

---

## 7. Token System

### 7.1 Invoice Tokens

```tsx
// src/lib/templateEditor/tokens.ts

export interface Token {
  id: string;
  token: string;
  label: string;
  description: string;
  category: string;
}

export const INVOICE_TOKENS: Token[] = [
  // Company Information
  { id: 'company_name', token: 'company_name', label: 'Company Name', description: 'Your company name', category: 'Company Information' },
  { id: 'company_logo', token: 'company_logo', label: 'Company Logo', description: 'URL to company logo image', category: 'Company Information' },
  { id: 'company_address', token: 'company_address', label: 'Company Address', description: 'Street address', category: 'Company Information' },
  { id: 'company_city', token: 'company_city', label: 'City', description: 'Company city', category: 'Company Information' },
  { id: 'company_state', token: 'company_state', label: 'State', description: 'Company state', category: 'Company Information' },
  { id: 'company_zip', token: 'company_zip', label: 'ZIP Code', description: 'Company ZIP code', category: 'Company Information' },
  { id: 'company_phone', token: 'company_phone', label: 'Phone', description: 'Company phone number', category: 'Company Information' },
  { id: 'company_email', token: 'company_email', label: 'Email', description: 'Company email address', category: 'Company Information' },
  
  // Invoice Details
  { id: 'invoice_number', token: 'invoice_number', label: 'Invoice Number', description: 'Unique invoice identifier', category: 'Invoice Details' },
  { id: 'invoice_date', token: 'invoice_date', label: 'Invoice Date', description: 'Date invoice was created', category: 'Invoice Details' },
  { id: 'due_date', token: 'due_date', label: 'Due Date', description: 'Payment due date', category: 'Invoice Details' },
  { id: 'period_start', token: 'period_start', label: 'Period Start', description: 'Billing period start date', category: 'Invoice Details' },
  { id: 'period_end', token: 'period_end', label: 'Period End', description: 'Billing period end date', category: 'Invoice Details' },
  { id: 'sidemark_name', token: 'sidemark_name', label: 'Sidemark', description: 'Sidemark/project name', category: 'Invoice Details' },
  
  // Customer Information
  { id: 'customer_name', token: 'customer_name', label: 'Customer Name', description: 'Customer/account name', category: 'Customer Information' },
  { id: 'customer_code', token: 'customer_code', label: 'Customer Code', description: 'Customer account code', category: 'Customer Information' },
  { id: 'billing_contact_name', token: 'billing_contact_name', label: 'Billing Contact', description: 'Name of billing contact', category: 'Customer Information' },
  { id: 'billing_address', token: 'billing_address', label: 'Billing Address', description: 'Customer billing address', category: 'Customer Information' },
  { id: 'billing_city', token: 'billing_city', label: 'Billing City', description: 'Customer city', category: 'Customer Information' },
  { id: 'billing_state', token: 'billing_state', label: 'Billing State', description: 'Customer state', category: 'Customer Information' },
  { id: 'billing_zip', token: 'billing_zip', label: 'Billing ZIP', description: 'Customer ZIP code', category: 'Customer Information' },
  { id: 'billing_email', token: 'billing_email', label: 'Billing Email', description: 'Customer email', category: 'Customer Information' },
  
  // Totals
  { id: 'subtotal', token: 'subtotal', label: 'Subtotal', description: 'Invoice subtotal before tax', category: 'Totals' },
  { id: 'tax_rate', token: 'tax_rate', label: 'Tax Rate', description: 'Tax rate percentage', category: 'Totals' },
  { id: 'tax_amount', token: 'tax_amount', label: 'Tax Amount', description: 'Total tax amount', category: 'Totals' },
  { id: 'discount_amount', token: 'discount_amount', label: 'Discount', description: 'Discount amount', category: 'Totals' },
  { id: 'total_amount', token: 'total_amount', label: 'Total Amount', description: 'Invoice total', category: 'Totals' },
  { id: 'amount_paid', token: 'amount_paid', label: 'Amount Paid', description: 'Amount already paid', category: 'Totals' },
  { id: 'balance_due', token: 'balance_due', label: 'Balance Due', description: 'Remaining balance', category: 'Totals' },
  
  // Line Items
  { id: 'line_items_table', token: 'line_items_table', label: 'Line Items Table', description: 'Full table of invoice line items', category: 'Line Items' },
  
  // Payment & Terms
  { id: 'payment_link', token: 'payment_link', label: 'Payment Link', description: 'Online payment URL', category: 'Payment & Terms' },
  { id: 'terms_and_conditions', token: 'terms_and_conditions', label: 'Terms & Conditions', description: 'Invoice terms text', category: 'Payment & Terms' },
  { id: 'notes', token: 'notes', label: 'Notes', description: 'Invoice notes', category: 'Payment & Terms' },
  
  // Other
  { id: 'current_date', token: 'current_date', label: 'Current Date', description: 'Today\'s date', category: 'Other' },
  { id: 'tenant_name', token: 'tenant_name', label: 'Organization Name', description: 'Your organization name', category: 'Other' },
];

export const EMAIL_TOKENS: Token[] = [
  // Brand
  { id: 'tenant_name', token: 'tenant_name', label: 'Organization Name', description: 'Your organization name', category: 'Brand' },
  { id: 'brand_logo_url', token: 'brand_logo_url', label: 'Logo URL', description: 'URL to your logo', category: 'Brand' },
  { id: 'brand_primary_color', token: 'brand_primary_color', label: 'Primary Color', description: 'Your brand primary color', category: 'Brand' },
  { id: 'brand_support_email', token: 'brand_support_email', label: 'Support Email', description: 'Customer support email', category: 'Brand' },
  { id: 'portal_base_url', token: 'portal_base_url', label: 'Portal URL', description: 'Base URL for customer portal', category: 'Brand' },
  { id: 'company_address', token: 'company_address', label: 'Company Address', description: 'Full company address', category: 'Brand' },
  { id: 'company_phone', token: 'company_phone', label: 'Company Phone', description: 'Company phone number', category: 'Brand' },
  
  // Invoice (for invoice-related emails)
  { id: 'invoice_number', token: 'invoice_number', label: 'Invoice Number', description: 'Invoice identifier', category: 'Invoice' },
  { id: 'invoice_date', token: 'invoice_date', label: 'Invoice Date', description: 'Date invoice was created', category: 'Invoice' },
  { id: 'invoice_due_date', token: 'invoice_due_date', label: 'Due Date', description: 'Payment due date', category: 'Invoice' },
  { id: 'total_amount', token: 'total_amount', label: 'Total Amount', description: 'Invoice total', category: 'Invoice' },
  { id: 'paid_amount', token: 'paid_amount', label: 'Paid Amount', description: 'Amount paid', category: 'Invoice' },
  { id: 'balance_due', token: 'balance_due', label: 'Balance Due', description: 'Remaining balance', category: 'Invoice' },
  { id: 'period_start', token: 'period_start', label: 'Period Start', description: 'Billing period start', category: 'Invoice' },
  { id: 'period_end', token: 'period_end', label: 'Period End', description: 'Billing period end', category: 'Invoice' },
  { id: 'invoice_link', token: 'invoice_link', label: 'Invoice Link', description: 'Link to view invoice', category: 'Invoice' },
  { id: 'payment_link', token: 'payment_link', label: 'Payment Link', description: 'Link to pay invoice', category: 'Invoice' },
  
  // Customer/Account
  { id: 'account_name', token: 'account_name', label: 'Account Name', description: 'Customer account name', category: 'Customer' },
  { id: 'contact_name', token: 'contact_name', label: 'Contact Name', description: 'Primary contact name', category: 'Customer' },
  { id: 'billing_contact_name', token: 'billing_contact_name', label: 'Billing Contact', description: 'Billing contact name', category: 'Customer' },
  
  // Shipment
  { id: 'shipment_reference', token: 'shipment_reference', label: 'Shipment Reference', description: 'Shipment identifier', category: 'Shipment' },
  { id: 'carrier_name', token: 'carrier_name', label: 'Carrier', description: 'Shipping carrier name', category: 'Shipment' },
  { id: 'tracking_number', token: 'tracking_number', label: 'Tracking Number', description: 'Shipment tracking number', category: 'Shipment' },
  { id: 'tracking_link', token: 'tracking_link', label: 'Tracking Link', description: 'Link to track shipment', category: 'Shipment' },
  { id: 'ship_date', token: 'ship_date', label: 'Ship Date', description: 'Date shipped', category: 'Shipment' },
  { id: 'item_count', token: 'item_count', label: 'Item Count', description: 'Number of items', category: 'Shipment' },
  
  // Item
  { id: 'item_code', token: 'item_code', label: 'Item Code', description: 'Item/SKU code', category: 'Item' },
  { id: 'item_description', token: 'item_description', label: 'Item Description', description: 'Item description', category: 'Item' },
  { id: 'quantity', token: 'quantity', label: 'Quantity', description: 'Item quantity', category: 'Item' },
  { id: 'location', token: 'location', label: 'Location', description: 'Warehouse location', category: 'Item' },
  
  // Release
  { id: 'release_number', token: 'release_number', label: 'Release Number', description: 'Release order number', category: 'Release' },
  
  // Task
  { id: 'task_title', token: 'task_title', label: 'Task Title', description: 'Task name/title', category: 'Task' },
  { id: 'task_priority', token: 'task_priority', label: 'Task Priority', description: 'Task priority level', category: 'Task' },
  { id: 'due_date', token: 'due_date', label: 'Due Date', description: 'Task due date', category: 'Task' },
  { id: 'assigned_by', token: 'assigned_by', label: 'Assigned By', description: 'Person who assigned task', category: 'Task' },
  
  // Claim
  { id: 'claim_reference', token: 'claim_reference', label: 'Claim Reference', description: 'Claim identifier', category: 'Claim' },
  { id: 'claim_amount', token: 'claim_amount', label: 'Claim Amount', description: 'Claimed amount', category: 'Claim' },
  { id: 'offer_amount', token: 'offer_amount', label: 'Offer Amount', description: 'Settlement offer', category: 'Claim' },
  
  // Employee
  { id: 'employee_name', token: 'employee_name', label: 'Employee Name', description: 'Employee name', category: 'Employee' },
  { id: 'employee_role', token: 'employee_role', label: 'Employee Role', description: 'Job role/title', category: 'Employee' },
  { id: 'invited_by', token: 'invited_by', label: 'Invited By', description: 'Person who sent invite', category: 'Employee' },
  { id: 'invitation_link', token: 'invitation_link', label: 'Invitation Link', description: 'Link to accept invite', category: 'Employee' },
  { id: 'expiry_date', token: 'expiry_date', label: 'Expiry Date', description: 'When invite expires', category: 'Employee' },
];
```

---

## 8. API Endpoints

### 8.1 Invoice Templates API

```tsx
// src/hooks/useInvoiceTemplates.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useInvoiceTemplates() {
  const queryClient = useQueryClient();

  // Fetch all templates
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['invoice-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoice_templates')
        .select('*')
        .order('is_default', { ascending: false })
        .order('name');
      
      if (error) throw error;
      return data;
    }
  });

  // Create template
  const createMutation = useMutation({
    mutationFn: async (template: Partial<InvoiceTemplate>) => {
      const { data, error } = await supabase
        .from('invoice_templates')
        .insert(template)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-templates'] });
    }
  });

  // Update template
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<InvoiceTemplate>) => {
      const { data, error } = await supabase
        .from('invoice_templates')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-templates'] });
    }
  });

  // Delete template
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('invoice_templates')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-templates'] });
    }
  });

  return {
    templates,
    isLoading,
    createTemplate: createMutation.mutateAsync,
    updateTemplate: updateMutation.mutateAsync,
    deleteTemplate: deleteMutation.mutateAsync,
  };
}
```

---

## 9. File Structure

```
src/
├── components/
│   └── templateEditor/
│       ├── TemplateEditor.tsx
│       ├── TemplateEditorToolbar.tsx
│       ├── TemplateEditorSidebar.tsx
│       ├── panels/
│       │   ├── TokenPanel.tsx
│       │   └── SettingsPanel.tsx
│       └── extensions/
│           └── TokenExtension.ts
├── hooks/
│   ├── useInvoiceTemplates.ts
│   └── useAlertTemplates.ts
├── lib/
│   ├── templateEditor/
│   │   ├── tokens.ts
│   │   ├── defaultInvoiceTemplate.ts
│   │   └── renderTemplate.ts
│   └── emailTemplates/
│       ├── templates.ts (all 23 email templates)
│       └── index.ts
├── pages/
│   ├── InvoiceTemplateEditor.tsx
│   └── settings/
│       └── AlertTemplateEditor.tsx (updated)
└── types/
    └── templates.ts
```

---

## 10. Implementation Order

### Phase 1: Foundation (Week 1)
1. ✅ Database schema migration for `invoice_templates` table
2. ✅ Add brand_settings to tenants table
3. ✅ Create TemplateEditor component with TipTap
4. ✅ Create TokenPanel and SettingsPanel components
5. ✅ Define all tokens (INVOICE_TOKENS, EMAIL_TOKENS)

### Phase 2: Invoice Templates (Week 2)
1. ✅ Create InvoiceTemplateEditor page
2. ✅ Create useInvoiceTemplates hook
3. ✅ Create default invoice HTML template
4. ✅ Implement preview mode with sample data
5. ✅ Add PDF export functionality

### Phase 3: Email Templates (Week 3)
1. ✅ Create all 23 email template HTML strings
2. ✅ Update alert template editor UI
3. ✅ Replace Email HTML tab with TemplateEditor
4. ✅ Update Email Text tab
5. ✅ Remove Brand Settings tab from alerts
6. ✅ Add Brand Settings to Organization Settings

### Phase 4: Testing & Polish (Week 4)
1. ✅ Test all email templates render correctly
2. ✅ Test invoice template PDF generation
3. ✅ Test token replacement in all contexts
4. ✅ Add keyboard shortcuts
5. ✅ Mobile responsive testing
6. ✅ Documentation

---

## Acceptance Criteria

### Template Editor Component
- [ ] Word-like WYSIWYG editor with full formatting toolbar
- [ ] Collapsible sidebar with tokens panel
- [ ] Click or drag tokens to insert into editor
- [ ] Preview mode shows template with sample data
- [ ] Settings panel for invoice-specific options (colors, columns)
- [ ] Undo/redo functionality
- [ ] Keyboard shortcuts (Ctrl+B, Ctrl+I, etc.)

### Invoice Template Editor Page
- [ ] Create, edit, delete invoice templates
- [ ] Set default template
- [ ] Reset to default template
- [ ] Save changes with confirmation
- [ ] Template selector dropdown
- [ ] Paper-like canvas (8.5" x 11")

### Email Templates
- [ ] All 23 templates updated with new design
- [ ] Orange header with logo
- [ ] Orange CTA buttons
- [ ] Consistent info card layout
- [ ] Proper token placeholders
- [ ] Plain text versions for all templates

### Alert Template Editor UI
- [ ] Email HTML tab uses TemplateEditor
- [ ] Email Text tab has simple editor with token buttons
- [ ] Brand Settings removed (moved to Org Settings)
- [ ] SMS tab unchanged
- [ ] Recipients tab unchanged

---

## Dependencies

```json
{
  "@tiptap/react": "^2.x",
  "@tiptap/starter-kit": "^2.x",
  "@tiptap/extension-underline": "^2.x",
  "@tiptap/extension-text-align": "^2.x",
  "@tiptap/extension-text-style": "^2.x",
  "@tiptap/extension-color": "^2.x",
  "@tiptap/extension-highlight": "^2.x",
  "@tiptap/extension-link": "^2.x",
  "@tiptap/extension-image": "^2.x",
  "@tiptap/extension-table": "^2.x",
  "@tiptap/extension-table-row": "^2.x",
  "@tiptap/extension-table-cell": "^2.x",
  "@tiptap/extension-table-header": "^2.x",
  "@tiptap/extension-placeholder": "^2.x",
  "@tiptap/extension-font-family": "^2.x"
}
```

Install with:
```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-underline @tiptap/extension-text-align @tiptap/extension-text-style @tiptap/extension-color @tiptap/extension-highlight @tiptap/extension-link @tiptap/extension-image @tiptap/extension-table @tiptap/extension-table-row @tiptap/extension-table-cell @tiptap/extension-table-header @tiptap/extension-placeholder @tiptap/extension-font-family
```

---

## Notes for Claude Code

1. **Start with database migrations** - Run these first before any frontend work
2. **Use existing UI components** - Leverage the existing shadcn/ui components
3. **Match existing patterns** - Follow the existing code style in the project
4. **Test token replacement** - Ensure all tokens render correctly in both preview and actual emails
5. **Mobile responsive** - The editor should work on tablets at minimum
6. **Error handling** - Add proper error states and loading indicators
7. **Toast notifications** - Use existing toast system for success/error messages

