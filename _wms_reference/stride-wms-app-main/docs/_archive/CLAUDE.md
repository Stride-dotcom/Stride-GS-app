# Claude.md - AI Assistant Guide for Stride WMS

This file provides guidance for Claude (and other AI assistants) working on the Stride WMS codebase.

## Project Overview

**Stride WMS** is an enterprise-grade Warehouse Management System for 3PL providers. It handles inventory tracking, shipment processing, claims management, billing/invoicing, cycle counts, repair quotes, and client self-service.

## Technology Stack

- **Frontend**: React 18 + TypeScript + Vite
- **UI**: shadcn-ui + Radix UI + Tailwind CSS
- **Database**: PostgreSQL via Supabase
- **Auth**: Supabase Auth (JWT-based)
- **State**: TanStack React Query v5
- **Forms**: React Hook Form + Zod
- **Mobile**: Capacitor 8 (iOS/Android)
- **PDF**: jsPDF
- **Excel**: xlsx library

## Project Structure

```
/src
├── pages/              # Route page components (46+ pages)
├── components/         # React components organized by domain
│   ├── accounts/       # Account management
│   ├── billing/        # Billing calculator, pricing
│   ├── claims/         # Claims processing UI
│   ├── client-portal/  # Client-facing components
│   ├── inventory/      # Item management
│   ├── invoices/       # Invoice template, generation
│   ├── reports/        # Billing reports, analytics
│   ├── settings/       # Settings panels, alerts
│   ├── shipments/      # Shipment receiving/releasing
│   ├── tasks/          # Task management
│   └── ui/             # shadcn-ui components (60+)
├── hooks/              # Custom React hooks (56+)
├── contexts/           # React contexts (AuthContext)
├── lib/                # Utilities
│   ├── billing/        # Billing calculation logic
│   ├── alertQueue.ts   # Alert/notification queueing
│   ├── email.ts        # Email templates
│   └── invoicePdf.ts   # PDF generation
├── integrations/
│   └── supabase/       # Supabase client & types
└── services/           # API service layers
```

## Key Coding Patterns

### Hooks Pattern
Data fetching uses custom hooks in `/src/hooks/`. Each hook typically provides:
- Fetch functions (`fetchItems`, `fetchInvoices`)
- Mutation functions (`createItem`, `updateItem`, `deleteItem`)
- Loading states

Example:
```typescript
const { items, loading, fetchItems, createItem } = useItems();
```

### Component Organization
- Pages are in `/src/pages/` and handle routing/layout
- Feature components are domain-organized under `/src/components/`
- Shared UI primitives are in `/src/components/ui/` (shadcn)

### Database Access
All database access goes through Supabase client:
```typescript
import { supabase } from "@/integrations/supabase/client";

const { data, error } = await supabase
  .from("table_name")
  .select("*")
  .eq("tenant_id", profile?.tenant_id);
```

### Multi-Tenant Isolation
- All data is scoped by `tenant_id`
- RLS policies enforce isolation at database level
- Always include tenant_id in queries

### Toast Notifications
```typescript
import { useToast } from "@/hooks/use-toast";
const { toast } = useToast();
toast({ title: "Success", description: "Operation completed" });
toast({ title: "Error", description: "Something failed", variant: "destructive" });
```

## Important Files to Know

### Core Business Logic
- `src/hooks/useInvoices.ts` - Invoice creation, grouping, billing events
- `src/hooks/useBilling.ts` - Billing event creation, pricing lookups
- `src/hooks/useClaims.ts` - Claims workflow
- `src/lib/billing/BillingCalculator.tsx` - Shared billing calculation component

### Key Pages
- `src/pages/Invoices.tsx` - Revenue Ledger with invoices, template editor
- `src/pages/Analytics.tsx` - Reports including billing report tab
- `src/pages/Claims.tsx` - Claims management
- `src/pages/Inventory.tsx` - Item management

### Alert System
- `src/lib/alertQueue.ts` - Queue alerts for processing
- `src/lib/email.ts` - Email template builders
- `src/hooks/useCommunications.ts` - Alert configuration, TRIGGER_EVENTS

## Database Schema (Key Tables)

### Inventory
- `items` - Core inventory items
- `item_photos` - Item photos
- `locations` - Warehouse locations
- `sidemarks` - Customer sidemarks/locations

### Billing
- `service_events` - Pricing rules for services
- `billing_events` - Generated billing records
- `invoices` - Invoice headers
- `invoice_lines` - Invoice line items

### Accounts
- `accounts` - Customer accounts
- `tenant_company_settings` - Organization settings

### Claims
- `claims` - Claim records
- `claim_items` - Items on claims

## Conventions

### Naming
- Components: PascalCase (`BillingReportTab.tsx`)
- Hooks: camelCase with `use` prefix (`useInvoices.ts`)
- Pages: PascalCase (`Invoices.tsx`)
- Files match component/hook names

### TypeScript
- Use explicit types for function parameters
- Export interfaces for component props
- Avoid `any` - use proper types from Supabase

### State Management
- Local state for UI concerns
- React Query for server state
- Context for global auth state

### Styling
- Use Tailwind CSS classes
- Use shadcn-ui components when available
- Follow existing patterns in similar components

## Common Tasks

### Adding a New Page
1. Create page component in `/src/pages/`
2. Add route in `/src/App.tsx`
3. Use `DashboardLayout` wrapper

### Adding a New Hook
1. Create in `/src/hooks/`
2. Follow existing patterns (fetch, create, update, delete)
3. Include tenant_id filtering

### Adding UI Components
1. Check if shadcn component exists first
2. If not, create in appropriate domain folder
3. Use existing styling patterns

### Working with Billing
1. Use `useInvoices` hook for invoice operations
2. `createInvoicesFromEvents` for billing report to invoice flow
3. Invoice number format: `INV-{account_code}-00001`

### Working with Alerts
1. Add trigger event to `TRIGGER_EVENTS` in `useCommunications.ts`
2. Create queue function in `alertQueue.ts`
3. Create email template in `email.ts`

## Testing Commands

```bash
# TypeScript check
npx tsc --noEmit

# Development server
npm run dev

# Production build
npm run build
```

## Git Workflow

- Feature branches: `claude/{feature-name}-{sessionId}`
- Commit messages: Clear, descriptive summaries
- Always verify TypeScript compiles before committing

## Things to Avoid

- Don't use `any` type
- Don't skip tenant_id filtering
- Don't modify shadcn-ui base components directly
- Don't add console.log in production code
- Don't hardcode tenant IDs or user IDs

## Debugging Tips

1. Check browser console for errors
2. Check Supabase dashboard for RLS policy issues
3. Verify tenant_id is being passed correctly
4. Check network tab for API response errors

## Recent Major Features

1. **Invoice Template Tab** - Visual editor for invoice styling with token system
2. **Billing Report Enhancements** - Sortable columns, inline editing, create invoice flow
3. **Bulk Invoice Actions** - Email and Excel export for selected invoices
4. **Invoice Grouping** - Create invoices by account, sidemark, or combination

---

*Last updated: January 31, 2026*
