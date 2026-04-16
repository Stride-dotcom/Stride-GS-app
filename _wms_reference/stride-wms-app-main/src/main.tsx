// Cache bust: 2026-01-30T04:52
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import PublicSmsOptInApp from "./PublicSmsOptInApp.tsx";
import "./index.css";
import { initErrorTracker } from "@/lib/errorTracker";

// Initialize global error tracking
initErrorTracker({
  getUser: () => {
    // Get user context from localStorage cache if available
    try {
      const authData = localStorage.getItem('sb-lxkstlsfxocaswqwlmed-auth-token');
      if (authData) {
        const parsed = JSON.parse(authData);
        const userId = parsed?.user?.id;
        
        // Try to get role from a cached profile
        const profileCache = localStorage.getItem('user_profile_cache');
        let role: string | undefined;
        let accountId: string | undefined;
        let tenantId: string | undefined;
        
        if (profileCache) {
          try {
            const profile = JSON.parse(profileCache);
            role = profile.role;
            accountId = profile.account_id;
            tenantId = profile.tenant_id;
          } catch {
            // Ignore parse errors
          }
        }
        
        return { id: userId, role, accountId, tenantId };
      }
    } catch {
      // Ignore errors reading from localStorage
    }
    return null;
  },
  getRoute: () => window.location.pathname,
  appVersion: import.meta.env.VITE_APP_VERSION || 'dev',
});

const pathname = window.location.pathname;
const isPublicSmsPath =
  pathname === "/sms" ||
  pathname === "/sms/" ||
  pathname === "/sms/opt-in" ||
  pathname.startsWith("/sms/opt-in/") ||
  pathname === "/sms/opt-out" ||
  pathname.startsWith("/sms/opt-out/") ||
  pathname === "/sms-opt-in" ||
  pathname.startsWith("/sms-opt-in/") ||
  pathname === "/sms-opt-out" ||
  pathname.startsWith("/sms-opt-out/");
const RootApp = isPublicSmsPath ? PublicSmsOptInApp : App;

createRoot(document.getElementById("root")!).render(<RootApp />);
