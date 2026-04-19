/**
 * PriceList — unified service catalog page (admin-only).
 *
 * Phase 1 (session 72): split panel — category sidebar on the left,
 * search + service cards on the right. Click a card to open the slide-out
 * ServiceEditPanel. "Add service" button opens AddServiceModal.
 *
 * Data: public.service_catalog via useServiceCatalog (Supabase Realtime).
 * Does NOT replace the Quote Tool catalog tab (which still reads its own
 * local store). Future phases will migrate Quote Tool to read from here.
 */
import { useMemo, useState } from 'react';
import { Plus, Search, Tag } from 'lucide-react';
import { theme } from '../styles/theme';
import { useServiceCatalog, type CatalogService, type ServiceCategory } from '../hooks/useServiceCatalog';
import { ServiceCard } from '../components/pricelist/ServiceCard';
import { ServiceEditPanel } from '../components/pricelist/ServiceEditPanel';
import { AddServiceModal } from '../components/pricelist/AddServiceModal';

const ALL_CATEGORIES: ServiceCategory[] = [
  'Warehouse', 'Storage', 'Shipping', 'Assembly',
  'Repair', 'Labor', 'Admin', 'Delivery',
];

type CategoryFilter = 'All' | ServiceCategory;

export function PriceList() {
  const v2 = theme.v2;
  const { services, loading, error, createService, updateService, deleteService, getAuditForService } = useServiceCatalog();

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Per-category counts for the sidebar
  const counts = useMemo(() => {
    const c: Record<string, number> = { All: services.length };
    for (const cat of ALL_CATEGORIES) c[cat] = 0;
    for (const s of services) c[s.category] = (c[s.category] ?? 0) + 1;
    return c;
  }, [services]);

  // Filtered + searched
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter(s => {
      if (categoryFilter !== 'All' && s.category !== categoryFilter) return false;
      if (q && !(s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [services, categoryFilter, search]);

  const existingCodes = useMemo(() => new Set(services.map(s => s.code)), [services]);
  const nextDisplayOrder = useMemo(() => {
    if (services.length === 0) return 1;
    return Math.max(...services.map(s => s.displayOrder)) + 1;
  }, [services]);

  const selected: CatalogService | null = useMemo(() => {
    if (!selectedId) return null;
    return services.find(s => s.id === selectedId) ?? null;
  }, [services, selectedId]);

  return (
    <div style={{
      fontFamily: theme.typography.fontFamily,
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
      background: v2.colors.bgPage,
      margin: '-28px -32px', padding: '28px 32px',
    }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ ...v2.typography.label, marginBottom: 4 }}>Stride Logistics</div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400, color: v2.colors.text, letterSpacing: '-0.5px' }}>
            Price List
          </h1>
          <div style={{ fontSize: 13, color: v2.colors.textSecondary, marginTop: 6 }}>
            Unified catalog of services, rates, and where they show up across the app.
          </div>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '10px 20px', borderRadius: v2.radius.button,
            background: v2.colors.accent, border: 'none', color: '#fff',
            cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '1.5px',
            textTransform: 'uppercase', fontFamily: 'inherit',
          }}
        >
          <Plus size={14} /> Add service
        </button>
      </div>

      {/* Loading / Error */}
      {error && (
        <div style={{
          padding: '12px 16px', marginBottom: 16,
          background: 'rgba(180,90,90,0.1)', color: '#B45A5A',
          borderRadius: v2.radius.input, fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* ── Split panel ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 20 }}>
        {/* Sidebar */}
        <aside style={{
          width: 220, flexShrink: 0,
          background: v2.colors.bgWhite,
          border: `1px solid ${v2.colors.border}`,
          borderRadius: v2.radius.card,
          padding: '20px 16px',
          alignSelf: 'flex-start',
        }}>
          <div style={{ ...v2.typography.label, marginBottom: 12, paddingLeft: 4 }}>Category</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <CategoryButton
              label="All services"
              count={counts.All}
              active={categoryFilter === 'All'}
              onClick={() => setCategoryFilter('All')}
            />
            {ALL_CATEGORIES.map(cat => (
              <CategoryButton
                key={cat}
                label={cat}
                count={counts[cat] ?? 0}
                active={categoryFilter === cat}
                onClick={() => setCategoryFilter(cat)}
              />
            ))}
          </div>
        </aside>

        {/* Right pane */}
        <section style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Search bar */}
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{
              position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
              color: v2.colors.textMuted,
            }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search services by code or name…"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '12px 14px 12px 38px',
                background: v2.colors.bgWhite,
                border: `1px solid ${v2.colors.border}`,
                borderRadius: v2.radius.input,
                fontSize: 13, color: v2.colors.text,
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Cards */}
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: v2.colors.textMuted, fontSize: 13 }}>
              Loading services…
            </div>
          ) : visible.length === 0 ? (
            <div style={{
              padding: 60, textAlign: 'center',
              background: v2.colors.bgWhite,
              border: `1px dashed ${v2.colors.border}`,
              borderRadius: v2.radius.card,
              color: v2.colors.textMuted,
            }}>
              <Tag size={24} style={{ opacity: 0.5, marginBottom: 12 }} />
              <div style={{ fontSize: 14, color: v2.colors.textSecondary }}>
                No services match {search ? `"${search}"` : 'this filter'}.
              </div>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: 16,
              paddingBottom: 40,
            }}>
              {visible.map(s => (
                <ServiceCard
                  key={s.id}
                  service={s}
                  onClick={() => setSelectedId(s.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Edit panel */}
      {selected && (
        <ServiceEditPanel
          service={selected}
          onClose={() => setSelectedId(null)}
          onSave={updateService}
          onDelete={deleteService}
          onGetAudit={getAuditForService}
        />
      )}

      {/* Add modal */}
      {showAdd && (
        <AddServiceModal
          existingCodes={existingCodes}
          nextDisplayOrder={nextDisplayOrder}
          onClose={() => setShowAdd(false)}
          onCreate={createService}
        />
      )}
    </div>
  );
}

// ─── Sidebar button ─────────────────────────────────────────────────────

function CategoryButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  const v2 = theme.v2;
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderRadius: v2.radius.input,
        background: active ? v2.colors.bgDark : 'transparent',
        color: active ? '#fff' : v2.colors.text,
        border: 'none',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        fontFamily: 'inherit',
        textAlign: 'left',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = v2.colors.bgCard; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <span>{label}</span>
      <span style={{
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: v2.radius.badge,
        background: active ? 'rgba(255,255,255,0.15)' : v2.colors.bgCard,
        color: active ? 'rgba(255,255,255,0.85)' : v2.colors.textMuted,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {count}
      </span>
    </button>
  );
}
