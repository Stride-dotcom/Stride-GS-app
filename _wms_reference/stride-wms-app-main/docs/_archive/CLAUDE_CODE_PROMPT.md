# Template Editor & Email Templates Implementation

## Overview

I need you to implement a Template Editor system for Stride WMS that includes:
1. A reusable WYSIWYG template editor component (TipTap-based)
2. An Invoice Template Editor page
3. Updated Alert Template Editor UI (replace current broken Email HTML/Text tabs)
4. All 23 email alert templates with new brand-consistent designs

## Reference Files

The complete implementation specification is at:
- `docs/TEMPLATE_EDITOR_IMPLEMENTATION_SPEC.md` (I'll provide this)

The email templates TypeScript file is at:
- `src/lib/emailTemplates/templates.ts` (I'll provide this)

## Implementation Order

### Phase 1: Foundation

1. **Database Migration** - Create `invoice_templates` table:
```sql
CREATE TABLE invoice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  html_content TEXT NOT NULL,
  css_content TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id)
);

CREATE INDEX idx_invoice_templates_tenant ON invoice_templates(tenant_id);
ALTER TABLE invoice_templates ENABLE ROW LEVEL SECURITY;

-- Add RLS policies for tenant isolation
CREATE POLICY "Users can view their tenant's invoice templates"
  ON invoice_templates FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "Users can insert invoice templates for their tenant"
  ON invoice_templates FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "Users can update their tenant's invoice templates"
  ON invoice_templates FOR UPDATE USING (tenant_id = get_user_tenant_id());
CREATE POLICY "Users can delete their tenant's invoice templates"
  ON invoice_templates FOR DELETE USING (tenant_id = get_user_tenant_id());
```

2. **Install TipTap Dependencies**:
```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-underline @tiptap/extension-text-align @tiptap/extension-text-style @tiptap/extension-color @tiptap/extension-highlight @tiptap/extension-link @tiptap/extension-image @tiptap/extension-table @tiptap/extension-table-row @tiptap/extension-table-cell @tiptap/extension-table-header @tiptap/extension-placeholder @tiptap/extension-font-family
```

### Phase 2: Template Editor Component

Create the reusable template editor in `src/components/templateEditor/`:

```
src/components/templateEditor/
├── TemplateEditor.tsx           # Main wrapper component
├── TemplateEditorToolbar.tsx    # Formatting toolbar (Bold, Italic, etc.)
├── TemplateEditorSidebar.tsx    # Tokens panel + Settings panel
└── index.ts                     # Exports
```

**Key Features:**
- Word-like WYSIWYG editing with TipTap
- Collapsible sidebar with searchable tokens
- Click token to insert at cursor
- Preview mode with sample data
- Settings panel for invoice-specific options (colors, columns)
- Support for two modes: `invoice` (full settings) and `email` (tokens only)

### Phase 3: Token System

Create token definitions in `src/lib/templateEditor/tokens.ts`:

**Invoice Tokens** (for invoice templates):
- Company: `{{company_name}}`, `{{company_address}}`, `{{company_phone}}`, etc.
- Invoice: `{{invoice_number}}`, `{{invoice_date}}`, `{{due_date}}`, `{{total_amount}}`, etc.
- Customer: `{{customer_name}}`, `{{billing_contact_name}}`, `{{billing_address}}`, etc.
- Totals: `{{subtotal}}`, `{{tax_amount}}`, `{{balance_due}}`, etc.
- Special: `{{line_items_table}}` - renders full line items table

**Email Tokens** (for alert templates):
- Brand: `{{tenant_name}}`, `{{brand_logo_url}}`, `{{brand_support_email}}`, etc.
- Invoice: `{{invoice_number}}`, `{{total_amount}}`, `{{payment_link}}`, etc.
- Shipment: `{{shipment_reference}}`, `{{tracking_number}}`, `{{carrier_name}}`, etc.
- Item: `{{item_code}}`, `{{item_description}}`, `{{location}}`, etc.
- Task: `{{task_title}}`, `{{task_priority}}`, `{{due_date}}`, etc.
- Claim: `{{claim_reference}}`, `{{claim_amount}}`, `{{offer_amount}}`, etc.

### Phase 4: Invoice Template Editor Page

Create `src/pages/InvoiceTemplateEditor.tsx`:

**Features:**
- Template selector dropdown (multiple templates per org)
- New/Save/Reset/Delete buttons
- Set default template
- Paper-like canvas (8.5" x 11")
- Full WYSIWYG editing
- Settings sidebar for colors, fonts, line item columns

**Route:** Add to router as `/settings/invoice-templates` or similar

### Phase 5: Update Alert Template Editor

Modify the existing alert template editor at `src/pages/settings/AlertTemplateEditor.tsx` (or wherever it lives):

**Changes:**
1. **Remove "Brand Settings" tab** - This moves to Organization Settings
2. **Replace "Email HTML" tab** - Use new TemplateEditor component with `mode="email"`
3. **Update "Email Text" tab** - Keep simple textarea but add token buttons below it
4. **Keep "SMS" tab** - Current implementation is fine
5. **Keep "Recipients" tab** - Current implementation is fine

The Email HTML tab should now show the Word-like editor instead of the broken block editor.

### Phase 6: Deploy Email Templates

Replace all 23 alert template defaults with the new designs from `src/lib/emailTemplates/templates.ts`.

**Templates to update:**
1. INVOICE_SENT
2. INVOICE_CREATED
3. PAYMENT_RECEIVED
4. SHIPMENT_RECEIVED
5. SHIPMENT_COMPLETED
6. SHIPMENT_STATUS_CHANGED
7. ITEM_RECEIVED
8. ITEM_DAMAGED
9. ITEM_LOCATION_CHANGED
10. RELEASE_CREATED
11. RELEASE_APPROVED
12. RELEASE_COMPLETED
13. TASK_CREATED
14. TASK_ASSIGNED
15. TASK_COMPLETED
16. CLAIM_ATTACHMENT_ADDED
17. CLAIM_DETERMINATION_SENT
18. CLAIM_REQUIRES_APPROVAL
19. CLAIM_CLIENT_ACCEPTED
20. CLAIM_CLIENT_COUNTERED
21. CLAIM_CLIENT_DECLINED
22. CLAIM_NOTE_ADDED
23. EMPLOYEE_INVITE

**Design Consistency:**
- Orange header (`#E85D2D`) with white logo
- Orange primary buttons
- Consistent info card layout
- Same footer format across all templates

## File Structure

```
src/
├── components/
│   └── templateEditor/
│       ├── TemplateEditor.tsx
│       ├── TemplateEditorToolbar.tsx
│       ├── TemplateEditorSidebar.tsx
│       └── index.ts
├── hooks/
│   └── useInvoiceTemplates.ts
├── lib/
│   ├── templateEditor/
│   │   ├── tokens.ts
│   │   ├── defaultInvoiceTemplate.ts
│   │   └── renderTemplate.ts
│   └── emailTemplates/
│       └── templates.ts
├── pages/
│   └── InvoiceTemplateEditor.tsx
└── types/
    └── templates.ts
```

## Key Design Decisions

1. **Primary Color:** `#E85D2D` (Stride Orange) - used for headers, buttons, accents
2. **Secondary Color:** `#1E293B` (Dark Slate) - used for text, table headers
3. **Font:** Inter / system fonts
4. **Editor Library:** TipTap (ProseMirror-based) for React compatibility
5. **Token Syntax:** `{{token_name}}` - replaced at render time

## Acceptance Criteria

- [ ] TemplateEditor component renders with toolbar and sidebar
- [ ] Tokens can be inserted by clicking in sidebar
- [ ] Preview mode shows template with sample data
- [ ] Invoice Template Editor page allows CRUD operations
- [ ] Alert template editor uses new WYSIWYG for Email HTML
- [ ] All 23 email templates have orange-themed designs
- [ ] Templates render correctly with token replacement
- [ ] Mobile responsive (tablet minimum)

## Notes

- Match existing code patterns and styling in the project
- Use existing UI components (shadcn/ui)
- Use existing toast system for notifications
- Follow existing Supabase patterns for data fetching
- Add proper TypeScript types throughout

Start with the database migration, then work through each phase in order. Let me know if you need any clarification on the specifications.
