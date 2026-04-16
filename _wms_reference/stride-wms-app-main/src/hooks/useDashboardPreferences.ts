import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type DashboardLayoutKey = 'desktop' | 'mobile';

interface DashboardPreferencesState {
  cardOrderByLayout: Record<DashboardLayoutKey, string[]>;
  hiddenCardsByLayout: Record<DashboardLayoutKey, string[]>;
}

export interface UseDashboardPreferencesOptions {
  /** Which layout to read/write (separate desktop vs mobile customization). */
  layout: DashboardLayoutKey;
  /** Current set of supported card IDs on the dashboard. */
  availableCardIds: string[];
  /** Default order for new users (and for merge-in of new cards). */
  defaultCardOrder: string[];
}

const LEGACY_CARD_ID_ALIASES: Record<string, string> = {
  // Old dashboard card ids (keep best-effort compatibility)
  putaway: 'put_away',
  shipments: 'incoming_shipments',
  heatmap: 'heat_map',
  heat_map_tile: 'heat_map',
};

function normalizeCardId(raw: string): string {
  const id = (raw || '').trim();
  return LEGACY_CARD_ID_ALIASES[id] ?? id;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  }
  return out;
}

function coerceLayoutMap(value: unknown): Record<DashboardLayoutKey, string[]> | null {
  // Legacy format: simple array applies to both layouts
  const asArray = toStringArray(value);
  if (asArray) {
    const normalized = asArray.map(normalizeCardId);
    return { desktop: normalized, mobile: normalized };
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const desktop = toStringArray(obj.desktop)?.map(normalizeCardId);
    const mobile = toStringArray(obj.mobile)?.map(normalizeCardId);

    if (desktop || mobile) {
      return {
        desktop: desktop ?? [],
        mobile: mobile ?? [],
      };
    }
  }

  return null;
}

function unique(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of list) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function mergeOrder(saved: string[] | null, defaults: string[], available: string[]): string[] {
  const normalizedSaved = unique((saved || []).map(normalizeCardId)).filter((id) => available.includes(id));
  const normalizedDefaults = unique(defaults.map(normalizeCardId)).filter((id) => available.includes(id));

  const merged: string[] = [...normalizedSaved];
  for (const id of normalizedDefaults) {
    if (!merged.includes(id)) merged.push(id);
  }
  // If a card exists in available but is not in defaults, still ensure it shows up somewhere.
  for (const id of available) {
    if (!merged.includes(id)) merged.push(id);
  }
  return merged;
}

function mergeHidden(saved: string[] | null, available: string[]): string[] {
  return unique((saved || []).map(normalizeCardId)).filter((id) => available.includes(id));
}

export function useDashboardPreferences(options: UseDashboardPreferencesOptions) {
  const { profile } = useAuth();

  const [state, setState] = useState<DashboardPreferencesState>(() => ({
    cardOrderByLayout: {
      desktop: mergeOrder(null, options.defaultCardOrder, options.availableCardIds),
      mobile: mergeOrder(null, options.defaultCardOrder, options.availableCardIds),
    },
    hiddenCardsByLayout: {
      desktop: [],
      mobile: [],
    },
  }));
  const [loading, setLoading] = useState(true);

  const fetchPreferences = useCallback(async () => {
    if (!profile?.id) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('user_dashboard_preferences')
        .select('card_order, hidden_cards')
        .eq('user_id', profile.id)
        .maybeSingle();

      if (error) throw error;

      const savedOrder = coerceLayoutMap(data?.card_order);
      const savedHidden = coerceLayoutMap(data?.hidden_cards);

      const next: DashboardPreferencesState = {
        cardOrderByLayout: {
          desktop: mergeOrder(savedOrder?.desktop ?? null, options.defaultCardOrder, options.availableCardIds),
          mobile: mergeOrder(savedOrder?.mobile ?? null, options.defaultCardOrder, options.availableCardIds),
        },
        hiddenCardsByLayout: {
          desktop: mergeHidden(savedHidden?.desktop ?? null, options.availableCardIds),
          mobile: mergeHidden(savedHidden?.mobile ?? null, options.availableCardIds),
        },
      };

      setState(next);
    } catch (error) {
      console.error('Error fetching dashboard preferences:', error);
    } finally {
      setLoading(false);
    }
  }, [options.availableCardIds, options.defaultCardOrder, profile?.id]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const persist = useCallback(async (next: DashboardPreferencesState) => {
    if (!profile?.id) return;

    const { error } = await supabase
      .from('user_dashboard_preferences')
      .upsert(
        {
          user_id: profile.id,
          card_order: next.cardOrderByLayout,
          hidden_cards: next.hiddenCardsByLayout,
        },
        { onConflict: 'user_id' }
      );

    if (error) throw error;
  }, [profile?.id]);

  const updateCardOrder = async (newOrderForLayout: string[]) => {
    const layout = options.layout;
    const sanitized = mergeOrder(newOrderForLayout, options.defaultCardOrder, options.availableCardIds);
    let next: DashboardPreferencesState | null = null;

    setState((prev) => {
      next = {
        ...prev,
        cardOrderByLayout: {
          ...prev.cardOrderByLayout,
          [layout]: sanitized,
        },
      };
      return next;
    });

    try {
      if (next) await persist(next);
    } catch (error) {
      console.error('Error saving card order:', error);
      fetchPreferences();
    }
  };

  const toggleCardVisibility = async (cardId: string) => {
    const layout = options.layout;
    const normalized = normalizeCardId(cardId);
    if (!options.availableCardIds.includes(normalized)) return;
    let next: DashboardPreferencesState | null = null;

    setState((prev) => {
      const currentlyHidden = prev.hiddenCardsByLayout[layout] || [];
      const nextHidden = currentlyHidden.includes(normalized)
        ? currentlyHidden.filter((id) => id !== normalized)
        : [...currentlyHidden, normalized];

      next = {
        ...prev,
        hiddenCardsByLayout: {
          ...prev.hiddenCardsByLayout,
          [layout]: mergeHidden(nextHidden, options.availableCardIds),
        },
      };
      return next;
    });

    try {
      if (next) await persist(next);
    } catch (error) {
      console.error('Error saving hidden cards:', error);
      fetchPreferences();
    }
  };

  const resetToDefault = async () => {
    const next: DashboardPreferencesState = {
      cardOrderByLayout: {
        desktop: mergeOrder(null, options.defaultCardOrder, options.availableCardIds),
        mobile: mergeOrder(null, options.defaultCardOrder, options.availableCardIds),
      },
      hiddenCardsByLayout: { desktop: [], mobile: [] },
    };

    setState(() => next);
    try {
      // Delete so future defaults auto-apply for any newly introduced cards.
      if (profile?.id) {
        await supabase.from('user_dashboard_preferences').delete().eq('user_id', profile.id);
      }
    } catch (error) {
      console.error('Error resetting dashboard preferences:', error);
      fetchPreferences();
    }
  };

  const cardOrder = state.cardOrderByLayout[options.layout] ?? [];
  const hiddenCards = state.hiddenCardsByLayout[options.layout] ?? [];

  return {
    cardOrder,
    hiddenCards,
    loading,
    updateCardOrder,
    toggleCardVisibility,
    resetToDefault,
  };
}
