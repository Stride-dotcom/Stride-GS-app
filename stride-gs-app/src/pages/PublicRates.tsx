/**
 * PublicRates — no-auth shareable price list page.
 *
 * Rendered directly from App.tsx when the URL hash matches
 * #/rates/:shareId — bypasses auth entirely. Uses the Supabase
 * anon key, which is allowed by the price_list_shares and
 * service_catalog RLS policies.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchPublicShare, type PriceListShare } from '../hooks/usePriceListShares';
import type { CatalogService } from '../hooks/useServiceCatalog';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServiceRow {
  id: string; code: string; name: string; category: string;
  billing: string; rates: Record<string, number> | null;
  flat_rate: number | null; xxl_rate: number | null;
  unit: string; taxable: boolean; active: boolean; display_order: number;
}

// Mirror of the public-read columns on delivery_zones. anon RLS is
// restricted to active=true, so out-of-area rows are excluded from the
// public sheet by the database, not by the client.
interface ZoneRow {
  zip_code: string;
  city: string;
  service_days: string | null;
  updated_rate: string | number | null;
  base_rate: string | number | null;
  zone: string | null;
  call_for_quote: boolean | null;
}
interface PublicZone {
  zipCode: string;
  city: string;
  serviceDays: string;
  rate: number;
  zone: string;
  callForQuote: boolean;
}
function zoneRowToPublic(r: ZoneRow): PublicZone {
  const rateNum = (v: string | number | null): number => {
    if (v === null || v === undefined) return 0;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    zipCode: r.zip_code,
    city: r.city,
    serviceDays: r.service_days ?? '',
    rate: rateNum(r.updated_rate) || rateNum(r.base_rate),
    zone: r.zone ?? '',
    callForQuote: r.call_for_quote === true,
  };
}

// The sentinel tab names used when an admin opts in to include an
// auxiliary section. Must match the _TAB exports in PriceList.tsx.
const ZIP_TAB      = 'Zip Codes';
const CLASSES_TAB  = 'Classes';
const COVERAGE_TAB = 'Coverage';

interface ClassRow {
  id: string;
  name: string | null;
  storage_size: string | number | null;
  display_order: number | null;
}
interface PublicClass {
  id: string;
  name: string;
  storageSize: number;
}
function classRowToPublic(r: ClassRow): PublicClass {
  const n = r.storage_size == null
    ? 0
    : (typeof r.storage_size === 'number' ? r.storage_size : parseFloat(r.storage_size) || 0);
  return {
    id: r.id,
    name: r.name ?? '',
    storageSize: n,
  };
}

interface CoverageRow {
  id: string;
  name: string | null;
  calc_type: string | null;
  rate: string | number | null;
  note: string | null;
  display_order: number | null;
}
interface PublicCoverage {
  id: string;
  name: string;
  calcType: string;
  rate: number;
  note: string;
}
function coverageRowToPublic(r: CoverageRow): PublicCoverage {
  const n = r.rate == null ? 0 : (typeof r.rate === 'number' ? r.rate : parseFloat(r.rate) || 0);
  return {
    id: r.id,
    name: r.name ?? '',
    calcType: r.calc_type ?? 'flat',
    rate: n,
    note: r.note ?? '',
  };
}
function formatPublicCoverageRate(c: PublicCoverage): string {
  if (c.calcType === 'per_lb')           return `$${c.rate.toFixed(2)} / lb`;
  if (c.calcType === 'percent_declared') return `${c.rate.toFixed(2)}% of declared value`;
  if (c.calcType === 'flat')             return `$${c.rate.toFixed(2)} flat`;
  if (c.calcType === 'included')         return 'Included';
  return String(c.rate);
}

function rowToService(row: ServiceRow): CatalogService {
  const xxlRate = Number(row.xxl_rate ?? 0);
  const rawRates = (row.rates ?? {}) as Record<string, number>;
  return {
    id: row.id, code: row.code, name: row.name,
    category: row.category as CatalogService['category'],
    billing: row.billing as CatalogService['billing'],
    rates: {
      XS: rawRates.XS ?? 0, S: rawRates.S ?? 0, M: rawRates.M ?? 0,
      L: rawRates.L ?? 0, XL: rawRates.XL ?? 0,
      XXL: rawRates.XXL ?? xxlRate,
    },
    xxlRate,
    flatRate: Number(row.flat_rate ?? 0),
    unit: row.unit as CatalogService['unit'],
    taxable: row.taxable, active: row.active,
    showInMatrix: false, showAsTask: false, showAsDeliveryService: false,
    showAsReceivingAddon: false, autoApplyRule: null,
    defaultSlaHours: null, defaultPriority: null,
    hasDedicatedPage: false, displayOrder: row.display_order,
    billIfPass: true, billIfFail: true, times: {},
    staxItemId: null, qbItemId: null,
    deliveryRateUnit: 'flat', visibleToClient: true,
    description: '', quoteRequired: false,
    createdAt: '', updatedAt: '',
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CLASS_LABELS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;

function fmt(n: number) {
  return n === 0 ? '—' : `$${n.toFixed(2)}`;
}

function unitLabel(u: string) {
  switch (u) {
    case 'per_item': return 'per item';
    case 'per_day':  return 'per day';
    case 'per_task': return 'per task';
    case 'per_hour': return 'per hour';
    default: return u;
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BG_PAGE   = '#F5F2EE';
const BG_CARD   = '#FFFFFF';
const BG_DARK   = '#1C1C1C';
const ACCENT    = '#E8692A';
const TEXT      = '#1C1C1C';
const TEXT_MUT  = '#888888';
const BORDER    = 'rgba(0,0,0,0.07)';
const TH_BG     = '#F5F2EE';
const RADIUS    = '16px';
const FONT      = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Sub-components ───────────────────────────────────────────────────────────

function ServiceTable({ services }: { services: CatalogService[] }) {
  const hasClass = services.some(s => s.billing === 'class_based');

  const thStyle: React.CSSProperties = {
    padding: '10px 16px', fontSize: 10, fontWeight: 600, letterSpacing: '2px',
    textTransform: 'uppercase', color: TEXT_MUT, background: TH_BG,
    textAlign: 'left', borderBottom: `1px solid ${BORDER}`,
  };
  const tdStyle: React.CSSProperties = {
    padding: '13px 16px', fontSize: 13, color: TEXT,
    borderBottom: `1px solid ${BORDER}`,
  };
  const tdNum: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

  if (hasClass) {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              <th style={thStyle}>Service</th>
              <th style={thStyle}>Code</th>
              {CLASS_LABELS.map(cls => (
                <th key={cls} style={{ ...thStyle, textAlign: 'right' }}>{cls}</th>
              ))}
              <th style={{ ...thStyle, textAlign: 'right' }}>Unit</th>
            </tr>
          </thead>
          <tbody>
            {services.map(svc => (
              <tr key={svc.id} style={{ background: BG_CARD }}>
                <td style={{ ...tdStyle, fontWeight: 500 }}>{svc.name}</td>
                <td style={{ ...tdStyle, color: TEXT_MUT, fontFamily: 'monospace', fontSize: 12 }}>{svc.code}</td>
                {CLASS_LABELS.map(cls => (
                  <td key={cls} style={tdNum}>
                    {svc.billing === 'class_based'
                      ? fmt(svc.rates[cls] ?? 0)
                      : cls === 'XS' ? fmt(svc.flatRate) : <span style={{ color: TEXT_MUT }}>—</span>}
                  </td>
                ))}
                <td style={{ ...tdNum, color: TEXT_MUT }}>{unitLabel(svc.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Service</th>
            <th style={thStyle}>Code</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Rate</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Unit</th>
          </tr>
        </thead>
        <tbody>
          {services.map(svc => (
            <tr key={svc.id} style={{ background: BG_CARD }}>
              <td style={{ ...tdStyle, fontWeight: 500 }}>{svc.name}</td>
              <td style={{ ...tdStyle, color: TEXT_MUT, fontFamily: 'monospace', fontSize: 12 }}>{svc.code}</td>
              <td style={tdNum}>{fmt(svc.flatRate)}</td>
              <td style={{ ...tdNum, color: TEXT_MUT }}>{unitLabel(svc.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PublicZoneTable({ zones }: { zones: PublicZone[] }) {
  const [search, setSearch] = useState('');
  const filtered = zones.filter(z => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      z.zipCode.toLowerCase().includes(q) ||
      z.city.toLowerCase().includes(q) ||
      z.zone.toLowerCase().includes(q)
    );
  });
  const thStyle: React.CSSProperties = {
    padding: '10px 16px', fontSize: 10, fontWeight: 600, letterSpacing: '2px',
    textTransform: 'uppercase', color: TEXT_MUT, background: TH_BG,
    textAlign: 'left', borderBottom: `1px solid ${BORDER}`,
  };
  const tdStyle: React.CSSProperties = {
    padding: '11px 16px', fontSize: 13, color: TEXT,
    borderBottom: `1px solid ${BORDER}`,
  };
  const tdNum: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  return (
    <div>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${BORDER}`, background: BG_CARD }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search zip, city, or zone…"
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '10px 14px', fontSize: 13, fontFamily: FONT,
            border: `1px solid ${BORDER}`, borderRadius: 10,
            background: BG_PAGE, outline: 'none', color: TEXT,
          }}
        />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              <th style={thStyle}>Zip</th>
              <th style={thStyle}>City</th>
              <th style={thStyle}>Service Days</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Rate</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Zone</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: TEXT_MUT }}>No zones match.</td></tr>
            ) : filtered.map(z => (
              <tr key={z.zipCode} style={{ background: BG_CARD }}>
                <td style={{ ...tdStyle, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{z.zipCode}</td>
                <td style={tdStyle}>{z.city}</td>
                <td style={{ ...tdStyle, color: TEXT_MUT, fontSize: 12 }}>{z.serviceDays || '—'}</td>
                <td style={tdNum}>{z.callForQuote ? <span style={{ color: ACCENT, fontWeight: 600 }}>Call for Quote</span> : (z.rate > 0 ? `$${z.rate}` : '—')}</td>
                <td style={{ ...tdStyle, textAlign: 'center', color: TEXT_MUT, fontSize: 12 }}>{z.zone || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PublicClassesTable({ classes }: { classes: PublicClass[] }) {
  const thStyle: React.CSSProperties = {
    padding: '10px 16px', fontSize: 10, fontWeight: 600, letterSpacing: '2px',
    textTransform: 'uppercase', color: TEXT_MUT, background: TH_BG,
    textAlign: 'left', borderBottom: `1px solid ${BORDER}`,
  };
  const tdStyle: React.CSSProperties = {
    padding: '11px 16px', fontSize: 13, color: TEXT,
    borderBottom: `1px solid ${BORDER}`,
  };
  const tdNum: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  return (
    <div>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${BORDER}`, background: BG_CARD, fontSize: 12, color: TEXT_MUT }}>
        Storage billing uses the <strong style={{ color: TEXT }}>STOR rate × storage size × qty</strong> formula. The size column is the cubic-foot figure applied to each item's class.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Class</th>
              <th style={thStyle}>Name</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Storage Size</th>
            </tr>
          </thead>
          <tbody>
            {classes.map(c => (
              <tr key={c.id} style={{ background: BG_CARD }}>
                <td style={{ ...tdStyle, fontWeight: 700, letterSpacing: '0.5px' }}>{c.id}</td>
                <td style={tdStyle}>{c.name || '—'}</td>
                <td style={tdNum}>{c.storageSize > 0 ? `${c.storageSize} cu ft` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PublicCoverageTable({ coverage }: { coverage: PublicCoverage[] }) {
  const thStyle: React.CSSProperties = {
    padding: '10px 16px', fontSize: 10, fontWeight: 600, letterSpacing: '2px',
    textTransform: 'uppercase', color: TEXT_MUT, background: TH_BG,
    textAlign: 'left', borderBottom: `1px solid ${BORDER}`,
  };
  const tdStyle: React.CSSProperties = {
    padding: '12px 16px', fontSize: 13, color: TEXT,
    borderBottom: `1px solid ${BORDER}`,
    verticalAlign: 'top',
  };
  return (
    <div>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${BORDER}`, background: BG_CARD, fontSize: 12, color: TEXT_MUT, lineHeight: 1.55 }}>
        Two separate coverages. <strong style={{ color: TEXT }}>Handling valuation</strong> is elected per shipment — default is Standard. <strong style={{ color: TEXT }}>Storage coverage</strong> is monthly. See each row's details for full terms.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Coverage</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Rate</th>
              <th style={thStyle}>Details</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map(c => (
              <tr key={c.id} style={{ background: BG_CARD }}>
                <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>{c.name || '—'}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {formatPublicCoverageRate(c)}
                </td>
                <td style={{ ...tdStyle, color: TEXT_MUT, fontSize: 12, lineHeight: 1.55 }}>{c.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { shareId: string }

export function PublicRates({ shareId }: Props) {
  const [share, setShare] = useState<PriceListShare | null>(null);
  const [services, setServices] = useState<CatalogService[]>([]);
  const [zones, setZones] = useState<PublicZone[]>([]);
  const [classes, setClasses] = useState<PublicClass[]>([]);
  const [coverage, setCoverage] = useState<PublicCoverage[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [status, setStatus] = useState<'loading' | 'unavailable' | 'ready'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await fetchPublicShare(shareId);
      if (cancelled) return;
      if (!s) { setStatus('unavailable'); return; }
      setShare(s);

      // Service tabs are every entry except the aux sentinels.
      const serviceCategories = s.tabs.filter(t => t !== ZIP_TAB && t !== CLASSES_TAB && t !== COVERAGE_TAB);
      const includeZips     = s.tabs.includes(ZIP_TAB);
      const includeClasses  = s.tabs.includes(CLASSES_TAB);
      const includeCoverage = s.tabs.includes(COVERAGE_TAB);

      const svcPromise: Promise<{ data: ServiceRow[] | null; error: unknown }> =
        serviceCategories.length > 0
          ? (supabase
              .from('service_catalog')
              .select('id,code,name,category,billing,rates,flat_rate,xxl_rate,unit,taxable,active,display_order')
              .in('category', serviceCategories)
              .eq('active', true)
              .order('display_order', { ascending: true }) as unknown as Promise<{ data: ServiceRow[] | null; error: unknown }>)
          : Promise.resolve({ data: [] as ServiceRow[], error: null });
      const zonePromise: Promise<{ data: ZoneRow[] | null; error: unknown }> =
        includeZips
          ? (supabase
              .from('delivery_zones')
              .select('zip_code,city,service_days,updated_rate,base_rate,zone,call_for_quote')
              .eq('active', true)
              .order('zip_code', { ascending: true }) as unknown as Promise<{ data: ZoneRow[] | null; error: unknown }>)
          : Promise.resolve({ data: [] as ZoneRow[], error: null });
      const classPromise: Promise<{ data: ClassRow[] | null; error: unknown }> =
        includeClasses
          ? (supabase
              .from('item_classes')
              .select('id,name,storage_size,display_order')
              .eq('active', true)
              .order('display_order', { ascending: true }) as unknown as Promise<{ data: ClassRow[] | null; error: unknown }>)
          : Promise.resolve({ data: [] as ClassRow[], error: null });
      const coveragePromise: Promise<{ data: CoverageRow[] | null; error: unknown }> =
        includeCoverage
          ? (supabase
              .from('coverage_options')
              .select('id,name,calc_type,rate,note,display_order')
              .eq('active', true)
              .order('display_order', { ascending: true }) as unknown as Promise<{ data: CoverageRow[] | null; error: unknown }>)
          : Promise.resolve({ data: [] as CoverageRow[], error: null });
      const [svcRes, zoneRes, classRes, covRes] = await Promise.all([svcPromise, zonePromise, classPromise, coveragePromise]);
      if (cancelled) return;
      if (svcRes.error) { setStatus('unavailable'); return; }
      setServices(((svcRes.data ?? []) as ServiceRow[]).map(rowToService));
      setZones(((zoneRes.data ?? []) as ZoneRow[]).map(zoneRowToPublic));
      setClasses(((classRes.data ?? []) as ClassRow[]).map(classRowToPublic));
      setCoverage(((covRes.data ?? []) as CoverageRow[]).map(coverageRowToPublic));
      setActiveTab(s.tabs[0] ?? '');
      setStatus('ready');
    })();
    return () => { cancelled = true; };
  }, [shareId]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div style={{ fontFamily: FONT, minHeight: '100vh', background: BG_PAGE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: TEXT_MUT, fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  // ── Unavailable ────────────────────────────────────────────────────────────
  if (status === 'unavailable' || !share) {
    return (
      <div style={{ fontFamily: FONT, minHeight: '100vh', background: BG_PAGE, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <div style={{ fontSize: 32, color: TEXT_MUT }}>🔒</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: TEXT }}>This link is no longer available</div>
        <div style={{ fontSize: 14, color: TEXT_MUT }}>The price list link may have expired or been deactivated.</div>
        <a href="https://www.stridenw.com" style={{ marginTop: 8, color: ACCENT, textDecoration: 'none', fontSize: 14 }}>Visit stridenw.com</a>
      </div>
    );
  }

  // ── Ready ──────────────────────────────────────────────────────────────────
  const isZipTab      = activeTab === ZIP_TAB;
  const isClassesTab  = activeTab === CLASSES_TAB;
  const isCoverageTab = activeTab === COVERAGE_TAB;
  const isAuxTab      = isZipTab || isClassesTab || isCoverageTab;
  const tabServices   = isAuxTab ? [] : services.filter(s => s.category === activeTab);
  const multiTab     = share.tabs.length > 1;

  return (
    <div style={{ fontFamily: FONT, minHeight: '100vh', background: BG_PAGE, display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{ background: BG_DARK, padding: '0 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src="https://www.mystridehub.com/stride-logo.png" alt="Stride" style={{ height: 36, width: 36, objectFit: 'contain' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '2px', color: '#FFFFFF', lineHeight: 1.1 }}>STRIDE</div>
              <div style={{ fontSize: 9, fontWeight: 400, letterSpacing: '5px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', lineHeight: 1 }}>LOGISTICS</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#FFFFFF', letterSpacing: '0.5px' }}>{share.title}</div>
            {share.expiresAt && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                Expires {new Date(share.expiresAt).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main style={{ flex: 1, maxWidth: 960, width: '100%', margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Tab bar — only shown when multiple categories selected */}
        {multiTab && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {share.tabs.map(tab => {
              const active = tab === activeTab;
              return (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  padding: '9px 20px', borderRadius: 9999,
                  background: active ? BG_DARK : BG_CARD,
                  color: active ? '#FFFFFF' : TEXT_MUT,
                  border: active ? 'none' : `1px solid ${BORDER}`,
                  fontSize: 11, fontWeight: 600, letterSpacing: '1.5px',
                  textTransform: 'uppercase', cursor: 'pointer', fontFamily: FONT,
                  transition: 'all 0.15s',
                }}>
                  {tab}
                </button>
              );
            })}
          </div>
        )}

        {/* Service table card — or zip table when active tab is Zip Codes */}
        <div style={{ background: BG_CARD, borderRadius: RADIUS, border: `1px solid ${BORDER}`, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
          {/* Card header */}
          <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: ACCENT, marginBottom: 4 }}>
                {activeTab}
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: TEXT }}>
                {isZipTab ? 'Delivery Zones' : isClassesTab ? 'Item Classes' : isCoverageTab ? 'Coverage Options' : `${activeTab} Services`}
              </div>
            </div>
            <div style={{ fontSize: 12, color: TEXT_MUT }}>
              {isZipTab
                ? `${zones.length} zone${zones.length !== 1 ? 's' : ''}`
                : isClassesTab
                  ? `${classes.length} class${classes.length !== 1 ? 'es' : ''}`
                  : isCoverageTab
                    ? `${coverage.length} option${coverage.length !== 1 ? 's' : ''}`
                    : `${tabServices.length} service${tabServices.length !== 1 ? 's' : ''}`
              }
            </div>
          </div>

          {isZipTab ? (
            zones.length === 0 ? (
              <div style={{ padding: '40px 24px', textAlign: 'center', color: TEXT_MUT, fontSize: 14 }}>
                No zones available.
              </div>
            ) : (
              <PublicZoneTable zones={zones} />
            )
          ) : isClassesTab ? (
            classes.length === 0 ? (
              <div style={{ padding: '40px 24px', textAlign: 'center', color: TEXT_MUT, fontSize: 14 }}>
                No classes available.
              </div>
            ) : (
              <PublicClassesTable classes={classes} />
            )
          ) : isCoverageTab ? (
            coverage.length === 0 ? (
              <div style={{ padding: '40px 24px', textAlign: 'center', color: TEXT_MUT, fontSize: 14 }}>
                No coverage options available.
              </div>
            ) : (
              <PublicCoverageTable coverage={coverage} />
            )
          ) : tabServices.length === 0 ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: TEXT_MUT, fontSize: 14 }}>
              No services listed for this category.
            </div>
          ) : (
            <ServiceTable services={tabServices} />
          )}
        </div>

        {/* Class size legend for class-based tables (not shown on aux tabs) */}
        {!isAuxTab && tabServices.some(s => s.billing === 'class_based') && (
          <div style={{ background: BG_CARD, borderRadius: RADIUS, border: `1px solid ${BORDER}`, padding: '16px 24px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: TEXT_MUT, marginBottom: 12 }}>Size Guide</div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {[
                { cls: 'XS', desc: 'Extra Small', cuft: '≤10 cu ft' },
                { cls: 'S',  desc: 'Small',       cuft: '11–25 cu ft' },
                { cls: 'M',  desc: 'Medium',       cuft: '26–50 cu ft' },
                { cls: 'L',  desc: 'Large',        cuft: '51–75 cu ft' },
                { cls: 'XL', desc: 'Extra Large',  cuft: '76–110 cu ft' },
                { cls: 'XXL', desc: 'XXL',         cuft: '111+ cu ft' },
              ].map(({ cls, desc, cuft }) => (
                <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 4, background: 'rgba(232,105,42,0.12)', color: ACCENT, fontSize: 11, fontWeight: 700 }}>{cls}</span>
                  <span style={{ fontSize: 12, color: TEXT_MUT }}>{desc} · {cuft}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pricing note */}
        <p style={{ fontSize: 12, color: TEXT_MUT, textAlign: 'center', margin: 0, lineHeight: 1.6 }}>
          Prices are subject to change. Contact Stride Logistics for a custom quote or volume pricing.
        </p>
      </main>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${BORDER}`, padding: '20px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: TEXT_MUT }}>Stride Logistics · Kent, WA</span>
          <span style={{ color: BORDER }}>·</span>
          <a href="https://www.stridenw.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: ACCENT, textDecoration: 'none' }}>stridenw.com</a>
          <span style={{ color: BORDER }}>·</span>
          <a href="mailto:info@stridenw.com" style={{ fontSize: 12, color: TEXT_MUT, textDecoration: 'none' }}>info@stridenw.com</a>
        </div>
      </footer>

      {/* Print styles */}
      <style>{`
        @media print {
          header { background: #1C1C1C !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          button { display: none !important; }
        }
      `}</style>
    </div>
  );
}
