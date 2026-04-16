/**
 * useSidemarkLabel - Hook to get the appropriate sidemark/reference label for an account
 *
 * Sub-accounts can be configured to display "Reference" instead of "Sidemark"
 * This is useful for projects that use sidemarks as a project reference field.
 */

import { useAccounts } from './useAccounts';

export function useSidemarkLabel(accountId: string | null | undefined) {
  const { getSidemarkLabel } = useAccounts();

  if (!accountId) {
    return {
      label: 'Sidemark',
      labelLower: 'sidemark',
      labelPlural: 'Sidemarks',
      labelPluralLower: 'sidemarks',
    };
  }

  const setting = getSidemarkLabel(accountId);
  const isReference = setting === 'reference';

  return {
    label: isReference ? 'Reference' : 'Sidemark',
    labelLower: isReference ? 'reference' : 'sidemark',
    labelPlural: isReference ? 'References' : 'Sidemarks',
    labelPluralLower: isReference ? 'references' : 'sidemarks',
  };
}

/**
 * Standalone function to get sidemark label (for use outside React components)
 */
export function getSidemarkDisplayLabel(sidemarkLabel: string | null | undefined): {
  label: string;
  labelLower: string;
  labelPlural: string;
  labelPluralLower: string;
} {
  const isReference = sidemarkLabel === 'reference';

  return {
    label: isReference ? 'Reference' : 'Sidemark',
    labelLower: isReference ? 'reference' : 'sidemark',
    labelPlural: isReference ? 'References' : 'Sidemarks',
    labelPluralLower: isReference ? 'references' : 'sidemarks',
  };
}
