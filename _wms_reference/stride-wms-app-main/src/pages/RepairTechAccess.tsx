import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format } from 'date-fns';

interface TaskData {
  id: string;
  task_type: string;
  status: string;
  description: string | null;
  due_date: string | null;
  created_at: string;
  items: Array<{
    id: string;
    item_code: string;
    description: string | null;
    status: string | null;
    photos: string[];
  }>;
}

interface TokenData {
  id: string;
  technician_name: string | null;
  technician_email: string | null;
  expires_at: string;
  accessed_at: string | null;
  task_id: string;
}

export default function RepairTechAccess() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [taskData, setTaskData] = useState<TaskData | null>(null);

  useEffect(() => {
    if (token) {
      validateTokenAndLoadData();
    } else {
      setError('No access token provided');
      setLoading(false);
    }
  }, [token]);

  const validateTokenAndLoadData = async () => {
    try {
      // Validate token
      const { data: tokenRecord, error: tokenError } = await supabase
        .from('repair_tech_tokens')
        .select('*')
        .eq('token', token)
        .single();

      if (tokenError || !tokenRecord) {
        setError('Invalid or expired access link');
        setLoading(false);
        return;
      }

      // Check expiration
      if (new Date(tokenRecord.expires_at) < new Date()) {
        setError('This access link has expired. Please contact the warehouse for a new link.');
        setLoading(false);
        return;
      }

      setTokenData(tokenRecord);

      // Update accessed_at
      await supabase
        .from('repair_tech_tokens')
        .update({ accessed_at: new Date().toISOString() })
        .eq('id', tokenRecord.id);

      // Load task data
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .select(`
          id,
          task_type,
          status,
          description,
          due_date,
          created_at,
          task_items(
            id,
            item:items(
              id,
              item_code,
              description,
              status
            )
          )
        `)
        .eq('id', tokenRecord.task_id)
        .single();

      if (taskError) throw taskError;

      // Fetch photos for each item
      const itemsWithPhotos = await Promise.all(
        (task.task_items || []).map(async (ti: any) => {
          const item = ti.item;
          if (!item) return null;

          const { data: photos } = await supabase
            .from('item_photos')
            .select('photo_url')
            .eq('item_id', item.id)
            .order('created_at', { ascending: false });

          return {
            id: item.id,
            item_code: item.item_code,
            description: item.description,
            status: item.status,
            photos: (photos || []).map((p: any) => p.photo_url),
          };
        })
      );

      setTaskData({
        id: task.id,
        task_type: task.task_type,
        status: task.status,
        description: task.description,
        due_date: task.due_date,
        created_at: task.created_at,
        items: itemsWithPhotos.filter(Boolean) as TaskData['items'],
      });

      setLoading(false);
    } catch (err) {
      console.error('Error loading repair data:', err);
      setError('Failed to load repair information');
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <MaterialIcon name="check_circle" size="sm" className="text-green-500" />;
      case 'in_progress':
        return <MaterialIcon name="schedule" size="sm" className="text-amber-500" />;
      default:
        return <MaterialIcon name="warning" size="sm" className="text-yellow-500" />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-4">
          <MaterialIcon name="progress_activity" size="xl" className="animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading repair information...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <MaterialIcon name="warning" size="lg" className="text-destructive" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <MaterialIcon name="build" size="md" className="text-primary" />
              </div>
              <div>
                <CardTitle>Repair Task Details</CardTitle>
                <CardDescription>
                  {tokenData?.technician_name ? `Welcome, ${tokenData.technician_name}` : 'Repair Technician Access'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Status:</span>
                <Badge variant={taskData?.status === 'completed' ? 'default' : 'secondary'}>
                  {getStatusIcon(taskData?.status || '')}
                  <span className="ml-1 capitalize">{taskData?.status?.replace('_', ' ')}</span>
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Task Type:</span>
                <Badge variant="outline" className="capitalize">
                  {taskData?.task_type?.replace('_', ' ')}
                </Badge>
              </div>
              {taskData?.due_date && (
                <div className="flex items-center gap-2">
                  <MaterialIcon name="schedule" size="sm" className="text-muted-foreground" />
                  <span>Due: {format(new Date(taskData.due_date.substring(0, 10) + 'T12:00:00'), 'MMM d, yyyy')}</span>
                </div>
              )}
            </div>

            {taskData?.description && (
              <>
                <Separator className="my-4" />
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <MaterialIcon name="description" size="sm" />
                    Task Notes
                  </h4>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{taskData.description}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Items */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <MaterialIcon name="inventory_2" size="md" />
            Items for Repair ({taskData?.items.length || 0})
          </h2>

          {taskData?.items.map((item) => (
            <Card key={item.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{item.item_code}</CardTitle>
                  {item.status && (
                    <Badge variant="outline" className="capitalize">
                      {item.status.replace('_', ' ')}
                    </Badge>
                  )}
                </div>
                {item.description && (
                  <CardDescription>{item.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {item.photos.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <MaterialIcon name="image" size="sm" />
                      Photos ({item.photos.length})
                    </h4>
                    <ScrollArea className="w-full">
                      <div className="flex gap-3 pb-2">
                        {item.photos.map((photo, index) => (
                          <a
                            key={index}
                            href={photo}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0"
                          >
                            <img
                              src={photo}
                              alt={`Item photo ${index + 1}`}
                              className="h-32 w-32 object-cover rounded-lg border hover:opacity-80 transition-opacity"
                            />
                          </a>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No photos available</p>
                )}
              </CardContent>
            </Card>
          ))}

          {(!taskData?.items || taskData.items.length === 0) && (
            <Card>
              <CardContent className="py-12 text-center">
                <MaterialIcon name="inventory_2" size="xl" className="mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No items assigned to this repair task</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground py-4">
          <p>This is a secure, time-limited access link.</p>
          {tokenData?.expires_at && (
            <p>Expires: {format(new Date(tokenData.expires_at), 'MMM d, yyyy h:mm a')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
