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
import { Plus, Search, Tag, Download, Share2, Check, Copy, X } from 'lucide-react';
import { theme } from '../styles/theme';
import { useServiceCatalog, type CatalogService, type ServiceCategory } from '../hooks/useServiceCatalog';
import { ServiceCard } from '../components/pricelist/ServiceCard';
import { ServiceEditPanel } from '../components/pricelist/ServiceEditPanel';
import { AddServiceModal } from '../components/pricelist/AddServiceModal';
import { downloadPriceListExcel } from '../components/pricelist/exportPriceListExcel';
import { usePriceListShares, type PriceListShare } from '../hooks/usePriceListShares';

const ALL_CATEGORIES: ServiceCategory[] = [
  'Warehouse', 'Storage', 'Shipping', 'Assembly',
  'Repair', 'Labor', 'Admin', 'Delivery',
];

const SHAREABLE_CATEGORIES: ServiceCategory[] = [
  'Warehouse', 'Storage', 'Delivery', 'Fabric Protection',
  'Assembly', 'Repair', 'Labor', 'Admin',
];

const BASE_SHARE_URL = 'https://www.mystridehub.com/#/rates/';

type CategoryFilter = 'All' | ServiceCategory;

export function PriceList() {
  const v2 = theme.v2;
  const { services, loading, error, createService, updateService, deleteService, getAuditForService } = useServiceCatalog();
  const { createShare } = usePriceListShares();

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [newShare, setNewShare] = useState<PriceListShare | null>(null);

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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowShare(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 20px', borderRadius: v2.radius.button,
              background: 'transparent', border: `1px solid ${v2.colors.border}`,
              color: v2.colors.text, cursor: 'pointer',
              fontSize: 11, fontWeight: 600, letterSpacing: '1.5px',
              textTransform: 'uppercase', fontFamily: 'inherit',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = v2.colors.bgCard; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <Share2 size={14} /> Share
          </button>
          <button
            onClick={() => downloadPriceListExcel(services)}
            disabled={services.length === 0}
            title="Download a formatted Excel workbook of all services"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 20px', borderRadius: v2.radius.button,
              background: 'transparent', border: `1px solid ${v2.colors.border}`,
              color: services.length === 0 ? v2.colors.textMuted : v2.colors.text,
              cursor: services.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: 11, fontWeight: 600, letterSpacing: '1.5px',
              textTransform: 'uppercase', fontFamily: 'inherit',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (services.length > 0) e.currentTarget.style.background = v2.colors.bgCard; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <Download size={14} /> Download Excel
          </button>
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

      {/* Share modal */}
      {showShare && (
        <PriceListShareModal
          createShare={createShare}
          onClose={() => setShowShare(false)}
          onCreated={share => { setShowShare(false); setNewShare(share); }}
        />
      )}

      {/* Generated link result */}
      {newShare && (
        <GeneratedLinkCard
          share={newShare}
          onClose={() => setNewShare(null)}
        />
      )}
    </div>
  );
}

// ─── Share modal ─────────────────────────────────────────────────────────────

function PriceListShareModal({ createShare, onClose, onCreated }: {
  createShare: (tabs: string[], title?: string, expiresAt?: string | null) => Promise<PriceListShare | null>;
  onClose: () => void;
  onCreated: (share: PriceListShare) => void;
}) {
  const v2 = theme.v2;
  const [selected, setSelected] = useState<Set<ServiceCategory>>(new Set(['Warehouse', 'Storage']));
  const [title, setTitle] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (cat: ServiceCategory) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(cat)) { if (next.size > 1) next.delete(cat); }
    else next.add(cat);
    return next;
  });

  const handleGenerate = async () => {
    setSaving(true); setErr(null);
    const tabs = SHAREABLE_CATEGORIES.filter(c => selected.has(c));
    const share = await createShare(tabs, title || undefined, expiresAt || null);
    setSaving(false);
    if (share) onCreated(share);
    else setErr('Failed to generate link — please try again.');
  };

  const inputStyle: React.CSSProperties = {
    padding: '10px 14px', borderRadius: v2.radius.input, fontFamily: 'inherit',
    border: `1px solid ${v2.colors.border}`, fontSize: 13,
    background: v2.colors.bgPage, outline: 'none', color: v2.colors.text, width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: v2.colors.bgWhite, borderRadius: v2.radius.card, padding: 32, width: '100%', maxWidth: 480, boxShadow: '0 24px 60px rgba(0,0,0,0.22)', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: v2.colors.text }}>Share Price List</div>
            <div style={{ fontSize: 13, color: v2.colors.textSecondary, marginTop: 4 }}>Select categories to include in the shareable link.</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: v2.colors.textMuted, padding: 4 }}><X size={18} /></button>
        </div>

        {/* Categories */}
        <div>
          <div style={{ ...v2.typography.label, marginBottom: 10 }}>Categories</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {SHAREABLE_CATEGORIES.map(cat => {
              const checked = selected.has(cat);
              return (
                <button key={cat} onClick={() => toggle(cat)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                  borderRadius: v2.radius.input, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                  background: checked ? 'rgba(232,105,42,0.08)' : v2.colors.bgPage,
                  border: `1px solid ${checked ? v2.colors.accent : v2.colors.border}`,
                  transition: 'all 0.15s',
                }}>
                  <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: checked ? v2.colors.accent : 'transparent', border: `2px solid ${checked ? v2.colors.accent : v2.colors.border}` }}>
                    {checked && <Check size={10} color="#fff" />}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: checked ? 600 : 400, color: checked ? v2.colors.text : v2.colors.textSecondary }}>{cat}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Disabled future toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: v2.radius.input, background: v2.colors.bgPage, border: `1px solid ${v2.colors.border}`, opacity: 0.5 }}>
          <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${v2.colors.border}` }} />
          <span style={{ fontSize: 13, color: v2.colors.textSecondary }}>Include zip code schedule</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, letterSpacing: '1px', color: v2.colors.textMuted, background: v2.colors.bgCard, padding: '2px 8px', borderRadius: 9999 }}>COMING SOON</span>
        </div>

        {/* Title */}
        <div>
          <label style={{ ...v2.typography.label, display: 'block', marginBottom: 6 }}>Custom title <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>(optional)</span></label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Stride Logistics — Price List" style={inputStyle} />
        </div>

        {/* Expiry */}
        <div>
          <label style={{ ...v2.typography.label, display: 'block', marginBottom: 6 }}>Expires <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>(leave blank = never)</span></label>
          <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} min={new Date().toISOString().slice(0, 10)} style={inputStyle} />
        </div>

        {err && <div style={{ padding: '10px 14px', borderRadius: v2.radius.input, background: 'rgba(180,90,90,0.10)', border: '1px solid rgba(180,90,90,0.3)', color: '#B45A5A', fontSize: 13 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: v2.radius.button, border: `1px solid ${v2.colors.border}`, background: 'transparent', color: v2.colors.textSecondary, fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={handleGenerate} disabled={saving || selected.size === 0} style={{ padding: '10px 24px', borderRadius: v2.radius.button, border: 'none', background: saving ? v2.colors.textMuted : v2.colors.accent, color: '#fff', fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            {saving ? 'Generating…' : 'Generate Link'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Generated link result card ───────────────────────────────────────────────

function GeneratedLinkCard({ share, onClose }: { share: PriceListShare; onClose: () => void }) {
  const v2 = theme.v2;
  const url = `${BASE_SHARE_URL}${share.shareId}`;
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: v2.colors.bgWhite, borderRadius: v2.radius.card, padding: 32, width: '100%', maxWidth: 480, boxShadow: '0 24px 60px rgba(0,0,0,0.22)', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(74,138,92,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Check size={18} color="#4A8A5C" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: v2.colors.text }}>Link generated</div>
            <div style={{ fontSize: 12, color: v2.colors.textSecondary, marginTop: 2 }}>
              {share.tabs.join(', ')}{share.expiresAt ? ` · Expires ${new Date(share.expiresAt).toLocaleDateString()}` : ' · Never expires'}
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 16px', borderRadius: v2.radius.input, background: v2.colors.bgPage, border: `1px solid ${v2.colors.border}`, fontSize: 13, color: v2.colors.textSecondary, wordBreak: 'break-all', lineHeight: 1.5 }}>
          {url}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={copy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: v2.radius.button, cursor: 'pointer', fontFamily: 'inherit', background: copied ? 'rgba(74,138,92,0.12)' : v2.colors.bgPage, border: `1px solid ${copied ? '#4A8A5C' : v2.colors.border}`, color: copied ? '#4A8A5C' : v2.colors.textSecondary, fontSize: 11, fontWeight: 600, letterSpacing: '1px', transition: 'all 0.2s' }}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'COPIED' : 'COPY LINK'}
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: v2.radius.button, textDecoration: 'none', background: v2.colors.bgPage, border: `1px solid ${v2.colors.border}`, color: v2.colors.textSecondary, fontSize: 11, fontWeight: 600, letterSpacing: '1px' }}>
            <X size={13} style={{ transform: 'rotate(45deg)' }} /> OPEN PREVIEW
          </a>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 24px', borderRadius: v2.radius.button, border: 'none', background: v2.colors.bgDark, color: v2.colors.textOnDark, fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' }}>Done</button>
        </div>
      </div>
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
