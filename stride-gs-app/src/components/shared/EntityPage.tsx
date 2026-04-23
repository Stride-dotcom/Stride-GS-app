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

// All colors/typography come from theme.v2 — layout from the v4 spec.
const EP = {
  pageBg: theme.v2.colors.bgPage,            // warm cream — #F5F2EE
  tabCardBg: theme.v2.colors.bgDark,         // near-black tab card — #1C1C1C
  tabActive: theme.v2.colors.accent,         // brand orange — #E8692A
  tabInactiveText: theme.v2.colors.textOnDarkMuted, // muted white on dark
  tabActiveText: theme.v2.colors.textOnDark, // #FFFFFF
  cardBg: theme.v2.colors.bgWhite,           // white content cards
  cardBorder: theme.v2.colors.border,        // rgba(0,0,0,0.08)
  labelColor: theme.v2.colors.accent,        // orange field labels (keeping orange per spec)
  textPrimary: theme.v2.colors.text,         // #1C1C1C
  textSecondary: theme.v2.colors.textSecondary, // #666
  textMuted: theme.v2.colors.textMuted,      // #999
  footerBg: theme.v2.colors.bgWhite,         // white bottom bar
  footerBorder: theme.v2.colors.border,
  footerPrimary: theme.v2.colors.accent,     // orange primary pill
  footerSecondaryBg: theme.v2.colors.bgDark, // dark secondary pill
  footerText: theme.v2.colors.textOnDark,
  dotRed: theme.colors.statusRed,            // red notification dot
  maxWidth: 720,                             // centered content width
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
        flex: '1 1 0',
        minWidth: 0,
        padding: '10px 8px',
        fontSize: 11,
        fontWeight: 700,
        fontFamily: 'inherit',
        letterSpacing: '0.3px',
        textTransform: 'uppercase',
        color: active ? EP.tabActiveText : EP.tabInactiveText,
        background: active ? EP.tabActive : EP.tabCardBg,
        border: 'none',
        borderRadius: 10,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {tab.label}

      {/* Count badge — red circle in top-right corner (matches v4 mockup) */}
      {tab.badgeCount != null && tab.badgeCount > 0 && (
        <span style={{
          position: 'absolute',
          top: -4,
          right: -2,
          minWidth: 16,
          height: 16,
          borderRadius: '50%',
          background: active ? '#fff' : EP.dotRed,
          color: active ? EP.dotRed : '#fff',
          fontSize: 9,
          fontWeight: 800,
          textAlign: 'center',
          lineHeight: '16px',
          padding: '0 4px',
        }}>
          {tab.badgeCount > 99 ? '99+' : tab.badgeCount}
        </span>
      )}

      {/* Red notification dot */}
      {tab.hasDot && (
        <span style={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 7,
          height: 7,
          borderRadius: '50%',
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
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100%',
      background: EP.pageBg,
      // Bleed into AppLayout margins so the page fills the content area.
      margin: '-28px -32px',
    }}>

      {/* Centered content column (header + tabs + body) */}
      <div style={{
        maxWidth: EP.maxWidth,
        width: '100%',
        margin: '0 auto',
        paddingBottom: 80,  // leave room for fixed bottom bar
      }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ padding: isMobile ? '12px 16px 6px' : '16px 20px 6px' }}>
          {/* Row 1: back circle · INVENTORY · ID · status · spacer · actions */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 4,
            flexWrap: 'wrap',
          }}>
            <button
              onClick={handleBack}
              aria-label="Back"
              style={{
                width: 32, height: 32,
                borderRadius: '50%',
                border: `1px solid ${EP.cardBorder}`,
                background: EP.cardBg,
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

            <span style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: EP.labelColor,
              flexShrink: 0,
            }}>
              {entityLabel}
            </span>

            <span style={{
              fontSize: isMobile ? 18 : 20,
              fontWeight: 800,
              color: EP.textPrimary,
              letterSpacing: '-0.3px',
              lineHeight: 1,
            }}>
              {entityId}
            </span>

            {statusBadge && <span style={{ flexShrink: 0 }}>{statusBadge}</span>}

            {headerActions && (
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                {headerActions}
              </span>
            )}
          </div>

          {/* Row 2: bold client name (bigger per spec). No sidemark / no metaPills. */}
          {clientName && (
            <div style={{
              paddingLeft: 42,  // align under the ID (past the back circle + gap)
              fontSize: 14,
              fontWeight: 700,
              color: EP.textPrimary,
              lineHeight: 1.3,
              marginBottom: 8,
            }}>
              {clientName}
            </div>
          )}

          {statusStrip}
        </div>

        {/* ── Tab cards (individual dark cards, centered, not a dark bar) ─── */}
        <div style={{
          display: 'flex',
          gap: 6,
          padding: isMobile ? '6px 16px 10px' : '6px 20px 12px',
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
            />
          ))}
        </div>

        {/* ── Tab body ───────────────────────────────────────────────────── */}
        <div style={{
          padding: isMobile ? '4px 14px 24px' : '4px 20px 24px',
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
            maxWidth: EP.maxWidth,
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
