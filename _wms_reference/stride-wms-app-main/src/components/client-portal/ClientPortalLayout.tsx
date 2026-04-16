import { ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/lib/toastShim';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface ClientPortalLayoutProps {
  children: ReactNode;
  accountName?: string;
  warehouseName?: string;
  userName?: string;
}

const navItems = [
  {
    title: 'Dashboard',
    href: '/client',
    icon: 'dashboard',
  },
  {
    title: 'My Items',
    href: '/client/items',
    icon: 'inventory_2',
  },
  {
    title: 'Shipments',
    href: '/client/shipments',
    icon: 'local_shipping',
  },
  {
    title: 'Quotes',
    href: '/client/quotes',
    icon: 'request_quote',
  },
  {
    title: 'Claims',
    href: '/client/claims',
    icon: 'gavel',
  },
];

export function ClientPortalLayout({
  children,
  accountName = 'My Account',
  warehouseName = 'Client Portal',
  userName = 'User',
}: ClientPortalLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error('Error signing out');
    } else {
      navigate('/client/login');
    }
  };

  const NavLinks = ({ mobile = false }: { mobile?: boolean }) => (
    <nav className={cn('flex flex-col gap-1', mobile && 'mt-4')}>
      {navItems.map((item) => {
        const isActive = location.pathname === item.href;
        return (
          <Link
            key={item.href}
            to={item.href}
            onClick={() => mobile && setMobileOpen(false)}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <MaterialIcon
              name={item.icon}
              size="md"
              weight={isActive ? 400 : 300}
              className={cn(
                'flex-shrink-0',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}
            />
            {item.title}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 border-r bg-white lg:block">
        <div className="flex h-full flex-col">
          {/* Logo/Brand */}
          <div className="flex h-16 items-center gap-2 border-b px-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-md">
              <MaterialIcon name="warehouse" size="sm" className="text-white" weight={300} />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">{warehouseName}</span>
              <span className="text-xs text-muted-foreground">Client Portal</span>
            </div>
          </div>

          {/* Account Info */}
          <div className="border-b px-4 py-3">
            <p className="text-xs text-muted-foreground">Viewing as</p>
            <p className="text-sm font-medium truncate">{accountName}</p>
          </div>

          {/* Navigation */}
          <div className="flex-1 overflow-y-auto p-4">
            <NavLinks />
          </div>

          {/* User Menu */}
          <div className="border-t p-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="w-full justify-start gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <MaterialIcon name="person" size="sm" />
                  </div>
                  <div className="flex flex-col items-start text-sm">
                    <span className="font-medium">{userName}</span>
                    <span className="text-xs text-muted-foreground">Client User</span>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                  <MaterialIcon name="logout" size="sm" className="mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center border-b bg-white px-4 lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <MaterialIcon name="menu" size="md" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
            <div className="flex h-full flex-col">
              {/* Logo/Brand */}
              <div className="flex h-14 items-center gap-2 border-b px-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-md">
                  <MaterialIcon name="warehouse" size="sm" className="text-white" weight={300} />
                </div>
                <span className="text-sm font-semibold">{warehouseName}</span>
              </div>

              {/* Account Info */}
              <div className="border-b px-4 py-3">
                <p className="text-xs text-muted-foreground">Viewing as</p>
                <p className="text-sm font-medium truncate">{accountName}</p>
              </div>

              {/* Navigation */}
              <div className="flex-1 overflow-y-auto p-4">
                <NavLinks mobile />
              </div>

              {/* Sign Out */}
              <div className="border-t p-4">
                <Button
                  variant="ghost"
                  className="w-full justify-start text-destructive"
                  onClick={handleLogout}
                >
                  <MaterialIcon name="logout" size="sm" className="mr-2" />
                  Sign Out
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <div className="ml-2 flex flex-1 items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-sm">
            <MaterialIcon name="warehouse" size="sm" className="text-white" weight={300} />
          </div>
          <span className="text-sm font-semibold">{warehouseName}</span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MaterialIcon name="person" size="md" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{userName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <MaterialIcon name="logout" size="sm" className="mr-2" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Main Content */}
      <main className="lg:pl-64">
        <div className="min-h-screen pt-14 lg:pt-0">
          <div className="p-4 pb-48 md:p-6 md:pb-48 lg:p-8 lg:pb-48">{children}</div>
        </div>
      </main>
    </div>
  );
}
