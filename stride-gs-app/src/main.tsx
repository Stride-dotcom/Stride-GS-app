import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './contexts/AuthContext.tsx'
import { BatchDataProvider } from './contexts/BatchDataContext.tsx'
import { supabase } from './lib/supabase.ts'

// ─── Pre-bootstrap PASSWORD_RECOVERY detection ──────────────────────────────
// Problem: bootstrap() calls getSession() to process the recovery token, which
// fires the PASSWORD_RECOVERY event — but AuthContext's onAuthStateChange listener
// isn't registered yet (React hasn't mounted). By the time AuthContext mounts and
// calls getSession(), the event is gone and the session looks like a normal login.
//
// Fix: register a module-level listener BEFORE bootstrap runs to capture the event,
// bridge via sessionStorage so AuthContext can detect it after mount.
//
// Also handle implicit-flow hash: type=recovery is present in the hash before
// getSession() clears it — use that as a fallback.
if (window.location.hash.includes('type=recovery')) {
  sessionStorage.setItem('stride_recovery', '1');
}

const _preBootstrapSub = supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    sessionStorage.setItem('stride_recovery', '1');
  }
});

async function bootstrap() {
  // ─── HashRouter + Supabase token conflict fix ────────────────────────────
  // Password reset emails redirect to: mystridehub.com/#access_token=...&type=recovery
  // HashRouter would try to route to "#access_token=..." before Supabase processes it.
  // Solution: detect token in hash (or PKCE code in search), let Supabase process it,
  // then clear the URL so React Router sees a clean "#/" path.
  const hasImplicitToken = window.location.hash.includes('access_token');
  const hasPkceCode = window.location.search.includes('code=');

  // Always settle Supabase cross-tab session sync before React mounts.
  // Without this, opening a new tab fires SIGNED_OUT before getSession
  // completes, causing AuthContext to log the user out (race condition).
  await supabase.auth.getSession();

  if (hasImplicitToken || hasPkceCode) {
    window.history.replaceState(null, '', window.location.pathname || '/');
  }

  // Pre-bootstrap listener no longer needed — AuthContext takes over from here
  _preBootstrapSub.data.subscription.unsubscribe();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthProvider>
        <BatchDataProvider>
          <App />
        </BatchDataProvider>
      </AuthProvider>
    </StrictMode>,
  )
}

bootstrap();
