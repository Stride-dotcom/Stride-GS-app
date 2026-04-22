/**
 * TabbedDetailPanel — shared shell for every entity's detail panel.
 *
 * Ships as part of session 79 Phase A. The Item panel is the first consumer;
 * Task / Repair / Will Call / Shipment / Claim will migrate onto it in
 * follow-up sessions. Until then, the existing `EntityAttachments` composition
 * stays untouched for those 5 panels — this shell is purely additive.
 *
 * NOTE — name collision: do NOT confuse with the existing simpler
 * `DetailPanel.tsx` (still used by ~10 non-entity callers such as
 * BillingDetailPanel, PaymentDetailPanel, OrderDetailPanel). This new shell
 * is strictly additive.
 *
 * ### What the shell owns
 * - Backdrop + slide-out panel frame (desktop) / full-screen (mobile)
 * - Left-edge resize handle wired to `useResizablePanel`
 * - `DetailHeader` chrome (title, below-id slot, client, sidemark, actions)
 * - Status strip (save banners etc.) slot between header and tab bar
 * - Tab bar with active-tab underline + badge counts
 * - Tab body (current tab's `render()` output)
 * - Overlay slot (e.g. ProcessingOverlay) absolute-positioned over the body
 * - Sticky footer slot (Edit / Save / Cancel etc.)
 *
 * ### What the adapter owns
 * - All entity-specific state: isEditing, draft, optimistic patches, saving,
 *   action handlers. State lives ABOVE this shell so it persists across
 *   tab switches regardless of `keepMounted`.
 * - Entity-specific tab content via `tabs[].render(ctx)` callbacks
 *
 * ### Built-in tab shortcuts
 * The `builtInTabs` config auto-wires Photos / Docs / Notes / Activity tabs
 * to the shared components. The shell hoists the data hooks so badge counts
 * stay live, matching EntityAttachments' behavior.
 *
 * Activity supports a render-function escape hatch — used by the Item panel,
 * whose cross-entity audit timeline is more complex than the generic
 * `EntityHistory` component and lives in its own `ItemActivityTab`.
 */
import React, { useMemo, useState } from 'react';
import { theme } from '../../styles/theme';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { getPanelContainerStyle, panelBackdropStyle } from './panelStyles';
import { DetailHeader } from './DetailHeader';
import { PhotosPanel, DocumentsPanel, NotesPanel } from './EntityAttachments';
import { EntityHistory } from './EntityHistory';
import { usePhotos, type EntityType as PhotoEntityType } from '../../hooks/usePhotos';
import { useDocuments, type DocumentContextType } from '../../hooks/useDocuments';
import { useEntityNotes } from '../../hooks/useEntityNotes';

// ── Types ───────────────────────────────────────────────────────────────────

export interface TabbedDetailPanelTab {
  /** Stable tab identity (used for storage + state keys). */
  id: string;
  /** Visible tab label. */
  label: string;
  /** Optional icon rendered to the left of the label. */
  icon?: React.ReactNode;
  /** Count chip shown to the right of the label. Pass `null` to hide. */
  badgeCount?: number | null;
  /** Keep the tab body mounted even when inactive. Default false (remount on
   *  switch). Set true for tabs owning expensive internal state (e.g. Details
   *  while editing — preserves input focus and avoids re-running mount fx). */
  keepMounted?: boolean;
  /** Body renderer. `ctx.active` lets tabs short-circuit expensive work when
   *  rendered-but-hidden (only matters if `keepMounted` is true). */
  render: (ctx: { active: boolean }) => React.ReactNode;
}

interface RelatedNotesEntity {
  type: string;
  id: string;
  label?: string;
}

export interface TabbedDetailPanelBuiltInTabs {
  photos?: {
    entityType: PhotoEntityType;
    entityId: string;
    /** Parent item id — enables cross-entity photo rollup on Item panels. */
    itemId?: string | null;
    tenantId?: string | null;
    /** v2026-04-22 — opt-in source-entity sub-tabs. The four migrating panels
     *  (Task/Repair/WC/Shipment) set this; legacy consumers leave it off. */
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
    /** v2026-04-22 — opt-in cross-entity rollup by item_id with source sub-tabs.
     *  Requires itemId. When omitted/false, falls back to ThreadedNotes pill
     *  switcher (the legacy path used by Claim). */
    enableSourceFilter?: boolean;
    /** Parent item id for the rollup query. Ignored unless enableSourceFilter. */
    itemId?: string | null;
  };
  /** Activity tab — accepts either a simple entityType/entityId pair (renders
   *  the default `<EntityHistory>`) OR a full render function (escape hatch
   *  for entities like Item whose activity view has cross-entity logic). */
  activity?:
    | { entityType: string; entityId: string; tenantId?: string | null }
    | { render: () => React.ReactNode };
}

export interface TabbedDetailPanelConfig {
  // ── Header ────────────────────────────────────────────────────────────
  title: string;
  /** Prefix above the title, e.g. "ITEM" / "TASK". Optional. */
  entityLabel?: string;
  /** Client name — rendered in the dark header. */
  clientName?: string;
  /** Sidemark chip content — rendered with the colored palette. */
  sidemark?: string;
  /** Below-ID slot (status badges + indicator chips). ReactNode so the adapter
   *  can swap in a `<select>` during edit mode. */
  belowId?: React.ReactNode;
  /** Inline slot right of the title (e.g. `<ItemIdBadges>`). */
  idBadges?: React.ReactNode;
  /** Right-aligned header actions slot (Actions dropdown + close). */
  headerActions?: React.ReactNode;

  // ── Body ──────────────────────────────────────────────────────────────
  /** Custom tabs — rendered in array order before built-in tabs. */
  tabs?: TabbedDetailPanelTab[];
  builtInTabs?: TabbedDetailPanelBuiltInTabs;
  /** Initial tab id. Defaults to the first tab. */
  initialTabId?: string;

  // ── Slots ─────────────────────────────────────────────────────────────
  /** Between header and tab bar — save banners, warnings, etc. */
  statusStrip?: React.ReactNode;
  /** Overlay absolute-positioned above the tab body (e.g. ProcessingOverlay). */
  overlay?: React.ReactNode;
  /** Sticky footer content (Edit / Save / Cancel etc.). */
  footer?: React.ReactNode;

  // ── Lifecycle ─────────────────────────────────────────────────────────
  onClose: () => void;
  /** useResizablePanel storage key, e.g. 'item', 'task', 'repair'. */
  resizeKey?: string;
  /** Desktop default panel width. Override on a per-entity basis. */
  defaultWidth?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const TAB_BUTTON_BASE: React.CSSProperties = {
  flex: '1 0 auto',
  minWidth: 72,
  padding: '10px 14px',
  fontSize: 12,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontFamily: 'inherit',
  transition: 'all 0.15s',
  whiteSpace: 'nowrap',
};

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    ...TAB_BUTTON_BASE,
    fontWeight: active ? 600 : 400,
    color: active ? theme.colors.orange : theme.colors.textSecondary,
    borderBottom: `2px solid ${active ? theme.colors.orange : 'transparent'}`,
  };
}

function CountChip({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: '1px 7px',
        borderRadius: 100,
        background: active ? theme.colors.orange : theme.colors.bgSubtle,
        color: active ? '#fff' : theme.colors.textMuted,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.4,
      }}
    >
      {n}
    </span>
  );
}

// ── Built-in tab resolver ───────────────────────────────────────────────────

/**
 * Hoisting the data hooks up to the shell level is intentional — it keeps
 * badge counts live and avoids double-fetching if the user opens/closes each
 * tab. Matches how `EntityAttachments` works today for the still-composed
 * panels (WC / Shipment / Claim). No hook is called unless the corresponding
 * config is present, since React conditionally calls hooks based on typeof
 * checks inside `useBuiltInTabs`.
 *
 * We can't skip a hook call conditionally per React's rules — but we CAN
 * always call the hook and pass null/undefined IDs so the internal query
 * short-circuits. That's what the hook internals already do when entityId
 * is falsy. Keeps hook count stable across renders.
 */
function useBuiltInTabs(cfg: TabbedDetailPanelBuiltInTabs | undefined): TabbedDetailPanelTab[] {
  // Resolve refs — always pass something to the hooks so hook count is stable.
  const photosCfg = cfg?.photos;
  const docsCfg = cfg?.docs;
  const notesCfg = cfg?.notes;
  const activityCfg = cfg?.activity;

  // Call hooks unconditionally but pass disabled/empty when unused.
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

  // useEntityNotes takes positional args; when no notes config is provided,
  // we pass empty-string id so the hook's internal guard short-circuits the
  // query (mirrors the pattern the hook already uses for unmounted panels).
  const { notes } = useEntityNotes(
    notesCfg?.entityType ?? 'inventory',
    notesCfg?.entityId ?? ''
  );

  return useMemo(() => {
    const out: TabbedDetailPanelTab[] = [];

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

// ── Component ───────────────────────────────────────────────────────────────

export function TabbedDetailPanel(props: TabbedDetailPanelConfig) {
  const {
    title,
    entityLabel,
    clientName,
    sidemark,
    belowId,
    idBadges,
    headerActions,
    tabs: customTabs,
    builtInTabs,
    initialTabId,
    statusStrip,
    overlay,
    footer,
    onClose,
    resizeKey,
    defaultWidth = 460,
  } = props;

  const { isMobile } = useIsMobile();
  const { width: panelWidth, handleMouseDown: handleResizeMouseDown } =
    useResizablePanel(defaultWidth, resizeKey ?? 'tabbed-detail-panel', isMobile);

  // Merge custom tabs first, built-in tabs after — matches the mockup order
  // when the adapter lists (details, coverage) and builtInTabs provides
  // (photos, docs, notes, activity) via interleaving in the adapter.
  const builtIn = useBuiltInTabs(builtInTabs);

  // Adapters can interleave tab order by instead omitting `builtInTabs` and
  // listing everything in `tabs` manually. The current Item adapter relies on
  // the natural order: customs first (Details, Coverage), built-ins after
  // (Photos, Docs, Notes, Activity). That matches the mockup: Details /
  // Photos / Docs / Notes / Coverage / Activity? — actually not quite.
  //
  // Mockup order: Details, Photos, Docs, Notes, Coverage, Activity.
  // That means Coverage sits BETWEEN Notes and Activity — between two
  // built-ins. To preserve flexibility the adapter can pass ALL tabs
  // (including Photos/Docs/Notes/Activity) manually — but then it loses the
  // auto-count-badge wiring. Compromise: the shell accepts a
  // `tabOrder?: string[]` override OR the adapter builds tabs manually.
  //
  // For Item v1 we use `tabOrder` to stitch them: tabs array is the full
  // desired order with tab ids, and the shell resolves them from custom +
  // built-in by id. Keep this simple: adapter passes `tabs` with the custom
  // ones and a `tabOrder` for final ordering. Built-ins not in `tabOrder`
  // still append at the end.

  // Compute final ordered tabs by stitching custom + built-in.
  // - If adapter passed `tabs` with ids matching built-in ids, built-ins
  //   override custom (in practice, adapter shouldn't duplicate an id).
  // - No explicit tabOrder: builtin order = alphabetic by id after customs.
  //   Item adapter intersperses by passing built-ins first as customs via
  //   placeholder IDs — but that's messy. Simpler: expose the two arrays,
  //   let adapter decide via a final reorder callback.
  //
  // Pragmatic implementation for v1: adapter passes a single `tabs` array
  // in exact desired render order. If any entries have id matching a
  // built-in shortcut, the shell replaces their render with the built-in
  // version (preserves count badge). Adapter can still pass a custom render
  // with the same id if it wants full override.
  const finalTabs = useMemo(() => {
    const byId = new Map<string, TabbedDetailPanelTab>();
    for (const t of builtIn) byId.set(t.id, t);

    const customs = customTabs ?? [];
    if (customs.length === 0) {
      // No custom tabs — just render built-ins in insertion order.
      return [...builtIn];
    }

    const out: TabbedDetailPanelTab[] = [];
    const seen = new Set<string>();
    for (const t of customs) {
      // If a custom tab id matches a built-in, merge: use adapter's label/icon
      // (if provided) but prefer the built-in render and live badge count.
      const bi = byId.get(t.id);
      if (bi) {
        out.push({
          ...bi,
          label: t.label || bi.label,
          icon: t.icon ?? bi.icon,
          keepMounted: t.keepMounted ?? bi.keepMounted,
          // Let adapter override badge if it wants, else use built-in count
          badgeCount: t.badgeCount !== undefined ? t.badgeCount : bi.badgeCount,
        });
      } else {
        out.push(t);
      }
      seen.add(t.id);
    }
    // Append any built-in tabs the adapter didn't reference.
    for (const bi of builtIn) {
      if (!seen.has(bi.id)) out.push(bi);
    }
    return out;
  }, [customTabs, builtIn]);

  const [activeId, setActiveId] = useState<string>(() => {
    if (initialTabId && finalTabs.some(t => t.id === initialTabId)) return initialTabId;
    return finalTabs[0]?.id ?? '';
  });

  return (
    <>
      {!isMobile && <div onClick={onClose} style={panelBackdropStyle} />}
      <div style={getPanelContainerStyle(panelWidth, isMobile)}>
        {!isMobile && (
          <div
            onMouseDown={handleResizeMouseDown}
            style={{
              position: 'absolute',
              left: 0, top: 0, bottom: 0,
              width: 6,
              cursor: 'col-resize',
              zIndex: 101,
            }}
          />
        )}

        <DetailHeader
          entityId={title}
          entityLabel={entityLabel}
          clientName={clientName}
          sidemark={sidemark}
          idBadges={idBadges}
          belowId={belowId}
          actions={headerActions}
          mobileCompact={isMobile}
          onClose={isMobile ? onClose : undefined}
        />

        {statusStrip}

        {/* Tab bar — matches ClaimDetailPanel's established pattern. */}
        <div
          style={{
            display: 'flex',
            borderBottom: `1px solid ${theme.colors.border}`,
            flexShrink: 0,
            overflowX: 'auto',
            // Let the row scroll horizontally on mobile if overflow.
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {finalTabs.map(tab => {
            const isActive = tab.id === activeId;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveId(tab.id)}
                style={tabButtonStyle(isActive)}
                aria-selected={isActive}
                role="tab"
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tab.badgeCount != null && tab.badgeCount > 0 && (
                  <CountChip n={tab.badgeCount} active={isActive} />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab body — scrolls independently; overlay is absolute over it. */}
        <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {finalTabs.map(tab => {
            const isActive = tab.id === activeId;
            if (!isActive && !tab.keepMounted) return null;
            return (
              <div
                key={tab.id}
                role="tabpanel"
                aria-hidden={!isActive}
                style={{
                  display: isActive ? 'block' : 'none',
                  padding: '16px 18px',
                }}
              >
                {tab.render({ active: isActive })}
              </div>
            );
          })}
          {overlay}
        </div>

        {footer && (
          <div
            style={{
              flexShrink: 0,
              borderTop: `1px solid ${theme.colors.border}`,
              background: '#fff',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </>
  );
}

// Re-export Tab type for adapter-file ergonomics.
export type { TabbedDetailPanelTab as Tab };
