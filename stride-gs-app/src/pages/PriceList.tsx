/**
 * PriceList — unified service catalog page (admin-only).
 *
 * Session 73 layout: split panel — category sidebar on the left, grouped
 * collapsible category sections on the right. Each service is a compact
 * row; clicking Edit expands the row inline (no slide-out panel). Stat
 * cards and global controls live above the split.
 *
 * Data: public.service_catalog via useServiceCatalog (Supabase Realtime).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Tag, Download, Share2, Check, Copy, X, UploadCloud, ChevronDown, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import { theme } from '../styles/theme';
import { useServiceCatalog, type CatalogService, type ServiceCategory } from '../hooks/useServiceCatalog';
import { ServiceRow } from '../components/pricelist/ServiceRow';
import { AddServiceModal } from '../components/pricelist/AddServiceModal';
import { ZipCodeTable } from '../components/pricelist/ZipCodeTable';
import { ClassesTable } from '../components/pricelist/ClassesTable';
import { CoverageTable } from '../components/pricelist/CoverageTable';
import { downloadPriceListExcel } from '../components/pricelist/exportPriceListExcel';
import { usePriceListShares, type PriceListShare } from '../hooks/usePriceListShares';
import { useDeliveryZones } from '../hooks/useDeliveryZones';
import { useItemClasses } from '../hooks/useItemClasses';
import { useCoverageOptions } from '../hooks/useCoverageOptions';
import { syncPriceListFromSupabase } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

// Persisted user prefs (per-email, mirrors useExpectedShipments's old pattern)
type SortKey = 'code' | 'name' | 'rate' | 'unit' | 'active';
type SortDir = 'asc' | 'desc';

interface PriceListPrefs {
  sortKey: SortKey;
  sortDir: SortDir;
  showInactive: boolean;
  collapsed: string[];
}

const DEFAULT_PREFS: PriceListPrefs = {
  sortKey: 'code',
  sortDir: 'asc',
  showInactive: false,
  collapsed: [],
};

function prefsKey(email: string) {
  return `stride_pricelist_prefs_${email || '_anon'}`;
}

function loadPrefs(email: string): PriceListPrefs {
  try {
    const raw = localStorage.getItem(prefsKey(email));
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<PriceListPrefs>;
    return {
      sortKey: parsed.sortKey ?? DEFAULT_PREFS.sortKey,
      sortDir: parsed.sortDir ?? DEFAULT_PREFS.sortDir,
      showInactive: parsed.showInactive ?? DEFAULT_PREFS.showInactive,
      collapsed: Array.isArray(parsed.collapsed) ? parsed.collapsed : [],
    };
  } catch { return DEFAULT_PREFS; }
}

function savePrefs(email: string, prefs: PriceListPrefs) {
  try { localStorage.setItem(prefsKey(email), JSON.stringify(prefs)); } catch { /* quota */ }
}

const ALL_CATEGORIES: ServiceCategory[] = [
  'Warehouse', 'Storage', 'Shipping', 'Assembly',
  'Repair', 'Labor', 'Admin', 'Delivery',
];

const SHAREABLE_CATEGORIES: ServiceCategory[] = [
  'Warehouse', 'Storage', 'Delivery', 'Fabric Protection',
  'Assembly', 'Repair', 'Labor', 'Admin',
];

// Sentinels appended to the tabs[] array on price_list_shares when an
// admin opts in to include an auxiliary section. PublicRates recognizes
// each and renders the matching table instead of a service list.
export const ZIP_TAB      = 'Zip Codes';
export const CLASSES_TAB  = 'Classes';
export const COVERAGE_TAB = 'Coverage';

const BASE_SHARE_URL = 'https://www.mystridehub.com/#/rates/';

// Pseudo-categories — these don't live in service_catalog. Each one
// swaps the right pane to its own table: delivery_zones, item_classes,
// or coverage_options.
const ZIP_CATEGORY      = 'Zip Codes' as const;
const CLASSES_CATEGORY  = 'Classes' as const;
const COVERAGE_CATEGORY = 'Coverage' as const;
type CategoryFilter = 'All' | ServiceCategory | typeof ZIP_CATEGORY | typeof CLASSES_CATEGORY | typeof COVERAGE_CATEGORY;

export function PriceList() {
  const v2 = theme.v2;
  const { user } = useAuth();
  const email = user?.email || '_anon';
  const { services, loading, error, createService, updateService, deleteService } = useServiceCatalog();
  const { zones: deliveryZones } = useDeliveryZones();
  const { classes: itemClasses } = useItemClasses();
  const { options: coverageOptions } = useCoverageOptions();
  const { createShare } = usePriceListShares();

  // Hydrate persisted prefs synchronously on first render so the UI never
  // flashes the defaults before localStorage loads.
  const initialPrefs = useRef<PriceListPrefs>(loadPrefs(email)).current;

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(initialPrefs.collapsed));
  const [sortKey, setSortKey] = useState<SortKey>(initialPrefs.sortKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialPrefs.sortDir);
  const [showInactive, setShowInactive] = useState(initialPrefs.showInactive);
  const [showAdd, setShowAdd] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [newShare, setNewShare] = useState<PriceListShare | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ kind: 'ok'; message: string } | { kind: 'err'; message: string } | null>(null);

  // If the auth email changes mid-session (impersonation, sign-out + sign-in),
  // re-hydrate from the new key so we don't accidentally write one user's prefs
  // under another user's key.
  const lastEmailRef = useRef(email);
  useEffect(() => {
    if (lastEmailRef.current !== email) {
      lastEmailRef.current = email;
      const next = loadPrefs(email);
      setSortKey(next.sortKey);
      setSortDir(next.sortDir);
      setShowInactive(next.showInactive);
      setCollapsed(new Set(next.collapsed));
    }
  }, [email]);

  // Persist on every relevant change.
  useEffect(() => {
    savePrefs(email, { sortKey, sortDir, showInactive, collapsed: Array.from(collapsed) });
  }, [email, sortKey, sortDir, showInactive, collapsed]);

  const handleSyncToSheet = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncResult(null);
    const res = await syncPriceListFromSupabase();
    setSyncing(false);
    if (res.ok && res.data) {
      const d = res.data;
      setSyncResult({ kind: 'ok', message: `Synced to Master Price List — ${d.updated} updated, ${d.appended} appended (${d.total_supabase} services)` });
    } else {
      setSyncResult({ kind: 'err', message: res.error || 'Sync failed' });
    }
    setTimeout(() => setSyncResult(null), 6000);
  };

  // Per-category counts for the sidebar
  const counts = useMemo(() => {
    const c: Record<string, number> = { All: services.length };
    for (const cat of ALL_CATEGORIES) c[cat] = 0;
    for (const s of services) c[s.category] = (c[s.category] ?? 0) + 1;
    return c;
  }, [services]);

  // Filtered + searched (Show Inactive applied here — when off, inactive rows
  // are completely removed from the list; when on, they're kept and dimmed
  // by ServiceRow's existing opacity rule).
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter(s => {
      if (!showInactive && !s.active) return false;
      if (categoryFilter !== 'All' && s.category !== categoryFilter) return false;
      if (q && !(s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [services, categoryFilter, search, showInactive]);

  // Compare two services by the active sort key. Always stable: ties fall
  // back to displayOrder so the list doesn't shuffle when sort values match.
  const compare = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return (a: CatalogService, b: CatalogService) => {
      let av: string | number = '';
      let bv: string | number = '';
      switch (sortKey) {
        case 'code':
          av = a.code.toLowerCase(); bv = b.code.toLowerCase(); break;
        case 'name':
          av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
        case 'rate':
          av = a.billing === 'flat' ? a.flatRate : (a.rates.XS ?? 0);
          bv = b.billing === 'flat' ? b.flatRate : (b.rates.XS ?? 0);
          break;
        case 'unit':
          av = a.unit; bv = b.unit; break;
        case 'active':
          av = a.active ? 0 : 1; bv = b.active ? 0 : 1; break;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return a.displayOrder - b.displayOrder;
    };
  }, [sortKey, sortDir]);

  // Group visible services by category, sorting each group by the active sort.
  const grouped = useMemo(() => {
    const map = new Map<string, CatalogService[]>();
    for (const s of visible) {
      const arr = map.get(s.category) ?? [];
      arr.push(s);
      map.set(s.category, arr);
    }
    const ordered: { category: string; services: CatalogService[] }[] = [];
    for (const cat of ALL_CATEGORIES) {
      const arr = map.get(cat);
      if (arr && arr.length) ordered.push({ category: cat, services: [...arr].sort(compare) });
      map.delete(cat);
    }
    for (const [cat, arr] of map) ordered.push({ category: cat, services: [...arr].sort(compare) });
    return ordered;
  }, [visible, compare]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Sensible default direction per column: most are ascending; for "Active"
      // ascending puts active rows first (active=0, inactive=1).
      setSortDir('asc');
    }
  };

  // Stats
  const stats = useMemo(() => {
    const total = services.length;
    const active = services.filter(s => s.active).length;
    const withTimes = services.filter(s =>
      Object.values(s.times).some(t => (t ?? 0) > 0)
    ).length;
    const distinctCategories = new Set(services.map(s => s.category)).size;
    return { total, active, withTimes, distinctCategories };
  }, [services]);

  const existingCodes = useMemo(() => new Set(services.map(s => s.code)), [services]);
  const nextDisplayOrder = useMemo(() => {
    if (services.length === 0) return 1;
    return Math.max(...services.map(s => s.displayOrder)) + 1;
  }, [services]);

  // Quick toggleActive — used by ActiveToggle in ServiceRow read mode.
  const toggleActive = async (id: string, active: boolean) => {
    await updateService(id, { active });
  };

  const toggleSection = (cat: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleEditClick = (id: string) => {
    setEditingId(prev => (prev === id ? null : id));
  };

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
          <button onClick={() => setShowShare(true)} style={ghostHeaderBtn(v2)}>
            <Share2 size={14} /> Share
          </button>
          <button
            onClick={handleSyncToSheet}
            disabled={syncing || services.length === 0}
            title="Push current Supabase rates to the Master Price List sheet so GAS billing sees them"
            style={{
              ...ghostHeaderBtn(v2),
              color: (syncing || services.length === 0) ? v2.colors.textMuted : v2.colors.text,
              cursor: (syncing || services.length === 0) ? 'not-allowed' : 'pointer',
            }}
          >
            <UploadCloud size={14} /> {syncing ? 'Syncing…' : 'Sync to Sheet'}
          </button>
          <button
            onClick={() => downloadPriceListExcel(services, deliveryZones, itemClasses, coverageOptions)}
            disabled={services.length === 0}
            title="Download a formatted Excel workbook of all services"
            style={{
              ...ghostHeaderBtn(v2),
              color: services.length === 0 ? v2.colors.textMuted : v2.colors.text,
              cursor: services.length === 0 ? 'not-allowed' : 'pointer',
            }}
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

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        <StatCard label="Total Services" value={stats.total} />
        <StatCard label="Active" value={stats.active} />
        <StatCard label="Categories" value={stats.distinctCategories} />
        <StatCard label="With Service Times" value={stats.withTimes} accent />
      </div>

      {/* Errors / Sync result */}
      {error && (
        <div style={{
          padding: '12px 16px', marginBottom: 16,
          background: 'rgba(180,90,90,0.1)', color: '#B45A5A',
          borderRadius: v2.radius.input, fontSize: 13,
        }}>{error}</div>
      )}
      {syncResult && (
        <div style={{
          padding: '12px 16px', marginBottom: 16,
          background: syncResult.kind === 'ok' ? 'rgba(74,138,92,0.12)' : 'rgba(180,90,90,0.10)',
          color: syncResult.kind === 'ok' ? '#4A8A5C' : '#B45A5A',
          border: `1px solid ${syncResult.kind === 'ok' ? 'rgba(74,138,92,0.3)' : 'rgba(180,90,90,0.3)'}`,
          borderRadius: v2.radius.input, fontSize: 13,
        }}>{syncResult.message}</div>
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
            <CategoryButton label="All services" count={counts.All} active={categoryFilter === 'All'} onClick={() => setCategoryFilter('All')} />
            {ALL_CATEGORIES.map(cat => (
              <CategoryButton
                key={cat}
                label={cat}
                count={counts[cat] ?? 0}
                active={categoryFilter === cat}
                onClick={() => setCategoryFilter(cat)}
              />
            ))}
            {/* Auxiliary sections — none of these live in service_catalog.
                Each swaps the right pane to its own table (item_classes /
                coverage_options / delivery_zones). Counts come from
                their dedicated hooks. */}
            <div style={{ height: 8 }} />
            <CategoryButton
              label={CLASSES_CATEGORY}
              count={itemClasses.length}
              active={categoryFilter === CLASSES_CATEGORY}
              onClick={() => setCategoryFilter(CLASSES_CATEGORY)}
            />
            <CategoryButton
              label={COVERAGE_CATEGORY}
              count={coverageOptions.length}
              active={categoryFilter === COVERAGE_CATEGORY}
              onClick={() => setCategoryFilter(COVERAGE_CATEGORY)}
            />
            <CategoryButton
              label={ZIP_CATEGORY}
              count={deliveryZones.length}
              active={categoryFilter === ZIP_CATEGORY}
              onClick={() => setCategoryFilter(ZIP_CATEGORY)}
            />
          </div>
        </aside>

        {/* Right pane */}
        <section style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Search + Show Inactive toggle */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
            <div style={{ position: 'relative', flex: 1 }}>
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
            <ShowInactiveToggle
              checked={showInactive}
              onChange={setShowInactive}
            />
          </div>

          {/* Sort header — applies only to the services list (aux sections use their own tables). */}
          {categoryFilter !== ZIP_CATEGORY && categoryFilter !== CLASSES_CATEGORY && categoryFilter !== COVERAGE_CATEGORY && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              padding: '10px 14px',
              background: v2.colors.bgCard,
              border: `1px solid ${v2.colors.border}`,
              borderRadius: v2.radius.input,
            }}>
              <span style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '2px',
                color: v2.colors.textMuted, textTransform: 'uppercase', marginRight: 4,
              }}>Sort by</span>
              <SortHeader label="Code"   active={sortKey === 'code'}   dir={sortDir} onClick={() => handleSort('code')} />
              <SortHeader label="Name"   active={sortKey === 'name'}   dir={sortDir} onClick={() => handleSort('name')} />
              <SortHeader label="Rate"   active={sortKey === 'rate'}   dir={sortDir} onClick={() => handleSort('rate')} />
              <SortHeader label="Unit"   active={sortKey === 'unit'}   dir={sortDir} onClick={() => handleSort('unit')} />
              <SortHeader label="Active" active={sortKey === 'active'} dir={sortDir} onClick={() => handleSort('active')} />
            </div>
          )}

          {/* Right pane content — aux section table, or grouped services list */}
          {categoryFilter === ZIP_CATEGORY ? (
            <ZipCodeTable search={search} />
          ) : categoryFilter === CLASSES_CATEGORY ? (
            <ClassesTable search={search} />
          ) : categoryFilter === COVERAGE_CATEGORY ? (
            <CoverageTable search={search} />
          ) : loading ? (
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 40 }}>
              {grouped.map(({ category, services: rows }) => {
                const isCollapsed = collapsed.has(category);
                return (
                  <section key={category} style={{
                    background: v2.colors.bgWhite,
                    border: `1px solid ${v2.colors.border}`,
                    borderRadius: v2.radius.card,
                    overflow: 'hidden',
                  }}>
                    {/* Collapsible header */}
                    <button
                      onClick={() => toggleSection(category)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                        padding: '14px 18px',
                        background: v2.colors.bgCard,
                        border: 'none', borderBottom: isCollapsed ? 'none' : `1px solid ${v2.colors.border}`,
                        cursor: 'pointer', fontFamily: 'inherit',
                        textAlign: 'left',
                      }}
                    >
                      {isCollapsed ? <ChevronRight size={14} color={v2.colors.textSecondary} /> : <ChevronDown size={14} color={v2.colors.textSecondary} />}
                      <span style={{
                        fontSize: 13, fontWeight: 600, letterSpacing: '0.5px',
                        color: v2.colors.text, textTransform: 'uppercase',
                      }}>{category}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        padding: '3px 9px', borderRadius: v2.radius.badge,
                        background: v2.colors.accent, color: '#fff',
                        fontVariantNumeric: 'tabular-nums',
                      }}>{rows.length}</span>
                    </button>

                    {/* Rows */}
                    {!isCollapsed && (
                      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {rows.map(s => (
                          <ServiceRow
                            key={s.id}
                            service={s}
                            editing={editingId === s.id}
                            onEditClick={() => handleEditClick(s.id)}
                            onCancel={() => setEditingId(null)}
                            onSave={updateService}
                            onDelete={deleteService}
                            onToggleActive={toggleActive}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </section>
      </div>

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
        <GeneratedLinkCard share={newShare} onClose={() => setNewShare(null)} />
      )}
    </div>
  );
}

// ─── Stat card ─────────────────────────────────────────────────────────
function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div style={{
      background: '#1C1C1C', color: '#fff',
      borderRadius: 20, padding: '20px 24px',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.5)',
      }}>{label}</div>
      <div style={{
        fontSize: 32, fontWeight: 300, marginTop: 6,
        color: accent ? '#E8692A' : '#fff', fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
    </div>
  );
}

// ─── Header ghost button helper ────────────────────────────────────────
function ghostHeaderBtn(v2: typeof theme.v2): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '10px 20px', borderRadius: v2.radius.button,
    background: 'transparent', border: `1px solid ${v2.colors.border}`,
    color: v2.colors.text, cursor: 'pointer',
    fontSize: 11, fontWeight: 600, letterSpacing: '1.5px',
    textTransform: 'uppercase', fontFamily: 'inherit',
    transition: 'background 0.15s',
  };
}

// ─── Share modal ─────────────────────────────────────────────────────────────

function PriceListShareModal({ createShare, onClose, onCreated }: {
  createShare: (tabs: string[], title?: string, expiresAt?: string | null) => Promise<PriceListShare | null>;
  onClose: () => void;
  onCreated: (share: PriceListShare) => void;
}) {
  const v2 = theme.v2;
  const [selected, setSelected] = useState<Set<ServiceCategory>>(new Set(['Warehouse', 'Storage']));
  const [includeZips, setIncludeZips] = useState(false);
  const [includeClasses, setIncludeClasses] = useState(false);
  const [includeCoverage, setIncludeCoverage] = useState(false);
  const [title, setTitle] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (cat: ServiceCategory) => setSelected(prev => {
    const next = new Set(prev);
    // Require at least one thing selected overall — service category, zip,
    // classes, or coverage tab.
    if (next.has(cat)) {
      if (next.size > 1 || includeZips || includeClasses || includeCoverage) next.delete(cat);
    }
    else next.add(cat);
    return next;
  });

  const handleGenerate = async () => {
    setSaving(true); setErr(null);
    const tabs: string[] = SHAREABLE_CATEGORIES.filter(c => selected.has(c));
    if (includeClasses)  tabs.push(CLASSES_TAB);
    if (includeCoverage) tabs.push(COVERAGE_TAB);
    if (includeZips)     tabs.push(ZIP_TAB);
    const share = await createShare(tabs, title || undefined, expiresAt || null);
    setSaving(false);
    if (share) onCreated(share);
    else setErr('Failed to generate link — please try again.');
  };

  const canGenerate = selected.size > 0 || includeZips || includeClasses || includeCoverage;

  const inputStyle: React.CSSProperties = {
    padding: '10px 14px', borderRadius: v2.radius.input, fontFamily: 'inherit',
    border: `1px solid ${v2.colors.border}`, fontSize: 13,
    background: v2.colors.bgPage, outline: 'none', color: v2.colors.text, width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: v2.colors.bgWhite, borderRadius: v2.radius.card, padding: 32, width: '100%', maxWidth: 480, boxShadow: '0 24px 60px rgba(0,0,0,0.22)', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: v2.colors.text }}>Share Price List</div>
            <div style={{ fontSize: 13, color: v2.colors.textSecondary, marginTop: 4 }}>Select categories to include in the shareable link.</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: v2.colors.textMuted, padding: 4 }}><X size={18} /></button>
        </div>

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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            onClick={() => setIncludeClasses(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              borderRadius: v2.radius.input, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              background: includeClasses ? 'rgba(232,105,42,0.08)' : v2.colors.bgPage,
              border: `1px solid ${includeClasses ? v2.colors.accent : v2.colors.border}`,
              transition: 'all 0.15s',
            }}
          >
            <div style={{
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: includeClasses ? v2.colors.accent : 'transparent',
              border: `2px solid ${includeClasses ? v2.colors.accent : v2.colors.border}`,
            }}>
              {includeClasses && <Check size={10} color="#fff" />}
            </div>
            <span style={{ fontSize: 13, fontWeight: includeClasses ? 600 : 400, color: includeClasses ? v2.colors.text : v2.colors.textSecondary }}>
              Include item classes (storage sizes)
            </span>
          </button>
          <button
            onClick={() => setIncludeCoverage(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              borderRadius: v2.radius.input, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              background: includeCoverage ? 'rgba(232,105,42,0.08)' : v2.colors.bgPage,
              border: `1px solid ${includeCoverage ? v2.colors.accent : v2.colors.border}`,
              transition: 'all 0.15s',
            }}
          >
            <div style={{
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: includeCoverage ? v2.colors.accent : 'transparent',
              border: `2px solid ${includeCoverage ? v2.colors.accent : v2.colors.border}`,
            }}>
              {includeCoverage && <Check size={10} color="#fff" />}
            </div>
            <span style={{ fontSize: 13, fontWeight: includeCoverage ? 600 : 400, color: includeCoverage ? v2.colors.text : v2.colors.textSecondary }}>
              Include coverage rates (handling + storage)
            </span>
          </button>
          <button
            onClick={() => setIncludeZips(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              borderRadius: v2.radius.input, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              background: includeZips ? 'rgba(232,105,42,0.08)' : v2.colors.bgPage,
              border: `1px solid ${includeZips ? v2.colors.accent : v2.colors.border}`,
              transition: 'all 0.15s',
            }}
          >
            <div style={{
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: includeZips ? v2.colors.accent : 'transparent',
              border: `2px solid ${includeZips ? v2.colors.accent : v2.colors.border}`,
            }}>
              {includeZips && <Check size={10} color="#fff" />}
            </div>
            <span style={{ fontSize: 13, fontWeight: includeZips ? 600 : 400, color: includeZips ? v2.colors.text : v2.colors.textSecondary }}>
              Include zip code schedule
            </span>
          </button>
        </div>

        <div>
          <label style={{ ...v2.typography.label, display: 'block', marginBottom: 6 }}>Custom title <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>(optional)</span></label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Stride Logistics — Price List" style={inputStyle} />
        </div>

        <div>
          <label style={{ ...v2.typography.label, display: 'block', marginBottom: 6 }}>Expires <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>(leave blank = never)</span></label>
          <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} min={new Date().toISOString().slice(0, 10)} style={inputStyle} />
        </div>

        {err && <div style={{ padding: '10px 14px', borderRadius: v2.radius.input, background: 'rgba(180,90,90,0.10)', border: '1px solid rgba(180,90,90,0.3)', color: '#B45A5A', fontSize: 13 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: v2.radius.button, border: `1px solid ${v2.colors.border}`, background: 'transparent', color: v2.colors.textSecondary, fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={handleGenerate} disabled={saving || !canGenerate} style={{ padding: '10px 24px', borderRadius: v2.radius.button, border: 'none', background: (saving || !canGenerate) ? v2.colors.textMuted : v2.colors.accent, color: '#fff', fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: (saving || !canGenerate) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
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

// ─── Sort header pill ──────────────────────────────────────────────────

function SortHeader({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  const v2 = theme.v2;
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '6px 12px', borderRadius: v2.radius.button,
        background: active ? v2.colors.accent : v2.colors.bgWhite,
        border: `1px solid ${active ? v2.colors.accent : v2.colors.border}`,
        color: active ? '#fff' : v2.colors.text,
        cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 10, fontWeight: 600, letterSpacing: '1.5px',
        textTransform: 'uppercase',
        transition: 'all 0.15s',
      }}
    >
      {label}
      {active && (dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </button>
  );
}

// ─── Show Inactive toggle ──────────────────────────────────────────────

function ShowInactiveToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const v2 = theme.v2;
  return (
    <button
      onClick={() => onChange(!checked)}
      title={checked ? 'Showing inactive services (dimmed)' : 'Inactive services hidden'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 10,
        padding: '0 16px', borderRadius: v2.radius.input,
        background: v2.colors.bgWhite,
        border: `1px solid ${checked ? v2.colors.accent : v2.colors.border}`,
        color: v2.colors.text, cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 11, fontWeight: 600, letterSpacing: '1.5px',
        textTransform: 'uppercase', whiteSpace: 'nowrap',
        transition: 'border-color 0.15s',
      }}
    >
      <span>Show Inactive</span>
      <div style={{
        position: 'relative', width: 30, height: 18,
        background: checked ? v2.colors.accent : '#D4D0CA',
        borderRadius: 100, transition: 'background 0.15s', flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', top: 2, left: checked ? 14 : 2,
          width: 14, height: 14, borderRadius: '50%', background: '#fff',
          transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </div>
    </button>
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
        border: 'none', cursor: 'pointer',
        fontSize: 13, fontWeight: active ? 500 : 400,
        fontFamily: 'inherit', textAlign: 'left',
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
