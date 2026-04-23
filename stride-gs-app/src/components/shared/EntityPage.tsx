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

// All colors/typography pulled from theme.v2 to match the Dashboard aesthetic.
const EP = {
  pageBg: theme.v2.colors.bgPage,                 // #F5F2EE — warm cream
  tabPillContainerBg: theme.v2.colors.bgWhite,    // white pill container holding tabs
  tabActive: theme.v2.colors.bgDark,              // #1C1C1C — active pill (matches Dashboard)
  tabActiveText: theme.v2.colors.textOnDark,      // #FFFFFF
  tabInactiveText: theme.v2.colors.textMuted,     // #999
  bodyCardBg: theme.v2.colors.bgCard,             // #EDE9E3 — same as Dashboard content card
  innerCardBg: theme.v2.colors.bgWhite,           // white inner sections
  cardBorder: theme.v2.colors.border,             // rgba(0,0,0,0.08)
  labelColor: theme.v2.colors.accent,             // #E8692A — orange field labels
  textPrimary: theme.v2.colors.text,              // #1C1C1C
  textSecondary: theme.v2.colors.textSecondary,   // #666
  textMuted: theme.v2.colors.textMuted,           // #999
  accent: theme.v2.colors.accent,                 // #E8692A orange
  footerBg: theme.v2.colors.bgWhite,              // white bottom bar
  footerBorder: theme.v2.colors.border,
  footerPrimary: theme.v2.colors.accent,          // orange primary pill
  footerSecondaryBg: theme.v2.colors.bgDark,      // dark secondary pill
  footerText: theme.v2.colors.textOnDark,
  dotRed: theme.colors.statusRed,
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
  render?: (ctx: { active: boolean }) => React.ReactNode;
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
              tenantId={activityCfg.tenantId ?? undefined}
            />
          ),
        });
      }
    }

    return out;
  }, [photosCfg, docsCfg, notesCfg, activityCfg, photos.length, documents.length, notes.length]);
}

// ── Sub-components ────────────────────────────────────────────────────────────

// Tab is a segmented pill (matches Dashboard's Calendar/Overview + Tasks/Repairs/WC pattern).
function TabButton({
  tab,
  active,
  onClick,
  compact,
}: {
  tab: EntityPageTab;
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: compact ? '7px 14px' : '9px 20px',
        fontSize: compact ? 10 : 12,
        fontWeight: 600,
        fontFamily: 'inherit',
        letterSpacing: '1.5px',
        textTransform: 'uppercase',
        color: active ? EP.tabActiveText : EP.tabInactiveText,
        background: active ? EP.tabActive : 'transparent',
        border: 'none',
        borderRadius: 100,  // pill
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all 0.2s',
        flexShrink: 0,
      }}
    >
      {tab.label}

      {/* Count badge — inline rounded chip (Dashboard style) */}
      {tab.badgeCount != null && tab.badgeCount > 0 && (
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 100,
          background: active ? '#fff' : 'rgba(0,0,0,0.06)',
          color: active ? EP.textPrimary : EP.textSecondary,
          letterSpacing: 0,
          minWidth: 18,
          textAlign: 'center',
          lineHeight: 1.2,
        }}>
          {tab.badgeCount > 99 ? '99+' : tab.badgeCount}
        </span>
      )}

      {/* Red notification dot */}
      {tab.hasDot && (
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: EP.dotRed,
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
    // sidemark + metaPills intentionally ignored by the new shell per the
    // v4 redesign spec — the header is now just back · label · ID · badge · actions.
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
      // Bleed into AppLayout margins (matches Dashboard pattern).
      margin: '-28px -32px',
      padding: isMobile ? '16px 16px 96px' : '28px 32px 96px',
      background: EP.pageBg,
      minHeight: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: isMobile ? 16 : 20,
    }}>

      {/* ── Header (Dashboard typography: tracked-out uppercase title) ────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={handleBack}
            aria-label="Back"
            style={{
              width: 34, height: 34,
              borderRadius: '50%',
              border: `1px solid ${EP.cardBorder}`,
              background: EP.innerCardBg,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontFamily: 'inherit',
              flexShrink: 0,
              color: EP.textSecondary,
            }}
          >
            <ArrowLeft size={15} />
          </button>

          {/* "INVENTORY · 62697" — matches "STRIDE LOGISTICS · DASHBOARD" cadence */}
          <div style={{
            fontSize: isMobile ? 16 : 20,
            fontWeight: 700,
            letterSpacing: '2px',
            color: EP.textPrimary,
            textTransform: 'uppercase',
            display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <span style={{ color: EP.accent }}>{entityLabel}</span>
            <span style={{ color: EP.textMuted }}>·</span>
            <span style={{ letterSpacing: '1px' }}>{entityId}</span>
          </div>

          {statusBadge && <span style={{ flexShrink: 0 }}>{statusBadge}</span>}
        </div>

        {headerActions && (
          <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {headerActions}
          </div>
        )}
      </div>

      {/* Client name — bigger + bold, matches Dashboard subhead weight */}
      {clientName && (
        <div style={{
          fontSize: isMobile ? 14 : 15,
          fontWeight: 700,
          color: EP.textPrimary,
          letterSpacing: '0.2px',
          marginTop: -8,
          paddingLeft: 46, // under the back circle
        }}>
          {clientName}
        </div>
      )}

      {statusStrip}

      {/* ── Tab pill strip (white container, inner pills — Dashboard pattern) */}
      <div style={{
        display: 'inline-flex',
        gap: 0,
        background: EP.tabPillContainerBg,
        borderRadius: 100,
        padding: 5,
        alignSelf: 'flex-start',
        maxWidth: '100%',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
      }}>
        {finalTabs.map(tab => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            onClick={() => setActiveId(tab.id)}
            compact={isMobile}
          />
        ))}
      </div>

      {/* ── Body card (bgCard wrapper, matches Dashboard content card) ───── */}
      <div style={{
        background: EP.bodyCardBg,
        borderRadius: isMobile ? 14 : 20,
        padding: isMobile ? '16px 14px' : '28px 32px',
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
              {tab.render?.({ active: isActive })}
            </div>
          );
        })}
      </div>

      {/* ── Fixed bottom bar (white, centered pill buttons) ───────────────── */}
      {footer && (
        <div style={{
          position: 'fixed',
          left: 0, right: 0, bottom: 0,
          background: EP.footerBg,
          borderTop: `1px solid ${EP.footerBorder}`,
          padding: '10px 16px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
        }}>
          <div style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            maxWidth: 960,
            flexWrap: 'wrap',
          }}>
            {footer}
          </div>
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
      background: EP.innerCardBg,
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
        justifyContent: 'center',
        gap: 5,
        flex: '1 1 0',
        minWidth: 110,
        maxWidth: 170,
        padding: '10px 14px',
        borderRadius: 10,
        border: 'none',
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.3px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        color: EP.footerText,
        background: variant === 'primary' ? EP.footerPrimary : EP.footerSecondaryBg,
        transition: `opacity ${theme.transitions.fast}`,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/** Design tokens re-exported for consumers who need them. */
export { EP as EntityPageTokens };
