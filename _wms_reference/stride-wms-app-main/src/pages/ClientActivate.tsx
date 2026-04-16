import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  useValidateInvitationToken,
  useAcceptInvitation,
} from '@/hooks/useClientInvitations';

const activationSchema = z
  .object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    phone: z.string().optional(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

type ActivationFormData = z.infer<typeof activationSchema>;

export default function ClientActivate() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [activationSuccess, setActivationSuccess] = useState(false);

  const { data: invitation, isLoading, error } = useValidateInvitationToken(token);
  const acceptInvitation = useAcceptInvitation();

  const form = useForm<ActivationFormData>({
    resolver: zodResolver(activationSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      phone: '',
      password: '',
      confirmPassword: '',
    },
  });

  // Pre-fill form with invitation data
  useEffect(() => {
    if (invitation) {
      form.setValue('firstName', invitation.first_name || '');
      form.setValue('lastName', invitation.last_name || '');
    }
  }, [invitation, form]);

  const onSubmit = async (data: ActivationFormData) => {
    if (!token) return;

    try {
      await acceptInvitation.mutateAsync({
        token,
        password: data.password,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
      });

      setActivationSuccess(true);
    } catch (err) {
      console.error('Activation error:', err);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-primary" />
              <p className="text-muted-foreground">Validating invitation...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No token provided
  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <MaterialIcon name="cancel" size="md" />
              Invalid Link
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This activation link is invalid. Please check your email for the correct link
              or contact support.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Token validation error
  if (error || !invitation) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <MaterialIcon name="cancel" size="md" />
              Invitation Not Found
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This invitation could not be found. It may have been cancelled or the link
              is incorrect.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Invitation expired
  if (invitation.isExpired) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-600">
              <MaterialIcon name="error" size="md" />
              Invitation Expired
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              This invitation has expired. Please contact {invitation.tenants?.name || 'the warehouse'}
              to request a new invitation.
            </p>
            <Alert>
              <MaterialIcon name="error" size="sm" />
              <AlertTitle>Need help?</AlertTitle>
              <AlertDescription>
                Reach out to your contact at {invitation.tenants?.name} to have them send
                a new invitation.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Invitation already used
  if (invitation.isUsed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="check_circle" size="md" className="text-green-500" />
              Already Activated
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              This invitation has already been used to create an account.
            </p>
            <Button className="w-full" onClick={() => navigate('/client/login')}>
              Go to Client Portal Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Invitation cancelled
  if (invitation.isCancelled) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <MaterialIcon name="cancel" size="md" />
              Invitation Cancelled
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This invitation has been cancelled. Please contact{' '}
              {invitation.tenants?.name || 'the warehouse'} if you believe this is an error.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Activation success
  if (activationSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                <MaterialIcon name="check_circle" size="xl" className="text-green-600" />
              </div>
            </div>
            <CardTitle className="text-center">Account Activated!</CardTitle>
            <CardDescription className="text-center">
              Your client portal account has been created successfully.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-green-50 border-green-200">
              <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
              <AlertTitle className="text-green-800">You're all set!</AlertTitle>
              <AlertDescription className="text-green-700">
                You can now log in to the client portal to view your items, track shipments,
                and review quotes.
              </AlertDescription>
            </Alert>

            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium">Your account details:</p>
              <p className="text-sm text-muted-foreground">
                Email: {invitation.email}
              </p>
              <p className="text-sm text-muted-foreground">
                Account: {invitation.accounts?.name}
              </p>
            </div>

            <Button className="w-full" onClick={() => navigate('/client/login')}>
              Go to Client Portal
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Activation form
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <MaterialIcon name="business" size="xl" className="text-primary" />
            </div>
          </div>
          <CardTitle>Activate Your Account</CardTitle>
          <CardDescription>
            Set up your password to access the client portal for{' '}
            <span className="font-medium">{invitation.accounts?.name}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/50 rounded-lg p-3 mb-6">
            <p className="text-sm text-muted-foreground">
              Invited by: <span className="font-medium">{invitation.tenants?.name}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              Email: <span className="font-medium">{invitation.email}</span>
            </p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input placeholder="John" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="(555) 123-4567" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Create a password"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? (
                            <MaterialIcon name="visibility_off" size="sm" />
                          ) : (
                            <MaterialIcon name="visibility" size="sm" />
                          )}
                        </Button>
                      </div>
                    </FormControl>
                    <FormDescription>
                      At least 8 characters with uppercase, lowercase, and a number
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showConfirmPassword ? 'text' : 'password'}
                          placeholder="Confirm your password"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        >
                          {showConfirmPassword ? (
                            <MaterialIcon name="visibility_off" size="sm" />
                          ) : (
                            <MaterialIcon name="visibility" size="sm" />
                          )}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {acceptInvitation.error && (
                <Alert variant="destructive">
                  <MaterialIcon name="error" size="sm" />
                  <AlertTitle>Activation Failed</AlertTitle>
                  <AlertDescription>
                    {acceptInvitation.error instanceof Error
                      ? acceptInvitation.error.message
                      : 'An error occurred during activation. Please try again.'}
                  </AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={acceptInvitation.isPending}
              >
                {acceptInvitation.isPending ? (
                  <>
                    <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                    Activating...
                  </>
                ) : (
                  'Activate Account'
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
