import * as React from "react";
import { FormField } from "@/components/ui/form-field";
import { SearchableSelect, SelectOption } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { toast } from "@/lib/toastShim";

/**
 * Demo page for mobile-safe form components
 * Use this to verify components work in iPhone viewport simulation
 */

// Demo options for SearchableSelect
const DEMO_ACCOUNTS: SelectOption[] = [
  { value: "acc-1", label: "Acme Corporation" },
  { value: "acc-2", label: "Beta Industries" },
  { value: "acc-3", label: "Charlie & Co" },
  { value: "acc-4", label: "Delta Logistics" },
  { value: "acc-5", label: "Echo Enterprises" },
  { value: "acc-6", label: "Foxtrot Freight" },
  { value: "acc-7", label: "Golf Global" },
  { value: "acc-8", label: "Hotel Holdings" },
];

const DEMO_WAREHOUSES: SelectOption[] = [
  { value: "wh-1", label: "Main Warehouse" },
  { value: "wh-2", label: "Secondary Storage" },
  { value: "wh-3", label: "Cold Storage Facility" },
];

export default function ComponentsDemo() {
  // Form field state
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [quantity, setQuantity] = React.useState("1");
  const [date, setDate] = React.useState("");
  
  // SearchableSelect state
  const [account, setAccount] = React.useState("");
  const [warehouse, setWarehouse] = React.useState("");
  const [asyncLoading, setAsyncLoading] = React.useState(false);
  const [asyncOptions, setAsyncOptions] = React.useState<SelectOption[]>([]);
  const [asyncValue, setAsyncValue] = React.useState("");
  
  // Validation errors
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Simulate async loading
  const loadAsyncOptions = React.useCallback(() => {
    setAsyncLoading(true);
    setTimeout(() => {
      setAsyncOptions([
        { value: "item-1", label: "Widget A" },
        { value: "item-2", label: "Widget B" },
        { value: "item-3", label: "Gadget X" },
        { value: "item-4", label: "Gadget Y" },
      ]);
      setAsyncLoading(false);
    }, 1500);
  }, []);

  // Load on mount
  React.useEffect(() => {
    loadAsyncOptions();
  }, [loadAsyncOptions]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Simple validation
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Name is required";
    if (!email.trim()) newErrors.email = "Email is required";
    else if (!email.includes("@")) newErrors.email = "Invalid email format";
    if (!account) newErrors.account = "Please select an account";
    
    setErrors(newErrors);
    
    if (Object.keys(newErrors).length === 0) {
      toast.success("Form submitted successfully!");
    }
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto max-w-2xl space-y-6 p-4 pb-safe">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Mobile-Safe Components Demo</h1>
          <p className="text-muted-foreground">
            Test these components in iPhone viewport simulation to verify mobile behavior.
          </p>
        </div>

        {/* FormField Examples */}
        <Card>
          <CardHeader>
            <CardTitle>FormField Component</CardTitle>
            <CardDescription>
              Mobile-first form fields with 44px touch targets and 16px font (prevents iOS zoom)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <FormField
                label="Name"
                name="name"
                value={name}
                onChange={setName}
                placeholder="Enter your name"
                required
                error={errors.name}
                helpText="Your full legal name"
              />

              <FormField
                label="Email"
                name="email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="email@example.com"
                required
                error={errors.email}
              />

              <FormField
                label="Description"
                name="description"
                type="textarea"
                value={description}
                onChange={setDescription}
                placeholder="Enter a detailed description..."
                helpText="This textarea auto-grows as you type"
                minRows={2}
                maxRows={6}
              />

              <FormField
                label="Quantity"
                name="quantity"
                type="number"
                value={quantity}
                onChange={setQuantity}
                min={1}
                max={100}
                step={1}
              />

              <FormField
                label="Due Date"
                name="date"
                type="date"
                value={date}
                onChange={setDate}
              />

              <FormField
                label="Sidemark"
                name="sidemark"
                value=""
                onChange={() => {}}
                uppercase
                placeholder="UPPERCASE INPUT"
                helpText="Automatically converts to uppercase"
              />

              {/* Horizontal layout example */}
              <FormField
                label="Horizontal"
                name="horizontal"
                value=""
                onChange={() => {}}
                placeholder="Horizontal on desktop, stacked on mobile"
                labelPosition="horizontal"
              />
            </form>
          </CardContent>
        </Card>

        {/* SearchableSelect Examples */}
        <Card>
          <CardHeader>
            <CardTitle>SearchableSelect Component</CardTitle>
            <CardDescription>
              Portal-based combobox with type-to-filter, recent selections, and async loading
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Account (with recent)</label>
              <SearchableSelect
                options={DEMO_ACCOUNTS}
                value={account}
                onChange={setAccount}
                placeholder="Select an account..."
                searchPlaceholder="Search accounts..."
                recentKey="demo-accounts"
                error={errors.account}
                clearable
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Warehouse</label>
              <SearchableSelect
                options={DEMO_WAREHOUSES}
                value={warehouse}
                onChange={setWarehouse}
                placeholder="Select a warehouse..."
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Async Loading Example</label>
              <SearchableSelect
                options={asyncOptions}
                value={asyncValue}
                onChange={setAsyncValue}
                loading={asyncLoading}
                placeholder="Select an item..."
                emptyText="No items available"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadAsyncOptions}
                className="mt-2"
              >
                Reload Options
              </Button>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Disabled State</label>
              <SearchableSelect
                options={DEMO_ACCOUNTS}
                value=""
                onChange={() => {}}
                disabled
                placeholder="This is disabled"
              />
            </div>
          </CardContent>
        </Card>

        {/* Submit Button */}
        <Card>
          <CardContent className="pt-6">
            <Button
              type="submit"
              onClick={handleSubmit}
              className="w-full min-h-[44px] text-base"
            >
              Submit Form
            </Button>
          </CardContent>
        </Card>

        {/* Scroll test - to verify dropdowns work when page scrolls */}
        <Card>
          <CardHeader>
            <CardTitle>Scroll Test</CardTitle>
            <CardDescription>
              Dropdown at bottom of scrollable page - should not be clipped
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SearchableSelect
              options={DEMO_ACCOUNTS}
              value=""
              onChange={() => {}}
              placeholder="Test dropdown at page bottom"
            />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
