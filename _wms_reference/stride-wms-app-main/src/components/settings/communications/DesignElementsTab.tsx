import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { CommunicationDesignElement } from '@/hooks/useCommunications';
import DOMPurify from 'dompurify';

interface DesignElementsTabProps {
  designElements: CommunicationDesignElement[];
}

const CATEGORY_LABELS: Record<string, string> = {
  icon: 'Icons',
  header_block: 'Headers & Footers',
  button: 'Buttons',
  divider: 'Dividers',
  callout: 'Callouts',
};

export function DesignElementsTab({ designElements }: DesignElementsTabProps) {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewElement, setPreviewElement] = useState<CommunicationDesignElement | null>(null);

  const categories = ['all', ...Object.keys(CATEGORY_LABELS)];
  
  const filteredElements = designElements.filter(e => 
    activeCategory === 'all' || e.category === activeCategory
  );

  const copySnippet = (element: CommunicationDesignElement) => {
    navigator.clipboard.writeText(element.html_snippet);
    setCopiedId(element.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const renderElementPreview = (element: CommunicationDesignElement) => {
    // For icons, we can safely render the img tag
    if (element.category === 'icon') {
      return (
        <div 
          className="flex items-center justify-center p-4"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(element.html_snippet) }}
        />
      );
    }
    
    // For other elements, show in an iframe for safety
    return (
      <iframe
        srcDoc={`
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { 
                margin: 0; 
                padding: 16px; 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: #f3f4f6;
              }
            </style>
          </head>
          <body>${element.html_snippet}</body>
          </html>
        `}
        className="w-full h-[150px] border-0"
        title={element.name}
        sandbox="allow-same-origin"
      />
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Design Elements</h3>
          <p className="text-sm text-muted-foreground">
            Pre-built email-safe HTML snippets for your templates. Click to copy.
          </p>
        </div>
      </div>

      <Tabs value={activeCategory} onValueChange={setActiveCategory}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <TabsTrigger key={key} value={key}>{label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredElements.map((element) => (
          <Card
            key={element.id}
            className="overflow-hidden hover:border-primary/50 transition-colors"
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-medium">{element.name}</CardTitle>
                  {element.is_system && (
                    <Badge variant="secondary" className="text-xs">
                      <MaterialIcon name="lock" size="sm" className="mr-1" />
                      System
                    </Badge>
                  )}
                </div>
                <Badge variant="outline" className="text-xs capitalize">
                  {element.category.replace('_', ' ')}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="border-t bg-muted/30">
                {renderElementPreview(element)}
              </div>
              <div className="p-3 border-t flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => copySnippet(element)}
                >
                  {copiedId === element.id ? (
                    <>
                      <MaterialIcon name="check" size="sm" className="mr-2 text-green-500" />
                      Copied
                    </>
                  ) : (
                    <>
                      <MaterialIcon name="content_copy" size="sm" className="mr-2" />
                      Copy HTML
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPreviewElement(element)}
                >
                  <MaterialIcon name="visibility" size="sm" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredElements.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No design elements found in this category.
        </div>
      )}

      {/* Code Preview Dialog */}
      <Dialog open={!!previewElement} onOpenChange={() => setPreviewElement(null)}>
        <DialogContent className="max-w-[700px]">
          <DialogHeader>
            <DialogTitle>{previewElement?.name}</DialogTitle>
            <DialogDescription>
              HTML snippet for {previewElement?.category.replace('_', ' ')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Preview</Label>
              <div className="mt-2 border rounded-lg overflow-hidden bg-muted/30">
                {previewElement && (
                  <iframe
                    srcDoc={`
                      <!DOCTYPE html>
                      <html>
                      <head>
                        <style>
                          body { 
                            margin: 0; 
                            padding: 24px; 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                            background: #f3f4f6;
                          }
                        </style>
                      </head>
                      <body>${previewElement.html_snippet}</body>
                      </html>
                    `}
                    className="w-full h-[200px] border-0"
                    title={previewElement.name}
                    sandbox="allow-same-origin"
                  />
                )}
              </div>
            </div>
            <div>
              <Label>HTML Code</Label>
              <ScrollArea className="mt-2 h-[200px]">
                <pre className="text-xs font-mono bg-muted p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
                  {previewElement?.html_snippet}
                </pre>
              </ScrollArea>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewElement(null)}>
              Close
            </Button>
            <Button onClick={() => previewElement && copySnippet(previewElement)}>
              {copiedId === previewElement?.id ? (
                <>
                  <MaterialIcon name="check" size="sm" className="mr-2" />
                  Copied
                </>
              ) : (
                <>
                  <MaterialIcon name="content_copy" size="sm" className="mr-2" />
                  Copy HTML
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Usage Guide */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Using Design Elements</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <p>
            These design elements are pre-built HTML snippets that are compatible with email clients.
            They use inline styles and table-based layouts for maximum compatibility.
          </p>
          <p>
            <strong>To use:</strong> Copy the HTML snippet and paste it into your email template's code view.
            You can also use the "Insert Element" dropdown in the template editor.
          </p>
          <p>
            <strong>Variables:</strong> Some elements contain variables like <code>{'{{portal_base_url}}'}</code>.
            These will be replaced with actual values when the email is sent.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
