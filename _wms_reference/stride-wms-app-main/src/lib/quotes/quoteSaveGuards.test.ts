import { describe, expect, it } from 'vitest';
import { hasMissingPricingForSelectedServices } from './quoteSaveGuards';

describe('hasMissingPricingForSelectedServices', () => {
  it('returns true when a selected service has no rate data', () => {
    const result = hasMissingPricingForSelectedServices({
      selectedServices: [{ service_id: 'svc-1', is_selected: true }],
      classLines: [],
      classServiceSelections: [],
      rates: [],
      rateOverrides: [],
    });

    expect(result).toBe(true);
  });

  it('returns false when selected services have active rates', () => {
    const result = hasMissingPricingForSelectedServices({
      selectedServices: [{ service_id: 'svc-1', is_selected: true }],
      classLines: [],
      classServiceSelections: [],
      rates: [{ service_id: 'svc-1', class_id: null, is_current: true }],
      rateOverrides: [],
    });

    expect(result).toBe(false);
  });

  it('returns false when a selected service is covered by a rate override', () => {
    const result = hasMissingPricingForSelectedServices({
      selectedServices: [{ service_id: 'svc-1', is_selected: true }],
      classLines: [],
      classServiceSelections: [],
      rates: [],
      rateOverrides: [{ service_id: 'svc-1', class_id: null }],
    });

    expect(result).toBe(false);
  });

  it('ignores non-billable class selections with zero quantity', () => {
    const result = hasMissingPricingForSelectedServices({
      selectedServices: [],
      classLines: [],
      classServiceSelections: [{ class_id: 'class-a', service_id: 'svc-2', is_selected: true, qty_override: 0 }],
      rates: [],
      rateOverrides: [],
    });

    expect(result).toBe(false);
  });

  it('returns true when only some class scopes are covered by overrides', () => {
    const result = hasMissingPricingForSelectedServices({
      selectedServices: [{ service_id: 'svc-1', is_selected: true }],
      classLines: [
        { class_id: 'class-a', qty: 1 },
        { class_id: 'class-b', qty: 1 },
      ],
      classServiceSelections: [],
      rates: [{ service_id: 'svc-1', class_id: 'class-a', is_current: true }],
      rateOverrides: [{ service_id: 'svc-1', class_id: 'class-a' }],
    });

    expect(result).toBe(true);
  });

  it('returns false when selected services are fully covered by class overrides', () => {
    const result = hasMissingPricingForSelectedServices({
      selectedServices: [{ service_id: 'svc-1', is_selected: true }],
      classLines: [
        { class_id: 'class-a', qty: 1 },
        { class_id: 'class-b', qty: 1 },
      ],
      classServiceSelections: [],
      rates: [],
      rateOverrides: [
        { service_id: 'svc-1', class_id: 'class-a' },
        { service_id: 'svc-1', class_id: 'class-b' },
      ],
    });

    expect(result).toBe(false);
  });
});
