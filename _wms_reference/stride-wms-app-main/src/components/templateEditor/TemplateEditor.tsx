import React, { useState, useCallback, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import DOMPurify from 'dompurify';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import Placeholder from '@tiptap/extension-placeholder';
import FontFamily from '@tiptap/extension-font-family';
import { TemplateEditorToolbar } from './TemplateEditorToolbar';
import { TemplateEditorSidebar } from './TemplateEditorSidebar';
import { Token, renderTemplate } from '@/lib/templateEditor/tokens';
import './template-editor.css';

export interface TemplateEditorProps {
  initialContent: string;
  onChange: (html: string) => void;
  tokens: Token[];
  settings?: TemplateSettings;
  onSettingsChange?: (settings: TemplateSettings) => void;
  mode?: 'invoice' | 'email';
  showSettings?: boolean;
}

export interface TemplateSettings {
  colors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
  typography?: {
    fontFamily?: string;
    baseFontSize?: string;
  };
  tableColumns?: Array<{
    id: string;
    label: string;
    enabled: boolean;
    width?: string;
  }>;
  pageSetup?: {
    pageSize?: string;
    orientation?: string;
    margins?: {
      top?: string;
      right?: string;
      bottom?: string;
      left?: string;
    };
  };
  contentOptions?: {
    showLogo?: boolean;
    showRemitTo?: boolean;
    showPaymentTerms?: boolean;
    showPaymentLink?: boolean;
    showNotes?: boolean;
    showTerms?: boolean;
  };
}

export function TemplateEditor({
  initialContent,
  onChange,
  tokens,
  settings = {},
  onSettingsChange,
  mode = 'invoice',
  showSettings = false,
}: TemplateEditorProps) {
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [activePanel, setActivePanel] = useState<'tokens' | 'settings'>('tokens');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline',
        },
      }),
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      Placeholder.configure({
        placeholder: 'Start typing your template content...',
      }),
      FontFamily,
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Update editor content when initialContent changes
  useEffect(() => {
    if (editor && initialContent !== editor.getHTML()) {
      editor.commands.setContent(initialContent);
    }
  }, [initialContent, editor]);

  const handleInsertToken = useCallback((token: string) => {
    if (editor) {
      editor.chain().focus().insertContent(`{{${token}}}`).run();
    }
  }, [editor]);

  const handleTogglePreview = useCallback(() => {
    setIsPreviewMode(prev => !prev);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setShowSidebar(prev => !prev);
  }, []);

  if (!editor) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="template-editor h-full flex flex-col bg-slate-900">
      {/* Toolbar */}
      <TemplateEditorToolbar
        editor={editor}
        onTogglePreview={handleTogglePreview}
        isPreviewMode={isPreviewMode}
        onToggleSidebar={handleToggleSidebar}
      />

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {showSidebar && (
          <TemplateEditorSidebar
            tokens={tokens}
            settings={settings}
            onInsertToken={handleInsertToken}
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
            style={{ padding: mode === 'invoice' ? '0.75in' : '24px' }}
          >
            {isPreviewMode ? (
              <div
                className="template-preview prose prose-slate max-w-none"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderTemplate(editor.getHTML(), tokens)) }}
              />
            ) : (
              <EditorContent
                editor={editor}
                className="prose prose-slate max-w-none focus:outline-none"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
