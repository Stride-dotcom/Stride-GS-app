# Stride WMS Promo Codes System Documentation

## Quick Summary (Plain English)

**Promo codes in Stride WMS let you offer discounts to your clients.** Here's how it works in simple terms:

### The Key Concept: "Opt-In" Discounts

Creating a promo code does **NOT** automatically apply it to everyone. Promo codes must be manually assigned to specific customer accounts or applied to individual billing events. This gives you full control over who receives discounts.

### Two Ways to Apply Discounts

1. **Account-Level Assignment** - Add the promo code to the customer's account in their Pricing settings. Once assigned, the discount automatically applies to all their future charges that qualify.

2. **Single Billing Event** - Apply a promo code to one specific charge without permanently assigning it to the account. Great for one-time discounts or special situations.

---

## Real-World Examples

### Example 1: Spring Promotion

> You create a promo code **SPRING25** for 25% off all services during April.

**What happens:**
- The code exists but does nothing until you assign it
- Customer calls and asks for the promotion
- You go to their Account > Settings > Pricing and assign SPRING25
- From that point on, all their charges get 25% off automatically
- When April ends, you can remove the code from their account

### Example 2: New Customer Welcome Discount

> You create **WELCOME50** for $50 off the first order, limited to 1 use per account.

**What happens:**
- New customer signs up and mentions the promo code
- You assign WELCOME50 to their account
- Their first billable service gets $50 off
- The code shows "Limit Reached" - it won't apply again for this customer
- If they have sub-accounts (branches), the 1-use limit applies to ALL their sub-accounts combined

### Example 3: One-Time Courtesy Discount

> A loyal customer had a bad experience and you want to give them 10% off their next delivery.

**What happens:**
- You don't need to assign a code permanently
- Go to Billing Reports, find their unbilled delivery charge
- Click the actions menu (three dots) > "Apply Promo Code"
- Select a promo code or apply the discount
- Only that one charge gets the discount

### Example 4: VIP Account Pricing

> You have several VIP accounts that always get 15% off.

**What happens:**
- Create code **VIP15** with "Unlimited uses"
- Assign VIP15 to each VIP account's pricing settings
- Every charge for those accounts automatically gets 15% off
- Sub-accounts don't automatically get the discount - you assign individually

---

## Parent/Sub-Account Rules

When accounts have sub-accounts (like a company with multiple branches):

| Scenario | What Happens |
|----------|--------------|
| Promo assigned to parent | Only parent account charges get discount |
| Promo assigned to sub-account | Only that sub-account's charges get discount |
| Usage limits (e.g., "1 time use") | Shared across parent + ALL sub-accounts |

**Example:** ABC Company has 3 warehouse locations (sub-accounts). You assign a "1 time use" promo to their Los Angeles location. Once used in LA, the code cannot be used by ANY of their locations - the limit is shared.

---

## Table of Contents

1. [Creating Promo Codes](#creating-promo-codes)
2. [Promo Code Settings](#promo-code-settings)
3. [Assigning to Accounts](#assigning-promo-codes-to-accounts)
4. [Manual Application to Billing Events](#manual-application-to-billing-events)
5. [How Discounts Are Calculated](#how-discounts-are-calculated)
6. [Usage Tracking](#usage-tracking)
7. [Database Schema](#database-schema)
8. [File Locations](#file-locations)

---

## Creating Promo Codes

Navigate to **Billing > Promo Codes** to manage promo codes.

### Steps to Create:
1. Click "Create Promo Code"
2. Enter a unique code (e.g., SUMMER25)
3. Configure the discount settings (see below)
4. Click "Create Promo Code"

The code is now available but **will not apply to any accounts** until explicitly assigned.

---

## Promo Code Settings

### Basic Settings

| Setting | Options | Description |
|---------|---------|-------------|
| **Code** | Text (uppercase) | The promo code customers reference (e.g., "SUMMER25"). Cannot be changed after creation. |
| **Active** | On/Off toggle | Disabled codes won't apply even if assigned to accounts |

### Discount Type

| Type | Example | How It Works |
|------|---------|--------------|
| **Percentage** | 25% | Reduces the charge by X percent. A $100 charge becomes $75 with 25% off. |
| **Flat Amount** | $50 | Reduces the charge by a fixed dollar amount. A $100 charge becomes $50 with $50 off. Capped at charge amount (won't go negative). |

### Expiration

| Type | Description |
|------|-------------|
| **Never expires** | Code works indefinitely until manually deactivated |
| **Expires on date** | Code stops working after the specified date, even if assigned to accounts |

### Service Scope

| Option | Description |
|--------|-------------|
| **All Services** | Discount applies to any billable service (receiving, storage, delivery, etc.) |
| **Selected Services Only** | Discount only applies to specific services you choose (e.g., only "Receiving" and "Inspection") |

When "Selected Services Only" is chosen, you can pick from your configured services:
- Receiving (RCVG)
- Storage (STORAGE)
- Inspection (INSP)
- Assembly (15MA, 30MA, etc.)
- Delivery (Will_Call)
- And any other services in your price list

### Usage Limit

| Type | Description |
|------|-------------|
| **Unlimited uses** | No limit - code can be used any number of times |
| **Limited uses** | Code can only be used X times per account group |

**Important:** Usage limits apply per account GROUP (parent + sub-accounts combined), not per individual account or per billing event.

---

## Assigning Promo Codes to Accounts

### Where to Assign
Navigate to: **Accounts > [Select Account] > Settings > Pricing**

Scroll down to the "Promo Codes" section below pricing adjustments.

### How to Assign
1. Select a promo code from the dropdown
2. Click "Assign"
3. The code now appears in the account's assigned codes table

### What Happens After Assignment
- When billing events are created for this account, the system automatically checks for assigned promo codes
- If a promo code is valid and applicable, the discount is applied
- If multiple codes qualify, the one giving the **highest discount** is used
- The discount details are stored in the billing event's metadata

### Removing Assignments
Click the delete icon next to any assigned promo code to remove it. Future charges will no longer receive that discount, but past charges are unaffected.

---

## Manual Application to Billing Events

You can apply a promo code to a single billing event without assigning it to the account.

### Where to Apply
Navigate to: **Billing > Reports**

Find an **unbilled** event in the table and click the three-dot menu (actions) > "Apply Promo Code"

### Options in the Dialog
- **If no promo exists:** Select from available promo codes and click "Apply"
- **If promo already applied:** Shows current discount with option to "Remove Promo Code"

### When to Use This
- One-time courtesy discounts
- Correcting missed discounts on specific charges
- Applying promotions after-the-fact
- Testing promo codes before assigning to accounts

### Restrictions
- Can only apply to **unbilled** events
- Cannot apply to invoiced or void events
- Still validates expiration, service scope, and usage limits

---

## How Discounts Are Calculated

### Automatic Application Flow

```
Billing Event Created
         ↓
Check: Does account have assigned promo codes?
         ↓ (if yes)
For each assigned promo code:
   ├─ Is it active?
   ├─ Has it expired?
   ├─ Does service scope match charge type?
   └─ Has usage limit been reached for this account group?
         ↓
Calculate discount for each valid code
         ↓
Apply the code with the HIGHEST discount amount
         ↓
Store discount info in billing event metadata
```

### Discount Calculation

**Percentage Discount:**
```
discount_amount = original_amount × (discount_percent / 100)
final_amount = original_amount - discount_amount
```

**Flat Rate Discount:**
```
discount_amount = MIN(flat_discount, original_amount)  // Can't exceed charge
final_amount = original_amount - discount_amount
```

### Stored Metadata

When a promo is applied, the billing event's `metadata` field includes:

```json
{
  "promo_discount": {
    "promo_code_id": "uuid",
    "promo_code": "SUMMER25",
    "discount_type": "percentage",
    "discount_value": 25,
    "original_amount": 100.00,
    "discount_amount": 25.00,
    "manual_application": false
  }
}
```

The `manual_application` flag is `true` when applied via the Apply Promo Dialog rather than automatic assignment.

---

## Usage Tracking

### Per-Account-Group Tracking

Usage is tracked at the **account group** level:
- Parent accounts and all their sub-accounts share usage counts
- A "1 time use" promo used by a sub-account counts against the parent's group

### How Usage is Recorded

Each time a promo code is applied to a billing event:
1. System identifies the "root account" (parent, or self if no parent)
2. Creates a usage record linking: promo code → root account → billing event
3. Future usage checks count all records for that root account

### Viewing Usage

On the Promo Codes page, the "Usage" column shows:
- `5` for unlimited codes (just a count)
- `5/10` for limited codes (used/limit)

When limit is reached, status shows "Limit Reached" badge.

---

## Database Schema

### promo_codes Table

Main table storing promo code definitions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Organization this code belongs to |
| `code` | VARCHAR | The promo code text (e.g., "SUMMER25") |
| `discount_type` | ENUM | "percentage" or "flat_rate" |
| `discount_value` | DECIMAL | The discount amount (percent or dollars) |
| `expiration_type` | ENUM | "none" or "date" |
| `expiration_date` | DATE | When the code expires (if applicable) |
| `service_scope` | ENUM | "all" or "selected" |
| `selected_services` | TEXT[] | Array of service codes (if scope is "selected") |
| `usage_limit_type` | ENUM | "unlimited" or "limited" |
| `usage_limit` | INTEGER | Max uses per account group (if limited) |
| `usage_count` | INTEGER | Global usage count (for display) |
| `is_active` | BOOLEAN | Whether the code is enabled |
| `deleted_at` | TIMESTAMP | Soft delete timestamp |
| `created_at` | TIMESTAMP | When created |

### account_promo_codes Table

Junction table linking promo codes to accounts.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `account_id` | UUID | The account this promo is assigned to |
| `promo_code_id` | UUID | The promo code being assigned |
| `assigned_by` | UUID | User who made the assignment |
| `assigned_at` | TIMESTAMP | When assigned |
| `notes` | TEXT | Optional notes about the assignment |

Unique constraint: One promo code can only be assigned once per account.

### promo_code_usages Table

Tracks per-account-group usage for enforcing limits.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `promo_code_id` | UUID | The promo code used |
| `root_account_id` | UUID | Parent account (or self if no parent) |
| `used_by_account_id` | UUID | Actual account that used it |
| `billing_event_id` | UUID | The billing event it was applied to |
| `used_at` | TIMESTAMP | When used |
| `used_by` | UUID | User who applied it (for manual applications) |

Unique constraint: One promo per billing event.

---

## File Locations

| Purpose | File Path |
|---------|-----------|
| Promo Codes Management Page | `src/pages/PromoCodes.tsx` |
| Create/Edit Promo Dialog | `src/components/billing/PromoCodeDialog.tsx` |
| Apply Promo to Event Dialog | `src/components/billing/ApplyPromoDialog.tsx` |
| Account Promo Assignment UI | `src/components/accounts/AccountPromoCodesSection.tsx` |
| Promo Code Logic/Utils | `src/lib/billing/promoCodeUtils.ts` |
| Account Promo Codes Hook | `src/hooks/useAccountPromoCodes.ts` |
| Promo Codes Hook | `src/hooks/usePromoCodes.ts` |
| Billing Event Creator | `src/lib/billing/createBillingEvent.ts` |
| Billing Reports (with Apply action) | `src/pages/BillingReports.tsx` |

### Database Migrations

| Table | Migration File |
|-------|----------------|
| `promo_codes` | (created in base schema) |
| `account_promo_codes` | `20260130_promo_code_tables.sql` |
| `promo_code_usages` | `20260130_promo_code_tables.sql` |

*Note: Both tables were created in a single migration file.*

---

## Summary

The Stride WMS promo codes system provides:

1. **Flexible discount options** - Percentage or flat amount discounts
2. **Targeted application** - Only applies to accounts you explicitly assign
3. **Service filtering** - Limit discounts to specific service types
4. **Usage controls** - Set per-account-group limits
5. **Expiration** - Automatic expiration by date
6. **Manual overrides** - Apply discounts to specific billing events as needed
7. **Sub-account awareness** - Usage limits shared across account groups
8. **Full audit trail** - Track who applied what and when

All discounts are stored in billing event metadata, making them visible in reports, exports, and invoices.

---

*Document updated: January 30, 2026*
*Stride WMS Version: Current*
