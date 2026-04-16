import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

// Dev-only quick login users - only visible in development mode
interface DevUser {
  role: string;
  email: string;
  password: string;
  label: string;
  icon: string;
}

const DEV_USERS: DevUser[] = [
  { role: 'admin', email: 'admin@dev.local', password: 'devquick123!', label: 'Admin', icon: 'shield' },
  { role: 'manager', email: 'manager@dev.local', password: 'devquick123!', label: 'Manager', icon: 'group' },
  { role: 'warehouse', email: 'warehouse@dev.local', password: 'devquick123!', label: 'Warehouse', icon: 'warehouse' },
  { role: 'client_user', email: 'client@dev.local', password: 'devquick123!', label: 'Client', icon: 'person' },
  { role: 'technician', email: 'technician@dev.local', password: 'devquick123!', label: 'Technician', icon: 'build' },
  { role: 'billing_manager', email: 'billing@dev.local', password: 'devquick123!', label: 'Billing Mgr', icon: 'receipt_long' },
];

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const signUpSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string().min(6, 'Password must be at least 6 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type LoginFormData = z.infer<typeof loginSchema>;
type SignUpFormData = z.infer<typeof signUpSchema>;

export default function Auth() {
  // Debug: Log dev quick login visibility conditions
  console.log('[Auth] Dev Quick Login conditions:', {
    dev: import.meta.env.DEV,
    flag: import.meta.env.VITE_ENABLE_DEV_QUICK_LOGIN,
    shouldShow: import.meta.env.DEV === true || import.meta.env.VITE_ENABLE_DEV_QUICK_LOGIN === 'true',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('login');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const { signIn, signUp, signInWithGoogle, resetPassword, user, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const signUpForm = useForm<SignUpFormData>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      firstName: '',
      lastName: '',
    },
  });

  useEffect(() => {
    if (!loading && user) {
      navigate('/');
    }
  }, [user, loading, navigate]);

  const handleLogin = async (data: LoginFormData) => {
    setIsLoading(true);
    const { error } = await signIn(data.email, data.password);
    setIsLoading(false);

    if (error) {
      let message = 'An error occurred during login';
      if (error.message.includes('Invalid login credentials')) {
        message = 'Invalid email or password';
      } else if (error.message.includes('Email not confirmed')) {
        message = 'Please confirm your email before logging in';
      }
      toast({
        variant: 'destructive',
        title: 'Login Failed',
        description: message,
      });
      return;
    }

    // Navigate to dashboard without welcome toast
    navigate('/');
  };

  const handleSignUp = async (data: SignUpFormData) => {
    setIsLoading(true);
    const { error } = await signUp(data.email, data.password, data.firstName, data.lastName);
    setIsLoading(false);

    if (error) {
      let message = 'An error occurred during sign up';
      if (error.message.includes('already registered')) {
        message = 'An account with this email already exists';
      } else if (error.message.includes('password')) {
        message = 'Password is too weak. Please use a stronger password';
      }
      toast({
        variant: 'destructive',
        title: 'Sign Up Failed',
        description: message,
      });
      return;
    }

    toast({
      title: 'Account Created!',
      description: 'Please check your email to confirm your account.',
    });
    setActiveTab('login');
    signUpForm.reset();
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    const { error } = await signInWithGoogle();
    setIsLoading(false);
    if (error) {
      toast({
        variant: 'destructive',
        title: 'Google Sign In Failed',
        description: error.message,
      });
    }
  };

  const handleForgotPassword = async () => {
    if (!resetEmail) {
      toast({
        variant: 'destructive',
        title: 'Email Required',
        description: 'Please enter your email address.',
      });
      return;
    }
    setIsLoading(true);
    const { error } = await resetPassword(resetEmail);
    setIsLoading(false);
    if (error) {
      toast({
        variant: 'destructive',
        title: 'Reset Failed',
        description: error.message,
      });
      return;
    }
    setResetSent(true);
    toast({
      title: 'Email Sent!',
      description: 'Check your email for the password reset link.',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4 py-8 overflow-y-auto">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-primary rounded-xl">
              <MaterialIcon name="inventory_2" size="xl" className="text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Stride WMS</CardTitle>
          <CardDescription>
            Warehouse Management System
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            
            <TabsContent value="login">
              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
                  <FormField
                    control={loginForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="you@example.com"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={loginForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="Enter password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      'Sign In'
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    className="w-full text-sm"
                    onClick={() => setShowForgotPassword(true)}
                  >
                    Forgot your password?
                  </Button>
                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handleGoogleSignIn}
                    disabled={isLoading}
                  >
                    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                    Google
                  </Button>

                  {/* Dev Quick Login - Only visible in development or when flag is set */}
                  {(import.meta.env.DEV === true || import.meta.env.VITE_ENABLE_DEV_QUICK_LOGIN === 'true') && (
                    <div className="mt-6">
                      <div className="relative mb-4">
                        <div className="absolute inset-0 flex items-center">
                          <span className="w-full border-t border-dashed border-orange-400" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-card px-2 text-orange-500 font-semibold">Dev Quick Login</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {/* Admin Dev Button - System access, placed at top */}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-xs border-purple-300 bg-purple-50 hover:bg-purple-100 hover:border-purple-500 dark:border-purple-700 dark:bg-purple-950 dark:hover:bg-purple-900 col-span-2"
                                onClick={async () => {
                                  setIsLoading(true);
                                  try {
                                    // Call the dev-admin-login edge function
                                    const { data, error } = await supabase.functions.invoke('dev-admin-login');

                                    if (error) {
                                      throw new Error(error.message || 'Failed to invoke dev-admin-login');
                                    }

                                    if (!data?.success) {
                                      throw new Error(data?.error || 'Dev admin login failed');
                                    }

                                    // Set the session from the edge function response
                                    if (data.session) {
                                      await supabase.auth.setSession({
                                        access_token: data.session.access_token,
                                        refresh_token: data.session.refresh_token,
                                      });
                                    }

                                    toast({
                                      title: 'Admin Dev Login',
                                      description: 'Signed in with admin_dev system privileges',
                                    });

                                     // Admin Dev users are primarily meant to access QA Center.
                                     navigate('/qa');
                                  } catch (err) {
                                    console.error('Admin dev login error:', err);
                                    toast({
                                      variant: 'destructive',
                                      title: 'Admin Dev Login Failed',
                                      description: err instanceof Error ? err.message : 'Could not sign in as Admin Dev',
                                    });
                                  } finally {
                                    setIsLoading(false);
                                  }
                                }}
                                disabled={isLoading}
                              >
                                <MaterialIcon name="developer_mode" size="sm" className="mr-1" />
                                Admin Dev
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Admin Dev — internal system access</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        {/* Standard dev login buttons */}
                        {DEV_USERS.map((devUser) => {
                          return (
                            <Button
                              key={devUser.role}
                              type="button"
                              variant="outline"
                              size="sm"
                              className="text-xs border-orange-200 hover:bg-orange-50 hover:border-orange-400 dark:border-orange-800 dark:hover:bg-orange-950"
                              onClick={async () => {
                                setIsLoading(true);
                                try {
                                  // Primary path: provision/assign role in dev helper and return a fresh session.
                                  const { data, error } = await supabase.functions.invoke('dev-admin-login', {
                                    body: { role: devUser.role },
                                  });

                                  if (error) {
                                    throw new Error(error.message || 'Edge function invocation failed');
                                  }
                                  if (!data?.success || !data?.session?.access_token || !data?.session?.refresh_token) {
                                    throw new Error(data?.error || 'No session returned from dev role login helper');
                                  }

                                  await supabase.auth.setSession({
                                    access_token: data.session.access_token,
                                    refresh_token: data.session.refresh_token,
                                  });
                                  navigate('/');
                                } catch (invokeError) {
                                  // Fallback path: try static credentials (for local setups not using the edge helper).
                                  const { error } = await signIn(devUser.email, devUser.password);
                                  if (error) {
                                    const invokeMsg = invokeError instanceof Error ? invokeError.message : 'Dev role helper unavailable';
                                    toast({
                                      variant: 'destructive',
                                      title: 'Dev Login Failed',
                                      description: `Could not log in as ${devUser.label}: ${error.message} (${invokeMsg})`,
                                    });
                                    return;
                                  }
                                  navigate('/');
                                } finally {
                                  setIsLoading(false);
                                }
                              }}
                              disabled={isLoading}
                            >
                              <MaterialIcon name={devUser.icon} size="sm" className="mr-1" />
                              {devUser.label}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="signup">
              <Form {...signUpForm}>
                <form onSubmit={signUpForm.handleSubmit(handleSignUp)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={signUpForm.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>First Name</FormLabel>
                          <FormControl>
                            <Input placeholder="First name" uppercase={false} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={signUpForm.control}
                      name="lastName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Last Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Last name" uppercase={false} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={signUpForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="you@example.com"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signUpForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="Enter password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signUpForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm Password</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="Confirm password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                        Creating account...
                      </>
                    ) : (
                      'Create Account'
                    )}
                  </Button>
                </form>
              </Form>
            </TabsContent>
          </Tabs>

          {/* Forgot Password Modal */}
          {showForgotPassword && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
              <Card className="w-full max-w-md mx-4">
                <CardHeader>
                  <CardTitle>Reset Password</CardTitle>
                  <CardDescription>
                    {resetSent
                      ? 'Check your email for the reset link'
                      : 'Enter your email to receive a password reset link'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!resetSent && (
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                    />
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        setShowForgotPassword(false);
                        setResetSent(false);
                        setResetEmail('');
                      }}
                    >
                      {resetSent ? 'Close' : 'Cancel'}
                    </Button>
                    {!resetSent && (
                      <Button className="flex-1" onClick={handleForgotPassword} disabled={isLoading}>
                        {isLoading ? <MaterialIcon name="progress_activity" size="sm" className="animate-spin" /> : 'Send Reset Link'}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
