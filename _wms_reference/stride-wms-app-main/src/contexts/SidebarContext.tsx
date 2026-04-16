import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface SidebarContextType {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  collapseSidebar: () => void;
  expandSidebar: () => void;
  toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sidebar-collapsed');
      return saved === 'true';
    }
    return false;
  });

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, []);

  const collapseSidebar = useCallback(() => setSidebarCollapsed(true), [setSidebarCollapsed]);
  const expandSidebar = useCallback(() => setSidebarCollapsed(false), [setSidebarCollapsed]);
  const toggleSidebar = useCallback(() => setSidebarCollapsed(!sidebarCollapsed), [sidebarCollapsed, setSidebarCollapsed]);

  return (
    <SidebarContext.Provider value={{
      sidebarCollapsed,
      setSidebarCollapsed,
      collapseSidebar,
      expandSidebar,
      toggleSidebar,
    }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
