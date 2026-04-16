/**
 * useClaimReport Hook
 * Handles public claim report generation and sharing
 * Generates PDF reports and downloadable ZIP packages
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { jsPDF } from 'jspdf';
import type { Claim, ClaimItem } from './useClaims';
import { getClaimNoticeText } from '@/components/claims/ClaimNotice';

export interface ClaimReportData {
  claim: Claim;
  items: ClaimItem[];
  attachments: ClaimAttachment[];
  account: {
    id: string;
    account_name: string;
    account_code: string;
  } | null;
  organization: {
    company_name: string;
    address_line1?: string;
    city?: string;
    state?: string;
    zip?: string;
    phone?: string;
    email?: string;
  } | null;
}

export interface ClaimAttachment {
  id: string;
  claim_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  uploaded_at: string;
}

function generateReportToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

export function useClaimReport() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);

  /**
   * Fetch full claim data for report generation
   */
  const fetchClaimReportData = useCallback(
    async (claimId: string): Promise<ClaimReportData | null> => {
      if (!profile?.tenant_id) return null;

      try {
        // Fetch claim with related data
        const { data: claim, error: claimError } = await supabase
          .from('claims')
          .select(
            `
            *,
            account:accounts(id, account_name, account_code)
          `
          )
          .eq('id', claimId)
          .eq('tenant_id', profile.tenant_id)
          .single();

        if (claimError || !claim) throw claimError || new Error('Claim not found');

        // Fetch claim items
        const { data: items, error: itemsError } = await supabase
          .from('claim_items')
          .select('*')
          .eq('claim_id', claimId);

        if (itemsError) throw itemsError;

        // Fetch attachments
        const { data: attachments, error: attachmentsError } = await supabase
          .from('claim_attachments')
          .select('*')
          .eq('claim_id', claimId);

        if (attachmentsError) throw attachmentsError;

        // Fetch organization settings
        const { data: orgSettings } = await supabase
          .from('tenant_company_settings')
          .select('company_name, address_line1, city, state, zip, phone, email')
          .eq('tenant_id', profile.tenant_id)
          .maybeSingle();

        return {
          claim: claim as Claim,
          items: (items || []) as unknown as ClaimItem[],
          attachments: (attachments || []) as unknown as ClaimAttachment[],
          account: claim.account as ClaimReportData['account'],
          organization: orgSettings as unknown as ClaimReportData['organization'],
        };
      } catch (error) {
        console.error('Error fetching claim report data:', error);
        return null;
      }
    },
    [profile?.tenant_id]
  );

  /**
   * Generate or get existing public report token
   */
  const getOrCreatePublicToken = useCallback(
    async (claimId: string): Promise<string | null> => {
      if (!profile?.tenant_id) return null;

      try {
        // Check for existing token
        const { data: claim, error } = await supabase
          .from('claims')
          .select('public_report_token')
          .eq('id', claimId)
          .eq('tenant_id', profile.tenant_id)
          .single();

        if (error) throw error;

        if (claim?.public_report_token) {
          return claim.public_report_token;
        }

        // Generate new token
        const token = generateReportToken();
        const { error: updateError } = await supabase
          .from('claims')
          .update({ public_report_token: token })
          .eq('id', claimId)
          .eq('tenant_id', profile.tenant_id);

        if (updateError) throw updateError;

        return token;
      } catch (error) {
        console.error('Error generating public token:', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to generate public link',
        });
        return null;
      }
    },
    [profile?.tenant_id, toast]
  );

  /**
   * Revoke public report token
   */
  const revokePublicToken = useCallback(
    async (claimId: string): Promise<boolean> => {
      if (!profile?.tenant_id) return false;

      try {
        const { error } = await supabase
          .from('claims')
          .update({ public_report_token: null })
          .eq('id', claimId)
          .eq('tenant_id', profile.tenant_id);

        if (error) throw error;

        toast({
          title: 'Link Revoked',
          description: 'The public report link has been disabled.',
        });

        return true;
      } catch (error) {
        console.error('Error revoking public token:', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to revoke public link',
        });
        return false;
      }
    },
    [profile?.tenant_id, toast]
  );

  /**
   * Generate PDF report for a claim
   */
  const generatePdfReport = useCallback(
    async (claimId: string): Promise<Blob | null> => {
      setGenerating(true);
      try {
        const reportData = await fetchClaimReportData(claimId);
        if (!reportData) throw new Error('Could not fetch claim data');

        const { claim, items, organization } = reportData;
        const doc = new jsPDF();
        let y = 20;

        // Header
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('Claim Report', 105, y, { align: 'center' });
        y += 15;

        // Organization info
        if (organization?.company_name) {
          doc.setFontSize(12);
          doc.setFont('helvetica', 'normal');
          doc.text(organization.company_name, 105, y, { align: 'center' });
          y += 6;
          if (organization.address_line1) {
            doc.setFontSize(10);
            const address = [
              organization.address_line1,
              `${organization.city || ''}, ${organization.state || ''} ${organization.zip || ''}`,
            ]
              .filter(Boolean)
              .join(', ');
            doc.text(address, 105, y, { align: 'center' });
            y += 6;
          }
        }

        y += 10;

        // Claim details section
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Claim Details', 20, y);
        y += 8;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');

        const details = [
          ['Claim Number:', claim.claim_number],
          ['Status:', (claim.status || 'pending').charAt(0).toUpperCase() + (claim.status || 'pending').slice(1)],
          ['Claim Type:', claim.claim_type?.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) || 'N/A'],
          ['Category:', claim.claim_category === 'shipping_damage' ? 'Shipping Damage (Assistance)' : 'Liability'],
          ['Date Filed:', new Date(claim.created_at).toLocaleDateString()],
          ['Account:', reportData.account?.account_name || 'N/A'],
        ];

        for (const [label, value] of details) {
          doc.setFont('helvetica', 'bold');
          doc.text(label, 20, y);
          doc.setFont('helvetica', 'normal');
          doc.text(String(value), 70, y);
          y += 6;
        }

        y += 5;

        // Description
        if (claim.description) {
          doc.setFont('helvetica', 'bold');
          doc.text('Description:', 20, y);
          y += 6;
          doc.setFont('helvetica', 'normal');
          const descLines = doc.splitTextToSize(claim.description, 170);
          doc.text(descLines, 20, y);
          y += descLines.length * 5 + 5;
        }

        // Items section
        if (items.length > 0) {
          if (y > 220) {
            doc.addPage();
            y = 20;
          }

          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.text('Claimed Items', 20, y);
          y += 8;

          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          doc.text('Item', 20, y);
          doc.text('Quantity', 100, y);
          doc.text('Declared Value', 130, y);
          doc.text('Damage', 170, y);
          y += 6;

          doc.setFont('helvetica', 'normal');
          for (const item of items) {
            if (y > 270) {
              doc.addPage();
              y = 20;
            }

            const itemAny = item as any;
            const itemName = itemAny.item_description || itemAny.item?.item_code || item.item_id || 'Unknown Item';
            const truncatedName = itemName.length > 40 ? itemName.substring(0, 37) + '...' : itemName;
            doc.text(truncatedName, 20, y);
            doc.text(String(itemAny.quantity_affected || 1), 100, y);
            doc.text(item.declared_value ? `$${item.declared_value.toFixed(2)}` : 'N/A', 130, y);
            doc.text(itemAny.damage_type || 'N/A', 170, y);
            y += 5;
          }
        }

        y += 10;

        // Financial summary
        if (y > 230) {
          doc.addPage();
          y = 20;
        }

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Financial Summary', 20, y);
        y += 8;

        doc.setFontSize(10);
        const financialDetails = [
          ['Total Claimed:', claim.total_claimed_amount ? `$${claim.total_claimed_amount.toFixed(2)}` : 'N/A'],
          ['Approved Amount:', claim.approved_payout_amount ? `$${claim.approved_payout_amount.toFixed(2)}` : 'Pending'],
        ];

        if (claim.status === 'approved' || claim.status === 'settled') {
          financialDetails.push([
            'Approved By:',
            claim.approved_by_system ? 'System (Auto-Approved)' : 'Manual Review',
          ]);
        }

        for (const [label, value] of financialDetails) {
          doc.setFont('helvetica', 'bold');
          doc.text(label, 20, y);
          doc.setFont('helvetica', 'normal');
          doc.text(value, 70, y);
          y += 6;
        }

        // Notice
        y += 10;
        if (y > 240) {
          doc.addPage();
          y = 20;
        }

        doc.setFillColor(239, 246, 255);
        doc.roundedRect(15, y - 5, 180, 30, 3, 3, 'F');
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 58, 138);
        const noticeText = getClaimNoticeText('email');
        const noticeLines = doc.splitTextToSize(noticeText, 170);
        doc.text(noticeLines, 20, y + 2);
        doc.setTextColor(0, 0, 0);

        // Footer
        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
          doc.setPage(i);
          doc.setFontSize(8);
          doc.setTextColor(128, 128, 128);
          doc.text(
            `Generated: ${new Date().toLocaleString()} | Page ${i} of ${pageCount}`,
            105,
            290,
            { align: 'center' }
          );
        }

        return doc.output('blob');
      } catch (error) {
        console.error('Error generating PDF report:', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to generate PDF report',
        });
        return null;
      } finally {
        setGenerating(false);
      }
    },
    [fetchClaimReportData, toast]
  );

  /**
   * Download PDF report
   */
  const downloadPdfReport = useCallback(
    async (claimId: string, claimNumber: string): Promise<void> => {
      const blob = await generatePdfReport(claimId);
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Claim-Report-${claimNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: 'Report Downloaded',
        description: `Claim report ${claimNumber} has been downloaded.`,
      });
    },
    [generatePdfReport, toast]
  );

  /**
   * Generate and download ZIP package with claim data and attachments
   */
  const downloadClaimPackage = useCallback(
    async (claimId: string, claimNumber: string): Promise<void> => {
      setGenerating(true);
      try {
        const reportData = await fetchClaimReportData(claimId);
        if (!reportData) throw new Error('Could not fetch claim data');

        // Dynamic import for JSZip
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();

        // Add PDF report
        const pdfBlob = await generatePdfReport(claimId);
        if (pdfBlob) {
          zip.file(`Claim-Report-${claimNumber}.pdf`, pdfBlob);
        }

        // Add claim data as JSON
        const claimDataJson = JSON.stringify(
          {
            claim: {
              claim_number: reportData.claim.claim_number,
              status: reportData.claim.status,
              claim_type: reportData.claim.claim_type,
              claim_category: reportData.claim.claim_category,
              description: reportData.claim.description,
              total_claimed_amount: reportData.claim.total_claimed_amount,
              approved_payout_amount: reportData.claim.approved_payout_amount,
              created_at: reportData.claim.created_at,
            },
            account: reportData.account,
            items: reportData.items.map((item) => {
              const itemAny = item as any;
              return {
                item_description: itemAny.item_description || itemAny.item?.item_code,
                quantity_affected: itemAny.quantity_affected || 1,
                declared_value: item.declared_value,
                damage_type: itemAny.damage_type,
                damage_description: itemAny.damage_description || item.determination_notes,
                coverage_type: item.coverage_type,
                coverage_source: item.coverage_source,
                pop_provided: item.pop_provided,
                valuation_method: item.valuation_method,
              };
            }),
          },
          null,
          2
        );
        zip.file('claim-data.json', claimDataJson);

        // Add attachments
        if (reportData.attachments.length > 0) {
          const attachmentsFolder = zip.folder('attachments');
          if (attachmentsFolder) {
            for (const attachment of reportData.attachments) {
              try {
                const { data: fileData, error } = await supabase.storage
                  .from('claim-attachments')
                  .download(attachment.storage_path);

                if (!error && fileData) {
                  attachmentsFolder.file(attachment.file_name, fileData);
                }
              } catch {
                console.warn(`Could not download attachment: ${attachment.file_name}`);
              }
            }
          }
        }

        // Generate and download ZIP
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Claim-Package-${claimNumber}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast({
          title: 'Package Downloaded',
          description: `Claim package for ${claimNumber} has been downloaded.`,
        });
      } catch (error) {
        console.error('Error generating claim package:', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to generate claim package',
        });
      } finally {
        setGenerating(false);
      }
    },
    [fetchClaimReportData, generatePdfReport, toast]
  );

  /**
   * Get public report URL
   */
  const getPublicReportUrl = useCallback(
    async (claimId: string): Promise<string | null> => {
      const token = await getOrCreatePublicToken(claimId);
      if (!token) return null;

      // Construct the public URL
      const baseUrl = window.location.origin;
      return `${baseUrl}/public/claim-report/${token}`;
    },
    [getOrCreatePublicToken]
  );

  /**
   * Copy public report URL to clipboard
   */
  const copyPublicReportUrl = useCallback(
    async (claimId: string): Promise<void> => {
      const url = await getPublicReportUrl(claimId);
      if (!url) return;

      try {
        await navigator.clipboard.writeText(url);
        toast({
          title: 'Link Copied',
          description: 'Public report link has been copied to clipboard.',
        });
      } catch {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to copy link to clipboard',
        });
      }
    },
    [getPublicReportUrl, toast]
  );

  return {
    generating,
    fetchClaimReportData,
    getOrCreatePublicToken,
    revokePublicToken,
    generatePdfReport,
    downloadPdfReport,
    downloadClaimPackage,
    getPublicReportUrl,
    copyPublicReportUrl,
  };
}
