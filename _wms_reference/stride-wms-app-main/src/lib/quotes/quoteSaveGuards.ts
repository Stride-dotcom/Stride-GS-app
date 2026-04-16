interface SelectedServiceLike {
  service_id: string;
  is_selected: boolean;
}

interface ClassLineLike {
  class_id: string;
  qty: number;
}

interface ClassServiceSelectionLike {
  class_id: string;
  service_id: string;
  is_selected: boolean;
  qty_override: number | null;
}

interface RateLike {
  service_id: string;
  class_id: string | null;
  is_current?: boolean | null;
}

interface RateOverrideLike {
  service_id: string;
  class_id: string | null;
}

interface MissingPricingGuardInput {
  selectedServices: SelectedServiceLike[];
  classLines: ClassLineLike[];
  classServiceSelections: ClassServiceSelectionLike[];
  rates: RateLike[];
  rateOverrides: RateOverrideLike[];
}

/**
 * Returns true when any currently selected service has no rate data and no override.
 * Persisting calculated totals in that state can silently zero out quote totals.
 */
export function hasMissingPricingForSelectedServices({
  selectedServices,
  classLines,
  classServiceSelections,
  rates,
  rateOverrides,
}: MissingPricingGuardInput): boolean {
  const billableClassIds = new Set(
    classLines
      .filter((line) => (line.qty ?? 0) > 0)
      .map((line) => line.class_id)
  );
  const requiredPricingScopes = new Set<string>();

  const addRequiredScope = (serviceId: string, classId: string | null) => {
    requiredPricingScopes.add(`${serviceId}:${classId ?? 'null'}`);
  };

  const hasCoverage = (serviceId: string, classId: string | null) => {
    const hasOverride = rateOverrides.some(
      (override) =>
        override.service_id === serviceId &&
        (override.class_id === classId || override.class_id === null)
    );
    if (hasOverride) {
      return true;
    }

    return rates.some(
      (rate) =>
        rate.service_id === serviceId &&
        (rate.is_current ?? true) &&
        (rate.class_id === classId || rate.class_id === null)
    );
  };

  for (const service of selectedServices) {
    if (!service.is_selected) {
      continue;
    }
    const hasClassSpecificOverrides = rateOverrides.some(
      (override) =>
        override.service_id === service.service_id &&
        override.class_id !== null
    );
    const hasClassSpecificRates = rates.some(
      (rate) =>
        rate.service_id === service.service_id &&
        rate.class_id !== null &&
        (rate.is_current ?? true)
    );

    if ((hasClassSpecificRates || hasClassSpecificOverrides) && billableClassIds.size > 0) {
      for (const classId of billableClassIds) {
        addRequiredScope(service.service_id, classId);
      }
      continue;
    }

    addRequiredScope(service.service_id, null);
  }

  for (const selection of classServiceSelections) {
    if (selection.is_selected && (selection.qty_override ?? 0) > 0) {
      addRequiredScope(selection.service_id, selection.class_id);
    }
  }

  if (requiredPricingScopes.size === 0) {
    return false;
  }

  return Array.from(requiredPricingScopes).some((scopeKey) => {
    const [serviceId, encodedClassId] = scopeKey.split(':');
    const classId = encodedClassId === 'null' ? null : encodedClassId;
    return !hasCoverage(serviceId, classId);
  });
}
