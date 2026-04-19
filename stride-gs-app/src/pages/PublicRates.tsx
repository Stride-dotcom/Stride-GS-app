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

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { shareId: string }

export function PublicRates({ shareId }: Props) {
  const [share, setShare] = useState<PriceListShare | null>(null);
  const [services, setServices] = useState<CatalogService[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [status, setStatus] = useState<'loading' | 'unavailable' | 'ready'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await fetchPublicShare(shareId);
      if (cancelled) return;
      if (!s) { setStatus('unavailable'); return; }
      setShare(s);

      const { data, error } = await supabase
        .from('service_catalog')
        .select('id,code,name,category,billing,rates,flat_rate,xxl_rate,unit,taxable,active,display_order')
        .in('category', s.tabs)
        .eq('active', true)
        .order('display_order', { ascending: true });

      if (cancelled) return;
      if (error) { setStatus('unavailable'); return; }
      setServices(((data ?? []) as ServiceRow[]).map(rowToService));
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
  const tabServices = services.filter(s => s.category === activeTab);
  const multiTab = share.tabs.length > 1;

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

        {/* Service table card */}
        <div style={{ background: BG_CARD, borderRadius: RADIUS, border: `1px solid ${BORDER}`, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
          {/* Card header */}
          <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: ACCENT, marginBottom: 4 }}>
                {activeTab}
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: TEXT }}>
                {activeTab} Services
              </div>
            </div>
            <div style={{ fontSize: 12, color: TEXT_MUT }}>
              {tabServices.length} service{tabServices.length !== 1 ? 's' : ''}
            </div>
          </div>

          {tabServices.length === 0 ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: TEXT_MUT, fontSize: 14 }}>
              No services listed for this category.
            </div>
          ) : (
            <ServiceTable services={tabServices} />
          )}
        </div>

        {/* Class size legend for class-based tables */}
        {tabServices.some(s => s.billing === 'class_based') && (
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
