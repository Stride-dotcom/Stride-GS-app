/**
 * DetailPanelMockup.tsx — Admin-only preview of the proposed canonical detail
 * panel layout applied to all 6 entity types (Item, Task, Repair, WillCall,
 * Shipment, Claim, Billing).
 *
 * Session 70 follow-up: user requested a mockup before rolling out DetailHeader
 * to the remaining panels. This page renders 7 mock panels side-by-side so the
 * layout decisions (ordering, typography, spacing, sidemark chip, color-coded
 * status badges, sticky footer actions) can be reviewed in context and tweaked
 * via one shared component before mass adoption.
 *
 * Not wired into the Sidebar — access via the `/mockup/panels` route.
 */
import React from 'react';
import {
  Package, ClipboardList, Wrench, Truck, FileText, AlertTriangle, DollarSign,
  Calendar, Pencil, X, FolderOpen,
} from 'lucide-react';
import { theme } from '../styles/theme';
import { DetailHeader } from '../components/shared/DetailHeader';

// ─── Shared primitives for the mockup ───────────────────────────────────────

function Badge({ t, bg, color }: { t: string; bg: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 12,
      fontSize: 11, fontWeight: 600, background: bg, color, whiteSpace: 'nowrap',
    }}>{t}</span>
  );
}

function SectionCard({
  icon: Icon, title, children, rightSlot,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  title: string;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div style={{
      background: theme.colors.bgSubtle,
      border: `1px solid ${theme.colors.border}`,
      borderRadius: 10,
      padding: 14,
      marginBottom: 14,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon size={14} color={theme.colors.orange} />
          <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text }}>{title}</span>
        </div>
        {rightSlot ?? null}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 10, fontWeight: 600, color: theme.colors.textMuted,
        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3,
      }}>{label}</div>
      <div style={{
        fontSize: 13, color: theme.colors.text,
        fontFamily: mono ? 'monospace' : undefined,
      }}>{value || '—'}</div>
    </div>
  );
}

function FolderBtn({ label, icon: Icon = FolderOpen }: { label: string; icon?: React.ComponentType<{ size?: number }> }) {
  return (
    <button style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6,
      border: `1px solid ${theme.colors.border}`, background: '#fff',
      color: theme.colors.textSecondary, cursor: 'pointer', fontFamily: 'inherit',
    }}>
      <Icon size={12} /> {label}
    </button>
  );
}

function ActionBtn({ label, primary, icon: Icon }: { label: string; primary?: boolean; icon?: React.ComponentType<{ size?: number }> }) {
  return (
    <button style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
      border: primary ? 'none' : `1px solid ${theme.colors.border}`,
      background: primary ? theme.colors.orange : '#fff',
      color: primary ? '#fff' : theme.colors.textSecondary,
      cursor: 'pointer', fontFamily: 'inherit',
    }}>
      {Icon ? <Icon size={13} /> : null} {label}
    </button>
  );
}

// Reusable panel chrome: mimics the modal side-panel shell so the mockup reads
// like what operators actually see.
function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      width: 460,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      border: `1px solid ${theme.colors.border}`,
      borderRadius: 12,
      background: '#fff',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      overflow: 'hidden',
      maxHeight: 760,
    }}>
      {children}
    </div>
  );
}

function StickyFooter({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '12px 20px',
      borderTop: `1px solid ${theme.colors.border}`,
      background: '#FAFAFA',
      display: 'flex', gap: 8, justifyContent: 'flex-end',
    }}>
      {children}
    </div>
  );
}

function PanelBody({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>{children}</div>
  );
}

// ─── Mock data (intentionally varied so the layout stresses realistic content) ─

const MOCK_CLIENT = 'Olson Kundig';
const MOCK_SIDEMARK = 'Cramer / Living Room';
const SHARED_EDIT_CLOSE = (
  <>
    <button style={{
      display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
      fontSize: 11, fontWeight: 600, borderRadius: 6,
      border: `1px solid ${theme.colors.border}`, background: '#fff',
      color: theme.colors.textSecondary, cursor: 'pointer',
    }}>
      <Pencil size={12} /> Edit
    </button>
    <button style={{
      background: 'none', border: 'none', cursor: 'pointer', padding: 4,
      color: theme.colors.textMuted,
    }}>
      <X size={18} />
    </button>
  </>
);

// ─── Individual panel mockups ───────────────────────────────────────────────

function ItemPanelMock() {
  return (
    <PanelShell>
      <DetailHeader
        entityId="80312"
        entityLabel="Item"
        clientName={MOCK_CLIENT}
        sidemark={MOCK_SIDEMARK}
        actions={SHARED_EDIT_CLOSE}
        belowId={
          <div style={{ display: 'flex', gap: 6 }}>
            <Badge t="Active" bg="#F0FDF4" color="#15803D" />
            <Badge t="INSP Needed" bg="#FEF3EE" color="#E85D2D" />
          </div>
        }
      />
      <PanelBody>
        <SectionCard icon={Package} title="Core Details">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Field label="Item ID" value="80312" mono />
            <Field label="Location" value="A-12-3" mono />
            <Field label="Vendor" value="Holly Hunt" />
            <Field label="Class" value="M (50 cuFt)" />
            <Field label="Qty" value="1" />
            <Field label="Reference" value="PO 12489" />
          </div>
          <Field label="Description" value="Large walnut credenza with brass pulls" />
        </SectionCard>

        <SectionCard icon={FileText} title="Notes">
          <Field label="Item Notes" value="Slight scuff on left rear leg — photographed at receiving." />
        </SectionCard>

        <SectionCard icon={FolderOpen} title="Links">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <FolderBtn label="Item Folder" />
            <FolderBtn label="Shipment Folder" icon={Truck} />
            <FolderBtn label="Photos" />
          </div>
        </SectionCard>

        <SectionCard icon={Calendar} title="Activity">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Field label="Received" value="03/14/2026" />
            <Field label="Shipment #" value="SHP-000131" mono />
          </div>
        </SectionCard>
      </PanelBody>
      <StickyFooter>
        <ActionBtn label="Move" />
        <ActionBtn label="Release" primary />
      </StickyFooter>
    </PanelShell>
  );
}

function TaskPanelMock() {
  return (
    <PanelShell>
      <DetailHeader
        entityId="INSP-62545-1"
        clientName={MOCK_CLIENT}
        sidemark={MOCK_SIDEMARK}
        actions={SHARED_EDIT_CLOSE}
        belowId={
          <div style={{ display: 'flex', gap: 6 }}>
            <Badge t="Inspection" bg="#FEF3EE" color="#E85D2D" />
            <Badge t="In Progress" bg="#FEF3EE" color="#E85D2D" />
          </div>
        }
      />
      <PanelBody>
        <SectionCard icon={Package} title="Core Details">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Field label="Item ID" value="80312" mono />
            <Field label="Location" value="A-12-3" mono />
            <Field label="Vendor" value="Holly Hunt" />
            <Field label="Assigned To" value="warehouse@stridenw.com" />
          </div>
          <Field label="Description" value="Large walnut credenza with brass pulls" />
        </SectionCard>

        <SectionCard icon={FileText} title="Notes">
          <Field label="Item Notes" value="Slight scuff on left rear leg." />
          <Field label="Task Notes" value="Customer approved — proceed to delivery." />
        </SectionCard>

        <SectionCard icon={FolderOpen} title="Links">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <FolderBtn label="Task Folder" icon={Wrench} />
            <FolderBtn label="Shipment Folder" icon={Truck} />
            <FolderBtn label="Work Order" icon={FileText} />
          </div>
        </SectionCard>

        <SectionCard icon={Calendar} title="Activity">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Field label="Created" value="03/14/2026 09:12" />
            <Field label="Started" value="03/15/2026 10:03" />
          </div>
        </SectionCard>
      </PanelBody>
      <StickyFooter>
        <ActionBtn label="Fail" />
        <ActionBtn label="Pass" primary />
      </StickyFooter>
    </PanelShell>
  );
}

function RepairPanelMock() {
  return (
    <PanelShell>
      <DetailHeader
        entityId="RPR-00042"
        clientName={MOCK_CLIENT}
        sidemark={MOCK_SIDEMARK}
        actions={SHARED_EDIT_CLOSE}
        belowId={
          <div style={{ display: 'flex', gap: 6 }}>
            <Badge t="Quote Sent" bg="#EFF6FF" color="#1D4ED8" />
            <Badge t="$245.00" bg="#F0FDF4" color="#15803D" />
          </div>
        }
      />
      <PanelBody>
        <SectionCard icon={Wrench} title="Core Details">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Field label="Item ID" value="80312" mono />
            <Field label="Source Task" value="INSP-62545-1" mono />
            <Field label="Repair Vendor" value="Dave's Furniture" />
            <Field label="Location" value="A-12-3" mono />
          </div>
          <Field label="Description" value="Large walnut credenza with brass pulls" />
        </SectionCard>

        <SectionCard icon={FileText} title="Notes">
          <Field label="Item Notes" value="Slight scuff on left rear leg." />
          <Field label="Task Notes" value="Inspection failed — scratched finish rear-right panel." />
          <Field label="Repair Notes" value="Dave quoted $245 for touch-up + re-finish. ETA 5 days." />
        </SectionCard>

        <SectionCard icon={FolderOpen} title="Links">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <FolderBtn label="Repair Folder" icon={Wrench} />
            <FolderBtn label="Source Task" icon={ClipboardList} />
            <FolderBtn label="Photos" />
          </div>
        </SectionCard>

        <SectionCard icon={Calendar} title="Activity">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Field label="Created" value="03/15/2026" />
            <Field label="Quote Sent" value="03/16/2026" />
          </div>
        </SectionCard>
      </PanelBody>
      <StickyFooter>
        <ActionBtn label="Decline" />
        <ActionBtn label="Approve" primary />
      </StickyFooter>
    </PanelShell>
  );
}

function WillCallPanelMock() {
  return (
    <PanelShell>
      <DetailHeader
        entityId="WC-000071"
        clientName={MOCK_CLIENT}
        sidemark={MOCK_SIDEMARK}
        actions={SHARED_EDIT_CLOSE}
        belowId={
          <div style={{ display: 'flex', gap: 6 }}>
            <Badge t="Scheduled" bg="#EFF6FF" color="#1D4ED8" />
            <Badge t="COD $1,240" bg="#FEF3EE" color="#E85D2D" />
          </div>
        }
      />
      <PanelBody>
        <SectionCard icon={ClipboardList} title="Core Details">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Field label="Pickup Party" value="Dwell Van Lines" />
            <Field label="Phone" value="(206) 555-0199" />
            <Field label="Requested By" value="procurement@olsonkundig.com" />
            <Field label="Items" value="4 items" />
          </div>
        </SectionCard>

        <SectionCard icon={Package} title="Items (4)">
          <div style={{ fontSize: 12, color: theme.colors.textSecondary }}>
            80312 · 80313 · 80317 · 80318
            <div style={{ marginTop: 4, color: theme.colors.textMuted, fontSize: 11 }}>
              Click a row to open item details
            </div>
          </div>
        </SectionCard>

        <SectionCard icon={FileText} title="Notes">
          <Field label="Will Call Notes" value="Driver arriving 10am Thursday. Call 30 min out." />
        </SectionCard>

        <SectionCard icon={FolderOpen} title="Links">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <FolderBtn label="Will Call Folder" />
            <FolderBtn label="Release PDF" icon={FileText} />
          </div>
        </SectionCard>

        <SectionCard icon={Calendar} title="Activity">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Field label="Created" value="03/14/2026" />
            <Field label="Scheduled" value="03/19/2026" />
          </div>
        </SectionCard>
      </PanelBody>
      <StickyFooter>
        <ActionBtn label="Cancel" />
        <ActionBtn label="Release" primary />
      </StickyFooter>
    </PanelShell>
  );
}

function ShipmentPanelMock() {
  return (
    <PanelShell>
      <DetailHeader
        entityId="SHP-000131"
        clientName={MOCK_CLIENT}
        sidemark={MOCK_SIDEMARK}
        actions={SHARED_EDIT_CLOSE}
        belowId={
          <div style={{ display: 'flex', gap: 6 }}>
            <Badge t="Received" bg="#F0FDF4" color="#15803D" />
            <Badge t="UPS" bg="#EFF6FF" color="#1D4ED8" />
          </div>
        }
      />
      <PanelBody>
        <SectionCard icon={Truck} title="Core Details">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Field label="Items" value="12" />
            <Field label="Carrier" value="UPS" />
            <Field label="Tracking #" value="1Z999AA10123456784" mono />
            <Field label="Receive Date" value="03/14/2026" />
          </div>
        </SectionCard>

        <SectionCard icon={FileText} title="Notes">
          <Field
            label="Shipment Notes"
            value="4 cartons arrived slightly damaged — inspection tasks auto-created."
          />
        </SectionCard>

        <SectionCard icon={FolderOpen} title="Links">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <FolderBtn label="Shipment Folder" icon={Truck} />
            <FolderBtn label="Photos" />
            <FolderBtn label="BOL / Invoice" icon={FileText} />
          </div>
        </SectionCard>

        <SectionCard icon={Calendar} title="Activity">
          <Field label="Received" value="03/14/2026 14:22" />
        </SectionCard>
      </PanelBody>
      <StickyFooter>
        <ActionBtn label="View Items" />
        <ActionBtn label="Generate PDF" primary icon={FileText} />
      </StickyFooter>
    </PanelShell>
  );
}

function ClaimPanelMock() {
  return (
    <PanelShell>
      <DetailHeader
        entityId="CLM-00017"
        entityLabel="Claim"
        clientName={MOCK_CLIENT}
        sidemark={MOCK_SIDEMARK}
        actions={SHARED_EDIT_CLOSE}
        belowId={
          <div style={{ display: 'flex', gap: 6 }}>
            <Badge t="Open" bg="#FEF3EE" color="#E85D2D" />
            <Badge t="Damage" bg="#FEF2F2" color="#DC2626" />
          </div>
        }
      />
      <PanelBody>
        <SectionCard icon={AlertTriangle} title="Core Details">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Field label="Claim Type" value="Damage" />
            <Field label="Severity" value="Moderate" />
            <Field label="Claimed Amount" value="$1,850.00" />
            <Field label="Status" value="Open" />
          </div>
          <Field
            label="Description"
            value="Desk arrived with top edge dented. Client requests replacement or full refund."
          />
        </SectionCard>

        <SectionCard icon={Package} title="Claim Items (1)">
          <div style={{ fontSize: 12, color: theme.colors.textSecondary }}>
            80312 — Walnut credenza · $1,850.00
          </div>
        </SectionCard>

        <SectionCard icon={FileText} title="Notes">
          <Field label="Internal Notes" value="Waiting on Holly Hunt vendor response. Opened 03/15." />
        </SectionCard>

        <SectionCard icon={FolderOpen} title="Links">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <FolderBtn label="Claim Files" />
            <FolderBtn label="Photos" />
          </div>
        </SectionCard>

        <SectionCard icon={Calendar} title="Activity">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Field label="Opened" value="03/15/2026" />
            <Field label="Last Update" value="03/16/2026 11:04" />
          </div>
        </SectionCard>
      </PanelBody>
      <StickyFooter>
        <ActionBtn label="Add Note" />
        <ActionBtn label="Resolve" primary />
      </StickyFooter>
    </PanelShell>
  );
}

function BillingPanelMock() {
  return (
    <PanelShell>
      <DetailHeader
        entityId="INV-00342"
        entityLabel="Invoice"
        clientName={MOCK_CLIENT}
        sidemark={MOCK_SIDEMARK}
        actions={SHARED_EDIT_CLOSE}
        belowId={
          <div style={{ display: 'flex', gap: 6 }}>
            <Badge t="Invoiced" bg="#EFF6FF" color="#1D4ED8" />
            <Badge t="$3,412.50" bg="#F0FDF4" color="#15803D" />
          </div>
        }
      />
      <PanelBody>
        <SectionCard icon={DollarSign} title="Core Details">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Field label="Invoice Date" value="03/31/2026" />
            <Field label="Payment Terms" value="Net 30" />
            <Field label="Total" value="$3,412.50" />
            <Field label="Line Items" value="14" />
          </div>
        </SectionCard>

        <SectionCard icon={FileText} title="Line Items (sample)">
          <div style={{ fontSize: 12, color: theme.colors.textSecondary, lineHeight: 1.7 }}>
            STOR · 12 items · 31 days · $1,920.00<br/>
            INSP · 4 tasks · $480.00<br/>
            RCVG · SHP-000131 · $240.00<br/>
            REPAIR · RPR-00042 · $245.00
          </div>
        </SectionCard>

        <SectionCard icon={FolderOpen} title="Links">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <FolderBtn label="Invoice PDF" icon={FileText} />
            <FolderBtn label="Accounting Folder" />
          </div>
        </SectionCard>

        <SectionCard icon={Calendar} title="Activity">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Field label="Sent" value="03/31/2026" />
            <Field label="Due" value="04/30/2026" />
          </div>
        </SectionCard>
      </PanelBody>
      <StickyFooter>
        <ActionBtn label="Email" />
        <ActionBtn label="Charge on File" primary icon={DollarSign} />
      </StickyFooter>
    </PanelShell>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

const PANELS: Array<{ key: string; label: string; Component: React.ComponentType }> = [
  { key: 'item',     label: 'Item',       Component: ItemPanelMock },
  { key: 'task',     label: 'Task',       Component: TaskPanelMock },
  { key: 'repair',   label: 'Repair',     Component: RepairPanelMock },
  { key: 'wc',       label: 'Will Call',  Component: WillCallPanelMock },
  { key: 'shipment', label: 'Shipment',   Component: ShipmentPanelMock },
  { key: 'claim',    label: 'Claim',      Component: ClaimPanelMock },
  { key: 'billing',  label: 'Billing',    Component: BillingPanelMock },
];

export function DetailPanelMockup() {
  return (
    <div style={{ padding: 20 }}>
      <div style={{
        marginBottom: 18, paddingBottom: 12,
        borderBottom: `1px solid ${theme.colors.border}`,
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: theme.colors.text, marginBottom: 4 }}>
          Detail Panel — Unified Layout Mockup
        </div>
        <div style={{ fontSize: 13, color: theme.colors.textSecondary, lineHeight: 1.5, maxWidth: 820 }}>
          Proposed canonical section order for every detail panel (Item / Task /
          Repair / Will Call / Shipment / Claim / Billing). Header chip is shared
          via <code style={{ fontSize: 12, background: theme.colors.bgSubtle, padding: '1px 5px', borderRadius: 4 }}>DetailHeader</code>.
          Below the header, every panel lays out the same sections in the same
          order: <strong>Core Details</strong> → <strong>Notes</strong> →
          <strong> Links</strong> → <strong>Activity</strong> → sticky
          <strong> Action Buttons</strong> footer. Tweak anything here and the
          shared component carries it to every panel on adoption.
        </div>
      </div>

      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start',
      }}>
        {PANELS.map(({ key, label, Component }) => (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: 0.8, color: theme.colors.textMuted,
            }}>
              {label}
            </div>
            <Component />
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 28, padding: 16, borderRadius: 10,
        background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`,
        fontSize: 13, color: theme.colors.textSecondary, lineHeight: 1.6,
        maxWidth: 820,
      }}>
        <div style={{ fontWeight: 700, color: theme.colors.text, marginBottom: 6 }}>
          Decisions baked into this mockup
        </div>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>Entity ID: 20px bold — entity label prefix in muted text for Claim / Invoice to avoid ID collisions with other records.</li>
          <li>Status badges always below the ID, before the client/sidemark row.</li>
          <li>Client name: 14px weight 700. Sidemark: pill with a deterministic color from the Inventory palette (hash-based, stable across pages).</li>
          <li>Section cards share iconography (lucide) and a consistent "UPPERCASE 10px label + 13px value" field pattern.</li>
          <li>Action buttons live in a sticky footer — primary action on the right, destructive/secondary to its left.</li>
          <li>Notes section always shows Item Notes (read-only, from Inventory) + entity-specific notes (editable).</li>
        </ul>
      </div>
    </div>
  );
}
