/**
 * ClaimsSOP Component
 * Internal Standard Operating Procedures for claims processing
 * Note: This content is INTERNAL ONLY - never shown to customers
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { jsPDF } from 'jspdf';
import { useToast } from '@/hooks/use-toast';

interface SOPSection {
  id: string;
  title: string;
  icon: string;
  content: React.ReactNode;
}

export function ClaimsSOP() {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);

  const handleDownloadPDF = async () => {
    setDownloading(true);
    try {
      const doc = new jsPDF();
      let y = 20;

      // Title
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('Claims Standard Operating Procedures', 105, y, { align: 'center' });
      y += 15;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text('INTERNAL USE ONLY - CONFIDENTIAL', 105, y, { align: 'center' });
      y += 10;
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 105, y, { align: 'center' });
      y += 20;

      // Section 1: Claim Intake
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('1. Claim Intake Checklist', 20, y);
      y += 8;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const intakeItems = [
        'Verify claim number is assigned',
        'Confirm account and sidemark association',
        'Check for photos/documentation attached',
        'Verify incident date and description',
        'Review coverage type and declared values',
        'Initialize SLA tracking',
      ];
      intakeItems.forEach(item => {
        doc.text(`• ${item}`, 25, y);
        y += 5;
      });
      y += 10;

      // Section 2: Liability Claim Workflow
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('2. Liability Claim Workflow', 20, y);
      y += 8;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const liabilitySteps = [
        '1. Review claim within SLA (8 business hours)',
        '2. Run system analysis for recommendation',
        '3. If under auto-approval threshold with high confidence: auto-approve',
        '4. If over threshold: escalate for manual review',
        '5. Document decision with override reason if applicable',
        '6. Send settlement offer to customer',
        '7. Process payout upon acceptance',
      ];
      liabilitySteps.forEach(step => {
        doc.text(step, 25, y);
        y += 5;
      });
      y += 10;

      // Section 3: Shipping Damage Workflow
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('3. Shipping Damage (Assistance) Workflow', 20, y);
      y += 8;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const shippingSteps = [
        '1. Create assistance billing event upon claim creation',
        '2. Collect all damage documentation',
        '3. Prepare carrier claim packet within SLA',
        '4. Generate public report for carrier submission',
        '5. Track carrier claim status separately',
        '6. No warehouse payout - assistance only',
      ];
      shippingSteps.forEach(step => {
        doc.text(step, 25, y);
        y += 5;
      });

      // Add more pages as needed
      doc.addPage();
      y = 20;

      // Section 4: SLA Handling
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('4. SLA Handling Rules', 20, y);
      y += 8;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const slaRules = [
        'Initial Review: 8 business hours from creation',
        'Manual Review: 16 business hours from creation',
        'Auto-Approved Payout: 24 hours from approval',
        'Shipping Damage Packet: 16 business hours',
        'Missing Docs: Pause SLA and track pause time',
        'Resume SLA when docs received',
        'Always push due date forward by paused duration',
      ];
      slaRules.forEach(rule => {
        doc.text(`• ${rule}`, 25, y);
        y += 5;
      });
      y += 10;

      // Section 5: Communication
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('5. Customer Communication Rules', 20, y);
      y += 8;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const commRules = [
        'Never mention "AI" or "artificial intelligence"',
        'Use "system" or "standardized rules" language',
        'Include claims processing notice in all communications',
        'Be factual about coverage and valuation methods',
        'Explain POP requirements clearly when applicable',
      ];
      commRules.forEach(rule => {
        doc.text(`• ${rule}`, 25, y);
        y += 5;
      });
      y += 10;

      // Section 6: Override Policy
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('6. Override Policy & Approval Standards', 20, y);
      y += 8;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const overridePolicy = [
        'Document reason for every override',
        'Valid reasons: missing_docs, customer_goodwill, exception, incorrect_input, policy_override',
        'Customer goodwill requires supervisor approval above threshold',
        'Policy overrides must be documented with policy reference',
        'Track all overrides for quality improvement',
      ];
      overridePolicy.forEach(rule => {
        doc.text(`• ${rule}`, 25, y);
        y += 5;
      });

      // Footer
      doc.setFontSize(8);
      doc.setTextColor(128, 128, 128);
      doc.text('Stride WMS - Claims SOP - Internal Use Only', 105, 285, { align: 'center' });

      // Download
      doc.save('Claims-SOP.pdf');
      toast({
        title: 'SOP Downloaded',
        description: 'Claims SOP PDF has been downloaded.',
      });
    } catch (error) {
      console.error('Error generating SOP PDF:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to generate SOP PDF',
      });
    } finally {
      setDownloading(false);
    }
  };

  const sections: SOPSection[] = [
    {
      id: 'intake',
      title: '1. Claim Intake Checklist',
      icon: 'checklist',
      content: (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Complete these steps when a new claim is received:
          </p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <MaterialIcon name="check_box" size="sm" className="text-green-600 mt-0.5" />
              <span>Verify claim number is assigned automatically</span>
            </li>
            <li className="flex items-start gap-2">
              <MaterialIcon name="check_box" size="sm" className="text-green-600 mt-0.5" />
              <span>Confirm account and sidemark association is correct</span>
            </li>
            <li className="flex items-start gap-2">
              <MaterialIcon name="check_box" size="sm" className="text-green-600 mt-0.5" />
              <span>Check for photos and supporting documentation</span>
            </li>
            <li className="flex items-start gap-2">
              <MaterialIcon name="check_box" size="sm" className="text-green-600 mt-0.5" />
              <span>Verify incident date and description are complete</span>
            </li>
            <li className="flex items-start gap-2">
              <MaterialIcon name="check_box" size="sm" className="text-green-600 mt-0.5" />
              <span>Review coverage type and declared values for accuracy</span>
            </li>
            <li className="flex items-start gap-2">
              <MaterialIcon name="check_box" size="sm" className="text-green-600 mt-0.5" />
              <span>Confirm SLA tracking has been initialized</span>
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'liability',
      title: '2. Liability Claim Workflow',
      icon: 'account_balance',
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Liability claims are warehouse-responsible damages requiring payout:
          </p>
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="outline" className="mt-0.5">1</Badge>
              <div>
                <p className="font-medium">Initial Review</p>
                <p className="text-sm text-muted-foreground">
                  Review claim within SLA (8 business hours). Check all documentation.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="outline" className="mt-0.5">2</Badge>
              <div>
                <p className="font-medium">System Analysis</p>
                <p className="text-sm text-muted-foreground">
                  Run system analysis to get recommendation based on coverage and documentation.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="outline" className="mt-0.5">3</Badge>
              <div>
                <p className="font-medium">Decision</p>
                <p className="text-sm text-muted-foreground">
                  Under auto-approval threshold + high confidence = auto-approve. Otherwise, escalate.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="outline" className="mt-0.5">4</Badge>
              <div>
                <p className="font-medium">Settlement Offer</p>
                <p className="text-sm text-muted-foreground">
                  Send offer to customer with terms. Track acceptance within token expiry.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="outline" className="mt-0.5">5</Badge>
              <div>
                <p className="font-medium">Payout Processing</p>
                <p className="text-sm text-muted-foreground">
                  Process credit, check, or ACH upon customer acceptance.
                </p>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'shipping',
      title: '3. Shipping Damage (Assistance) Workflow',
      icon: 'local_shipping',
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Shipping damage claims are carrier-responsible. We provide assistance, not payout:
          </p>
          <div className="p-3 border border-blue-200 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Important:</strong> A claim assistance fee is billed automatically when a
              shipping damage claim is created.
            </p>
          </div>
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="outline" className="mt-0.5">1</Badge>
              <div>
                <p className="font-medium">Collect Documentation</p>
                <p className="text-sm text-muted-foreground">
                  Gather all damage photos, delivery receipts, BOLs, and related docs.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="outline" className="mt-0.5">2</Badge>
              <div>
                <p className="font-medium">Prepare Carrier Packet</p>
                <p className="text-sm text-muted-foreground">
                  Generate claim packet for carrier submission within SLA (16 business hours).
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="outline" className="mt-0.5">3</Badge>
              <div>
                <p className="font-medium">Generate Public Report</p>
                <p className="text-sm text-muted-foreground">
                  Create shareable report link for carrier claim submission.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Badge variant="outline" className="mt-0.5">4</Badge>
              <div>
                <p className="font-medium">Track Carrier Response</p>
                <p className="text-sm text-muted-foreground">
                  Monitor carrier claim status. No warehouse payout required.
                </p>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'sla',
      title: '4. SLA Handling Rules',
      icon: 'timer',
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Service Level Agreement timelines:</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="p-3 border rounded-lg">
              <p className="font-medium text-sm">Initial Review</p>
              <p className="text-lg font-bold text-primary">8 business hours</p>
            </div>
            <div className="p-3 border rounded-lg">
              <p className="font-medium text-sm">Manual Review</p>
              <p className="text-lg font-bold text-primary">16 business hours</p>
            </div>
            <div className="p-3 border rounded-lg">
              <p className="font-medium text-sm">Auto-Approved Payout</p>
              <p className="text-lg font-bold text-primary">24 hours</p>
            </div>
            <div className="p-3 border rounded-lg">
              <p className="font-medium text-sm">Shipping Damage Packet</p>
              <p className="text-lg font-bold text-primary">16 business hours</p>
            </div>
          </div>
          <Separator />
          <div>
            <h4 className="font-medium mb-2">Pause/Resume Rules</h4>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>• Pause SLA when waiting for customer documents</li>
              <li>• Resume when documents are received</li>
              <li>• Push due date forward by total paused duration</li>
              <li>• Track cumulative pause time for reporting</li>
            </ul>
          </div>
        </div>
      ),
    },
    {
      id: 'communication',
      title: '5. Customer Communication Rules',
      icon: 'chat',
      content: (
        <div className="space-y-4">
          <div className="p-3 border border-red-200 bg-red-50 rounded-lg">
            <p className="text-sm text-red-800">
              <strong>Critical:</strong> Never use the words "AI" or "artificial intelligence" in
              customer-facing communications.
            </p>
          </div>
          <div>
            <h4 className="font-medium mb-2">Approved Language</h4>
            <ul className="space-y-1 text-sm">
              <li className="flex items-center gap-2">
                <MaterialIcon name="check" size="sm" className="text-green-600" />
                "Claims management system"
              </li>
              <li className="flex items-center gap-2">
                <MaterialIcon name="check" size="sm" className="text-green-600" />
                "Standardized rules"
              </li>
              <li className="flex items-center gap-2">
                <MaterialIcon name="check" size="sm" className="text-green-600" />
                "System-calculated valuation"
              </li>
              <li className="flex items-center gap-2">
                <MaterialIcon name="check" size="sm" className="text-green-600" />
                "Automated processing"
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium mb-2">Prohibited Language</h4>
            <ul className="space-y-1 text-sm">
              <li className="flex items-center gap-2">
                <MaterialIcon name="close" size="sm" className="text-red-600" />
                "AI-powered" or "AI analysis"
              </li>
              <li className="flex items-center gap-2">
                <MaterialIcon name="close" size="sm" className="text-red-600" />
                "Machine learning"
              </li>
              <li className="flex items-center gap-2">
                <MaterialIcon name="close" size="sm" className="text-red-600" />
                "Algorithm decided"
              </li>
            </ul>
          </div>
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm font-medium text-blue-800 mb-1">Standard Notice (use in all communications):</p>
            <p className="text-sm text-blue-700 italic">
              "Claims are processed through our claims management system using standardized rules
              based on coverage selection and documentation. This keeps outcomes consistent and fair.
              If documentation is missing, the system applies default valuation methods."
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'override',
      title: '6. Override Policy & Approval Standards',
      icon: 'gavel',
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            When overriding system recommendations, proper documentation is required:
          </p>
          <div>
            <h4 className="font-medium mb-2">Valid Override Reasons</h4>
            <div className="space-y-2">
              <div className="flex items-start gap-2 p-2 bg-muted/50 rounded">
                <Badge variant="secondary" className="mt-0.5">missing_docs</Badge>
                <span className="text-sm">Documentation was incomplete or incorrect</span>
              </div>
              <div className="flex items-start gap-2 p-2 bg-muted/50 rounded">
                <Badge variant="secondary" className="mt-0.5">customer_goodwill</Badge>
                <span className="text-sm">Business decision to exceed calculated amount</span>
              </div>
              <div className="flex items-start gap-2 p-2 bg-muted/50 rounded">
                <Badge variant="secondary" className="mt-0.5">exception</Badge>
                <span className="text-sm">Unique circumstance not covered by rules</span>
              </div>
              <div className="flex items-start gap-2 p-2 bg-muted/50 rounded">
                <Badge variant="secondary" className="mt-0.5">incorrect_input</Badge>
                <span className="text-sm">System received incorrect data</span>
              </div>
              <div className="flex items-start gap-2 p-2 bg-muted/50 rounded">
                <Badge variant="secondary" className="mt-0.5">policy_override</Badge>
                <span className="text-sm">Following specific policy exception</span>
              </div>
            </div>
          </div>
          <Separator />
          <div>
            <h4 className="font-medium mb-2">Approval Requirements</h4>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>• Document reason for every override</li>
              <li>• Customer goodwill above threshold requires supervisor approval</li>
              <li>• Policy overrides must reference specific policy</li>
              <li>• All overrides are tracked for quality improvement</li>
            </ul>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <MaterialIcon name="menu_book" size="lg" />
            Claims Standard Operating Procedures
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Internal reference guide for claims processing
          </p>
        </div>
        <Button onClick={handleDownloadPDF} disabled={downloading}>
          {downloading ? (
            <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />
          ) : (
            <MaterialIcon name="download" size="sm" className="mr-2" />
          )}
          Download PDF
        </Button>
      </div>

      {/* Confidential Notice */}
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 text-amber-800">
            <MaterialIcon name="lock" size="md" />
            <span className="font-medium">Internal Use Only</span>
          </div>
          <p className="text-sm text-amber-700 mt-1">
            This document contains internal procedures and should not be shared with customers.
          </p>
        </CardContent>
      </Card>

      {/* SOP Sections */}
      <Accordion type="multiple" defaultValue={['intake', 'liability']} className="space-y-4">
        {sections.map(section => (
          <AccordionItem key={section.id} value={section.id} className="border rounded-lg">
            <AccordionTrigger className="px-4 hover:no-underline">
              <div className="flex items-center gap-3">
                <MaterialIcon name={section.icon} size="md" className="text-primary" />
                <span className="font-medium">{section.title}</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">{section.content}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
