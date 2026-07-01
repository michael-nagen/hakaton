// ── Model Provider — OpenRouter OAuth (PKCE) ─────────────────────────
//
// One-click "Connect with OpenRouter", VS Code/Cursor-plugin style: the app
// sends the user to OpenRouter to approve, then exchanges the returned code for
// a USER-controlled API key — no manual copy/paste. Pure PKCE (S256), so no
// client secret is needed and nothing sensitive ships in the bundle.
//
// Flow (per https://openrouter.ai/docs/use-cases/oauth-pkce):
//   1. buildOpenRouterAuthUrl() → redirect user to openrouter.ai/auth
//   2. user approves → OpenRouter redirects back with ?code=...
//   3. exchangeOpenRouterCode({ code }) → POST /api/v1/auth/keys → { key }
//
// The resulting key is treated exactly like a pasted BYOK key (stored on-device
// only). The key and the PKCE verifier are never logged.

const AUTH_URL = 'https://openrouter.ai/auth';
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';
const VERIFIER_STORAGE_KEY = 'maestro.openrouter.pkce_verifier';

/** base64url (no padding) of an ArrayBuffer / byte array. */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Random high-entropy PKCE code verifier (43–128 chars). */
function generateCodeVerifier(): string {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  return base64UrlEncode(random);
}

/** S256 challenge = base64url(SHA-256(verifier)). */
async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Begin the OAuth flow: mint a verifier, stash it for the return trip, and
 * return the OpenRouter authorization URL to send the user to. The caller does
 * `window.location.href = url`.
 *
 * `callbackUrl` must be an https URL (ports 443/3000) or any localhost port,
 * per OpenRouter's rules. Defaults to the current page so the user lands back
 * on /ai-setup with `?code=...`.
 */
export async function buildOpenRouterAuthUrl(params?: { callbackUrl?: string }): Promise<string> {
  const callbackUrl =
    params?.callbackUrl ??
    (typeof window !== 'undefined' ? `${window.location.origin}/ai-setup` : '');

  const verifier = generateCodeVerifier();
  const challenge = await deriveCodeChallenge(verifier);
  try {
    sessionStorage.setItem(VERIFIER_STORAGE_KEY, verifier);
  } catch {
    // sessionStorage unavailable — exchange will fall back to no verifier.
  }

  const url = new URL(AUTH_URL);
  url.searchParams.set('callback_url', callbackUrl);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** True if the current URL carries an OAuth `?code=` we should exchange. */
export function readOAuthCodeFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('code');
}

/** Remove `?code=...` from the address bar without a reload (keeps the URL clean). */
export function clearOAuthCodeFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}

/**
 * Exchange the authorization code for a user-controlled API key. Returns a
 * discriminated result (never throws to the UI); the key never appears in any
 * error message. Consumes the stored verifier.
 */
export async function exchangeOpenRouterCode(params: {
  code: string;
}): Promise<{ ok: true; key: string } | { ok: false; message: string }> {
  let verifier: string | null = null;
  try {
    verifier = sessionStorage.getItem(VERIFIER_STORAGE_KEY);
    sessionStorage.removeItem(VERIFIER_STORAGE_KEY);
  } catch {
    verifier = null;
  }

  try {
    const res = await fetch(EXCHANGE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: params.code,
        ...(verifier ? { code_verifier: verifier, code_challenge_method: 'S256' } : {}),
      }),
    });
    if (!res.ok) {
      return { ok: false, message: `Could not complete OpenRouter sign-in (status ${res.status}).` };
    }
    const data = (await res.json()) as { key?: string };
    if (!data.key) return { ok: false, message: 'OpenRouter did not return a key. Please try again.' };
    return { ok: true, key: data.key };
  } catch {
    return { ok: false, message: 'Network error completing OpenRouter sign-in. Please try again.' };
  }
}
