import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { EntityActivityFeed } from '@/components/activity/EntityActivityFeed';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  useQuotes,
  useQuoteClasses,
  useQuoteServices,
  useQuoteServiceRates,
  useEditLock,
} from '@/hooks/useQuotes';
import { useAccounts } from '@/hooks/useAccounts';
import { useToast } from '@/hooks/use-toast';
import {
  QuoteFormData,
  QuoteWithDetails,
  DiscountType,
  QUOTE_STATUS_CONFIG,
  isQuoteEditable,
  ClassServiceSelection,
} from '@/lib/quotes/types';
import { calculateQuote, formatCurrency, computeStorageDays } from '@/lib/quotes/calculator';
import { hasMissingPricingForSelectedServices } from '@/lib/quotes/quoteSaveGuards';
import { downloadQuotePdf, exportQuoteToExcel, transformQuoteToPdfData, QuotePdfData } from '@/lib/quotes/export';
import { useTenantSettings } from '@/hooks/useTenantSettings';
import { useCoverageSettings } from '@/hooks/useCoverageSettings';
import { useCommunications } from '@/hooks/useCommunications';
import { DocumentCapture } from '@/components/scanner/DocumentCapture';
import { useDocuments } from '@/hooks/useDocuments';
import { HelpTip } from '@/components/ui/help-tip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { UnifiedNotesSection } from '@/components/notes/UnifiedNotesSection';

// NOTE: All services are now dynamically fetched from the Price List (service_events table)
// No hardcoded service codes - the quote tool automatically adapts to whatever
// services and classes exist in the tenant's Price List

export default function QuoteBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isNew = !id || id === 'new';

  // Data hooks
  const { fetchQuoteDetails, createQuote, updateQuote, sendQuote } = useQuotes();
  const { classes, loading: classesLoading } = useQuoteClasses();
  const { services, classBasedServices, nonClassBasedServices, loading: servicesLoading } = useQuoteServices();
  const { rates, loading: ratesLoading } = useQuoteServiceRates();
  const { accounts } = useAccounts();
  const { settings: tenantSettings } = useTenantSettings();
  const { brandSettings } = useCommunications();

  // Quote documents (redesigned Documents field, upload-only)
  const { documents: quoteDocuments, refetch: refetchQuoteDocuments } = useDocuments({
    enabled: !isNew && !!id,
    contextType: 'quote',
    contextId: !isNew && id ? id : undefined,
  });

  // Edit lock
  const { lock, lockedByOther, acquireLock } = useEditLock('quote', isNew ? null : id);

  // Form state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quote, setQuote] = useState<QuoteWithDetails | null>(null);
  const [formData, setFormData] = useState<QuoteFormData>({
    account_id: '',
    currency: 'USD',
    tax_enabled: false,
    tax_rate_percent: null,
    storage_months_input: null,
    storage_days_input: null,
    rates_locked: false,
    expiration_date: null,
    quote_discount_type: null,
    quote_discount_value: null,
    coverage_type: null,
    total_declared_value: null,
    notes: null,
    internal_notes: null,
    class_lines: [],
    class_service_selections: [],
    selected_services: [],
    rate_overrides: [],
  });

  // Coverage settings (uses selected account for rate resolution)
  const { calculateCoverageCost, getCoverageLabel, effectiveRates: coverageRates, loading: coverageLoading } = useCoverageSettings({ accountId: formData.account_id || null });

  // Computed coverage cost
  const coverageCost = useMemo(() => {
    if (!formData.coverage_type || !formData.total_declared_value) return 0;
    return calculateCoverageCost(formData.coverage_type as any, formData.total_declared_value);
  }, [formData.coverage_type, formData.total_declared_value, calculateCoverageCost]);

  // UI state
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());
  const [showDiscountDialog, setShowDiscountDialog] = useState(false);
  const [discountType, setDiscountType] = useState<DiscountType>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [sendName, setSendName] = useState('');
  const [sending, setSending] = useState(false);

  // Define the order and pattern matching for main row services
  // These are the services that appear as columns in the class table (in order)
  const MAIN_ROW_SERVICE_PATTERNS = [
    { pattern: /receiv/i, label: 'Receiving' },
    { pattern: /inspect/i, label: 'Inspection' },
    { pattern: /pull.?prep/i, label: 'Pull Prep' },
  ];

  // Define services for expanded section (in order)
  const EXPANDED_SERVICE_PATTERNS = [
    { pattern: /will.?call/i, label: 'Will Call' },
    { pattern: /disposal/i, label: 'Disposal' },
    { pattern: /return/i, label: 'Returns' },
    { pattern: /sit.?test/i, label: 'Sit Test' },
  ];

  // Main row services: Specific services shown as columns (no storage services)
  // Matched by name pattern and ordered as specified
  const mainRowServices = useMemo(() => {
    const result: { code: string; label: string; service: typeof classBasedServices[0] }[] = [];

    for (const { pattern, label } of MAIN_ROW_SERVICE_PATTERNS) {
      const service = classBasedServices.find(s =>
        pattern.test(s.name) || pattern.test(s.service_code || '')
      );
      if (service) {
        result.push({
          code: service.service_code || service.id,
          label: label,
          service,
        });
      }
    }

    return result;
  }, [classBasedServices]);

  // Storage services: Services billed per-day (for the Storage Duration section)
  const storageServiceList = useMemo(() => {
    return classBasedServices.filter(s => s.billing_unit === 'per_day');
  }, [classBasedServices]);

  // Expanded services: Services specified for expanded section (in order)
  const expandedServices = useMemo(() => {
    const result: { code: string; label: string; service: typeof classBasedServices[0] }[] = [];

    for (const { pattern, label } of EXPANDED_SERVICE_PATTERNS) {
      const service = classBasedServices.find(s =>
        pattern.test(s.name) || pattern.test(s.service_code || '')
      );
      if (service) {
        result.push({
          code: service.service_code || service.id,
          label: label,
          service,
        });
      }
    }

    return result;
  }, [classBasedServices]);

  // All non-class-based services from Price List (dynamically fetched)
  // These are flat-rate services that don't vary by class
  const otherServiceList = useMemo(() => {
    return nonClassBasedServices;
  }, [nonClassBasedServices]);

  // Load existing quote
  useEffect(() => {
    if (!isNew && id) {
      setLoading(true);
      fetchQuoteDetails(id).then((data) => {
        if (data) {
          setQuote(data);
          setFormData({
            account_id: data.account_id,
            currency: data.currency,
            tax_enabled: data.tax_enabled,
            tax_rate_percent: data.tax_rate_percent,
            storage_months_input: data.storage_months_input,
            storage_days_input: data.storage_days_input,
            rates_locked: data.rates_locked,
            expiration_date: data.expiration_date,
            quote_discount_type: data.quote_discount_type,
            quote_discount_value: data.quote_discount_value,
            coverage_type: data.coverage_type ?? null,
            total_declared_value: data.total_declared_value ?? null,
            notes: data.notes,
            internal_notes: data.internal_notes,
            class_lines: data.class_lines.map((line) => ({
              class_id: line.class_id,
              qty: line.qty,
              line_discount_type: line.line_discount_type,
              line_discount_value: line.line_discount_value,
            })),
            class_service_selections: (data.class_service_selections || []).map((css) => ({
              class_id: css.class_id,
              service_id: css.service_id,
              is_selected: css.is_selected,
              qty_override: css.qty_override,
            })),
            selected_services: data.selected_services.map((ss) => ({
              service_id: ss.service_id,
              is_selected: ss.is_selected,
              hours_input: ss.hours_input,
              qty_input: ss.qty_input,
            })),
            rate_overrides: data.rate_overrides.map((override) => ({
              service_id: override.service_id,
              class_id: override.class_id,
              override_rate_amount: override.override_rate_amount,
              reason: override.reason,
            })),
          });
          if (isQuoteEditable(data.status)) {
            // Don't await lock - it's non-blocking
            acquireLock();
          }
        }
        setLoading(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew, fetchQuoteDetails]); // Note: acquireLock intentionally excluded to prevent re-render loop

  // Sync class lines with available classes from price list
  // This ensures new classes added to the price list automatically appear in quotes
  // IMPORTANT: Don't run until quote data is loaded (for existing quotes) to avoid overwriting saved quantities
  useEffect(() => {
    if (classes.length === 0) return;
    // For existing quotes, wait until quote data is loaded before syncing
    if (!isNew && loading) return;

    setFormData((prev) => {
      const existingClassIds = new Set(prev.class_lines.map(l => l.class_id));
      const availableClassIds = new Set(classes.map(c => c.id));

      // Check if we need to add new classes or remove old ones
      const needsNewClasses = classes.some(cls => !existingClassIds.has(cls.id));
      const hasRemovedClasses = prev.class_lines.some(l => !availableClassIds.has(l.class_id));

      if (!needsNewClasses && !hasRemovedClasses && prev.class_lines.length > 0) {
        return prev; // No changes needed
      }

      // Build new class_lines array, preserving existing values
      const newClassLines = classes.map((cls) => {
        const existing = prev.class_lines.find(l => l.class_id === cls.id);
        if (existing) {
          return existing; // Preserve existing values
        }
        // New class - create with default values
        return {
          class_id: cls.id,
          qty: 0,
          line_discount_type: null,
          line_discount_value: null,
        };
      });

      return {
        ...prev,
        class_lines: newClassLines,
      };
    });
  }, [classes, isNew, loading]);

  // Calculate totals
  const calculation = useMemo(() => {
    if (classes.length === 0 || services.length === 0) return null;

    return calculateQuote({
      classes,
      services,
      rates,
      classLines: formData.class_lines,
      selectedServices: formData.selected_services,
      classServiceSelections: formData.class_service_selections,
      rateOverrides: formData.rate_overrides,
      storageDaysInput: formData.storage_days_input,
      storageMonthsInput: formData.storage_months_input,
      quoteDiscountType: formData.quote_discount_type,
      quoteDiscountValue: formData.quote_discount_value,
      taxEnabled: formData.tax_enabled,
      taxRatePercent: formData.tax_rate_percent,
      coverageType: formData.coverage_type,
      totalDeclaredValue: formData.total_declared_value,
      coverageCostOverride: coverageCost,
    });
  }, [classes, services, rates, formData, coverageCost]);

  // Toggle class row expansion
  const toggleClassExpanded = useCallback((classId: string) => {
    setExpandedClasses((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(classId)) {
        newSet.delete(classId);
      } else {
        newSet.add(classId);
      }
      return newSet;
    });
  }, []);

  // Update class line quantity
  const updateClassQty = useCallback((classId: string, qty: number) => {
    setFormData((prev) => ({
      ...prev,
      class_lines: prev.class_lines.map((line) =>
        line.class_id === classId ? { ...line, qty: Math.max(0, qty) } : line
      ),
    }));
  }, []);

  // Get class service selection
  const getClassServiceSelection = useCallback((classId: string, serviceId: string): ClassServiceSelection | undefined => {
    return formData.class_service_selections.find(
      (css) => css.class_id === classId && css.service_id === serviceId
    );
  }, [formData.class_service_selections]);

  // Get or create class service qty (returns current qty or null if not set)
  const getClassServiceQty = useCallback((classId: string, serviceId: string): number | null => {
    const selection = getClassServiceSelection(classId, serviceId);
    return selection?.qty_override ?? null;
  }, [getClassServiceSelection]);

  // Update class service qty (creates selection if needed)
  const updateClassServiceQty = useCallback((classId: string, serviceId: string, qty: number | null) => {
    setFormData((prev) => {
      const existing = prev.class_service_selections.find(
        (css) => css.class_id === classId && css.service_id === serviceId
      );
      if (existing) {
        return {
          ...prev,
          class_service_selections: prev.class_service_selections.map((css) =>
            css.class_id === classId && css.service_id === serviceId
              ? { ...css, qty_override: qty, is_selected: qty !== null && qty > 0 }
              : css
          ),
        };
      } else if (qty !== null && qty > 0) {
        return {
          ...prev,
          class_service_selections: [
            ...prev.class_service_selections,
            { class_id: classId, service_id: serviceId, is_selected: true, qty_override: qty },
          ],
        };
      }
      return prev;
    });
  }, []);

  // Toggle checkbox and set qty to class qty or 0
  const toggleClassServiceCheckbox = useCallback((classId: string, serviceId: string, classQty: number) => {
    setFormData((prev) => {
      const existing = prev.class_service_selections.find(
        (css) => css.class_id === classId && css.service_id === serviceId
      );
      if (existing) {
        const newSelected = !existing.is_selected;
        return {
          ...prev,
          class_service_selections: prev.class_service_selections.map((css) =>
            css.class_id === classId && css.service_id === serviceId
              ? { ...css, is_selected: newSelected, qty_override: newSelected ? classQty : null }
              : css
          ),
        };
      } else {
        return {
          ...prev,
          class_service_selections: [
            ...prev.class_service_selections,
            { class_id: classId, service_id: serviceId, is_selected: true, qty_override: classQty },
          ],
        };
      }
    });
  }, []);

  // Toggle non-class based service selection
  const toggleNonClassService = useCallback((serviceId: string) => {
    setFormData((prev) => {
      const existing = prev.selected_services.find((ss) => ss.service_id === serviceId);
      if (existing) {
        return {
          ...prev,
          selected_services: prev.selected_services.map((ss) =>
            ss.service_id === serviceId ? { ...ss, is_selected: !ss.is_selected } : ss
          ),
        };
      } else {
        return {
          ...prev,
          selected_services: [
            ...prev.selected_services,
            { service_id: serviceId, is_selected: true, hours_input: null, qty_input: null },
          ],
        };
      }
    });
  }, []);

  // Select all for a specific main row service across all classes
  const selectAllForService = useCallback((serviceId: string) => {
    setFormData((prev) => {
      const newSelections = [...prev.class_service_selections];

      // Check if all classes already have this service selected
      const allSelected = classes.every((cls) => {
        const selection = newSelections.find(
          (css) => css.class_id === cls.id && css.service_id === serviceId
        );
        return selection?.is_selected;
      });

      // Toggle: if all selected, deselect all; otherwise select all
      classes.forEach((cls) => {
        const classLine = prev.class_lines.find((l) => l.class_id === cls.id);
        const classQty = classLine?.qty || 0;
        const existingIndex = newSelections.findIndex(
          (css) => css.class_id === cls.id && css.service_id === serviceId
        );

        if (existingIndex >= 0) {
          newSelections[existingIndex] = {
            ...newSelections[existingIndex],
            is_selected: !allSelected,
            qty_override: !allSelected ? classQty : null,
          };
        } else if (!allSelected) {
          newSelections.push({
            class_id: cls.id,
            service_id: serviceId,
            is_selected: true,
            qty_override: classQty,
          });
        }
      });

      return { ...prev, class_service_selections: newSelections };
    });
  }, [classes]);

  // Check if all classes have a service selected
  const isAllSelectedForService = useCallback((serviceId: string) => {
    return classes.every((cls) => {
      const selection = formData.class_service_selections.find(
        (css) => css.class_id === cls.id && css.service_id === serviceId
      );
      return selection?.is_selected;
    });
  }, [classes, formData.class_service_selections]);

  // Check if some (but not all) classes have a service selected
  const isSomeSelectedForService = useCallback((serviceId: string) => {
    const selectedCount = classes.filter((cls) => {
      const selection = formData.class_service_selections.find(
        (css) => css.class_id === cls.id && css.service_id === serviceId
      );
      return selection?.is_selected;
    }).length;
    return selectedCount > 0 && selectedCount < classes.length;
  }, [classes, formData.class_service_selections]);

  // Update non-class service hours/qty
  const updateNonClassServiceInput = useCallback((serviceId: string, field: 'hours_input' | 'qty_input', value: number | null) => {
    setFormData((prev) => ({
      ...prev,
      selected_services: prev.selected_services.map((ss) =>
        ss.service_id === serviceId ? { ...ss, [field]: value } : ss
      ),
    }));
  }, []);

  // Save quote
  const handleSave = async () => {
    if (!formData.account_id) {
      toast({
        title: 'Account required',
        description: 'Please select an account for this quote.',
        variant: 'destructive',
      });
      return;
    }

    const missingPricingData = hasMissingPricingForSelectedServices({
      selectedServices: formData.selected_services,
      classLines: formData.class_lines,
      classServiceSelections: formData.class_service_selections,
      rates,
      rateOverrides: formData.rate_overrides,
    });

    // For new quotes, fail closed when we detect selected services without
    // available pricing data; otherwise we can persist a corrupted $0 total.
    if (isNew && missingPricingData) {
      toast({
        title: 'Pricing data unavailable',
        description: 'Cannot create quote while service rates are unavailable. Please refresh and try again.',
        variant: 'destructive',
      });
      return;
    }

    // Only persist totals when full pricing data is available.
    // This prevents accidentally zeroing stored totals during transient pricing-load failures.
    const calculatedTotals = calculation && !missingPricingData
      ? {
          subtotal: calculation.subtotal_after_discounts,
          tax: calculation.tax_amount,
          grand_total: calculation.grand_total,
          coverage_cost: calculation.coverage_cost,
        }
      : undefined;

    setSaving(true);
    try {
      if (isNew) {
        const newQuote = await createQuote(formData, calculatedTotals);
        if (newQuote) {
          navigate(`/quotes/${newQuote.id}`, { replace: true });
        }
      } else if (id) {
        const updatePayload: Partial<QuoteFormData> = {
          ...formData,
          // Existing quote notes are managed by UnifiedNotesSection.
          notes: undefined,
          internal_notes: undefined,
        };
        await updateQuote(id, updatePayload, calculatedTotals);
      }
    } finally {
      setSaving(false);
    }
  };

  // Apply quote discount
  const applyDiscount = () => {
    const value = parseFloat(discountValue);
    if (!isNaN(value)) {
      setFormData((prev) => ({
        ...prev,
        quote_discount_type: discountType,
        quote_discount_value: value,
      }));
    }
    setShowDiscountDialog(false);
  };

  // Build per-class service lines from calculation engine data
  const buildServiceLines = (): QuotePdfData['serviceLines'] => {
    if (!calculation) return [];
    const lines: QuotePdfData['serviceLines'] = [];

    // Process each service total from the calculation engine
    for (const st of calculation.service_totals) {
      const service = services.find((s) => s.id === st.service_id);
      if (!service) continue;

      // Check if this service has per-class selections
      const classSelections = formData.class_service_selections.filter(
        (css) => css.service_id === st.service_id && css.is_selected && (css.qty_override ?? 0) > 0
      );

      // Also check if it's a class-based service from selectedServices (per_piece/per_class/per_day storage)
      const isClassBased = service.billing_unit === 'per_piece' || service.billing_unit === 'per_class' ||
        (service.billing_unit === 'per_day' && service.is_storage_service);
      const hasClassRates = rates.some((r) => r.service_id === st.service_id && r.class_id !== null);
      const isSelectedService = formData.selected_services.some(
        (ss) => ss.service_id === st.service_id && ss.is_selected
      );

      if (classSelections.length > 0) {
        // Class-based service selections: one row per class
        const storageDays = calculation.storage_days;
        for (const css of classSelections) {
          const cls = classes.find((c) => c.id === css.class_id);
          const rate = getApplicableRateForExport(st.service_id, css.class_id);
          const qty = css.qty_override ?? 0;
          const lineTotal = service.is_storage_service && service.billing_unit === 'per_day'
            ? qty * storageDays * rate
            : qty * rate;

          lines.push({
            serviceName: st.service_name,
            category: st.category,
            className: cls?.name || '-',
            billingUnit: st.billing_unit,
            rate,
            quantity: qty,
            lineTotal,
            isTaxable: true,
          });
        }
      } else if (isSelectedService && isClassBased && hasClassRates) {
        // Selected service with class-specific rates: break out per class
        const storageDays = calculation.storage_days;
        for (const classLine of formData.class_lines) {
          if ((classLine.qty || 0) <= 0) continue;
          const cls = classes.find((c) => c.id === classLine.class_id);
          const rate = getApplicableRateForExport(st.service_id, classLine.class_id);
          const qty = classLine.qty;
          const lineTotal = service.is_storage_service && service.billing_unit === 'per_day'
            ? qty * storageDays * rate
            : qty * rate;

          lines.push({
            serviceName: st.service_name,
            category: st.category,
            className: cls?.name || '-',
            billingUnit: st.billing_unit,
            rate,
            quantity: qty,
            lineTotal,
            isTaxable: true,
          });
        }
      } else {
        // Non-class service: single aggregated row
        lines.push({
          serviceName: st.service_name,
          category: st.category,
          className: undefined,
          billingUnit: st.billing_unit,
          rate: st.rate,
          quantity: st.billable_qty,
          lineTotal: st.total,
          isTaxable: true,
        });
      }
    }

    return lines;
  };

  // Helper to get rate for a service/class combo (mirrors calculator logic)
  const getApplicableRateForExport = (serviceId: string, classId: string | null): number => {
    // Check overrides first
    const override = formData.rate_overrides.find(
      (o) => o.service_id === serviceId && (o.class_id === classId || o.class_id === null)
    );
    if (override) return override.override_rate_amount;

    // Try class-specific rate
    if (classId) {
      const classRate = rates.find(
        (r) => r.service_id === serviceId && r.class_id === classId && r.is_current
      );
      if (classRate) return classRate.rate_amount;
    }

    // Fall back to default rate
    const defaultRate = rates.find(
      (r) => r.service_id === serviceId && r.class_id === null && r.is_current
    );
    return defaultRate?.rate_amount ?? 0;
  };

  // Build common export data
  const buildExportData = (): QuotePdfData | null => {
    if (!quote) return null;

    const pdfData = transformQuoteToPdfData(
      {
        ...quote,
        quote_class_lines: quote.class_lines.map((line) => ({
          ...line,
          id: line.class_id,
          quote_id: quote.id,
          class_id: line.class_id,
          quantity: line.qty,
          rate_amount: 0,
          line_total: 0,
          created_at: quote.created_at,
          quote_class: classes.find((c) => c.id === line.class_id),
        })),
      },
      {
        serviceLines: buildServiceLines(),
        brandColor: brandSettings?.brand_primary_color,
        companyLogo: tenantSettings?.logo_url || undefined,
        companyWebsite: tenantSettings?.company_website || undefined,
        companyName: tenantSettings?.company_name || undefined,
      }
    );

    // Override with live calculation values so the PDF always reflects current state
    if (calculation) {
      pdfData.subtotal = calculation.subtotal_before_discounts;
      pdfData.discountAmount = calculation.quote_discount_amount;
      pdfData.discountType = formData.quote_discount_type || undefined;
      pdfData.discountValue = formData.quote_discount_value || undefined;
      pdfData.taxRate = calculation.tax_rate || undefined;
      pdfData.taxAmount = calculation.tax_amount || undefined;
      pdfData.coverageType = calculation.coverage_type || undefined;
      pdfData.coverageCost = calculation.coverage_cost || undefined;
      pdfData.grandTotal = calculation.grand_total;
    }

    // Override account data from current form state (handles account changes before save)
    const currentAccount = accounts.find(a => a.id === formData.account_id);
    if (currentAccount) {
      pdfData.accountName = currentAccount.account_name;
      pdfData.accountCode = currentAccount.account_code;
      pdfData.contactName = currentAccount.primary_contact_name || undefined;
      pdfData.contactEmail = currentAccount.primary_contact_email || undefined;
    }

    return pdfData;
  };

  // Export to PDF
  const handleExportPdf = async () => {
    const pdfData = buildExportData();
    if (!pdfData) return;

    await downloadQuotePdf(pdfData);
    toast({
      title: 'PDF Downloaded',
      description: `Quote ${quote!.quote_number} has been downloaded as PDF.`,
    });
  };

  // Export to Excel
  const handleExportExcel = () => {
    const pdfData = buildExportData();
    if (!pdfData) return;

    exportQuoteToExcel(pdfData);
    toast({
      title: 'Excel Downloaded',
      description: `Quote ${quote!.quote_number} has been downloaded as Excel.`,
    });
  };

  // Send quote via email
  const handleSend = async () => {
    if (!quote || !id || !sendEmail.trim()) return;

    setSending(true);
    try {
      const success = await sendQuote(id, sendEmail.trim(), sendName.trim() || undefined);
      if (success) {
        setShowSendDialog(false);
        setSendEmail('');
        setSendName('');
        const updatedQuote = await fetchQuoteDetails(id);
        if (updatedQuote) {
          setQuote(updatedQuote);
        }
      }
    } finally {
      setSending(false);
    }
  };

  // Initialize send dialog
  const openSendDialog = () => {
    if (quote?.account) {
      setSendEmail(quote.account.billing_email || '');
      setSendName('');
    }
    setShowSendDialog(true);
  };

  // Check if quote is expired based on expiration_date
  const isExpired = useMemo(() => {
    if (!formData.expiration_date) return false;
    const expirationDate = new Date(formData.expiration_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Compare dates only, not times
    return expirationDate < today;
  }, [formData.expiration_date]);

  // Check if editable - also considers expiration date
  const canEdit = isNew || (quote && isQuoteEditable(quote.status) && !lockedByOther && !isExpired);

  // Loading state
  if (loading || classesLoading || servicesLoading || ratesLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <MaterialIcon name="arrow_back" size="md" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">
                {isNew ? 'New Quote' : quote?.quote_number || 'Quote'}
              </h1>
              {quote && (
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <StatusIndicator status={quote.status} label={QUOTE_STATUS_CONFIG[quote.status].label} size="sm" />
                  {isExpired && (
                    <Badge variant="destructive">
                      <MaterialIcon name="schedule" size="sm" className="mr-1" />
                      Expired
                    </Badge>
                  )}
                  {lockedByOther && lock && (
                    <Badge variant="outline" className="text-amber-600">
                      <MaterialIcon name="lock" size="sm" className="mr-1" />
                      Locked by {lock.locked_by_name}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            {!isNew && quote && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="sm:size-default">
                    <MaterialIcon name="download" size="sm" className="sm:mr-2" />
                    <span className="hidden sm:inline">Export</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleExportPdf}>
                    <MaterialIcon name="description" size="sm" className="mr-2" />
                    Download PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportExcel}>
                    <MaterialIcon name="table_chart" size="sm" className="mr-2" />
                    Download Excel
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {!isNew && quote && quote.status === 'draft' && (
              <Button variant="outline" size="sm" className="sm:size-default" onClick={openSendDialog}>
                <MaterialIcon name="send" size="sm" className="sm:mr-2" />
                <span className="hidden sm:inline">Send Quote</span>
              </Button>
            )}
            {canEdit && (
              <Button onClick={handleSave} disabled={saving} size="sm" className="sm:size-default">
                {saving ? (
                  <MaterialIcon name="progress_activity" size="sm" className="sm:mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="save" size="sm" className="sm:mr-2" />
                )}
                <span className="hidden sm:inline">{isNew ? 'Create Quote' : 'Save Changes'}</span>
                <span className="sm:hidden">Save</span>
              </Button>
            )}
          </div>
        </div>

        {/* Audit Trail */}
        {!isNew && quote && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground bg-muted/50 rounded-lg px-4 py-2">
            {quote.created_by_name && (
              <span className="flex items-center gap-1">
                <MaterialIcon name="person_add" size="sm" />
                Created by <span className="font-medium text-foreground">{quote.created_by_name}</span>
                {' '}on {new Date(quote.created_at).toLocaleDateString()}{' '}
                at {new Date(quote.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {quote.last_updated_by_name && quote.last_updated_at && (
              <span className="flex items-center gap-1">
                <MaterialIcon name="edit" size="sm" />
                Last edited by <span className="font-medium text-foreground">{quote.last_updated_by_name}</span>
                {' '}on {new Date(quote.last_updated_at).toLocaleDateString()}{' '}
                at {new Date(quote.last_updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Quote Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="business" size="md" />
                  Quote Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="account">Account *</Label>
                    <Select
                      value={formData.account_id}
                      onValueChange={(v) => setFormData((p) => ({ ...p, account_id: v }))}
                      disabled={!canEdit}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select account..." />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.account_code} - {account.account_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="expiration">Expiration Date</Label>
                    <div className="flex items-center gap-2">
                      <MaterialIcon name="calendar_today" size="sm" className="text-muted-foreground shrink-0" />
                      <Input
                        id="expiration"
                        type="date"
                        value={formData.expiration_date || ''}
                        onChange={(e) => setFormData((p) => ({ ...p, expiration_date: e.target.value || null }))}
                        disabled={!canEdit}
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="rates-locked"
                      checked={formData.rates_locked}
                      onCheckedChange={(v) => setFormData((p) => ({ ...p, rates_locked: v }))}
                      disabled={!canEdit}
                    />
                    <Label htmlFor="rates-locked" className="flex items-center gap-1">
                      {formData.rates_locked ? <MaterialIcon name="lock" size="sm" /> : <MaterialIcon name="lock_open" size="sm" />}
                      Lock Rates
                    </Label>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Class-Based Services Table - Dynamically populated from Price List */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="inventory_2" size="md" />
                  Items & Services by Class
                </CardTitle>
                <CardDescription>
                  Enter quantities per class. Expand rows to select services. All services are pulled from your Price List.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {classes.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <MaterialIcon name="category" size="xl" className="mx-auto mb-2 opacity-50" />
                    <p>No classes found in your Price List.</p>
                    <p className="text-sm">Add classes to your Price List to create quotes.</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="w-8 px-2 py-2"></th>
                        <th className="px-2 py-2 text-left font-medium">Class</th>
                        <th className="px-2 py-2 text-center font-medium w-24">Qty</th>
                        {/* Dynamic columns for daily rate services (per-day billing) with Select All */}
                        {mainRowServices.map(({ code, label, service }) => (
                          <th key={code} className="px-2 py-2 text-center font-medium min-w-[90px]">
                            <div className="flex flex-col items-center gap-1">
                              <span>{label}</span>
                              <Checkbox
                                checked={isAllSelectedForService(service.id)}
                                onCheckedChange={() => selectAllForService(service.id)}
                                disabled={!canEdit}
                                className={`h-3 w-3 ${isSomeSelectedForService(service.id) ? 'opacity-50' : ''}`}
                                title="Select all"
                              />
                            </div>
                          </th>
                        ))}
                        <th className="px-2 py-2 text-left font-medium">More Services</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classes.map((cls) => {
                        const line = formData.class_lines.find((l) => l.class_id === cls.id);
                        const classQty = line?.qty || 0;
                        const isExpanded = expandedClasses.has(cls.id);

                        // Count selected services for this class (from expanded services only)
                        const selectedCount = formData.class_service_selections.filter(
                          (css) => css.class_id === cls.id && css.is_selected &&
                          expandedServices.some(es => es.service.id === css.service_id)
                        ).length;

                        return (
                          <Collapsible key={cls.id} open={isExpanded} onOpenChange={() => toggleClassExpanded(cls.id)} asChild>
                            <>
                              <tr className={`border-b ${classQty > 0 ? 'bg-primary/5' : ''}`}>
                                <td className="px-2 py-2">
                                  <CollapsibleTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                      <MaterialIcon
                                        name={isExpanded ? 'expand_less' : 'expand_more'}
                                        size="sm"
                                      />
                                    </Button>
                                  </CollapsibleTrigger>
                                </td>
                                <td className="px-2 py-2 font-medium">{cls.name}</td>
                                <td className="px-2 py-2">
                                  <div className="flex items-center justify-center gap-1">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={() => updateClassQty(cls.id, Math.max(0, classQty - 1))}
                                      disabled={!canEdit || classQty <= 0}
                                    >
                                      <MaterialIcon name="remove" size="sm" />
                                    </Button>
                                    <Input
                                      type="number"
                                      min="0"
                                      value={classQty > 0 ? classQty : ''}
                                      onChange={(e) => updateClassQty(cls.id, parseInt(e.target.value) || 0)}
                                      disabled={!canEdit}
                                       className="w-20 h-7 text-center text-sm"
                                      placeholder="0"
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={() => updateClassQty(cls.id, classQty + 1)}
                                      disabled={!canEdit}
                                    >
                                      <MaterialIcon name="add" size="sm" />
                                    </Button>
                                  </div>
                                </td>
                                {/* Dynamic service cells for main row services */}
                                {mainRowServices.map(({ code, service }) => {
                                  const selection = getClassServiceSelection(cls.id, service.id);
                                  const isSelected = selection?.is_selected || false;
                                  const qty = selection?.qty_override;

                                  return (
                                    <td key={code} className="px-2 py-2">
                                      <div className="flex items-center gap-1 justify-center">
                                        <Checkbox
                                          checked={isSelected}
                                          onCheckedChange={() => toggleClassServiceCheckbox(cls.id, service.id, classQty)}
                                          disabled={!canEdit}
                                          className="mr-1"
                                        />
                                        <Input
                                          type="number"
                                          min="0"
                                          step="1"
                                          value={qty ?? ''}
                                          onChange={(e) => updateClassServiceQty(cls.id, service.id, e.target.value ? parseFloat(e.target.value) : null)}
                                          disabled={!canEdit}
                                           className="w-20 h-7 text-center text-sm"
                                          placeholder="0"
                                        />
                                      </div>
                                    </td>
                                  );
                                })}
                                <td className="px-2 py-2">
                                  {selectedCount > 0 ? (
                                    <Badge variant="secondary" className="text-xs">
                                      +{selectedCount} more
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">Expand for more</span>
                                  )}
                                </td>
                              </tr>
                              <CollapsibleContent asChild>
                                <tr>
                                  <td colSpan={4 + mainRowServices.length} className="bg-muted/30 p-0">
                                    <div className="p-3">
                                      <div className="text-xs font-medium text-muted-foreground mb-2">
                                        Additional Services for {cls.name} ({expandedServices.length} services)
                                      </div>
                                      {expandedServices.length === 0 ? (
                                        <div className="text-center py-4 text-muted-foreground text-sm">
                                          No additional services available.
                                        </div>
                                      ) : (
                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                          {expandedServices.map(({ code, label, service }) => {
                                            const selection = getClassServiceSelection(cls.id, service.id);
                                            const isSelected = selection?.is_selected || false;
                                            const qty = selection?.qty_override;

                                            return (
                                              <div
                                                key={code}
                                                className={`flex items-center gap-2 p-2 rounded border ${
                                                  isSelected ? 'border-primary bg-primary/5' : 'border-border'
                                                }`}
                                              >
                                                <Checkbox
                                                  checked={isSelected}
                                                  onCheckedChange={() => toggleClassServiceCheckbox(cls.id, service.id, classQty)}
                                                  disabled={!canEdit}
                                                />
                                                <span className="text-xs flex-1 truncate" title={label}>{label}</span>
                                                <Input
                                                  type="number"
                                                  min="0"
                                                  step="1"
                                                  value={qty ?? ''}
                                                  onChange={(e) => updateClassServiceQty(cls.id, service.id, e.target.value ? parseFloat(e.target.value) : null)}
                                                  disabled={!canEdit}
                                                  className="w-14 h-6 text-center text-xs"
                                                  placeholder="0"
                                                />
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              </CollapsibleContent>
                            </>
                          </Collapsible>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            {/* Other Services - Non-class-based services from Price List (Collapsible) */}
            {otherServiceList.length > 0 && (
              <Collapsible>
                <Card>
                  <CardHeader className="pb-3">
                    <CollapsibleTrigger className="flex items-center justify-between w-full">
                      <CardTitle className="flex items-center gap-2">
                        <MaterialIcon name="handyman" size="md" />
                        Other Services
                        <Badge variant="outline" className="ml-2 text-xs">
                          {otherServiceList.length} available
                        </Badge>
                      </CardTitle>
                      <MaterialIcon name="expand_more" size="md" className="text-muted-foreground" />
                    </CollapsibleTrigger>
                    <CardDescription>
                      Additional services from your Price List (not class-specific)
                    </CardDescription>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent className="pt-0">
                      <div className="space-y-2">
                        {otherServiceList.map((service) => {
                          const selected = formData.selected_services.find(
                            (ss) => ss.service_id === service.id
                          );
                          const isSelected = selected?.is_selected ?? false;

                          return (
                            <div
                              key={service.id}
                              className={`flex items-center justify-between p-3 rounded-lg border ${
                                isSelected ? 'border-primary bg-primary/5' : 'border-border'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => toggleNonClassService(service.id)}
                                  disabled={!canEdit}
                                />
                                <div>
                                  <div className="font-medium">{service.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {service.category} - {service.billing_unit.replace('_', ' ')}
                                  </div>
                                </div>
                              </div>
                              {isSelected && (
                                <div className="flex items-center gap-4">
                                  {service.billing_unit === 'per_hour' && !(/assembl/i.test(service.name)) && (
                                    <div className="flex items-center gap-2">
                                      <Label className="text-xs">Hours:</Label>
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.5"
                                        value={selected?.hours_input || ''}
                                        onChange={(e) =>
                                          updateNonClassServiceInput(
                                            service.id,
                                            'hours_input',
                                            e.target.value ? parseFloat(e.target.value) : null
                                          )
                                        }
                                        disabled={!canEdit}
                                        className="w-20 h-8"
                                      />
                                    </div>
                                  )}
                                  {(service.billing_unit === 'per_piece' || /assembl/i.test(service.name)) && (
                                    <div className="flex items-center gap-2">
                                      <Label className="text-xs">Qty:</Label>
                                      <Input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={selected?.qty_input ?? ''}
                                        onChange={(e) =>
                                          updateNonClassServiceInput(
                                            service.id,
                                            'qty_input',
                                            e.target.value ? parseFloat(e.target.value) : null
                                          )
                                        }
                                        disabled={!canEdit}
                                        className="w-20 h-8"
                                        placeholder="0"
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}

            {/* Storage Duration & Rates */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="warehouse" size="md" />
                  Storage
                </CardTitle>
                <CardDescription>
                  Enter storage duration and select storage rates per class. Rates are pulled from your Price List.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Duration inputs */}
                <div className="flex items-center gap-4">
                  <div className="flex-1 space-y-2">
                    <Label>Days</Label>
                    <Input
                      type="number"
                      min="0"
                      value={formData.storage_days_input || ''}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          storage_days_input: e.target.value ? parseInt(e.target.value) : null,
                        }))
                      }
                      disabled={!canEdit}
                      placeholder="0"
                    />
                  </div>
                  <div className="flex-1 space-y-2">
                    <Label>Months</Label>
                    <Input
                      type="number"
                      min="0"
                      value={formData.storage_months_input || ''}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          storage_months_input: e.target.value ? parseInt(e.target.value) : null,
                        }))
                      }
                      disabled={!canEdit}
                      placeholder="0"
                    />
                  </div>
                  <div className="flex-1 pt-6">
                    <div className="text-sm text-muted-foreground bg-muted p-2 rounded text-center">
                      Total: <span className="font-semibold">{computeStorageDays(formData.storage_months_input, formData.storage_days_input)}</span> days
                    </div>
                  </div>
                </div>

                {/* Storage services per class */}
                {storageServiceList.length > 0 && classes.length > 0 && (
                  <div className="border-t pt-4 mt-4">
                    <div className="text-sm font-medium mb-3">Storage Rates by Class</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="px-2 py-2 text-left font-medium">Class</th>
                            {storageServiceList.map((service) => {
                              // Rename "Storage Charge" to "Std Storage Charge"
                              const displayName = /storage.?charge/i.test(service.name)
                                ? 'Std Storage Charge'
                                : service.name;
                              return (
                                <th key={service.id} className="px-2 py-2 text-center font-medium min-w-[120px]">
                                  <div className="flex flex-col items-center gap-1">
                                    <span>{displayName}</span>
                                    <Checkbox
                                      checked={isAllSelectedForService(service.id)}
                                      onCheckedChange={() => selectAllForService(service.id)}
                                      disabled={!canEdit}
                                      className={`h-3 w-3 ${isSomeSelectedForService(service.id) ? 'opacity-50' : ''}`}
                                      title="Select all"
                                    />
                                  </div>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {classes.map((cls) => {
                            const line = formData.class_lines.find((l) => l.class_id === cls.id);
                            const classQty = line?.qty || 0;

                            return (
                              <tr key={cls.id} className={`border-b ${classQty > 0 ? 'bg-primary/5' : ''}`}>
                                <td className="px-2 py-2 font-medium">{cls.name}</td>
                                {storageServiceList.map((service) => {
                                  const selection = getClassServiceSelection(cls.id, service.id);
                                  const isSelected = selection?.is_selected || false;
                                  const qty = selection?.qty_override;

                                  return (
                                    <td key={service.id} className="px-2 py-2">
                                      <div className="flex items-center gap-1 justify-center">
                                        <Checkbox
                                          checked={isSelected}
                                          onCheckedChange={() => toggleClassServiceCheckbox(cls.id, service.id, classQty)}
                                          disabled={!canEdit}
                                          className="mr-1"
                                        />
                                        <Input
                                          type="number"
                                          min="0"
                                          step="1"
                                          value={qty ?? ''}
                                          onChange={(e) => updateClassServiceQty(cls.id, service.id, e.target.value ? parseFloat(e.target.value) : null)}
                                          disabled={!canEdit}
                                          className="w-20 h-7 text-center text-sm"
                                          placeholder="0"
                                        />
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Storage is calculated as: Qty × {computeStorageDays(formData.storage_months_input, formData.storage_days_input)} days × rate per day
                    </p>
                  </div>
                )}

                {storageServiceList.length === 0 && (
                  <div className="text-center py-4 text-muted-foreground text-sm border-t pt-4 mt-4">
                    <MaterialIcon name="info" size="sm" className="mr-1" />
                    No storage services found in your Price List. Add services with "Day" billing unit.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Valuation Coverage */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="shield" size="md" />
                  Valuation Coverage
                </CardTitle>
                <CardDescription>
                  Add coverage protection for items in this quote. Rates are pulled from your organization settings.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Coverage Type</Label>
                    <Select
                      value={formData.coverage_type || ''}
                      onValueChange={(v) => setFormData((p) => ({ ...p, coverage_type: v || null }))}
                      disabled={!canEdit}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select coverage..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard (No Cost)</SelectItem>
                        <SelectItem value="full_replacement_no_deductible">
                          Full Replacement (No Deductible) — {(coverageRates.full_replacement_no_deductible_rate * 100).toFixed(2)}%
                        </SelectItem>
                        <SelectItem value="full_replacement_deductible">
                          Full Replacement (${coverageRates.deductible_amount} Deductible) — {(coverageRates.full_replacement_deductible_rate * 100).toFixed(2)}%
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Total Declared Value</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.total_declared_value || ''}
                      onChange={(e) =>
                        setFormData((p) => ({
                          ...p,
                          total_declared_value: e.target.value ? parseFloat(e.target.value) : null,
                        }))
                      }
                      disabled={!canEdit}
                      placeholder="$0.00"
                    />
                  </div>
                </div>

                {coverageCost > 0 && (
                  <div className="bg-muted p-3 rounded-lg space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Coverage Type</span>
                      <span className="font-medium">{getCoverageLabel(formData.coverage_type as any)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Declared Value</span>
                      <span className="font-medium">{formatCurrency(formData.total_declared_value || 0)}</span>
                    </div>
                    <Separator className="my-1" />
                    <div className="flex justify-between font-semibold">
                      <span>Coverage Cost</span>
                      <span>{formatCurrency(coverageCost)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Coverage is not subject to tax</p>
                  </div>
                )}

                {formData.coverage_type === 'standard' && (
                  <p className="text-xs text-muted-foreground">
                    Standard coverage has no additional cost. Liability is limited per your service agreement.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {quote?.id ? (
                  <UnifiedNotesSection
                    entityType="quote"
                    entityId={quote.id}
                    entityNumber={quote.quote_number}
                    embedded
                    readOnly={!canEdit}
                    allowedNoteTypes={['internal', 'public']}
                  />
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label>Customer Notes (visible on quote)</Label>
                      <Textarea
                        value={formData.notes || ''}
                        onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value || null }))}
                        disabled={!canEdit}
                        placeholder="Notes to display on the quote..."
                        rows={3}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Internal Notes (not visible to customer)</Label>
                      <Textarea
                        value={formData.internal_notes || ''}
                        onChange={(e) => setFormData((p) => ({ ...p, internal_notes: e.target.value || null }))}
                        disabled={!canEdit}
                        placeholder="Internal notes..."
                        rows={2}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Documents (upload-only; matches Intake Documents UI) */}
            {!isNew && quote && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MaterialIcon name="description" size="sm" />
                    Documents
                    <Badge variant="outline">{quoteDocuments.length}</Badge>
                    <HelpTip
                      tooltip="Upload quote-related documents (specs, photos, paperwork). Tap a thumbnail to open, or use the download icon to download."
                      pageKey="quotes.detail"
                      fieldKey="documents"
                    />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DocumentCapture
                    context={{ type: 'quote', quoteId: id!, quoteNumber: quote.quote_number }}
                    maxDocuments={12}
                    ocrEnabled={true}
                    scanEnabled={false}
                    canEdit={!!canEdit}
                    onDocumentAdded={() => {
                      void refetchQuoteDocuments();
                    }}
                    onDocumentRemoved={() => {
                      void refetchQuoteDocuments();
                    }}
                  />
                </CardContent>
              </Card>
            )}
          </div>

          {/* Summary Panel */}
          <div className="space-y-6">
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="attach_money" size="md" />
                  Quote Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {calculation ? (
                  <>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">Services</div>
                      {calculation.service_totals.map((st) => (
                        <div key={st.service_id} className="flex justify-between text-sm">
                          <span className="truncate pr-2">{st.service_name}</span>
                          <span className="font-mono">{formatCurrency(st.total)}</span>
                        </div>
                      ))}
                      {calculation.service_totals.length === 0 && (
                        <div className="text-sm text-muted-foreground">No services selected</div>
                      )}
                    </div>

                    <Separator />

                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span className="font-semibold">
                        {formatCurrency(calculation.subtotal_before_discounts)}
                      </span>
                    </div>

                    {formData.quote_discount_value && formData.quote_discount_value > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>
                          Discount ({formData.quote_discount_type === 'percentage'
                            ? `${formData.quote_discount_value}%`
                            : formatCurrency(formData.quote_discount_value)}
                          )
                        </span>
                        <span>-{formatCurrency(calculation.quote_discount_amount)}</span>
                      </div>
                    )}

                    {calculation.quote_discount_amount > 0 && (
                      <div className="flex justify-between">
                        <span>After Discount</span>
                        <span className="font-semibold">
                          {formatCurrency(calculation.subtotal_after_discounts)}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Switch
                          id="tax-enabled"
                          checked={formData.tax_enabled}
                          onCheckedChange={(v) => setFormData((p) => ({ ...p, tax_enabled: v }))}
                          disabled={!canEdit}
                        />
                        <Label htmlFor="tax-enabled" className="text-sm">Tax</Label>
                        {formData.tax_enabled && (
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={formData.tax_rate_percent || ''}
                            onChange={(e) =>
                              setFormData((p) => ({
                                ...p,
                                tax_rate_percent: e.target.value ? parseFloat(e.target.value) : null,
                              }))
                            }
                            disabled={!canEdit}
                            className="w-20 h-8"
                            placeholder="%"
                          />
                        )}
                      </div>
                      {formData.tax_enabled && (
                        <span>{formatCurrency(calculation.tax_amount)}</span>
                      )}
                    </div>

                    <Separator />

                    {calculation.coverage_cost > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="flex items-center gap-1">
                          <MaterialIcon name="shield" size="sm" />
                          Valuation Coverage
                        </span>
                        <span className="font-mono">{formatCurrency(calculation.coverage_cost)}</span>
                      </div>
                    )}

                    <div className="flex justify-between text-lg font-bold">
                      <span>Grand Total</span>
                      <span>{formatCurrency(calculation.grand_total)}</span>
                    </div>

                    {calculation.storage_days > 0 && (
                      <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                        Storage: {calculation.storage_days} days
                      </div>
                    )}

                    {canEdit && (
                      <div className="space-y-2 pt-4">
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => setShowDiscountDialog(true)}
                        >
                          <MaterialIcon name="percent" size="sm" className="mr-2" />
                          Add Discount
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <MaterialIcon name="calculate" size="xl" className="mx-auto mb-2 opacity-50" />
                    <p>Configure your quote to see the summary</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {!formData.rates_locked && (
              <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
                <CardContent className="pt-4">
                  <div className="flex gap-2 text-amber-800 dark:text-amber-200 text-sm">
                    <MaterialIcon name="error" size="sm" className="flex-shrink-0 mt-0.5" />
                    <p>
                      Rates are not locked. Prices shown are valid as of today and are subject to
                      change prior to acceptance.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Discount Dialog */}
      <Dialog open={showDiscountDialog} onOpenChange={setShowDiscountDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Quote Discount</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Discount Type</Label>
              <Select value={discountType} onValueChange={(v: DiscountType) => setDiscountType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage (%)</SelectItem>
                  <SelectItem value="flat_rate">Fixed Amount ($)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Value</Label>
              <Input
                type="number"
                min="0"
                step={discountType === 'percentage' ? '1' : '0.01'}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === 'percentage' ? '10' : '50.00'}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDiscountDialog(false)}>
              Cancel
            </Button>
            <Button onClick={applyDiscount}>Apply Discount</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activity Feed */}
      {id && (
        <div className="mt-6">
          <EntityActivityFeed
            entityType="quote"
            entityId={id}
            title="Activity"
            description="Timeline of changes to this quote"
          />
        </div>
      )}

      {/* Send Quote Dialog */}
      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Quote</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Send this quote to the customer. They will receive an email with a link to view and accept or decline the quote.
            </p>
            <div className="space-y-2">
              <Label htmlFor="send-email">Recipient Email *</Label>
              <Input
                id="send-email"
                type="email"
                value={sendEmail}
                onChange={(e) => setSendEmail(e.target.value)}
                placeholder="customer@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="send-name">Recipient Name</Label>
              <Input
                id="send-name"
                value={sendName}
                onChange={(e) => setSendName(e.target.value)}
                placeholder="Recipient name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSendDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={!sendEmail.trim() || sending}>
              {sending ? (
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
              ) : (
                <MaterialIcon name="send" size="sm" className="mr-2" />
              )}
              Send Quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
