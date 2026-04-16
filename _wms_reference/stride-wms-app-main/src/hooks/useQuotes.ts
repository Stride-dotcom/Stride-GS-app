// Hooks for managing quotes
// Uses (supabase as any) for quote tables until types are regenerated

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  Quote,
  QuoteClass,
  QuoteService,
  QuoteServiceRate,
  QuoteBillingUnit,
  QuoteClassLine,
  QuoteSelectedService,
  QuoteRateOverride,
  QuoteEvent,
  QuoteWithDetails,
  QuoteFormData,
  QuoteStatus,
  QuoteAttachment,
  EditLock,
} from '@/lib/quotes/types';
import { computeStorageDays, formatCurrency } from '@/lib/quotes/calculator';
import { sendEmail, generateServiceQuoteEmail } from '@/lib/emailService';

// Generate UUID without external dependency
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Hook for fetching quote classes from standard classes table
export function useQuoteClasses() {
  const { profile } = useAuth();
  const [classes, setClasses] = useState<QuoteClass[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchClasses = useCallback(async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    try {
      // Fetch from standard classes table (Price List consolidation)
      const { data, error } = await (supabase as any)
        .from('classes')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('code');

      if (error) throw error;

      // Map classes to QuoteClass format
      const quoteClasses: QuoteClass[] = (data || []).map((cls: any, index: number) => ({
        id: cls.id,
        tenant_id: cls.tenant_id,
        name: cls.name || cls.code,
        description: cls.description || `Size class ${cls.code}`,
        display_order: index,
        is_active: true,
        created_at: cls.created_at,
        updated_at: cls.updated_at,
      }));

      setClasses(quoteClasses);
    } catch (e) {
      console.error('Error fetching classes:', e);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id]);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  return { classes, loading, refetch: fetchClasses };
}

// Hook for fetching quote services from charge_types + pricing_rules (unified pricing system)
export function useQuoteServices() {
  const { profile } = useAuth();
  const [services, setServices] = useState<QuoteService[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchServices = useCallback(async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    try {
      // Fetch charge_types (the authoritative pricing source)
      const { data: chargeTypes, error: ctError } = await supabase
        .from('charge_types')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('charge_name');

      if (ctError) throw ctError;

      // Fetch pricing_rules to determine class-based services
      const { data: pricingRules, error: prError } = await supabase
        .from('pricing_rules')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null);

      if (prError) throw prError;

      // Build set of charge_type_ids that have class-based pricing
      const classBasedChargeIds = new Set<string>();
      (pricingRules || []).forEach((pr: any) => {
        if (pr.pricing_method === 'class_based' && pr.class_code) {
          classBasedChargeIds.add(pr.charge_type_id);
        }
      });

      // Map charge_types to QuoteService format
      const mappedServices: QuoteService[] = (chargeTypes || []).map((ct: any) => {
        // Map unit from pricing_rules to billing_unit
        const rules = (pricingRules || []).filter((pr: any) => pr.charge_type_id === ct.id);
        const firstRule = rules[0];
        let billingUnit: QuoteBillingUnit = 'per_piece';
        const unit = (firstRule?.unit || 'each').toLowerCase();
        if (unit === 'day' || unit === 'per_day') billingUnit = 'per_day';
        else if (unit === 'hour' || unit === 'task' || unit === 'per_hour' || unit === 'per_task') billingUnit = 'per_hour';
        else if (unit === 'item' || unit === 'each' || unit === 'piece' || unit === 'per_piece' || unit === 'per_item') billingUnit = 'per_piece';
        else if (unit === 'flat' || unit === 'per_flat') billingUnit = 'flat';

        // Determine category
        let category = ct.category || 'General';

        const isStorageService = ct.default_trigger === 'storage' || 
          ct.charge_code.toLowerCase().includes('strg') || 
          ct.charge_code.toLowerCase().includes('storage') ||
          ct.charge_name.toLowerCase().includes('storage');

        return {
          id: ct.id,
          tenant_id: ct.tenant_id,
          service_code: ct.charge_code,
          category,
          name: ct.charge_name,
          description: ct.notes || '',
          billing_unit: billingUnit,
          trigger_label: category,
          is_storage_service: isStorageService,
          is_taxable_default: ct.is_taxable,
          is_class_based: classBasedChargeIds.has(ct.id),
          display_order: 0,
          is_active: ct.is_active,
          created_at: ct.created_at,
          updated_at: ct.updated_at,
        };
      });

      setServices(mappedServices);
    } catch (e) {
      console.error('Error fetching services from charge_types:', e);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  // Group services by category
  const servicesByCategory = services.reduce(
    (acc, service) => {
      if (!acc[service.category]) {
        acc[service.category] = [];
      }
      acc[service.category].push(service);
      return acc;
    },
    {} as Record<string, QuoteService[]>
  );

  // Separate class-based and non-class-based services
  const classBasedServices = services.filter(s => s.is_class_based);
  const nonClassBasedServices = services.filter(s => !s.is_class_based);
  const storageServices = services.filter(s => s.is_storage_service);

  return {
    services,
    servicesByCategory,
    classBasedServices,
    nonClassBasedServices,
    storageServices,
    loading,
    refetch: fetchServices
  };
}

// Hook for fetching service rates from charge_types + pricing_rules (unified pricing system)
export function useQuoteServiceRates() {
  const { profile } = useAuth();
  const [rates, setRates] = useState<QuoteServiceRate[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRates = useCallback(async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    try {
      // Fetch charge_types to get the charge_type_id → service mapping
      const { data: chargeTypes, error: ctError } = await supabase
        .from('charge_types')
        .select('id, charge_code, notes, created_at, updated_at')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .is('deleted_at', null);

      if (ctError) throw ctError;

      // Fetch pricing_rules for rates
      const { data: pricingRules, error: prError } = await supabase
        .from('pricing_rules')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null);

      if (prError) throw prError;

      // Fetch classes to map class_code to class_id
      const { data: classes, error: classError } = await supabase
        .from('classes')
        .select('id, code')
        .eq('tenant_id', profile.tenant_id);

      if (classError) throw classError;

      const classMap = new Map((classes || []).map(c => [c.code, c.id]));
      const chargeTypeMap = new Map((chargeTypes || []).map((ct: any) => [ct.id, ct]));

      // Convert pricing_rules to QuoteServiceRate format
      const convertedRates: QuoteServiceRate[] = (pricingRules || []).map((pr: any) => {
        const ct = chargeTypeMap.get(pr.charge_type_id);
        return {
          id: pr.id,
          tenant_id: pr.tenant_id,
          service_id: pr.charge_type_id, // charge_type_id IS the service_id now
          class_id: pr.class_code ? classMap.get(pr.class_code) || null : null,
          rate_amount: pr.rate,
          currency: 'USD',
          effective_date: pr.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
          is_current: true,
          notes: ct?.notes || null,
          created_at: pr.created_at,
          updated_at: pr.updated_at,
        };
      });

      setRates(convertedRates);
    } catch (e) {
      console.error('Error fetching rates from pricing_rules:', e);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id]);

  useEffect(() => {
    fetchRates();
  }, [fetchRates]);

  return { rates, loading, refetch: fetchRates };
}

// Main hook for managing quotes
export function useQuotes() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch all quotes
  const fetchQuotes = useCallback(
    async (filters?: {
      status?: QuoteStatus[];
      accountId?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
    }) => {
      if (!profile?.tenant_id) return;
      setLoading(true);
      try {
        let query = (supabase as any)
          .from('quotes')
          .select(
            `
            *,
            account:accounts(id, account_name, account_code, is_wholesale, billing_email)
          `
          )
          .eq('tenant_id', profile.tenant_id)
          .order('created_at', { ascending: false });

        if (filters?.status && filters.status.length > 0) {
          query = query.in('status', filters.status);
        }
        if (filters?.accountId) {
          query = query.eq('account_id', filters.accountId);
        }
        if (filters?.search) {
          query = query.or(
            `quote_number.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`
          );
        }
        if (filters?.dateFrom) {
          query = query.gte('created_at', filters.dateFrom);
        }
        if (filters?.dateTo) {
          query = query.lte('created_at', filters.dateTo);
        }

        const { data, error } = await query.limit(500);

        if (error) throw error;
        setQuotes((data as Quote[]) || []);
      } catch (e: any) {
        // Silently handle "table not found" errors (quotes table may not exist yet)
        if (e?.code === 'PGRST205' || e?.message?.includes('Could not find')) {
          console.warn('Quotes table not available:', e?.message);
          setQuotes([]);
          return;
        }
        console.error('Error fetching quotes:', e);
        toast({
          title: 'Error',
          description: 'Failed to load quotes',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    },
    [profile?.tenant_id, toast]
  );

  // Fetch single quote with all details
  const fetchQuoteDetails = useCallback(
    async (quoteId: string): Promise<QuoteWithDetails | null> => {
      try {
        // Fetch quote
        const { data: quote, error: quoteError } = await (supabase as any)
          .from('quotes')
          .select(
            `
            *,
            account:accounts(id, account_name, account_code, is_wholesale, billing_email)
          `
          )
          .eq('id', quoteId)
          .single();

        if (quoteError) throw quoteError;

        // Fetch class lines - joins with classes table
        const { data: classLines } = await (supabase as any)
          .from('quote_class_lines')
          .select(`*, class:classes(*)`)
          .eq('quote_id', quoteId);

        // Fetch selected services - joins with charge_types table (unified pricing)
        const { data: selectedServices } = await (supabase as any)
          .from('quote_selected_services')
          .select(`*, service:charge_types(*)`)
          .eq('quote_id', quoteId);

        // Fetch rate overrides
        const { data: rateOverrides } = await (supabase as any)
          .from('quote_rate_overrides')
          .select('*')
          .eq('quote_id', quoteId);

        // Fetch class service selections (per-class service selections)
        const { data: classServiceSelections } = await (supabase as any)
          .from('quote_class_service_selections')
          .select('*')
          .eq('quote_id', quoteId);

        // Fetch events
        const { data: events } = await (supabase as any)
          .from('quote_events')
          .select('*')
          .eq('quote_id', quoteId)
          .order('created_at', { ascending: false });

        // Resolve user names for audit trail
        const userIdsToResolve = new Set<string>();
        if (quote.created_by) userIdsToResolve.add(quote.created_by);
        if (events?.length) {
          events.forEach((evt: QuoteEvent) => {
            if (evt.created_by) userIdsToResolve.add(evt.created_by);
          });
        }

        let userNameMap: Record<string, string> = {};
        if (userIdsToResolve.size > 0) {
          const { data: users } = await supabase
            .from('users')
            .select('id, first_name, last_name')
            .in('id', Array.from(userIdsToResolve));
          if (users) {
            users.forEach((u: { id: string; first_name: string | null; last_name: string | null }) => {
              const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Unknown';
              userNameMap[u.id] = name;
            });
          }
        }

        // Find last update event
        const lastUpdateEvent = events?.find((evt: QuoteEvent) => evt.event_type === 'updated');

        // Derive attachments from events
        const addedAttachments = new Map<string, QuoteAttachment>();
        const removedPaths = new Set<string>();

        // Process events in chronological order (oldest first) to build current state
        const chronologicalEvents = [...(events || [])].reverse();
        for (const evt of chronologicalEvents) {
          if (evt.event_type === 'attachment_removed' && evt.payload_json?.storage_path) {
            removedPaths.add(evt.payload_json.storage_path as string);
          }
          if (evt.event_type === 'attachment_added' && evt.payload_json?.storage_path) {
            const storagePath = evt.payload_json.storage_path as string;
            if (!removedPaths.has(storagePath)) {
              addedAttachments.set(storagePath, {
                file_name: (evt.payload_json.file_name as string) || 'Unknown',
                file_url: (evt.payload_json.file_url as string) || '',
                file_size: (evt.payload_json.file_size as number) || 0,
                mime_type: (evt.payload_json.mime_type as string) || '',
                storage_path: storagePath,
                uploaded_by: evt.created_by,
                uploaded_by_name: evt.created_by ? userNameMap[evt.created_by] || null : null,
                uploaded_at: evt.created_at,
              });
            }
          }
        }

        return {
          ...(quote as Quote),
          class_lines: (classLines as QuoteClassLine[]) || [],
          selected_services: (selectedServices as QuoteSelectedService[]) || [],
          class_service_selections: (classServiceSelections || []) as { class_id: string; service_id: string; is_selected: boolean; qty_override: number | null }[],
          rate_overrides: (rateOverrides as QuoteRateOverride[]) || [],
          events: (events as QuoteEvent[]) || [],
          attachments: Array.from(addedAttachments.values()),
          created_by_name: quote.created_by ? userNameMap[quote.created_by] || null : null,
          last_updated_by_name: lastUpdateEvent?.created_by ? userNameMap[lastUpdateEvent.created_by] || null : null,
          last_updated_at: lastUpdateEvent?.created_at || null,
        };
      } catch (e: any) {
        // Silently handle "table not found" errors (quotes table may not exist yet)
        if (e?.code === 'PGRST205' || e?.message?.includes('Could not find')) {
          console.warn('Quotes table not available:', e?.message);
          return null;
        }
        console.error('Error fetching quote details:', e);
        toast({
          title: 'Error',
          description: 'Failed to load quote details',
          variant: 'destructive',
        });
        return null;
      }
    },
    [toast]
  );

  // Create new quote
  const createQuote = useCallback(
    async (formData: QuoteFormData, calculatedTotals?: { subtotal: number; tax: number; grand_total: number; coverage_cost?: number }): Promise<Quote | null> => {
      if (!profile?.tenant_id || !profile?.id) return null;

      try {
        // Generate quote number
        const { data: quoteNumber } = await (supabase as any).rpc('generate_quote_number');

        // Get tenant settings for defaults
        const { data: settings } = await (supabase as any)
          .from('tenant_settings')
          .select('quote_validity_days, default_currency')
          .eq('tenant_id', profile.tenant_id)
          .single();

        const validityDays = settings?.quote_validity_days || 30;
        const expirationDate =
          formData.expiration_date ||
          new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // Create quote with totals
        const { data: quote, error: quoteError } = await (supabase as any)
          .from('quotes')
          .insert({
            tenant_id: profile.tenant_id,
            account_id: formData.account_id,
            quote_number: quoteNumber || `EST-${Date.now()}`,
            status: 'draft',
            currency: formData.currency || settings?.default_currency || 'USD',
            tax_enabled: formData.tax_enabled,
            tax_rate_percent: formData.tax_rate_percent,
            storage_days: computeStorageDays(
              formData.storage_months_input,
              formData.storage_days_input
            ),
            storage_months_input: formData.storage_months_input,
            storage_days_input: formData.storage_days_input,
            rates_locked: formData.rates_locked,
            expiration_date: expirationDate,
            quote_discount_type: formData.quote_discount_type,
            quote_discount_value: formData.quote_discount_value,
            notes: formData.notes,
            internal_notes: formData.internal_notes,
            created_by: profile.id,
            // Coverage fields
            coverage_type: formData.coverage_type,
            total_declared_value: formData.total_declared_value ?? 0,
            coverage_cost: calculatedTotals?.coverage_cost ?? 0,
            // Save calculated totals
            subtotal_before_discounts: calculatedTotals?.subtotal || 0,
            subtotal_after_discounts: calculatedTotals?.subtotal || 0,
            tax_amount: calculatedTotals?.tax || 0,
            grand_total: calculatedTotals?.grand_total || 0,
          })
          .select()
          .single();

        if (quoteError) throw quoteError;

        const createInitialUnifiedNote = async (
          text: string | null | undefined,
          noteType: 'public' | 'internal',
          legacyColumn: 'notes' | 'internal_notes'
        ) => {
          const trimmed = text?.trim();
          if (!trimmed) return;
          const { error: noteError } = await (supabase as any).rpc('create_unified_note', {
            p_entity_type: 'quote',
            p_entity_id: quote.id,
            p_note_text: trimmed,
            p_note_type: noteType,
            p_source_entity_number: quote.quote_number || null,
            p_metadata: {
              source: 'quote_create',
              legacy_column: legacyColumn,
            },
          });
          if (noteError) {
            // Do not block quote creation if note mirroring fails.
            console.warn('[useQuotes] Failed to mirror initial quote note into unified notes:', noteError.message);
          }
        };
        await createInitialUnifiedNote(formData.notes, 'public', 'notes');
        await createInitialUnifiedNote(formData.internal_notes, 'internal', 'internal_notes');

        // Insert class lines
        if (formData.class_lines.length > 0) {
          const classLineInserts = formData.class_lines
            .filter((line) => line.qty > 0)
            .map((line) => ({
              quote_id: quote.id,
              class_id: line.class_id,
              qty: line.qty,
              line_discount_type: line.line_discount_type,
              line_discount_value: line.line_discount_value,
            }));

          if (classLineInserts.length > 0) {
            const { error: lineError } = await (supabase as any)
              .from('quote_class_lines')
              .insert(classLineInserts);
            if (lineError) throw lineError;
          }
        }

        // Insert selected services (non-class based)
        if (formData.selected_services.length > 0) {
          const serviceInserts = formData.selected_services
            .filter((ss) => ss.is_selected)
            .map((ss) => ({
              quote_id: quote.id,
              service_id: ss.service_id,
              is_selected: true,
              hours_input: ss.qty_input ?? ss.hours_input,
            }));

          if (serviceInserts.length > 0) {
            const { error: serviceError } = await (supabase as any)
              .from('quote_selected_services')
              .insert(serviceInserts);
            if (serviceError) throw serviceError;
          }
        }

        // Insert class service selections (per-class service selections)
        if (formData.class_service_selections && formData.class_service_selections.length > 0) {
          const classServiceInserts = formData.class_service_selections
            .filter((css) => css.is_selected)
            .map((css) => ({
              quote_id: quote.id,
              class_id: css.class_id,
              service_id: css.service_id,
              is_selected: css.is_selected,
              qty_override: css.qty_override,
            }));

          if (classServiceInserts.length > 0) {
            const { error: cssError } = await (supabase as any)
              .from('quote_class_service_selections')
              .insert(classServiceInserts);
            if (cssError) throw cssError;
          }
        }

        // Insert rate overrides
        if (formData.rate_overrides.length > 0) {
          const { error: overrideError } = await (supabase as any)
            .from('quote_rate_overrides')
            .insert(
              formData.rate_overrides.map((override) => ({
                quote_id: quote.id,
                ...override,
              }))
            );
          if (overrideError) throw overrideError;
        }

        // Log creation event
        await (supabase as any).from('quote_events').insert({
          tenant_id: profile.tenant_id,
          quote_id: quote.id,
          event_type: 'created',
          created_by: profile.id,
        });

        toast({
          title: 'Quote created',
          description: `Quote ${quote.quote_number} has been created.`,
        });

        return quote as Quote;
      } catch (e) {
        console.error('Error creating quote:', e);
        toast({
          title: 'Error',
          description: 'Failed to create quote',
          variant: 'destructive',
        });
        return null;
      }
    },
    [profile?.tenant_id, profile?.id, toast]
  );

  // Update quote
  const updateQuote = useCallback(
    async (quoteId: string, formData: Partial<QuoteFormData>, calculatedTotals?: { subtotal: number; tax: number; grand_total: number; coverage_cost?: number }): Promise<boolean> => {
      if (!profile?.tenant_id || !profile?.id) return false;

      try {
        // Update quote fields
        const updateData: Record<string, unknown> = {};

        if (formData.account_id !== undefined) updateData.account_id = formData.account_id;
        if (formData.currency !== undefined) updateData.currency = formData.currency;
        if (formData.tax_enabled !== undefined) updateData.tax_enabled = formData.tax_enabled;
        if (formData.tax_rate_percent !== undefined)
          updateData.tax_rate_percent = formData.tax_rate_percent;
        if (
          formData.storage_months_input !== undefined ||
          formData.storage_days_input !== undefined
        ) {
          updateData.storage_months_input = formData.storage_months_input;
          updateData.storage_days_input = formData.storage_days_input;
          updateData.storage_days = computeStorageDays(
            formData.storage_months_input ?? null,
            formData.storage_days_input ?? null
          );
        }
        if (formData.rates_locked !== undefined) updateData.rates_locked = formData.rates_locked;
        if (formData.expiration_date !== undefined)
          updateData.expiration_date = formData.expiration_date;
        if (formData.quote_discount_type !== undefined)
          updateData.quote_discount_type = formData.quote_discount_type;
        if (formData.quote_discount_value !== undefined)
          updateData.quote_discount_value = formData.quote_discount_value;
        if (formData.notes !== undefined) updateData.notes = formData.notes;
        if (formData.coverage_type !== undefined) updateData.coverage_type = formData.coverage_type;
        if (formData.total_declared_value !== undefined) updateData.total_declared_value = formData.total_declared_value ?? 0;
        if (formData.internal_notes !== undefined)
          updateData.internal_notes = formData.internal_notes;

        // Add calculated totals if provided
        if (calculatedTotals) {
          updateData.subtotal_before_discounts = calculatedTotals.subtotal;
          updateData.subtotal_after_discounts = calculatedTotals.subtotal;
          updateData.tax_amount = calculatedTotals.tax;
          updateData.grand_total = calculatedTotals.grand_total;
          updateData.coverage_cost = calculatedTotals.coverage_cost ?? 0;
        }

        // Track update timestamp
        updateData.updated_at = new Date().toISOString();

        if (Object.keys(updateData).length > 0) {
          const { error } = await (supabase as any)
            .from('quotes')
            .update(updateData)
            .eq('id', quoteId);
          if (error) throw error;
        }

        // Update class lines if provided
        if (formData.class_lines) {
          // Delete existing lines
          await (supabase as any).from('quote_class_lines').delete().eq('quote_id', quoteId);

          // Insert new lines
          const classLineInserts = formData.class_lines
            .filter((line) => line.qty > 0)
            .map((line) => ({
              quote_id: quoteId,
              class_id: line.class_id,
              qty: line.qty,
              line_discount_type: line.line_discount_type,
              line_discount_value: line.line_discount_value,
            }));

          if (classLineInserts.length > 0) {
            const { error } = await (supabase as any)
              .from('quote_class_lines')
              .insert(classLineInserts);
            if (error) throw error;
          }
        }

        // Update selected services if provided (non-class based)
        if (formData.selected_services) {
          // Delete existing
          await (supabase as any)
            .from('quote_selected_services')
            .delete()
            .eq('quote_id', quoteId);

          // Insert new
          const serviceInserts = formData.selected_services
            .filter((ss) => ss.is_selected)
            .map((ss) => ({
              quote_id: quoteId,
              service_id: ss.service_id,
              is_selected: true,
              hours_input: ss.qty_input ?? ss.hours_input,
            }));

          if (serviceInserts.length > 0) {
            const { error } = await (supabase as any)
              .from('quote_selected_services')
              .insert(serviceInserts);
            if (error) throw error;
          }
        }

        // Update class service selections if provided (per-class service selections)
        if (formData.class_service_selections) {
          // Delete existing
          await (supabase as any)
            .from('quote_class_service_selections')
            .delete()
            .eq('quote_id', quoteId);

          // Insert new
          const classServiceInserts = formData.class_service_selections
            .filter((css) => css.is_selected)
            .map((css) => ({
              quote_id: quoteId,
              class_id: css.class_id,
              service_id: css.service_id,
              is_selected: css.is_selected,
              qty_override: css.qty_override,
            }));

          if (classServiceInserts.length > 0) {
            const { error } = await (supabase as any)
              .from('quote_class_service_selections')
              .insert(classServiceInserts);
            if (error) throw error;
          }
        }

        // Update rate overrides if provided
        if (formData.rate_overrides) {
          await (supabase as any).from('quote_rate_overrides').delete().eq('quote_id', quoteId);

          if (formData.rate_overrides.length > 0) {
            const { error } = await (supabase as any).from('quote_rate_overrides').insert(
              formData.rate_overrides.map((override) => ({
                quote_id: quoteId,
                ...override,
              }))
            );
            if (error) throw error;
          }
        }

        // Log update event
        await (supabase as any).from('quote_events').insert({
          tenant_id: profile.tenant_id,
          quote_id: quoteId,
          event_type: 'updated',
          created_by: profile.id,
        });

        toast({
          title: 'Quote updated',
          description: 'Your changes have been saved.',
        });

        return true;
      } catch (e) {
        console.error('Error updating quote:', e);
        toast({
          title: 'Error',
          description: 'Failed to update quote',
          variant: 'destructive',
        });
        return false;
      }
    },
    [profile?.tenant_id, profile?.id, toast]
  );

  // Void quote
  const voidQuote = useCallback(
    async (quoteId: string, reason: string): Promise<boolean> => {
      if (!profile?.tenant_id || !profile?.id) return false;

      try {
        const { error } = await (supabase as any)
          .from('quotes')
          .update({
            status: 'void',
            voided_at: new Date().toISOString(),
            voided_by: profile.id,
            void_reason: reason,
          })
          .eq('id', quoteId);

        if (error) throw error;

        // Log void event
        await (supabase as any).from('quote_events').insert({
          tenant_id: profile.tenant_id,
          quote_id: quoteId,
          event_type: 'voided',
          payload_json: { reason },
          created_by: profile.id,
        });

        toast({
          title: 'Quote voided',
          description: 'The quote has been voided.',
        });

        return true;
      } catch (e) {
        console.error('Error voiding quote:', e);
        toast({
          title: 'Error',
          description: 'Failed to void quote',
          variant: 'destructive',
        });
        return false;
      }
    },
    [profile?.tenant_id, profile?.id, toast]
  );

  // Duplicate quote
  const duplicateQuote = useCallback(
    async (quoteId: string, newAccountId?: string): Promise<Quote | null> => {
      if (!profile?.tenant_id || !profile?.id) return null;

      try {
        // Fetch original quote details
        const original = await fetchQuoteDetails(quoteId);
        if (!original) throw new Error('Original quote not found');

        // Create new quote with copied data
        const formData: QuoteFormData = {
          account_id: newAccountId || original.account_id,
          currency: original.currency,
          tax_enabled: original.tax_enabled,
          tax_rate_percent: original.tax_rate_percent,
          storage_months_input: original.storage_months_input,
          storage_days_input: original.storage_days_input,
          rates_locked: original.rates_locked,
          expiration_date: null, // Will use default
          quote_discount_type: original.quote_discount_type,
          quote_discount_value: original.quote_discount_value,
          coverage_type: original.coverage_type ?? null,
          total_declared_value: original.total_declared_value ?? null,
          notes: original.notes,
          internal_notes: original.internal_notes,
          class_lines: original.class_lines.map((line) => ({
            class_id: line.class_id,
            qty: line.qty,
            line_discount_type: line.line_discount_type,
            line_discount_value: line.line_discount_value,
          })),
          class_service_selections: original.class_service_selections.map((css) => ({
            class_id: css.class_id,
            service_id: css.service_id,
            is_selected: css.is_selected,
            qty_override: css.qty_override,
          })),
          selected_services: original.selected_services.map((ss) => ({
            service_id: ss.service_id,
            is_selected: ss.is_selected,
            hours_input: ss.hours_input,
            qty_input: ss.qty_input ?? null,
          })),
          rate_overrides: original.rate_overrides.map((override) => ({
            service_id: override.service_id,
            class_id: override.class_id,
            override_rate_amount: override.override_rate_amount,
            reason: override.reason,
          })),
        };

        return await createQuote(formData);
      } catch (e) {
        console.error('Error duplicating quote:', e);
        toast({
          title: 'Error',
          description: 'Failed to duplicate quote',
          variant: 'destructive',
        });
        return null;
      }
    },
    [profile?.tenant_id, profile?.id, fetchQuoteDetails, createQuote, toast]
  );

  // Send quote via email
  const sendQuote = useCallback(
    async (quoteId: string, recipientEmail: string, recipientName?: string): Promise<boolean> => {
      if (!profile?.tenant_id || !profile?.id) return false;

      try {
        // Fetch quote details
        const quoteDetails = await fetchQuoteDetails(quoteId);
        if (!quoteDetails) {
          throw new Error('Quote not found');
        }

        // Fetch tenant info
        const { data: tenant } = await supabase
          .from('tenants')
          .select('name')
          .eq('id', profile.tenant_id)
          .single();

        // Generate magic link token
        const magicToken = generateUUID();

        // Update quote with magic link token and status
        const { error: updateError } = await (supabase as any)
          .from('quotes')
          .update({
            status: 'sent',
            magic_link_token: magicToken,
            sent_at: new Date().toISOString(),
          })
          .eq('id', quoteId);

        if (updateError) throw updateError;

        // Calculate total items
        const totalItems = quoteDetails.class_lines.reduce((sum, line) => sum + line.qty, 0);

        // Build quote link
        const baseUrl = window.location.origin;
        const quoteLink = `${baseUrl}/quote/accept?token=${magicToken}`;

        // Format expiration date
        const expiresAt = quoteDetails.expiration_date
          ? new Date(quoteDetails.expiration_date).toLocaleDateString()
          : undefined;

        // Generate email content
        const emailContent = generateServiceQuoteEmail({
          recipientName: recipientName || 'Customer',
          accountName: quoteDetails.account?.account_name || 'Your Account',
          warehouseName: tenant?.name || 'Warehouse Services',
          quoteNumber: quoteDetails.quote_number,
          totalAmount: formatCurrency(quoteDetails.grand_total || 0, quoteDetails.currency),
          itemCount: totalItems,
          storageDays: quoteDetails.storage_days || 0,
          quoteLink,
          expiresAt,
        });

        // Send email
        const emailResult = await sendEmail({
          to: recipientEmail,
          toName: recipientName,
          subject: emailContent.subject,
          htmlBody: emailContent.html,
          textBody: emailContent.text,
          emailType: 'service_quote_sent',
          tenantId: profile.tenant_id,
          entityType: 'quote',
          entityId: quoteId,
        });

        if (!emailResult.success) {
          throw new Error(emailResult.error || 'Failed to send email');
        }

        // Log event
        await (supabase as any).from('quote_events').insert({
          tenant_id: profile.tenant_id,
          quote_id: quoteId,
          event_type: 'emailed',
          payload_json: {
            recipient_email: recipientEmail,
            recipient_name: recipientName,
          },
          created_by: profile.id,
        });

        toast({
          title: 'Quote sent',
          description: `Quote ${quoteDetails.quote_number} has been sent to ${recipientEmail}.`,
        });

        return true;
      } catch (e) {
        console.error('Error sending quote:', e);
        toast({
          title: 'Error',
          description: 'Failed to send quote',
          variant: 'destructive',
        });
        return false;
      }
    },
    [profile?.tenant_id, profile?.id, fetchQuoteDetails, toast]
  );

  // Upload attachment to a quote
  const uploadQuoteAttachment = useCallback(
    async (quoteId: string, file: File): Promise<QuoteAttachment | null> => {
      if (!profile?.tenant_id || !profile?.id) return null;

      try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${generateUUID()}.${fileExt}`;
        const storagePath = `${profile.tenant_id}/quotes/${quoteId}/${fileName}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('documents-private')
          .upload(storagePath, file, { contentType: file.type });

        if (uploadError) throw uploadError;

        // Get the URL
        const { data: urlData } = supabase.storage
          .from('documents-private')
          .getPublicUrl(storagePath);

        const fileUrl = urlData.publicUrl;

        // Log attachment event
        await (supabase as any).from('quote_events').insert({
          tenant_id: profile.tenant_id,
          quote_id: quoteId,
          event_type: 'attachment_added',
          payload_json: {
            file_name: file.name,
            file_url: fileUrl,
            file_size: file.size,
            mime_type: file.type,
            storage_path: storagePath,
          },
          created_by: profile.id,
        });

        toast({
          title: 'File Uploaded',
          description: `${file.name} has been attached to the quote.`,
        });

        return {
          file_name: file.name,
          file_url: fileUrl,
          file_size: file.size,
          mime_type: file.type,
          storage_path: storagePath,
          uploaded_by: profile.id,
          uploaded_at: new Date().toISOString(),
        };
      } catch (e) {
        console.error('Error uploading quote attachment:', e);
        toast({
          title: 'Error',
          description: 'Failed to upload attachment',
          variant: 'destructive',
        });
        return null;
      }
    },
    [profile?.tenant_id, profile?.id, toast]
  );

  // Remove attachment from a quote
  const removeQuoteAttachment = useCallback(
    async (quoteId: string, attachment: QuoteAttachment): Promise<boolean> => {
      if (!profile?.tenant_id || !profile?.id) return false;

      try {
        // Remove from storage
        await supabase.storage
          .from('documents-private')
          .remove([attachment.storage_path]);

        // Log removal event
        await (supabase as any).from('quote_events').insert({
          tenant_id: profile.tenant_id,
          quote_id: quoteId,
          event_type: 'attachment_removed',
          payload_json: {
            file_name: attachment.file_name,
            storage_path: attachment.storage_path,
          },
          created_by: profile.id,
        });

        toast({
          title: 'Attachment Removed',
          description: `${attachment.file_name} has been removed.`,
        });

        return true;
      } catch (e) {
        console.error('Error removing quote attachment:', e);
        toast({
          title: 'Error',
          description: 'Failed to remove attachment',
          variant: 'destructive',
        });
        return false;
      }
    },
    [profile?.tenant_id, profile?.id, toast]
  );

  return {
    quotes,
    loading,
    fetchQuotes,
    fetchQuoteDetails,
    createQuote,
    updateQuote,
    voidQuote,
    duplicateQuote,
    sendQuote,
    uploadQuoteAttachment,
    removeQuoteAttachment,
  };
}

// Hook for edit locks
export function useEditLock(resourceType: string, resourceId: string | null) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [lock, setLock] = useState<EditLock | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [lockedByOther, setLockedByOther] = useState(false);

  // Check for existing lock
  const checkLock = useCallback(async () => {
    if (!resourceId || !profile?.tenant_id) return;

    try {
      const { data, error } = await (supabase as any)
        .from('edit_locks')
        .select('*')
        .eq('resource_type', resourceType)
        .eq('resource_id', resourceId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setLock(data as EditLock);
        setIsLocked(true);
        setLockedByOther(data.locked_by !== profile.id);
      } else {
        setLock(null);
        setIsLocked(false);
        setLockedByOther(false);
      }
    } catch (e) {
      console.error('Error checking lock:', e);
    }
  }, [resourceType, resourceId, profile?.tenant_id, profile?.id]);

  // Acquire lock
  const acquireLock = useCallback(async (): Promise<boolean> => {
    if (!resourceId || !profile?.tenant_id || !profile?.id) return false;

    try {
      // First check if lock exists
      const { data: existingLock } = await (supabase as any)
        .from('edit_locks')
        .select('*')
        .eq('resource_type', resourceType)
        .eq('resource_id', resourceId)
        .maybeSingle();

      if (existingLock) {
        // Lock exists - check if we own it
        if (existingLock.locked_by === profile.id) {
          // We already own the lock, update expiry and return success
          await (supabase as any)
            .from('edit_locks')
            .update({
              locked_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            })
            .eq('id', existingLock.id);

          setLock(existingLock as EditLock);
          setIsLocked(true);
          setLockedByOther(false);
          return true;
        } else {
          // Someone else owns the lock
          setLock(existingLock as EditLock);
          setIsLocked(true);
          setLockedByOther(true);
          toast({
            title: 'Record locked',
            description: `This record is being edited by ${existingLock.locked_by_name}`,
            variant: 'destructive',
          });
          return false;
        }
      }

      // No lock exists, create one
      const { data, error } = await (supabase as any)
        .from('edit_locks')
        .insert({
          tenant_id: profile.tenant_id,
          resource_type: resourceType,
          resource_id: resourceId,
          locked_by: profile.id,
          locked_by_name: (profile as any).full_name || profile.email || 'Unknown',
          locked_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        })
        .select()
        .single();

      if (error) {
        // Race condition - someone else created a lock between our check and insert
        // Just check again and see if we can use it
        const { data: raceLock } = await (supabase as any)
          .from('edit_locks')
          .select('*')
          .eq('resource_type', resourceType)
          .eq('resource_id', resourceId)
          .maybeSingle();

        if (raceLock && raceLock.locked_by === profile.id) {
          setLock(raceLock as EditLock);
          setIsLocked(true);
          setLockedByOther(false);
          return true;
        }
        // Someone else got the lock
        console.warn('Lock race condition, another user acquired the lock');
        return false;
      }

      setLock(data as EditLock);
      setIsLocked(true);
      setLockedByOther(false);
      return true;
    } catch (e) {
      console.error('Error acquiring lock:', e);
      return false;
    }
  }, [resourceType, resourceId, profile, toast]);

  // Release lock
  const releaseLock = useCallback(async () => {
    if (!resourceId || !profile?.id) return;

    try {
      await (supabase as any)
        .from('edit_locks')
        .delete()
        .eq('resource_type', resourceType)
        .eq('resource_id', resourceId)
        .eq('locked_by', profile.id);

      setLock(null);
      setIsLocked(false);
      setLockedByOther(false);
    } catch (e) {
      console.error('Error releasing lock:', e);
    }
  }, [resourceType, resourceId, profile?.id]);

  // Check lock on mount and periodically
  useEffect(() => {
    if (resourceId) {
      checkLock();
      const interval = setInterval(checkLock, 30000); // Check every 30s
      return () => clearInterval(interval);
    }
  }, [resourceId, checkLock]);

  // Release lock on unmount
  useEffect(() => {
    return () => {
      if (lock && !lockedByOther) {
        releaseLock();
      }
    };
  }, [lock, lockedByOther, releaseLock]);

  return {
    lock,
    isLocked,
    lockedByOther,
    acquireLock,
    releaseLock,
    checkLock,
  };
}
