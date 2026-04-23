/**
 * EntityPage.tsx — Full-page entity detail shell (replaces slide-out TabbedDetailPanel
 * for direct-URL entity routes). Session 80 Entity Page Redesign.
 *
 * Layout and structure from the locked design spec:
 *  - Warm page background (theme.v2.colors.bgPage)
 *  - Dark tab bar (theme.v2.colors.bgDark) with orange active tab, notification dots
 *  - Sub-tab pills inside Photos/Notes/Activity
 *  - White content cards (theme.colors.bgCard)
 *  - Orange field labels (theme.colors.orange)
 *  - Slim sticky bottom bar (theme.v2.colors.bgDark)
 *
 * All colors come from the app theme — not hardcoded hex values.
 * NOT the same as TabbedDetailPanel (slide-out panel for list-page side panels).
 */
import React, { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '../../hooks/useIsMobile';
import { PhotosPanel, DocumentsPanel, NotesPanel } from './EntityAttachments';
import { EntityHistory } from './EntityHistory';
import { usePhotos, type EntityType as PhotoEntityType } from '../../hooks/usePhotos';
import { useDocuments, type DocumentContextType } from '../../hooks/useDocuments';
import { useEntityNotes } from '../../hooks/useEntityNotes';
import { theme } from '../../styles/theme';

// ── Design tokens (derived from app theme — no hardcoded hex) ─────────────────

const EP = {
  pageBg: theme.v2.colors.bgPage,            // warm cream — '#F5F2EE'
  tabBarBg: theme.v2.colors.bgDark,          // near-black — '#1C1C1C'
  tabActive: theme.colors.orange,            // brand orange — '#E85D2D'
  tabInactiveText: 'rgba(255,255,255,0.55)',  // muted white on dark
  tabActiveText: '#ffffff',
  cardBg: theme.colors.bgCard,               // white cards
  labelColor: theme.colors.orange,           // orange field labels
  footerBg: theme.v2.colors.bgDark,          // dark bottom bar
  footerPrimary: theme.colors.orange,        // primary CTA
  footerSecondaryBg: 'rgba(255,255,255,0.12)',
  footerText: '#ffffff',
  dotRed: theme.colors.statusRed,            // red notification dot
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EntityPageTab {
  id: string;
  label: string;
  /** Red dot shown on the tab button when true. */
  hasDot?: boolean;
  /** Orange count badge when > 0. */
  badgeCount?: number | null;
  /** Keep tab body mounted while inactive (e.g. Details with edit inputs). */
  keepMounted?: boolean;
  render: (ctx: { active: boolean }) => React.ReactNode;
}

interface RelatedNotesEntity {
  type: string;
  id: string;
  label?: string;
}

export interface EntityPageBuiltInTabs {
  photos?: {
    entityType: PhotoEntityType;
    entityId: string;
    itemId?: string | null;
    tenantId?: string | null;
    enableSourceFilter?: boolean;
  };
  docs?: {
    contextType: DocumentContextType;
    contextId: string;
    tenantId?: string | null;
  };
  notes?: {
    entityType: string;
    entityId: string;
    relatedEntities?: RelatedNotesEntity[];
    enableSourceFilter?: boolean;
    itemId?: string | null;
  };
  activity?:
    | { entityType: string; entityId: string; tenantId?: string | null }
    | { render: () => React.ReactNode };
}

export interface EntityPageConfig {
  // ── Header ───────────────────────────────────────────────────────────────
  /** Entity type label shown above the ID, e.g. "INVENTORY". */
  entityLabel: string;
  /** Primary ID displayed large in the header. */
  entityId: string;
  /** Status badge rendered inline with the ID. */
  statusBadge?: React.ReactNode;
  /** Client name line. */
  clientName?: string;
  /** Sidemark chip. */
  sidemark?: string;
  /** Small field pills row (Vendor, Class, Location…). */
  metaPills?: React.ReactNode;
  /** Right-side header actions slot (edit toggle, overflow menu). */
  headerActions?: React.ReactNode;
  /** Back navigation — defaults to browser history back. */
  backTo?: string;

  // ── Body ─────────────────────────────────────────────────────────────────
  tabs?: EntityPageTab[];
  builtInTabs?: EntityPageBuiltInTabs;
  initialTabId?: string;

  // ── Slots ─────────────────────────────────────────────────────────────────
  /** Between header and tab bar — banners, sync warnings. */
  statusStrip?: React.ReactNode;
  /** Sticky bottom bar content — if omitted the bar is hidden. */
  footer?: React.ReactNode;
}

// ── Built-in tab resolver ─────────────────────────────────────────────────────

function useBuiltInEntityTabs(cfg: EntityPageBuiltInTabs | undefined): EntityPageTab[] {
  const photosCfg = cfg?.photos;
  const docsCfg = cfg?.docs;
  const notesCfg = cfg?.notes;
  const activityCfg = cfg?.activity;

  const { photos } = usePhotos({
    entityType: (photosCfg?.entityType ?? 'inventory') as PhotoEntityType,
    entityId: photosCfg?.entityId ?? null,
    tenantId: photosCfg?.tenantId ?? null,
    itemId: photosCfg?.itemId ?? null,
    enabled: !!photosCfg?.entityId,
  });
  const { documents } = useDocuments({
    contextType: (docsCfg?.contextType ?? 'item') as DocumentContextType,
    contextId: docsCfg?.contextId ?? '',
    tenantId: docsCfg?.tenantId ?? null,
    enabled: !!docsCfg?.contextId,
  });
  const { notes } = useEntityNotes(
    notesCfg?.entityType ?? 'inventory',
    notesCfg?.entityId ?? ''
  );

  return useMemo(() => {
    const out: EntityPageTab[] = [];

    if (photosCfg) {
      out.push({
        id: 'photos',
        label: 'Photos',
        badgeCount: photos.length,
        render: () => (
          <PhotosPanel
            entityType={photosCfg.entityType}
            entityId={photosCfg.entityId}
            itemId={photosCfg.itemId ?? null}
            tenantId={photosCfg.tenantId ?? null}
            enableSourceFilter={photosCfg.enableSourceFilter}
          />
        ),
      });
    }

    if (docsCfg) {
      out.push({
        id: 'docs',
        label: 'Docs',
        badgeCount: documents.length,
        render: () => (
          <DocumentsPanel
            contextType={docsCfg.contextType}
            contextId={docsCfg.contextId}
            tenantId={docsCfg.tenantId ?? null}
          />
        ),
      });
    }

    if (notesCfg) {
      out.push({
        id: 'notes',
        label: 'Notes',
        badgeCount: notes.length,
        render: () => (
          <NotesPanel
            entityType={notesCfg.entityType}
            entityId={notesCfg.entityId}
            relatedEntities={notesCfg.relatedEntities}
            enableSourceFilter={notesCfg.enableSourceFilter}
            itemId={notesCfg.itemId ?? null}
          />
        ),
      });
    }

    if (activityCfg) {
      if ('render' in activityCfg) {
        out.push({
          id: 'activity',
          label: 'Activity',
          badgeCount: null,
          render: () => <>{activityCfg.render()}</>,
        });
      } else {
        out.push({
          id: 'activity',
          label: 'Activity',
          badgeCount: null,
          render: () => (
            <EntityHistory
              entityType={activityCfg.entityType}
              entityId={activityCfg.entityId}
              tenantId={activityCfg.tenantId}
            />
          ),
        });
      }
    }

    return out;
  }, [photosCfg, docsCfg, notesCfg, activityCfg, photos.length, documents.length, notes.length]);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TabButton({
  tab,
  active,
  onClick,
}: {
  tab: EntityPageTab;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      style={{
        position: 'relative',
        padding: '0 16px',
        height: 40,
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        fontFamily: 'inherit',
        letterSpacing: active ? '0.03em' : '0.02em',
        color: active ? EP.tabActiveText : EP.tabInactiveText,
        background: active ? EP.tabActive : 'transparent',
        border: 'none',
        borderRadius: 8,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        transition: 'background 0.15s, color 0.15s',
        flexShrink: 0,
      }}
    >
      {tab.label}

      {/* Count badge — only when active (orange) or inactive with count */}
      {tab.badgeCount != null && tab.badgeCount > 0 && (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 16,
          height: 16,
          borderRadius: 100,
          background: active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.15)',
          color: '#fff',
          fontSize: 9,
          fontWeight: 700,
          padding: '0 4px',
          lineHeight: 1,
        }}>
          {tab.badgeCount > 99 ? '99+' : tab.badgeCount}
        </span>
      )}

      {/* Red notification dot */}
      {tab.hasDot && (
        <span style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: EP.dotRed,
          border: `1.5px solid ${EP.tabBarBg}`,
        }} />
      )}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function EntityPage(props: EntityPageConfig) {
  const {
    entityLabel,
    entityId,
    statusBadge,
    clientName,
    sidemark,
    metaPills,
    headerActions,
    backTo,
    tabs: customTabs,
    builtInTabs,
    initialTabId,
    statusStrip,
    footer,
  } = props;

  const navigate = useNavigate();
  const { isMobile } = useIsMobile();

  const builtIn = useBuiltInEntityTabs(builtInTabs);

  // Merge custom + built-in tabs in order (same logic as TabbedDetailPanel)
  const finalTabs = useMemo(() => {
    const byId = new Map<string, EntityPageTab>();
    for (const t of builtIn) byId.set(t.id, t);

    const customs = customTabs ?? [];
    if (customs.length === 0) return [...builtIn];

    const out: EntityPageTab[] = [];
    const seen = new Set<string>();
    for (const t of customs) {
      const bi = byId.get(t.id);
      if (bi) {
        out.push({
          ...bi,
          label: t.label || bi.label,
          keepMounted: t.keepMounted ?? bi.keepMounted,
          badgeCount: t.badgeCount !== undefined ? t.badgeCount : bi.badgeCount,
          hasDot: t.hasDot ?? bi.hasDot,
        });
      } else {
        out.push(t);
      }
      seen.add(t.id);
    }
    for (const bi of builtIn) {
      if (!seen.has(bi.id)) out.push(bi);
    }
    return out;
  }, [customTabs, builtIn]);

  const [activeId, setActiveId] = useState<string>(() => {
    if (initialTabId && finalTabs.some(t => t.id === initialTabId)) return initialTabId;
    return finalTabs[0]?.id ?? '';
  });

  const handleBack = () => {
    if (backTo) navigate(backTo);
    else navigate(-1);
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100%',
      background: EP.pageBg,
      // Bleed into AppLayout margins (same trick as TaskJobPage)
      margin: '-28px -32px',
    }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        background: EP.pageBg,
        padding: isMobile ? '16px 16px 0' : '20px 28px 0',
        flexShrink: 0,
      }}>
        {/* Row 1: back + label + ID + status */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 6,
          flexWrap: 'wrap',
        }}>
          <button
            onClick={handleBack}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: theme.radii.md,
              border: `1px solid ${theme.colors.border}`,
              background: theme.colors.bgCard,
              color: theme.colors.textSecondary,
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.medium,
              cursor: 'pointer',
              fontFamily: 'inherit',
              flexShrink: 0,
            }}
          >
            <ArrowLeft size={13} />
            Back
          </button>

          <span style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            color: EP.labelColor,
            flexShrink: 0,
          }}>
            {entityLabel}
          </span>

          <span style={{
            fontSize: isMobile ? 18 : 22,
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.text,
            letterSpacing: '-0.02em',
            lineHeight: 1,
          }}>
            {entityId}
          </span>

          {statusBadge && <span style={{ flexShrink: 0 }}>{statusBadge}</span>}

          {/* Push header actions to the right */}
          {headerActions && (
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              {headerActions}
            </span>
          )}
        </div>

        {/* Row 2: client · sidemark · meta pills */}
        {(clientName || sidemark || metaPills) && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 14,
            fontSize: 12,
          }}>
            {clientName && (
              <span style={{ color: theme.colors.textSecondary, fontWeight: theme.typography.weights.medium }}>{clientName}</span>
            )}
            {clientName && sidemark && (
              <span style={{ color: theme.colors.textMuted }}>·</span>
            )}
            {sidemark && (
              <span style={{
                padding: '2px 8px',
                borderRadius: theme.radii.sm,
                background: theme.colors.orangeLight,
                color: theme.colors.primaryHover,
                fontSize: theme.typography.sizes.xs,
                fontWeight: theme.typography.weights.semibold,
              }}>
                {sidemark}
              </span>
            )}
            {metaPills && <>{metaPills}</>}
          </div>
        )}

        {statusStrip}
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────────── */}
      <div style={{
        background: EP.tabBarBg,
        display: 'flex',
        alignItems: 'center',
        padding: '6px 8px',
        gap: 2,
        flexShrink: 0,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        {finalTabs.map(tab => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            onClick={() => setActiveId(tab.id)}
          />
        ))}
      </div>

      {/* ── Tab body ───────────────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        padding: isMobile ? '12px 12px 80px' : '16px 20px 80px',
        overflowY: 'auto',
      }}>
        {finalTabs.map(tab => {
          const isActive = tab.id === activeId;
          if (!isActive && !tab.keepMounted) return null;
          return (
            <div
              key={tab.id}
              role="tabpanel"
              aria-hidden={!isActive}
              style={{ display: isActive ? 'block' : 'none' }}
            >
              {tab.render({ active: isActive })}
            </div>
          );
        })}
      </div>

      {/* ── Sticky bottom bar ──────────────────────────────────────────────── */}
      {footer && (
        <div style={{
          position: 'sticky',
          bottom: 0,
          background: EP.footerBg,
          padding: '0 16px',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          zIndex: 10,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}>
          {footer}
        </div>
      )}
    </div>
  );
}

// ── Helper exports ─────────────────────────────────────────────────────────────

/** Renders an orange field label (VENDOR, CLASS, etc.) */
export function EPLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weights.medium,
      letterSpacing: '1.5px',
      textTransform: 'uppercase',
      color: EP.labelColor,
      marginBottom: 3,
    }}>
      {children}
    </div>
  );
}

/** A white content card for use inside EntityPage tab bodies. */
export function EPCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      background: EP.cardBg,
      borderRadius: theme.radii.xl,
      padding: theme.spacing.lg,
      marginBottom: theme.spacing.md,
      boxShadow: theme.shadows.sm,
      ...style,
    }}>
      {children}
    </div>
  );
}

/** Footer button — primary (orange) or secondary (dark translucent). */
export function EPFooterButton({
  label,
  variant = 'primary',
  onClick,
  disabled,
  icon,
}: {
  label: string;
  variant?: 'primary' | 'secondary';
  onClick?: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: `0 ${theme.spacing.lg}`,
        height: 36,
        borderRadius: theme.radii.lg,
        border: 'none',
        fontFamily: 'inherit',
        fontSize: theme.typography.sizes.sm,
        fontWeight: theme.typography.weights.semibold,
        letterSpacing: '0.5px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        color: EP.footerText,
        background: variant === 'primary' ? EP.footerPrimary : EP.footerSecondaryBg,
        transition: `opacity ${theme.transitions.fast}`,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/** Design tokens re-exported for consumers who need them. */
export { EP as EntityPageTokens };
