import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useAdminDev } from "@/hooks/useAdminDev";
import {
  type DecisionLedgerEntry,
  type DecisionLedgerEntryType,
  useAppendDecisionLedgerEntry,
  useDecisionLedgerThreads,
} from "@/hooks/useDecisionLedger";
import { cn } from "@/lib/utils";

function formatDateTime(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function entryTypeLabel(type: DecisionLedgerEntryType) {
  if (type === "decision") return "Decision";
  if (type === "status") return "Status";
  return "Note";
}

function statusBadgeVariant(status: string | null) {
  const s = (status ?? "").toLowerCase();
  if (!s) return "secondary";
  if (s.includes("done") || s.includes("implemented") || s.includes("complete")) return "default";
  if (s.includes("blocked") || s.includes("failed") || s.includes("rejected")) return "destructive";
  if (s.includes("in_progress") || s.includes("in progress")) return "secondary";
  return "outline";
}

interface EntryComposerState {
  open: boolean;
  mode: "new_decision" | "append";
  decision_key: string;
  entry_type: DecisionLedgerEntryType;
  title: string;
  body: string;
  status: string;
  phase: string;
  version: string;
}

const DEFAULT_COMPOSER: EntryComposerState = {
  open: false,
  mode: "new_decision",
  decision_key: "",
  entry_type: "decision",
  title: "",
  body: "",
  status: "",
  phase: "",
  version: "",
};

export default function DecisionLedger() {
  const { toast } = useToast();
  const { isAdminDev, loading: adminLoading } = useAdminDev();
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState<EntryComposerState>(DEFAULT_COMPOSER);

  const { threads, isLoading, error } = useDecisionLedgerThreads({ search, limit: 800 });
  const appendEntry = useAppendDecisionLedgerEntry();

  const totalEntries = useMemo(() => threads.reduce((sum, t) => sum + t.entries.length, 0), [threads]);

  if (!adminLoading && !isAdminDev) {
    return <Navigate to="/" replace />;
  }

  const openNewDecision = () => {
    setComposer({
      ...DEFAULT_COMPOSER,
      open: true,
      mode: "new_decision",
      entry_type: "decision",
      status: "proposed",
    });
  };

  const openAppend = (decision_key: string, entry_type: DecisionLedgerEntryType) => {
    setComposer({
      ...DEFAULT_COMPOSER,
      open: true,
      mode: "append",
      decision_key,
      entry_type,
    });
  };

  const closeComposer = () => setComposer(DEFAULT_COMPOSER);

  const onSubmit = async () => {
    const decision_key = composer.decision_key.trim();
    if (!decision_key) {
      toast({ title: "Decision key is required", variant: "destructive" });
      return;
    }
    if (!composer.body.trim()) {
      toast({ title: "Body is required", variant: "destructive" });
      return;
    }

    try {
      await appendEntry.mutateAsync({
        decision_key,
        entry_type: composer.entry_type,
        title: composer.mode === "new_decision" ? composer.title.trim() || null : null,
        body: composer.body,
        status: composer.status.trim() || null,
        phase: composer.phase.trim() || null,
        version: composer.version.trim() || null,
      });

      toast({ title: "Saved to decision ledger" });
      closeComposer();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save decision ledger entry";
      toast({ title: "Error", description: message, variant: "destructive" });
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-end gap-3 md:gap-4 justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Decision Ledger</h1>
            <p className="text-sm text-muted-foreground">
              Append-only, immutable record of decisions and status changes.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search key, title, body, status…"
              className="w-full md:w-[320px]"
            />
            <Button onClick={openNewDecision}>New decision</Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              Ledger threads
              <Badge variant="secondary">{threads.length}</Badge>
              <Badge variant="outline">{totalEntries} entries</Badge>
            </CardTitle>
            <CardDescription>
              Entries cannot be edited or deleted. To correct something, append a new entry.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : error ? (
              <div className="text-sm text-destructive">
                {(error as Error).message || "Failed to load decision ledger"}
              </div>
            ) : threads.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No entries yet. Create your first decision to start the ledger.
              </div>
            ) : (
              <Accordion type="multiple" className="w-full">
                {threads.map((t) => (
                  <AccordionItem key={t.decision_key} value={t.decision_key}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 text-left w-full">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{t.title}</div>
                          <div className="text-xs text-muted-foreground truncate">{t.decision_key}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {t.currentStatus ? (
                            <Badge variant={statusBadgeVariant(t.currentStatus) as any}>
                              {t.currentStatus}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">no status</Badge>
                          )}
                          <Badge variant="outline">{t.entries.length}</Badge>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" onClick={() => openAppend(t.decision_key, "status")}>
                            Add status update
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => openAppend(t.decision_key, "note")}>
                            Add note
                          </Button>
                        </div>

                        <ScrollArea className="max-h-[420px] rounded-md border">
                          <div className="p-3 space-y-3">
                            {t.entries.map((e: DecisionLedgerEntry) => (
                              <div key={e.id} className="rounded-lg border bg-background p-3">
                                <div className="flex flex-col md:flex-row md:items-center gap-2 justify-between">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Badge variant="outline">{entryTypeLabel(e.entry_type)}</Badge>
                                    {e.status ? (
                                      <Badge variant={statusBadgeVariant(e.status) as any}>{e.status}</Badge>
                                    ) : null}
                                    {e.phase ? <Badge variant="secondary">{e.phase}</Badge> : null}
                                    {e.version ? <Badge variant="secondary">{e.version}</Badge> : null}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatDateTime(e.created_at)}
                                  </div>
                                </div>
                                {e.title ? (
                                  <div className="mt-2 font-medium">{e.title}</div>
                                ) : null}
                                <pre
                                  className={cn(
                                    "mt-2 whitespace-pre-wrap text-sm leading-relaxed",
                                    "text-foreground"
                                  )}
                                >
                                  {e.body}
                                </pre>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={composer.open}
        onOpenChange={(open) => {
          if (!open) closeComposer();
        }}
      >
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>
              {composer.mode === "new_decision" ? "New decision" : "Append entry"}
            </DialogTitle>
            <DialogDescription>
              This will create a new immutable ledger entry (no edits/deletes).
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="text-sm font-medium">Decision key</label>
              <Input
                value={composer.decision_key}
                onChange={(e) => setComposer((p) => ({ ...p, decision_key: e.target.value }))}
                placeholder="e.g. phase5.subscription_gate.fail_open"
                disabled={composer.mode === "append"}
              />
              <div className="text-xs text-muted-foreground mt-1">
                Use a stable, human-readable key to group entries.
              </div>
            </div>

            {composer.mode === "new_decision" ? (
              <div className="md:col-span-2">
                <label className="text-sm font-medium">Title (optional)</label>
                <Input
                  value={composer.title}
                  onChange={(e) => setComposer((p) => ({ ...p, title: e.target.value }))}
                  placeholder="Short headline for the decision"
                />
              </div>
            ) : null}

            <div>
              <label className="text-sm font-medium">Entry type</label>
              <Input value={composer.entry_type} disabled />
            </div>

            <div>
              <label className="text-sm font-medium">Status (optional)</label>
              <Input
                value={composer.status}
                onChange={(e) => setComposer((p) => ({ ...p, status: e.target.value }))}
                placeholder="proposed / approved / implemented / blocked …"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Phase (optional)</label>
              <Input
                value={composer.phase}
                onChange={(e) => setComposer((p) => ({ ...p, phase: e.target.value }))}
                placeholder='e.g. "Phase 5"'
              />
            </div>

            <div>
              <label className="text-sm font-medium">Version (optional)</label>
              <Input
                value={composer.version}
                onChange={(e) => setComposer((p) => ({ ...p, version: e.target.value }))}
                placeholder='e.g. "v3"'
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-sm font-medium">Body</label>
              <Textarea
                value={composer.body}
                onChange={(e) => setComposer((p) => ({ ...p, body: e.target.value }))}
                placeholder={
                  composer.entry_type === "decision"
                    ? "Write the decision and rationale…"
                    : composer.entry_type === "status"
                    ? "What changed? Why? Link evidence if applicable…"
                    : "Add a note (context, references, next steps)…"
                }
                className="min-h-[180px]"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeComposer} disabled={appendEntry.isPending}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={appendEntry.isPending}>
              {appendEntry.isPending ? "Saving…" : "Save entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

