import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type DecisionLedgerEntryType = "decision" | "status" | "note";

export interface DecisionLedgerEntry {
  id: string;
  decision_key: string;
  entry_type: DecisionLedgerEntryType;
  title: string | null;
  body: string;
  status: string | null;
  phase: string | null;
  version: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
}

export interface DecisionLedgerThread {
  decision_key: string;
  title: string;
  currentStatus: string | null;
  lastUpdatedAt: string;
  entries: DecisionLedgerEntry[];
}

export interface UseDecisionLedgerEntriesParams {
  search?: string;
  limit?: number;
}

function groupEntriesIntoThreads(entries: DecisionLedgerEntry[]): DecisionLedgerThread[] {
  const map = new Map<string, DecisionLedgerEntry[]>();
  for (const e of entries) {
    const existing = map.get(e.decision_key);
    if (existing) existing.push(e);
    else map.set(e.decision_key, [e]);
  }

  const threads: DecisionLedgerThread[] = [];
  for (const [decision_key, threadEntries] of map.entries()) {
    // entries come from API newest-first, but group preserves order of pushes; ensure newest-first
    const sorted = [...threadEntries].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    const decisionEntry = [...sorted].reverse().find((e) => e.entry_type === "decision");
    const title = decisionEntry?.title?.trim() || decision_key;

    const currentStatus = sorted.find((e) => e.status)?.status ?? null;
    const lastUpdatedAt = sorted[0]?.created_at ?? new Date(0).toISOString();

    threads.push({
      decision_key,
      title,
      currentStatus,
      lastUpdatedAt,
      entries: sorted,
    });
  }

  return threads.sort((a, b) => (a.lastUpdatedAt < b.lastUpdatedAt ? 1 : -1));
}

export function useDecisionLedgerEntries(params: UseDecisionLedgerEntriesParams = {}) {
  const { session } = useAuth();
  const limit = params.limit ?? 500;

  return useQuery<DecisionLedgerEntry[]>({
    queryKey: ["decision-ledger-entries", params],
    enabled: !!session,
    queryFn: async () => {
      let query = (supabase as any).from("decision_ledger_entries")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      const search = params.search?.trim();
      if (search) {
        const like = `%${search}%`;
        query = query.or(`decision_key.ilike.${like},title.ilike.${like},body.ilike.${like},status.ilike.${like}`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as DecisionLedgerEntry[];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useDecisionLedgerThreads(params: UseDecisionLedgerEntriesParams = {}) {
  const entriesQuery = useDecisionLedgerEntries(params);

  const threads = useMemo(() => {
    if (!entriesQuery.data) return [];
    return groupEntriesIntoThreads(entriesQuery.data);
  }, [entriesQuery.data]);

  return {
    ...entriesQuery,
    threads,
  };
}

export interface AppendDecisionLedgerEntryInput {
  decision_key: string;
  entry_type: DecisionLedgerEntryType;
  title?: string | null;
  body: string;
  status?: string | null;
  phase?: string | null;
  version?: string | null;
  metadata?: Record<string, unknown>;
}

export function useAppendDecisionLedgerEntry() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AppendDecisionLedgerEntryInput) => {
      const payload = {
        decision_key: input.decision_key.trim(),
        entry_type: input.entry_type,
        title: input.title ?? null,
        body: input.body,
        status: input.status ?? null,
        phase: input.phase ?? null,
        version: input.version ?? null,
        metadata: input.metadata ?? {},
        created_by: profile?.id ?? null,
      };

      const { data, error } = await (supabase as any).from("decision_ledger_entries").insert(payload).select("*").single();
      if (error) throw error;
      return data as DecisionLedgerEntry;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["decision-ledger-entries"] });
    },
  });
}

