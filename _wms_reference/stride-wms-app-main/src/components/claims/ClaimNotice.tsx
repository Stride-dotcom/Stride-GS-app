/**
 * ClaimNotice Component
 * Displays standardized claims processing notices
 * Note: NEVER mention "AI" - use "system" or "standardized rules" language
 */

import { Info, AlertCircle, CheckCircle, Clock, FileText } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

export type ClaimNoticeContext =
  | 'initiated'
  | 'review'
  | 'payout_offer'
  | 'settlement'
  | 'portal_submission'
  | 'portal_detail'
  | 'email';

export type ClaimNoticeVariant = 'info' | 'warning' | 'success' | 'processing';

interface ClaimNoticeProps {
  context: ClaimNoticeContext;
  variant?: ClaimNoticeVariant;
  className?: string;
  compact?: boolean;
}

const NOTICE_CONFIG: Record<
  ClaimNoticeContext,
  {
    title: string;
    message: string;
    variant: ClaimNoticeVariant;
    icon: typeof Info;
  }
> = {
  initiated: {
    title: 'Claim Submitted',
    message:
      'Your claim has been received and will be processed through our claims management system using standardized rules based on your coverage selection and documentation provided.',
    variant: 'info',
    icon: FileText,
  },
  review: {
    title: 'Claim Under Review',
    message:
      'This claim is being processed through our claims management system using standardized rules based on coverage selection and documentation. This keeps outcomes consistent and fair.',
    variant: 'processing',
    icon: Clock,
  },
  payout_offer: {
    title: 'Settlement Offer',
    message:
      'This settlement amount has been calculated using standardized rules based on your coverage selection, declared values, and documentation provided. If documentation was incomplete, default valuation methods were applied.',
    variant: 'info',
    icon: Info,
  },
  settlement: {
    title: 'Claim Settled',
    message:
      'This claim has been settled based on standardized rules and your coverage selection. The payout amount reflects the terms of your valuation coverage.',
    variant: 'success',
    icon: CheckCircle,
  },
  portal_submission: {
    title: 'Claims Processing Information',
    message:
      'Claims are processed through our claims management system using standardized rules based on coverage selection and documentation. This keeps outcomes consistent and fair. To receive full replacement value, please provide proof of purchase documentation with your claim.',
    variant: 'info',
    icon: Info,
  },
  portal_detail: {
    title: 'How Your Claim Is Processed',
    message:
      'Your claim is evaluated using standardized rules based on your coverage selection. If documentation such as proof of purchase is missing, the system applies default valuation methods based on your shipment coverage.',
    variant: 'info',
    icon: Info,
  },
  email: {
    title: 'Claims Processing',
    message:
      'Claims are processed through our claims management system using standardized rules based on coverage selection and documentation provided.',
    variant: 'info',
    icon: Info,
  },
};

const VARIANT_STYLES: Record<ClaimNoticeVariant, string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-900 [&>svg]:text-blue-600',
  warning: 'border-yellow-200 bg-yellow-50 text-yellow-900 [&>svg]:text-yellow-600',
  success: 'border-green-200 bg-green-50 text-green-900 [&>svg]:text-green-600',
  processing: 'border-purple-200 bg-purple-50 text-purple-900 [&>svg]:text-purple-600',
};

export function ClaimNotice({ context, variant, className, compact = false }: ClaimNoticeProps) {
  const config = NOTICE_CONFIG[context];
  const effectiveVariant = variant || config.variant;
  const Icon = config.icon;

  if (compact) {
    return (
      <div
        className={cn(
          'flex items-start gap-2 rounded-md border p-3 text-sm',
          VARIANT_STYLES[effectiveVariant],
          className
        )}
      >
        <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <p className="leading-relaxed">{config.message}</p>
      </div>
    );
  }

  return (
    <Alert className={cn(VARIANT_STYLES[effectiveVariant], className)}>
      <Icon className="h-4 w-4" />
      <AlertTitle>{config.title}</AlertTitle>
      <AlertDescription className="mt-1">{config.message}</AlertDescription>
    </Alert>
  );
}

/**
 * Get plain text notice for emails
 * Returns only the message text without HTML
 */
export function getClaimNoticeText(context: ClaimNoticeContext): string {
  return NOTICE_CONFIG[context].message;
}

/**
 * Get HTML notice for email templates
 */
export function getClaimNoticeHtml(context: ClaimNoticeContext): string {
  const config = NOTICE_CONFIG[context];
  return `
    <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0; font-weight: 600; color: #1e40af; font-size: 14px;">${config.title}</p>
      <p style="margin: 8px 0 0 0; color: #1e3a8a; font-size: 14px; line-height: 1.5;">${config.message}</p>
    </div>
  `;
}

/**
 * Additional notices for specific scenarios
 */
export function ClaimDocumentationNotice({ className }: { className?: string }) {
  return (
    <Alert className={cn('border-amber-200 bg-amber-50', className)}>
      <AlertCircle className="h-4 w-4 text-amber-600" />
      <AlertTitle className="text-amber-900">Documentation Required</AlertTitle>
      <AlertDescription className="text-amber-800 mt-1">
        To receive full replacement value, please provide proof of purchase (receipt, invoice, or
        comparable documentation) for claimed items. Without proof of purchase, claims are settled
        using prorated valuation based on your shipment coverage.
      </AlertDescription>
    </Alert>
  );
}

export function ClaimAutoApprovedNotice({
  amount,
  className,
}: {
  amount: number;
  className?: string;
}) {
  return (
    <Alert className={cn('border-green-200 bg-green-50', className)}>
      <CheckCircle className="h-4 w-4 text-green-600" />
      <AlertTitle className="text-green-900">Claim Auto-Approved</AlertTitle>
      <AlertDescription className="text-green-800 mt-1">
        This claim has been automatically approved for ${amount.toFixed(2)} based on standardized
        processing rules and your coverage selection.
      </AlertDescription>
    </Alert>
  );
}

export function ClaimAssistanceNotice({ fee, className }: { fee: number; className?: string }) {
  return (
    <Alert className={cn('border-blue-200 bg-blue-50', className)}>
      <Info className="h-4 w-4 text-blue-600" />
      <AlertTitle className="text-blue-900">Claim Assistance Service</AlertTitle>
      <AlertDescription className="text-blue-800 mt-1">
        This is a shipping damage claim for carrier-caused damage. We will assist with filing and
        managing the claim with the carrier on your behalf. A claim assistance fee of $
        {fee.toFixed(2)} will be applied to your account.
      </AlertDescription>
    </Alert>
  );
}
