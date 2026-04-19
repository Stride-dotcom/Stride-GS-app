/**
 * ServiceCard — read-only summary card for a service_catalog row.
 * Click the card to open the ServiceEditPanel.
 */
import { theme } from '../../styles/theme';
import type { CatalogService } from '../../hooks/useServiceCatalog';

interface ServiceCardProps {
  service: CatalogService;
  onClick: () => void;
}

const CLASSES = ['XS', 'S', 'M', 'L', 'XL'] as const;

function formatUSD(n: number): string {
  if (n === 0) return '—';
  return n < 1
    ? `$${n.toFixed(2)}`
    : `$${Math.round(n * 100) / 100}`;
}

function unitLabel(unit: CatalogService['unit']): string {
  return unit === 'per_item' ? '/ item'
    : unit === 'per_day' ? '/ day'
    : unit === 'per_task' ? '/ task'
    : '/ hour';
}

export function ServiceCard({ service, onClick }: ServiceCardProps) {
  const v2 = theme.v2;
  const tags: { label: string; bg: string; color: string }[] = [];
  if (!service.active)               tags.push({ label: 'Inactive',  bg: 'rgba(140,140,140,0.15)', color: '#666' });
  if (service.showInMatrix)          tags.push({ label: 'Matrix',    bg: v2.colors.statusAccepted.bg, color: v2.colors.statusAccepted.text });
  if (service.showAsTask)            tags.push({ label: 'Task',      bg: v2.colors.statusSent.bg,     color: v2.colors.statusSent.text });
  if (service.showAsDeliveryService) tags.push({ label: 'Delivery',  bg: v2.colors.statusDraft.bg,    color: v2.colors.statusDraft.text });
  if (service.showAsReceivingAddon)  tags.push({ label: 'Rcv Add-on', bg: v2.colors.accentLight,      color: v2.colors.accent });
  if (service.hasDedicatedPage)      tags.push({ label: 'Own Page',  bg: v2.colors.statusExpired.bg,  color: v2.colors.statusExpired.text });
  if (!service.taxable)              tags.push({ label: 'Non-taxable', bg: 'rgba(180,90,90,0.10)',    color: '#B45A5A' });

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: v2.colors.bgWhite,
        border: `1px solid ${v2.colors.border}`,
        borderRadius: v2.radius.card,
        padding: '20px 24px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        width: '100%',
        opacity: service.active ? 1 : 0.6,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = v2.colors.accent;
        e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = v2.colors.border;
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Code + Name */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ ...v2.typography.label, marginBottom: 4 }}>{service.code}</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: v2.colors.text, lineHeight: 1.25 }}>
            {service.name}
          </div>
        </div>
        <div style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase',
          padding: '4px 10px', borderRadius: v2.radius.badge,
          background: v2.colors.bgCard, color: v2.colors.textSecondary, whiteSpace: 'nowrap',
        }}>
          {service.category}
        </div>
      </div>

      {/* Rates */}
      {service.billing === 'class_based' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {CLASSES.map(cls => (
            <div key={cls} style={{
              background: v2.colors.bgCard,
              borderRadius: v2.radius.chip,
              padding: '8px 4px',
              textAlign: 'center',
            }}>
              <div style={{ ...v2.typography.label, fontSize: 9, marginBottom: 2 }}>{cls}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: v2.colors.text, fontVariantNumeric: 'tabular-nums' }}>
                {formatUSD(service.rates[cls] ?? 0)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          background: v2.colors.bgCard,
          borderRadius: v2.radius.chip,
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
        }}>
          <span style={{ fontSize: 20, fontWeight: 300, color: v2.colors.text, fontVariantNumeric: 'tabular-nums' }}>
            {service.flatRate > 0 ? `$${service.flatRate}` : '—'}
          </span>
          <span style={{ fontSize: 11, color: v2.colors.textMuted }}>
            {unitLabel(service.unit)}
          </span>
        </div>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tags.map(t => (
            <span key={t.label} style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.5px',
              padding: '3px 8px', borderRadius: v2.radius.badge,
              background: t.bg, color: t.color, textTransform: 'uppercase',
            }}>
              {t.label}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
