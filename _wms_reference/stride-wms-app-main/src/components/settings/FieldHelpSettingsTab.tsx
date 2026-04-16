import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import {
  useCreateGlobalHelpTool,
  useGlobalHelpTools,
  useSeedGlobalHelpTools,
  useUpdateGlobalHelpTool,
} from '@/hooks/useGlobalHelpTools';
import {
  appendHelpNavigationParams,
  GLOBAL_HELP_PAGE_DEFINITIONS,
  GLOBAL_HELP_TOOL_SEEDS,
  getHelpFieldLabel,
  getHelpPageFallbackRoute,
  getHelpPageLabel,
  HELP_PICKER_CHANNEL,
  HELP_PICKER_MODE,
  HELP_PICKER_PAGE,
  HELP_QUERY_ROW,
  resolveHelpRouteFromEntry,
} from '@/lib/globalHelpToolsCatalog';

type AddFormState = {
  pageKey: string;
  fieldKey: string;
  fieldLabel: string;
  routePath: string;
  targetSelector: string;
  helpText: string;
  isActive: boolean;
};

const DEFAULT_ADD_FORM: AddFormState = {
  pageKey: '',
  fieldKey: '',
  fieldLabel: '',
  routePath: '',
  targetSelector: '',
  helpText: '',
  isActive: true,
};

const sortStrings = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b));

function rowAnchorId(id: string): string {
  return `help-tool-row-${id}`;
}

function buildRouteWithPickerParams(baseRoute: string, pageKey: string, channelId: string): string {
  const [path, query = ''] = baseRoute.split('?');
  const params = new URLSearchParams(query);
  params.set(HELP_PICKER_MODE, '1');
  params.set(HELP_PICKER_CHANNEL, channelId);
  params.set(HELP_PICKER_PAGE, pageKey);
  return `${path}?${params.toString()}`;
}

export function FieldHelpSettingsTab() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [pageFilter, setPageFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [openPages, setOpenPages] = useState<Record<string, boolean>>({});
  const [draftTextById, setDraftTextById] = useState<Record<string, string>>({});
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState<AddFormState>(DEFAULT_ADD_FORM);
  const [pickerChannelId, setPickerChannelId] = useState<string | null>(null);

  const { data: entries = [], isLoading } = useGlobalHelpTools();
  const createEntry = useCreateGlobalHelpTool();
  const updateEntry = useUpdateGlobalHelpTool();
  const seedEntries = useSeedGlobalHelpTools();
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current) return;
    if (isLoading) return;
    seededRef.current = true;
    seedEntries.mutate(GLOBAL_HELP_TOOL_SEEDS, {
      onSuccess: (result) => {
        if (result.inserted > 0) {
          toast({
            title: 'Help tools synced',
            description: `Added ${result.inserted} existing help tips to the global manager.`,
          });
        }
      },
      onError: (error) => {
        toast({
          variant: 'destructive',
          title: 'Sync failed',
          description: error instanceof Error ? error.message : 'Could not sync existing help tips.',
        });
      },
    });
  }, [isLoading, seedEntries, toast]);

  const knownPageKeys = useMemo(
    () => sortStrings([...GLOBAL_HELP_PAGE_DEFINITIONS.map((definition) => definition.pageKey), ...entries.map((entry) => entry.page_key)]),
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries
      .filter((entry) => {
        if (pageFilter !== 'all' && entry.page_key !== pageFilter) return false;
        if (statusFilter === 'active' && !entry.is_active) return false;
        if (statusFilter === 'inactive' && entry.is_active) return false;
        if (!q) return true;
        return (
          entry.page_key.toLowerCase().includes(q) ||
          entry.field_key.toLowerCase().includes(q) ||
          entry.help_text.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const pageCompare = a.page_key.localeCompare(b.page_key);
        if (pageCompare !== 0) return pageCompare;
        return a.field_key.localeCompare(b.field_key);
      });
  }, [entries, pageFilter, search, statusFilter]);

  const groupedEntries = useMemo(() => {
    const map = new Map<string, typeof filteredEntries>();
    filteredEntries.forEach((entry) => {
      const list = map.get(entry.page_key) || [];
      list.push(entry);
      map.set(entry.page_key, list);
    });
    return map;
  }, [filteredEntries]);

  const groupedPageKeys = useMemo(
    () => Array.from(groupedEntries.keys()).sort((a, b) => a.localeCompare(b)),
    [groupedEntries]
  );

  useEffect(() => {
    setOpenPages((prev) => {
      const next = { ...prev };
      let changed = false;
      groupedPageKeys.forEach((pageKey) => {
        if (!(pageKey in next)) {
          next[pageKey] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [groupedPageKeys]);

  useEffect(() => {
    const rowId = searchParams.get(HELP_QUERY_ROW);
    if (!rowId) return;
    const element = document.getElementById(rowAnchorId(rowId));
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedRowId(rowId);
    window.setTimeout(() => setHighlightedRowId((prev) => (prev === rowId ? null : prev)), 2500);
  }, [searchParams, filteredEntries]);

  useEffect(() => {
    if (!pickerChannelId) return;
    const channelName = `help-picker:${pickerChannelId}`;
    const storageKey = `help-picker-result:${pickerChannelId}`;
    const channel = typeof window !== 'undefined' && 'BroadcastChannel' in window
      ? new BroadcastChannel(channelName)
      : null;

    const applySelection = (payload: {
      pageKey?: string;
      fieldKey?: string;
      fieldLabel?: string;
      routePath?: string;
      selector?: string;
    }) => {
      const nextPageKey = payload.pageKey || addForm.pageKey;
      const nextFieldKey = payload.fieldKey || addForm.fieldKey;

      if (!nextPageKey || !nextFieldKey) return;

      const existing = entries.find(
        (entry) => entry.page_key === nextPageKey && entry.field_key === nextFieldKey
      );
      if (existing) {
        setAddDialogOpen(false);
        setHighlightedRowId(existing.id);
        const next = new URLSearchParams(searchParams);
        next.set(HELP_QUERY_ROW, existing.id);
        setSearchParams(next, { replace: true });
        toast({
          title: 'Already exists',
          description: 'Opened the existing help tool row for inline editing.',
        });
        setPickerChannelId(null);
        return;
      }

      setAddForm((prev) => ({
        ...prev,
        pageKey: nextPageKey,
        fieldKey: nextFieldKey,
        fieldLabel: payload.fieldLabel || prev.fieldLabel,
        routePath: payload.routePath || prev.routePath,
        targetSelector: payload.selector || prev.targetSelector,
      }));
      setPickerChannelId(null);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue);
        applySelection(parsed);
      } catch {
        // ignore malformed payload
      }
    };

    channel?.addEventListener('message', (event) => applySelection(event.data || {}));
    window.addEventListener('storage', onStorage);

    const existingPayload = localStorage.getItem(storageKey);
    if (existingPayload) {
      try {
        applySelection(JSON.parse(existingPayload));
      } catch {
        // ignore malformed payload
      }
    }

    return () => {
      channel?.close();
      window.removeEventListener('storage', onStorage);
    };
  }, [addForm.fieldKey, addForm.pageKey, entries, pickerChannelId, searchParams, setSearchParams, toast]);

  useEffect(() => {
    if (!addDialogOpen) return;
    if (addForm.routePath.trim()) return;
    const fallback = getHelpPageFallbackRoute(addForm.pageKey);
    if (!fallback) return;
    setAddForm((prev) => ({ ...prev, routePath: fallback }));
  }, [addDialogOpen, addForm.pageKey, addForm.routePath]);

  const handleInlineTextChange = (entryId: string, value: string) => {
    setDraftTextById((prev) => ({ ...prev, [entryId]: value }));
  };

  const resolveDraftText = (entryId: string, fallback: string): string =>
    draftTextById[entryId] ?? fallback;

  const handleSaveRowText = async (entryId: string, fallback: string) => {
    const nextText = resolveDraftText(entryId, fallback).trim();
    if (!nextText) {
      toast({
        variant: 'destructive',
        title: 'Missing help text',
        description: 'Help text cannot be empty.',
      });
      return;
    }
    if (nextText === fallback) return;

    try {
      setSavingRowId(entryId);
      await updateEntry.mutateAsync({
        id: entryId,
        patch: { help_text: nextText },
      });
      toast({ title: 'Saved', description: 'Help text updated.' });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Could not update help text.',
      });
    } finally {
      setSavingRowId(null);
    }
  };

  const handleToggleActive = async (entryId: string, nextActive: boolean) => {
    try {
      setSavingRowId(entryId);
      await updateEntry.mutateAsync({
        id: entryId,
        patch: { is_active: nextActive },
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Could not update active state.',
      });
    } finally {
      setSavingRowId(null);
    }
  };

  const openAddDialog = () => {
    const firstPage = GLOBAL_HELP_PAGE_DEFINITIONS[0];
    setAddForm({
      ...DEFAULT_ADD_FORM,
      pageKey: firstPage?.pageKey || '',
      routePath: firstPage?.fallbackRoute || '/settings?tab=dev-console',
    });
    setAddDialogOpen(true);
  };

  const openPicker = () => {
    if (!addForm.routePath) {
      toast({
        variant: 'destructive',
        title: 'Select a route first',
        description: 'Add a route path before launching the field picker.',
      });
      return;
    }
    const channelId = crypto.randomUUID();
    setPickerChannelId(channelId);
    const pickerUrl = buildRouteWithPickerParams(addForm.routePath, addForm.pageKey, channelId);
    window.open(pickerUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCreateEntry = async () => {
    const pageKey = addForm.pageKey.trim();
    const fieldKey = addForm.fieldKey.trim();
    const helpText = addForm.helpText.trim();
    const routePath = addForm.routePath.trim();
    if (!pageKey || !fieldKey || !helpText || !routePath) {
      toast({
        variant: 'destructive',
        title: 'Missing values',
        description: 'Page, field, route, and text are required.',
      });
      return;
    }

    const existing = entries.find((entry) => entry.page_key === pageKey && entry.field_key === fieldKey);
    if (existing) {
      setAddDialogOpen(false);
      const next = new URLSearchParams(searchParams);
      next.set(HELP_QUERY_ROW, existing.id);
      setSearchParams(next, { replace: true });
      setHighlightedRowId(existing.id);
      toast({
        title: 'Already exists',
        description: 'Opened the existing row for inline editing.',
      });
      return;
    }

    try {
      await createEntry.mutateAsync({
        page_key: pageKey,
        field_key: fieldKey,
        help_text: helpText,
        is_active: addForm.isActive,
        route_path: routePath,
        target_selector: addForm.targetSelector || null,
        source_type: addForm.targetSelector ? 'injected' : 'native',
      });
      setAddDialogOpen(false);
      setAddForm(DEFAULT_ADD_FORM);
      toast({ title: 'Created', description: 'New help tip added.' });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Create failed',
        description: error instanceof Error ? error.message : 'Could not create help tip.',
      });
    }
  };

  const navigateToField = (entry: (typeof entries)[number]) => {
    const returnParams = new URLSearchParams();
    returnParams.set(HELP_QUERY_ROW, entry.id);
    const returnTo = `/admin/help-tool?${returnParams.toString()}`;

    const resolved = resolveHelpRouteFromEntry(entry.page_key, entry.route_path);
    if (resolved.usedFallback) {
      toast({
        title: 'Using fallback page',
        description: 'No exact record context was saved yet. Opened the nearest page.',
      });
    }

    const href = appendHelpNavigationParams(resolved.routePath, {
      pageKey: entry.page_key,
      fieldKey: entry.field_key,
      selector: entry.target_selector,
      returnTo,
      rowId: entry.id,
    });
    navigate(href);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="help" size="md" />
            Help Tool Manager
          </CardTitle>
          <CardDescription>
            Manage every help icon in one place. Field links jump to the page, focus the field, and open help.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row">
            <div className="relative flex-1">
              <MaterialIcon
                name="search"
                size="sm"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search page, field, or text..."
                className="pl-8"
              />
            </div>
            <Select value={pageFilter} onValueChange={setPageFilter}>
              <SelectTrigger className="w-full xl:w-[260px]">
                <SelectValue placeholder="Filter page" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All pages</SelectItem>
                {knownPageKeys.map((pageKey) => (
                  <SelectItem key={pageKey} value={pageKey}>
                    {getHelpPageLabel(pageKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
              <SelectTrigger className="w-full xl:w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={openAddDialog}>
              <MaterialIcon name="add" size="sm" className="mr-2" />
              Add Help Tip
            </Button>
          </div>

          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading help tips...</div>
          ) : groupedPageKeys.length === 0 ? (
            <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
              No matching help tips.
            </div>
          ) : (
            <div className="space-y-3">
              {groupedPageKeys.map((pageKey) => {
                const pageEntries = groupedEntries.get(pageKey) || [];
                const open = openPages[pageKey] ?? true;
                return (
                  <Collapsible
                    key={pageKey}
                    open={open}
                    onOpenChange={(nextOpen) =>
                      setOpenPages((prev) => ({ ...prev, [pageKey]: nextOpen }))
                    }
                  >
                    <Card>
                      <div className="flex items-center border-b px-4 py-3">
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-3 text-left"
                          >
                            <div>
                              <div className="font-medium">{getHelpPageLabel(pageKey)}</div>
                              <div className="font-mono text-xs text-muted-foreground">{pageKey}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">{pageEntries.length}</Badge>
                              <MaterialIcon
                                name="expand_more"
                                size="sm"
                                className={`transition-transform ${open ? 'rotate-180' : ''}`}
                              />
                            </div>
                          </button>
                        </CollapsibleTrigger>
                      </div>

                      <CollapsibleContent>
                        <div className="p-4">
                          <div className="rounded-md border overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-[200px]">Page</TableHead>
                                  <TableHead className="w-[240px]">Field</TableHead>
                                  <TableHead>Text</TableHead>
                                  <TableHead className="w-[160px]">Active / Inactive</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {pageEntries.map((entry) => {
                                  const draft = resolveDraftText(entry.id, entry.help_text);
                                  const saveDisabled =
                                    savingRowId === entry.id || draft.trim() === '' || draft === entry.help_text;
                                  const rowHighlighted = highlightedRowId === entry.id;
                                  return (
                                    <TableRow
                                      key={entry.id}
                                      id={rowAnchorId(entry.id)}
                                      className={rowHighlighted ? 'bg-primary/5' : undefined}
                                    >
                                      <TableCell>
                                        <div className="text-sm">{getHelpPageLabel(entry.page_key)}</div>
                                        <div className="font-mono text-xs text-muted-foreground">
                                          {entry.page_key}
                                        </div>
                                      </TableCell>
                                      <TableCell>
                                        <button
                                          type="button"
                                          className="text-sm font-medium text-primary underline underline-offset-2"
                                          onClick={() => navigateToField(entry)}
                                        >
                                          {getHelpFieldLabel(entry.page_key, entry.field_key)}
                                        </button>
                                        <div className="font-mono text-xs text-muted-foreground">
                                          {entry.field_key}
                                        </div>
                                      </TableCell>
                                      <TableCell>
                                        <div className="space-y-2">
                                          <Textarea
                                            value={draft}
                                            onChange={(e) => handleInlineTextChange(entry.id, e.target.value)}
                                            rows={3}
                                            className="text-sm"
                                          />
                                          <div className="flex justify-end">
                                            <Button
                                              size="sm"
                                              onClick={() => handleSaveRowText(entry.id, entry.help_text)}
                                              disabled={saveDisabled}
                                            >
                                              Save
                                            </Button>
                                          </div>
                                        </div>
                                      </TableCell>
                                      <TableCell>
                                        <button
                                          type="button"
                                          onClick={() => handleToggleActive(entry.id, !entry.is_active)}
                                          disabled={savingRowId === entry.id}
                                        >
                                          <Badge variant={entry.is_active ? 'default' : 'secondary'}>
                                            {entry.is_active ? 'Active' : 'Inactive'}
                                          </Badge>
                                        </button>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-[780px]">
          <DialogHeader>
            <DialogTitle>Add Help Tip</DialogTitle>
            <DialogDescription>
              Pick a field on a page in a new tab, then save globally.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Page Key</Label>
                <Input
                  value={addForm.pageKey}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, pageKey: e.target.value }))}
                  placeholder="settings.locations"
                />
              </div>
              <div className="space-y-2">
                <Label>Route Path</Label>
                <Input
                  value={addForm.routePath}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, routePath: e.target.value }))}
                  placeholder="/settings?tab=locations"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Field Key</Label>
                <Input
                  value={addForm.fieldKey}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, fieldKey: e.target.value }))}
                  placeholder="warehouse_filter"
                />
              </div>
              <div className="space-y-2">
                <Label>Field Label</Label>
                <Input
                  value={addForm.fieldLabel}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, fieldLabel: e.target.value }))}
                  placeholder="Warehouse Filter"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Field Selector (from picker)</Label>
              <Input
                value={addForm.targetSelector}
                onChange={(e) => setAddForm((prev) => ({ ...prev, targetSelector: e.target.value }))}
                placeholder="#warehouse_id"
              />
            </div>

            <div className="space-y-2">
              <Label>Help Text</Label>
              <Textarea
                value={addForm.helpText}
                onChange={(e) => setAddForm((prev) => ({ ...prev, helpText: e.target.value }))}
                rows={5}
                placeholder="Enter help text..."
              />
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setAddForm((prev) => ({ ...prev, isActive: !prev.isActive }))}
                className="inline-flex"
              >
                <Badge variant={addForm.isActive ? 'default' : 'secondary'}>
                  {addForm.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </button>

              <Button variant="outline" onClick={openPicker}>
                <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
                Pick Field On Page
              </Button>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              Picker route templates:{' '}
              {GLOBAL_HELP_PAGE_DEFINITIONS.slice(0, 4).map((definition, index) => (
                <span key={definition.pageKey}>
                  {index > 0 && ' · '}
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() =>
                      setAddForm((prev) => ({
                        ...prev,
                        pageKey: definition.pageKey,
                        routePath: definition.fallbackRoute,
                      }))
                    }
                  >
                    {definition.label}
                  </button>
                </span>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateEntry}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
