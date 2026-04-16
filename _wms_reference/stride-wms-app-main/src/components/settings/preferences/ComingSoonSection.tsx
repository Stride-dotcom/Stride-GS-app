import { ReactNode, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface ComingSoonSectionProps {
  title: string;
  iconName: string;
  children?: ReactNode;
  defaultOpen?: boolean;
}

export function ComingSoonSection({
  title,
  iconName,
  children,
  defaultOpen = false,
}: ComingSoonSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="opacity-60">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
            <CardTitle className="flex items-center justify-between text-base">
              <div className="flex items-center gap-2">
                {isOpen ? (
                  <MaterialIcon name="expand_more" size="sm" className="text-muted-foreground" />
                ) : (
                  <MaterialIcon name="chevron_right" size="sm" className="text-muted-foreground" />
                )}
                <MaterialIcon name={iconName} size="sm" className="text-muted-foreground" />
                <span className="text-muted-foreground text-sm">{title}</span>
              </div>
              <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pointer-events-none pt-0">
            {children}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
