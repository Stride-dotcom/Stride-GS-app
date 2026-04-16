import { DefaultPromptDefinition } from '@/types/guidedPrompts';

// ============================================================================
// Default Prompts Library - All 25 prompts across 8 workflows
// ============================================================================

export const DEFAULT_PROMPTS: DefaultPromptDefinition[] = [
  // ========================================================================
  // RECEIVING (5 prompts)
  // ========================================================================
  {
    prompt_key: 'receiving_pre_task',
    workflow: 'receiving',
    trigger_point: 'before',
    prompt_type: 'modal',
    min_level: 'training',
    severity: 'info',
    title: 'Before You Start Receiving',
    message: 'Make sure you have a clear workspace and good lighting. Check that the shipment manifest matches what you are about to receive.',
    tip_text: 'Tip: Count items before scanning to catch discrepancies early.',
    checklist_items: [
      { key: 'manifest_ready', label: 'I have the manifest or packing slip ready', required: true },
      { key: 'workspace_clear', label: 'My workspace is clear and organized', required: false },
      { key: 'camera_ready', label: 'My camera is ready for photos', required: true },
    ],
    buttons: [
      { key: 'confirm', label: 'Start Receiving', variant: 'default', action: 'confirm' },
      { key: 'cancel', label: 'Cancel', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 1,
    is_active: true,
  },
  {
    prompt_key: 'receiving_scan_items_apply_id',
    workflow: 'receiving',
    trigger_point: 'during',
    prompt_type: 'modal',
    min_level: 'training',
    severity: 'blocking', // "No ID, no work" - critical business rule
    title: 'Item ID Required',
    message: 'Each item must have an ID applied before it can be processed. Scan or enter the item ID to continue.',
    tip_text: 'No ID, no work - all items must be tracked.',
    buttons: [
      { key: 'confirm', label: 'ID Applied', variant: 'default', action: 'confirm' },
    ],
    requires_confirmation: true,
    sort_order: 1.5,
    is_active: true,
  },
  {
    prompt_key: 'receiving_photo_reminder',
    workflow: 'receiving',
    trigger_point: 'during',
    prompt_type: 'slide_panel',
    min_level: 'training',
    severity: 'warning', // Photos are important but not always mandatory
    title: 'Photo Required',
    message: 'This item needs a photo before continuing. Take a clear photo showing the item condition and any labels.',
    tip_text: 'Good photos help with claims and inventory tracking.',
    buttons: [
      { key: 'take_photo', label: 'Take Photo Now', variant: 'default', action: 'confirm' },
      { key: 'skip', label: 'Skip for Now', variant: 'outline', action: 'skip' },
    ],
    requires_confirmation: true,
    sort_order: 2,
    is_active: true,
  },
  {
    prompt_key: 'receiving_damage_check',
    workflow: 'receiving',
    trigger_point: 'during',
    prompt_type: 'modal',
    min_level: 'standard',
    severity: 'warning',
    title: 'Damage Inspection',
    message: 'Carefully inspect the item for any visible damage. Document any issues found with photos and notes.',
    checklist_items: [
      { key: 'exterior_checked', label: 'Exterior packaging inspected', required: true },
      { key: 'damage_documented', label: 'Any damage has been photographed', required: false },
    ],
    buttons: [
      { key: 'no_damage', label: 'No Damage Found', variant: 'default', action: 'confirm' },
      { key: 'damage_found', label: 'Report Damage', variant: 'destructive', action: 'confirm' },
    ],
    requires_confirmation: true,
    sort_order: 3,
    is_active: true,
  },
  {
    prompt_key: 'receiving_completion',
    workflow: 'receiving',
    trigger_point: 'after',
    prompt_type: 'modal',
    min_level: 'standard',
    severity: 'warning',
    title: 'Receiving Complete',
    message: 'Review your receiving summary. Ensure all items are accounted for and properly logged.',
    tip_text: 'Double-check counts before finalizing.',
    buttons: [
      { key: 'confirm', label: 'Complete Receiving', variant: 'default', action: 'confirm' },
      { key: 'review', label: 'Review Items', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 4,
    is_active: true,
  },

  // ========================================================================
  // INSPECTION (4 prompts)
  // ========================================================================
  {
    prompt_key: 'inspection_pre_task',
    workflow: 'inspection',
    trigger_point: 'before',
    prompt_type: 'modal',
    min_level: 'training',
    severity: 'info',
    title: 'Starting Inspection',
    message: 'Prepare your inspection workspace. You will need good lighting and a clean area to examine items.',
    checklist_items: [
      { key: 'lighting_good', label: 'Good lighting is available', required: true },
      { key: 'clean_surface', label: 'Clean inspection surface ready', required: true },
    ],
    buttons: [
      { key: 'start', label: 'Begin Inspection', variant: 'default', action: 'confirm' },
      { key: 'cancel', label: 'Cancel', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 1,
    is_active: true,
  },
  {
    prompt_key: 'inspection_photo_sequence',
    workflow: 'inspection',
    trigger_point: 'during',
    prompt_type: 'slide_panel',
    min_level: 'training',
    severity: 'warning',
    title: 'Photo Documentation',
    message: 'Take photos from multiple angles: front, back, top, and any areas of concern.',
    tip_text: 'Consistent photo angles help with before/after comparisons.',
    buttons: [
      { key: 'continue', label: 'Continue', variant: 'default', action: 'confirm' },
    ],
    requires_confirmation: true,
    sort_order: 2,
    is_active: true,
  },
  {
    prompt_key: 'inspection_damage_found',
    workflow: 'inspection',
    trigger_point: 'during',
    prompt_type: 'modal',
    min_level: 'standard',
    severity: 'warning',
    title: 'Damage Detected',
    message: 'Document the damage with detailed photos and notes. This information will be used for claims.',
    checklist_items: [
      { key: 'photos_taken', label: 'Damage photos taken', required: true },
      { key: 'notes_added', label: 'Description added to notes', required: true },
    ],
    buttons: [
      { key: 'confirm', label: 'Damage Documented', variant: 'default', action: 'confirm' },
    ],
    requires_confirmation: true,
    sort_order: 3,
    is_active: true,
  },
  {
    prompt_key: 'inspection_completion',
    workflow: 'inspection',
    trigger_point: 'after',
    prompt_type: 'modal',
    min_level: 'standard',
    severity: 'warning',
    title: 'Inspection Complete',
    message: 'Review your inspection notes and photos before finalizing.',
    buttons: [
      { key: 'complete', label: 'Complete Inspection', variant: 'default', action: 'confirm' },
      { key: 'review', label: 'Review Again', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 4,
    is_active: true,
  },

  // ========================================================================
  // ASSEMBLY (3 prompts)
  // ========================================================================
  {
    prompt_key: 'assembly_pre_task',
    workflow: 'assembly',
    trigger_point: 'before',
    prompt_type: 'modal',
    min_level: 'training',
    severity: 'info',
    title: 'Assembly Task Preparation',
    message: 'Review the assembly instructions and ensure you have all required tools and parts.',
    checklist_items: [
      { key: 'instructions_reviewed', label: 'Instructions reviewed', required: true },
      { key: 'tools_ready', label: 'All tools available', required: true },
      { key: 'parts_verified', label: 'All parts accounted for', required: true },
    ],
    buttons: [
      { key: 'start', label: 'Start Assembly', variant: 'default', action: 'confirm' },
      { key: 'cancel', label: 'Cancel', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 1,
    is_active: true,
  },
  {
    prompt_key: 'assembly_issue_found',
    workflow: 'assembly',
    trigger_point: 'during',
    prompt_type: 'modal',
    min_level: 'standard',
    severity: 'warning',
    title: 'Assembly Issue',
    message: 'Document any issues encountered during assembly. Take photos and add notes for the record.',
    buttons: [
      { key: 'documented', label: 'Issue Documented', variant: 'default', action: 'confirm' },
      { key: 'skip', label: 'Continue Without', variant: 'outline', action: 'skip' },
    ],
    requires_confirmation: true,
    sort_order: 2,
    is_active: true,
  },
  {
    prompt_key: 'assembly_completion',
    workflow: 'assembly',
    trigger_point: 'after',
    prompt_type: 'modal',
    min_level: 'standard',
    severity: 'warning',
    title: 'Assembly Complete',
    message: 'Verify the assembly is complete and functioning correctly. Take a final photo of the completed work.',
    checklist_items: [
      { key: 'functionality_verified', label: 'Functionality verified', required: true },
      { key: 'final_photo', label: 'Final photo taken', required: true },
    ],
    buttons: [
      { key: 'complete', label: 'Mark Complete', variant: 'default', action: 'confirm' },
    ],
    requires_confirmation: true,
    sort_order: 3,
    is_active: true,
  },

  // ========================================================================
  // REPAIR (3 prompts)
  // ========================================================================
  {
    prompt_key: 'repair_pre_task',
    workflow: 'repair',
    trigger_point: 'before',
    prompt_type: 'modal',
    min_level: 'training',
    severity: 'info',
    title: 'Repair Task Preparation',
    message: 'Review the repair quote and customer notes. Ensure you have all necessary parts and tools.',
    checklist_items: [
      { key: 'quote_reviewed', label: 'Repair quote reviewed', required: true },
      { key: 'parts_available', label: 'Required parts available', required: true },
      { key: 'before_photos', label: 'Before photos taken', required: true },
    ],
    buttons: [
      { key: 'start', label: 'Start Repair', variant: 'default', action: 'confirm' },
      { key: 'cancel', label: 'Cancel', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 1,
    is_active: true,
  },
  {
    prompt_key: 'repair_approval_required',
    workflow: 'repair',
    trigger_point: 'before',
    prompt_type: 'modal',
    min_level: 'training',
    severity: 'blocking', // Repairs need approval - critical business rule
    title: 'Repair Approval Required',
    message: 'This repair requires customer approval before work can begin. Verify the repair quote has been approved.',
    tip_text: 'Check repair_quotes table for status = "approved".',
    buttons: [
      { key: 'approved', label: 'Approval Verified', variant: 'default', action: 'confirm' },
      { key: 'cancel', label: 'Cancel', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 0.5,
    is_active: true,
    // This prompt should check: repair_quotes.status = 'approved'
    conditions: {
      operator: 'and',
      rules: [
        { field: 'repair_quote.status', op: 'ne', value: 'approved' },
      ],
    },
  },
  {
    prompt_key: 'repair_completion',
    workflow: 'repair',
    trigger_point: 'after',
    prompt_type: 'modal',
    min_level: 'standard',
    severity: 'warning',
    title: 'Repair Complete',
    message: 'Document the completed repair with photos and notes. Verify the repair meets quality standards.',
    checklist_items: [
      { key: 'after_photos', label: 'After photos taken', required: true },
      { key: 'quality_verified', label: 'Quality standards met', required: true },
      { key: 'time_logged', label: 'Labor time logged', required: true },
    ],
    buttons: [
      { key: 'complete', label: 'Complete Repair', variant: 'default', action: 'confirm' },
    ],
    requires_confirmation: true,
    sort_order: 2,
    is_active: true,
  },

  // ========================================================================
  // MOVEMENT (3 prompts)
  // ========================================================================
  {
    prompt_key: 'movement_sequence',
    workflow: 'movement',
    trigger_point: 'before',
    prompt_type: 'slide_panel',
    min_level: 'training',
    severity: 'info',
    title: 'Movement Sequence',
    message: 'Scan the item first, then scan the destination location. The system will update the item location automatically.',
    tip_text: 'Always scan in order: Item first, then Location.',
    buttons: [
      { key: 'understood', label: 'Got It', variant: 'default', action: 'confirm' },
    ],
    requires_confirmation: true,
    sort_order: 1,
    is_active: true,
  },
  {
    prompt_key: 'movement_fragile_warning',
    workflow: 'movement',
    trigger_point: 'during',
    prompt_type: 'modal',
    min_level: 'standard',
    severity: 'blocking', // Fragile handling is critical
    title: 'Fragile Item',
    message: 'This item is marked as FRAGILE. Handle with extra care during movement.',
    tip_text: 'Use appropriate equipment and take your time.',
    buttons: [
      { key: 'acknowledge', label: 'I Understand', variant: 'default', action: 'confirm' },
    ],
    requires_confirmation: true,
    sort_order: 2,
    is_active: true,
  },
  {
    prompt_key: 'movement_no_stack_warning',
    workflow: 'movement',
    trigger_point: 'during',
    prompt_type: 'modal',
    min_level: 'standard',
    severity: 'blocking', // No stack is a critical handling rule
    title: 'Do Not Stack',
    message: 'This item is marked as DO NOT STACK. Ensure nothing is placed on top of it.',
    buttons: [
      { key: 'acknowledge', label: 'I Understand', variant: 'default', action: 'confirm' },
    ],
    requires_confirmation: true,
    sort_order: 3,
    is_active: true,
  },

  // ========================================================================
  // STOCKTAKE (3 prompts)
  // ========================================================================
  {
    prompt_key: 'stocktake_pre_task',
    workflow: 'stocktake',
    trigger_point: 'before',
    prompt_type: 'modal',
    min_level: 'training',
    severity: 'info',
    title: 'Starting Stocktake',
    message: 'You are about to begin a stocktake. Scan each item in the designated area and verify quantities.',
    checklist_items: [
      { key: 'area_clear', label: 'Stocktake area is accessible', required: true },
      { key: 'scanner_ready', label: 'Scanner is charged and ready', required: true },
    ],
    buttons: [
      { key: 'start', label: 'Begin Stocktake', variant: 'default', action: 'confirm' },
      { key: 'cancel', label: 'Cancel', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 1,
    is_active: true,
  },
  {
    prompt_key: 'stocktake_missing_item',
    workflow: 'stocktake',
    trigger_point: 'during',
    prompt_type: 'modal',
    min_level: 'standard',
    severity: 'warning',
    title: 'Item Not Found',
    message: 'An expected item was not found at this location. Please verify and check surrounding areas.',
    tip_text: 'Check nearby locations - items may have been misplaced.',
    buttons: [
      { key: 'mark_missing', label: 'Mark as Missing', variant: 'destructive', action: 'confirm' },
      { key: 'found', label: 'I Found It', variant: 'default', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 2,
    is_active: true,
  },
  {
    prompt_key: 'stocktake_completion',
    workflow: 'stocktake',
    trigger_point: 'after',
    prompt_type: 'modal',
    min_level: 'standard',
    severity: 'warning',
    title: 'Stocktake Complete',
    message: 'Review the stocktake results. Discrepancies will be flagged for review.',
    buttons: [
      { key: 'submit', label: 'Submit Stocktake', variant: 'default', action: 'confirm' },
      { key: 'review', label: 'Review Results', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 3,
    is_active: true,
  },

  // ========================================================================
  // SCAN HUB (2 prompts)
  // ========================================================================
  {
    prompt_key: 'scan_hub_service_confirm',
    workflow: 'scan_hub',
    trigger_point: 'during',
    prompt_type: 'slide_panel',
    min_level: 'training',
    severity: 'info',
    title: 'Confirm Service Selection',
    message: 'You have selected a service for this item. Please confirm before proceeding.',
    buttons: [
      { key: 'confirm', label: 'Confirm Service', variant: 'default', action: 'confirm' },
      { key: 'change', label: 'Change Selection', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 1,
    is_active: true,
  },
  {
    prompt_key: 'scan_hub_approval_required',
    workflow: 'scan_hub',
    trigger_point: 'during',
    prompt_type: 'modal',
    min_level: 'standard',
    severity: 'blocking', // Approval is required before proceeding
    title: 'Approval Required',
    message: 'This service requires manager approval before proceeding. A notification has been sent.',
    tip_text: 'You may continue with other items while waiting for approval.',
    buttons: [
      { key: 'ok', label: 'OK', variant: 'default', action: 'confirm' },
    ],
    requires_confirmation: true,
    sort_order: 2,
    is_active: true,
  },

  // ========================================================================
  // OUTBOUND (6 prompts) - includes will_call variant
  // ========================================================================
  {
    prompt_key: 'outbound_staging_pre_task',
    workflow: 'outbound',
    trigger_point: 'before',
    prompt_type: 'modal',
    min_level: 'training',
    severity: 'info',
    title: 'Start Outbound Pull',
    message: 'You are about to start pulling items for an outbound shipment. Review the pick list carefully.',
    checklist_items: [
      { key: 'pick_list_reviewed', label: 'Pick list reviewed', required: true },
      { key: 'staging_area_clear', label: 'Staging area is ready', required: true },
    ],
    buttons: [
      { key: 'start', label: 'Start Pulling', variant: 'default', action: 'confirm' },
      { key: 'cancel', label: 'Cancel', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 1,
    is_active: true,
  },
  {
    prompt_key: 'outbound_authorization_required',
    workflow: 'outbound',
    trigger_point: 'before',
    prompt_type: 'modal',
    min_level: 'training',
    severity: 'blocking', // Authorization is required before release
    title: 'Authorization Required',
    message: 'This release requires authorization. Verify the release has been authorized by the account holder.',
    tip_text: 'Check for a valid release authorization or signature.',
    buttons: [
      { key: 'authorized', label: 'Authorization Verified', variant: 'default', action: 'confirm' },
      { key: 'cancel', label: 'Cancel', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 0.5,
    is_active: true,
  },
  {
    prompt_key: 'outbound_scan_to_dock',
    workflow: 'outbound',
    trigger_point: 'during',
    prompt_type: 'toast',
    min_level: 'training',
    severity: 'info',
    title: 'Scan to Dock',
    message: 'Scan each item as you move it to the dock staging area.',
    requires_confirmation: false,
    sort_order: 2,
    is_active: true,
  },
  {
    prompt_key: 'outbound_staging_complete',
    workflow: 'outbound',
    trigger_point: 'during',
    prompt_type: 'modal',
    min_level: 'standard',
    severity: 'warning',
    title: 'Staging Complete',
    message: 'All items have been staged. Verify the count before proceeding to release.',
    checklist_items: [
      { key: 'count_verified', label: 'Item count verified', required: true },
      { key: 'condition_checked', label: 'Items in good condition', required: true },
    ],
    buttons: [
      { key: 'proceed', label: 'Proceed to Release', variant: 'default', action: 'confirm' },
      { key: 'recount', label: 'Recount Items', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 3,
    is_active: true,
  },
  {
    prompt_key: 'outbound_release_items',
    workflow: 'outbound',
    trigger_point: 'during',
    prompt_type: 'slide_panel',
    min_level: 'training',
    severity: 'warning',
    title: 'Release Items',
    message: 'Scan each item as it is loaded onto the truck or handed to the customer.',
    tip_text: 'Get a signature or photo confirmation when possible.',
    buttons: [
      { key: 'continue', label: 'Continue', variant: 'default', action: 'confirm' },
    ],
    requires_confirmation: true,
    sort_order: 4,
    is_active: true,
  },
  {
    prompt_key: 'outbound_release_complete',
    workflow: 'outbound',
    trigger_point: 'after',
    prompt_type: 'modal',
    min_level: 'standard',
    severity: 'warning',
    title: 'Release Complete',
    message: 'All items have been released. The shipment will be marked as complete.',
    buttons: [
      { key: 'complete', label: 'Complete Shipment', variant: 'default', action: 'confirm' },
      { key: 'review', label: 'Review First', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 5,
    is_active: true,
  },

  // ========================================================================
  // WILL CALL (2 prompts) - variant of outbound for customer pickup
  // ========================================================================
  {
    prompt_key: 'will_call_customer_verification',
    workflow: 'will_call',
    trigger_point: 'before',
    prompt_type: 'modal',
    min_level: 'training',
    severity: 'blocking', // Must verify customer identity
    title: 'Customer Verification',
    message: 'Verify the customer identity before releasing items. Check ID and compare with authorization.',
    checklist_items: [
      { key: 'id_verified', label: 'Customer ID verified', required: true },
      { key: 'authorization_checked', label: 'Authorization confirmed', required: true },
    ],
    buttons: [
      { key: 'verified', label: 'Customer Verified', variant: 'default', action: 'confirm' },
      { key: 'cancel', label: 'Cancel', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 1,
    is_active: true,
  },
  {
    prompt_key: 'will_call_signature_required',
    workflow: 'will_call',
    trigger_point: 'after',
    prompt_type: 'modal',
    min_level: 'training',
    severity: 'blocking', // Signature is required for will call
    title: 'Signature Required',
    message: 'Obtain customer signature to complete the will call release.',
    buttons: [
      { key: 'signed', label: 'Signature Obtained', variant: 'default', action: 'confirm' },
    ],
    requires_confirmation: true,
    sort_order: 2,
    is_active: true,
  },

  // ========================================================================
  // CLAIMS (2 prompts)
  // ========================================================================
  {
    prompt_key: 'claims_documentation',
    workflow: 'claims',
    trigger_point: 'before',
    prompt_type: 'modal',
    min_level: 'training',
    severity: 'warning',
    title: 'Claims Documentation',
    message: 'Ensure all damage is properly documented with photos and detailed notes before filing a claim.',
    checklist_items: [
      { key: 'photos_taken', label: 'Damage photos taken', required: true },
      { key: 'notes_added', label: 'Detailed description provided', required: true },
      { key: 'item_identified', label: 'Item properly identified', required: true },
    ],
    buttons: [
      { key: 'continue', label: 'Continue with Claim', variant: 'default', action: 'confirm' },
      { key: 'add_more', label: 'Add More Documentation', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 1,
    is_active: true,
  },
  {
    prompt_key: 'claims_submission',
    workflow: 'claims',
    trigger_point: 'after',
    prompt_type: 'modal',
    min_level: 'standard',
    severity: 'warning',
    title: 'Submit Claim',
    message: 'Review the claim details before submission. Once submitted, the claim will be processed.',
    buttons: [
      { key: 'submit', label: 'Submit Claim', variant: 'default', action: 'confirm' },
      { key: 'review', label: 'Review Again', variant: 'outline', action: 'cancel' },
    ],
    requires_confirmation: true,
    sort_order: 2,
    is_active: true,
  },
];

// Helper to get prompts by workflow
export function getPromptsByWorkflow(workflow: string): DefaultPromptDefinition[] {
  return DEFAULT_PROMPTS.filter(p => p.workflow === workflow);
}

// Helper to get prompt by key
export function getPromptByKey(promptKey: string): DefaultPromptDefinition | undefined {
  return DEFAULT_PROMPTS.find(p => p.prompt_key === promptKey);
}
