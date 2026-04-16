import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { PriceListTab } from './pricing/PriceListTab';
import { CategoriesTab } from './pricing/CategoriesTab';
import { ClassesTab } from './pricing/ClassesTab';
import { QuickStartTab } from './pricing/QuickStartTab';
import { FlagsTab } from './pricing/FlagsTab';

const SUB_TABS = [
  { value: 'price-list', label: 'Price List', icon: 'payments' },
  { value: 'categories', label: 'Categories', icon: 'folder' },
  { value: 'classes', label: 'Classes', icon: 'label' },
  { value: 'flags', label: 'Flags', icon: 'flag' },
  { value: 'quick-start', label: 'Quick Start', icon: 'rocket_launch' },
] as const;

export function ServiceRatesConsole() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSubtab = searchParams.get('subtab') || 'price-list';
  const [activeSubtab, setActiveSubtab] = useState(initialSubtab);

  const navigateToTab = (tab: string) => {
    setActiveSubtab(tab);
    searchParams.set('subtab', tab);
    setSearchParams(searchParams, { replace: true });
  };

  const handleTabChange = (value: string) => {
    setActiveSubtab(value);
    searchParams.set('subtab', value);
    setSearchParams(searchParams, { replace: true });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground">
          <MaterialIcon name="payments" size="sm" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Service Rates</h3>
          <p className="text-sm text-muted-foreground">Manage your pricing, categories, and classes</p>
        </div>
      </div>

      {/* Tabbed content */}
      <Tabs value={activeSubtab} onValueChange={handleTabChange}>
        <TabsList className="flex w-full overflow-x-auto h-auto gap-1 p-1">
          {SUB_TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-1.5 whitespace-nowrap text-xs sm:text-sm px-2.5 sm:px-3"
            >
              <MaterialIcon name={tab.icon} size="sm" />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="price-list" className="mt-6">
          <PriceListTab navigateToTab={navigateToTab} />
        </TabsContent>

        <TabsContent value="categories" className="mt-6">
          <CategoriesTab />
        </TabsContent>

        <TabsContent value="classes" className="mt-6">
          <ClassesTab />
        </TabsContent>

        <TabsContent value="flags" className="mt-6">
          <FlagsTab />
        </TabsContent>

        <TabsContent value="quick-start" className="mt-6">
          <QuickStartTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
