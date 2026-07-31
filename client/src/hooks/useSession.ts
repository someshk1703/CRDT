import { createClient, type Session, type User } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';

// ─── Supabase client singleton ────────────────────────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface SessionHook {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * Manages Supabase Auth session state.
 * - Provides `signIn` (GitHub OAuth) and `signOut`.
 * - `signOut` also closes any active WebSocket via the registered `closeActiveWs` callback.
 * - Listens to `onAuthStateChange` so the session stays reactive across OAuth redirects.
 */
export function useSession(): SessionHook {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Registered by Room.tsx so sign-out closes the active WS before clearing auth
  const closeActiveWsRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Load initial session (handles OAuth redirect callback)
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setLoading(false);
    });

    return () => { subscription.unsubscribe(); };
  }, []);

  const signIn = async () => {
    // When embedded in an iframe, GitHub blocks OAuth redirects inside frames.
    // Get the OAuth URL without redirecting, then open it in a new tab.
    // Supabase's onAuthStateChange fires in the iframe once the popup completes
    // (both share the same crdt-client.vercel.app localStorage origin).
    const inIframe = window.self !== window.top;
    if (inIframe) {
      const { data } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: window.location.origin, skipBrowserRedirect: true },
      });
      if (data?.url) window.open(data.url, '_blank', 'noopener');
    } else {
      await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: window.location.origin },
      });
    }
  };

  const signOut = async () => {
    // Close active WS first so the server sees a clean disconnect
    closeActiveWsRef.current?.();
    await supabase.auth.signOut();
  };

  // Expose a way for Room.tsx to register the close callback
  (signOut as { registerClose?: (fn: () => void) => void }).registerClose =
    (fn: () => void) => { closeActiveWsRef.current = fn; };

  return { session, user: session?.user ?? null, loading, signIn, signOut };
}
