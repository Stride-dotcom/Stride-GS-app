# STRIDE WMS — Domain Knowledge Reference
> Commit this file to the repo root. Claude Code reads it automatically for domain context.
> Last updated: 2026-03-03

---

## 1. WHAT STRIDE IS (Domain Identity)

Stride is a **3PL Warehouse Management System** — software purpose-built for third-party logistics providers who warehouse and fulfill goods for multiple client businesses (tenants) simultaneously inside a single shared facility.

Key distinction from general WMS: every feature must work at the **client/account level**, not just the warehouse level. Multi-client architecture is the foundation, not an add-on.

---

## 2. CORE WMS WORKFLOW (The 6-Stage Lifecycle)

Every item that enters a warehouse follows this mandatory sequence. Stride must support all 6 stages:

```
INBOUND                              OUTBOUND
────────                             ────────
1. RECEIVING → 2. PUTAWAY → 3. STORAGE → 4. PICKING → 5. PACKING → 6. SHIPPING
                                    ↕
                              RETURNS/REVERSE LOGISTICS
```

### Stage Details

| Stage | What Happens | Key Data Captured |
|-------|-------------|-------------------|
| **Receiving** | Driver arrives, dock intake (Stage 1 quick scan), then detailed item processing (Stage 2) | ASN match, quantities, condition, discrepancies, photos |
| **Putaway** | Items moved from dock to storage locations | Location assignment, putaway strategy (velocity/zone/ABC), capacity |
| **Storage** | Items at rest in bin/shelf/pallet locations | Real-time counts, lot/expiry, serialization |
| **Picking** | Worker retrieves items for an order | Pick path optimization, scan-confirm, batch/wave/zone picking |
| **Packing** | Items verified, boxed, labeled | Carton selection, packing slip, carrier label, weight validation |
| **Shipping** | Shipment dispatched | Carrier integration, tracking, BOL generation, proof of delivery |

### Industry Accuracy Benchmarks
- High-performing warehouses: **95–99% inventory accuracy**
- Manual/spreadsheet operations: **63–70% accuracy**
- Error rate target: **< 0.5% pick errors**

---

## 3. 3PL-SPECIFIC REQUIREMENTS (What Makes Stride Different)

### Multi-Tenant Architecture
- Each client (account) is a **virtual warehouse** within the physical space
- Complete data isolation — Client A cannot see Client B's inventory
- Client-specific: storage locations, picking strategies, shipping rules, billing rates, service agreements
- Onboarding new clients should take **hours, not weeks**

### Client-Specific Billing (Critical Revenue Function)
3PL billing is inherently complex — it is NOT like SaaS subscription billing:

**Billable event categories:**
- **Receiving fees** — per pallet, per carton, per line item received
- **Storage fees** — per pallet/bin/cubic foot, charged weekly or monthly
- **Pick & pack fees** — per order, per unit, per line
- **Handling fees** — special requests, kitting, labeling, repackaging
- **Shipping fees** — freight charges, carrier label fees
- **Value-added services (VAS)** — custom work billed at agreed rates
- **Minimum charges** — monthly minimums per client

**Industry pain point:** 56% of 3PLs leave money on the table because they cannot automate VAS billing. Every missed charge = direct margin loss.

**Billing timing:** Events must be captured in real-time as they occur, then aggregated into invoices at billing cycle end. Manual reconciliation is a major failure point.

### Client Portal (Self-Service = Competitive Advantage)
Best-in-class 3PL portals provide clients:
- Real-time inventory dashboard (stock levels, locations)
- Order tracking (received → shipped with tracking numbers)
- Invoice download without calling the 3PL
- Low-stock alerts and reorder notifications
- Report generation on-demand

---

## 4. INVENTORY MANAGEMENT PATTERNS

### Location Hierarchy (standard WMS model)
```
Warehouse → Zone → Aisle → Bay → Level → Bin
```
Example: `WH1 > ZONE-A > A01 > 03 > 02 > BIN-4`

### Putaway Strategies (in priority order for Stride)
1. **Directed putaway** — system assigns optimal location based on rules
2. **Velocity-based slotting** — fast movers near dock/pick stations
3. **Zone-based** — product type/temperature/client zone
4. **ABC analysis** — A items (high velocity) get prime locations
5. **Capacity-aware** — respects 90% utilization cap (Stride design decision)

### Inventory Tracking Attributes
- SKU / Item code
- Lot number (for batch traceability)
- Serial number (for individual unit tracking)
- Expiration date (FIFO/FEFO rotation enforcement)
- Condition (new, damaged, quarantine)
- Client/Account ownership

### Cycle Counting (vs. Full Physical Inventory)
- WMS best practice: continuous cycle counts rather than annual shutdowns
- Triggered by: ABC schedule, discrepancy history, velocity changes
- Stride: stocktake system handles this

---

## 5. TASK SYSTEM (WMS Work Orchestration)

Modern WMS platforms use a **task queue** pattern — the system generates directed work tasks and assigns them to workers:

**Task types in Stride:**
- Receiving tasks (dock intake, detail processing)
- Putaway tasks (move item X from staging to location Y)
- Pick tasks (retrieve item for order)
- Pack tasks (prepare order for shipment)
- Cycle count tasks
- Replenishment tasks
- Special/VAS tasks

**Task interleaving:** Advanced WMS assigns the next-best task dynamically to minimize empty travel (worker finishes a put-away and is automatically assigned a nearby pick rather than returning to the queue).

---

## 6. SHIPMENTS (Outbound) — Key Concepts

### Outbound Shipment Types
- **Standard outbound** — client orders fulfilled from stock
- **Will Call** — client or their customer picks up at the warehouse (NOTE: migrating from task type to shipment type in a future Stride phase)
- **Transfer** — inter-warehouse movement
- **Return** — inbound return from customer

### Carrier Integration Requirements
- Rate shopping across carriers (UPS, FedEx, USPS, regional carriers)
- Label generation (ZPL for thermal printers)
- Tracking number capture and storage
- BOL (Bill of Lading) generation for LTL/FTL
- Proof of delivery capture

### Shipment Status Flow
```
DRAFT → ALLOCATED → PICKED → PACKED → SHIPPED → DELIVERED
                                          ↓
                                    EXCEPTION (lost/damaged)
```

---

## 7. CLAIMS MANAGEMENT

3PLs handle claims when inventory is lost, damaged, or shorted. Key fields:
- Claim type: damage / shortage / overage / loss
- Discovery point: receiving / storage / shipping
- Evidence: photos, scan records, BOL notes
- Resolution: credit, replacement, insurance, denial
- Claim value and settlement amount

---

## 8. SAAS ARCHITECTURE PATTERNS (Stride-Specific)

### Multi-Tenant Data Isolation (Supabase/PostgreSQL)
```sql
-- Every table has tenant_id
-- RLS policy pattern (Stride uses this):
CREATE POLICY "tenant_isolation" ON table_name
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);
```

**Critical:** Use `app_metadata` not `user_metadata` for tenant_id — app_metadata is server-controlled and cannot be manipulated by the client.

### React Query Patterns (Stride stack)
```typescript
// Standard hook pattern in Stride:
// - useQuery for reads with tenant_id scoping
// - useMutation for writes with optimistic updates
// - queryClient.invalidateQueries for cache busting after mutations
```

### Supabase Edge Functions (Deno runtime)
- Run on Supabase hosted infrastructure, NOT locally
- Used for: webhook handlers, scheduled jobs, billing calculations
- Cannot be tested with `npm run dev` — requires Supabase CLI or remote testing

### RLS Policy Risk Areas
Changes to RLS policies are HIGH RISK — a misconfigured policy can:
1. Expose one tenant's data to another (data breach)
2. Block legitimate access (operational outage)
3. Silently return empty results (data appears missing)

Always test RLS changes against: (a) correct tenant access, (b) cross-tenant blocking, (c) unauthenticated blocking.

---

## 9. BILLING SYSTEM ARCHITECTURE (Stride-Specific)

### The Billing Gateway Pattern (Stride's approach)
Stride centralizes all billing logic behind a unified Billing Gateway to prevent scattered logic causing revenue disruption. The legacy `service_events` pattern is being migrated to `charge_types + pricing_rules`.

**Billing parity rule:** Any code change must produce identical billing output to the previous version. Revenue accuracy is non-negotiable.

### Charge Structure
```
charge_types → defines what can be billed (receiving, storage, pick, etc.)
pricing_rules → defines how much per client (rate cards)
service_events → legacy: individual billable events as they occur
invoices → aggregated billing at cycle end
```

### Common 3PL Rate Card Components
- Storage: $/pallet/month OR $/cubic foot/month
- Receiving: $/pallet received OR $/hour
- Pick: $/order OR $/unit OR $/line
- Packing: $/order OR included in pick
- Shipping: cost + markup OR flat fee
- Minimums: $/month minimum per client

---

## 10. SAAS LAUNCH REQUIREMENTS CHECKLIST

### Security & Compliance
- [ ] RLS enabled on ALL tables (Supabase)
- [ ] PCI DSS compliance — never store raw card data; use Stripe tokenization only
- [ ] GDPR/CCPA — privacy policy, data deletion workflows, consent management
- [ ] SOC 2 Type II consideration (enterprise clients will ask for this)
- [ ] JWT validation on all API endpoints
- [ ] Rate limiting on auth endpoints
- [ ] Audit logging for all data mutations (Stride has audit_log system)

### Stripe Integration
- [ ] Webhook signature verification (prevent spoofed events)
- [ ] Idempotency keys on all Stripe API calls (prevent duplicate charges)
- [ ] Subscription lifecycle events: `customer.subscription.created/updated/deleted`
- [ ] Payment failure handling + dunning emails
- [ ] Invoice generation and delivery
- [ ] Proration handling for plan changes
- [ ] Test mode → live mode migration checklist

### Performance
- [ ] DB indexes on all `tenant_id` + common filter columns
- [ ] Query performance analysis (EXPLAIN ANALYZE) before shipping new queries
- [ ] React Query cache strategy per feature (stale times appropriate to data volatility)
- [ ] Pagination on all list endpoints (no unbounded queries)

### Reliability
- [ ] Error boundaries in React components
- [ ] Toast notifications for all async operations (success + failure)
- [ ] Offline/network error handling
- [ ] Supabase realtime subscription cleanup on unmount

---

## 11. E-COMMERCE / STORE INTEGRATIONS (Future Stride Phase)

3PL clients sell on multiple channels. WMS must pull orders automatically:

**Priority integration targets:**
1. **Shopify** — largest DTC client base; REST Admin API + webhooks
2. **Amazon** — SP-API for FBA/FBM orders and inventory sync
3. **WooCommerce** — REST API, webhook-based
4. **EDI** — for big-box retail (Walmart, Target); requires EDI 850/856/810
5. **BigCommerce / TikTok Shop** — growing channels

**Integration pattern:**
```
Client Store → Webhook/Poll → Stride Order Intake → Task Generation → Pick/Pack/Ship → Tracking Update → Store
```

**Key data to sync:**
- Inbound: orders, order items, quantities, shipping addresses, carrier preferences
- Outbound: tracking numbers, fulfillment status, inventory levels

---

## 12. COMPETITIVE LANDSCAPE (Stride Positioning)

| Platform | Pricing | Target | Key Differentiator |
|----------|---------|--------|--------------------|
| Extensiv (3PL WM) | $100–$1,000/mo | Small-mid 3PL | Built by 3PL operators |
| ShipHero | $1,995/mo | DTC/ecomm 3PL | Batch picking, rate shopping |
| Manhattan Active | Enterprise | Large 3PL | Micro-services, 1,700+ customers |
| Deposco | Mid-market | Growing 3PL | AI-native, cloud-first |
| Stride WMS | TBD | Small-mid 3PL | Modern stack, client portal UX |

**Stride competitive advantages to build toward:**
- Faster client onboarding than legacy platforms
- Superior client portal UX (Apple-quality design)
- AI-assisted receiving, putaway suggestions, discrepancy detection
- Modern React/TypeScript stack (faster feature velocity than legacy platforms)

---

## 13. MOBILE-FIRST CONSIDERATIONS

Warehouse staff use Stride on mobile devices and tablets:
- Touch targets minimum 44x44px
- Barcode scanning via camera (Capacitor integration)
- Offline-capable for scan operations (network drops in warehouses)
- Simplified UI for task completion (single action per screen preferred)
- High contrast for warehouse lighting conditions

---

## 14. KEY GLOSSARY (Use These Terms Consistently in Code)

| Term | Definition |
|------|-----------|
| **Tenant** | A 3PL business using Stride (the warehouse operator) |
| **Account / Client** | A customer of the 3PL (whose goods are stored) |
| **ASN** | Advanced Shipping Notice — pre-alert from client before goods arrive |
| **SKU** | Stock Keeping Unit — unique product identifier |
| **Lot** | Batch of products received together (traceability) |
| **Putaway** | Moving received goods to storage locations |
| **Slotting** | Optimizing which products go to which locations |
| **FIFO/FEFO** | First In First Out / First Expired First Out rotation rules |
| **BOL** | Bill of Lading — shipping document for freight |
| **VAS** | Value-Added Services — custom work (kitting, labeling, etc.) |
| **Cycle Count** | Counting a subset of inventory on a rolling schedule |
| **Wave** | Batch of orders released for picking at the same time |
| **Pick Path** | Optimized route through warehouse to fulfill a pick list |
| **Cartonization** | Selecting optimal box size for an order |
| **Discrepancy** | Mismatch between expected and received quantities |
| **Sidemarks** | Client-specific reference codes on shipments |

---

*This document is auto-read by agents at session start. Update when domain understanding evolves.*


---

## Domain Knowledge

**Read `STRIDE_DOMAIN_KNOWLEDGE.md`** in the repo root before implementing any feature. It contains:
- Complete WMS 6-stage workflow (Receiving → Putaway → Storage → Picking → Packing → Shipping)
- 3PL billing models, charge categories, and rate card structures
- Industry terminology and accuracy benchmarks
- Competitive positioning and feature priorities
- Mobile-first warehouse UX requirements

This is NOT optional context — building WMS features without domain knowledge produces incorrect workflows.

---

## Architecture Invariants (Never Violate)

### 1. Tenant Isolation
- Every DB query MUST include `.eq("tenant_id", profile?.tenant_id)` or be covered by RLS
- Never use service-role key in frontend code
- `app_metadata.tenant_id` is the authoritative source (not `user_metadata`)
- Cross-tenant data access = critical security failure

### 2. Billing Parity
- ANY change touching billing logic requires verifying output is identical to previous version
- The Billing Gateway is the single source of truth — never calculate billing amounts inline in components
- Legacy `service_events` and new `charge_types + pricing_rules` must stay in sync during migration
- When in doubt: DO NOT change billing behavior — flag for review instead

### 3. RLS Policy Safety
- Test all RLS changes for: correct-tenant access ✓, cross-tenant block ✓, unauthenticated block ✓
- Misconfigured RLS silently returns empty results — always verify with data present
- Never DROP and recreate RLS policies without explicit instruction

### 4. Migration Safety
- All DB migrations are non-destructive (ADD columns, never DROP without explicit approval)
- New columns require defaults or nullable — never break existing rows
- RPC grants must accompany new functions (anon + authenticated roles)

---

## Common Patterns Quick Reference

### Supabase Query (tenant-scoped)
```typescript
const { data, error } = await supabase
  .from("table_name")
  .select("*")
  .eq("tenant_id", profile?.tenant_id)
  .order("created_at", { ascending: false });
```

### React Query Hook Structure
```typescript
export function useFeatureName() {
  const { profile } = useAuth();
  
  const query = useQuery({
    queryKey: ["feature_name", profile?.tenant_id],
    queryFn: async () => { /* supabase call */ },
    enabled: !!profile?.tenant_id,
  });

  const mutation = useMutation({
    mutationFn: async (data) => { /* supabase call */ },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feature_name"] });
      toast({ title: "Success message" });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return { ...query, create: mutation.mutate };
}
```

### shadcn/ui Component Usage
- Always use shadcn components from `@/components/ui/` — never raw HTML for form elements
- Toast notifications via `useToast` hook for all async feedback
- Form validation via React Hook Form + Zod schema

---

## Feature Implementation Order (WMS Workflow)

When building new features, always consider upstream/downstream impact:

```
Receiving (inbound) → impacts → Inventory levels
Inventory levels → impacts → Putaway suggestions, Picking availability  
Picking → impacts → Packing, Shipment creation
Shipment creation → impacts → Billing events (charge capture)
Billing events → impacts → Invoice generation
```

Never implement a downstream feature without confirming upstream data exists and is correctly structured.

---

## SALA System Map

Quick reference — which system owns which data:

| Feature Area | SYSTEM_MASTER Location |
|-------------|----------------------|
| Receiving & dock intake | `docs/systems/receiving-dock-intake/` |
| Inventory management | `docs/systems/inventory/` |
| Putaway & locations | `docs/systems/capacity-heatmap/` |
| Shipments (outbound) | `docs/systems/shipments/` |
| Tasks & work queues | `docs/systems/tasks/` |
| Billing & invoicing | `docs/systems/billing/` |
| Client portal | `docs/systems/client-portal/` |
| Claims | `docs/systems/claims/` |
| Alerts & notifications | `docs/systems/alerts/` |
| Security & RLS | `docs/systems/security/` |
| Quotes | `docs/systems/quotes/` |
| Routing | `docs/systems/routing/` |
| Auth & roles | `docs/systems/auth-roles-tenant/` |
| Storage & media | `docs/systems/storage-media/` |
| Stocktake | `docs/systems/stocktake/` |
| Settings & pricing | `docs/systems/settings-pricing-service-codes/` |
| Super admin | `docs/systems/super-admin-audit/` |
| Comms & webhooks | `docs/systems/communications-notifications-webhooks/` |
| Scan hub | `docs/systems/scanhub/` |
| Warehouse map | `docs/systems/warehouse-map/` |

---

## SaaS Launch Readiness Checklist (Reference When Building)

Before any feature ships to production:
- [ ] RLS policy covers all CRUD operations
- [ ] No unbounded queries (all lists paginated)
- [ ] DB indexes on filter columns (check with EXPLAIN ANALYZE)  
- [ ] React Query cache invalidated after mutations
- [ ] Error boundary wraps the feature component
- [ ] Toast feedback on all async actions
- [ ] Mobile layout tested (warehouse staff use tablets/phones)
- [ ] Billing event captured if feature involves a billable action
- [ ] Audit log entry created for sensitive data changes

---

## What NOT to Do (Common Drift Errors)

1. **Don't infer billing logic** — always read `docs/systems/billing/SYSTEM_MASTER.md` first
2. **Don't create new files without checking if a similar hook/component exists** — check `/src/hooks/` and `/src/components/` first
3. **Don't add columns without null/default safety** — existing rows must not break
4. **Don't skip the SALA preflight** — it exists because implementation drift causes production incidents
5. **Don't use `user_metadata` for tenant_id** — it is client-writable and insecure
6. **Don't make billing changes without explicit parity verification instruction**
7. **Don't expand scope beyond SCOPE LOCK** — if you think something else needs changing, STOP and report it
