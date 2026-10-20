/** A way to sign in with OAuth 2 (authorization code): where to send people, and how to learn who they are. */
export interface OAuthProvider {
  readonly id: 'github' | 'google';
  readonly label: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scope: string;
  /** Who signed in, from the provider's access token. */
  readonly identify: (accessToken: string) => Promise<{ readonly id: string; readonly name: string; readonly email?: string }>;
}

const json = async <T>(response: Response): Promise<T> => {
  if (!response.ok) throw new Error(`${response.url} answered ${response.status}`);
  return (await response.json()) as T;
};

/** GitHub (https://github.com/settings/developers); `api` and `site` can point elsewhere (GitHub Enterprise, tests). */
export function github(clientId: string, clientSecret: string, site = 'https://github.com', api = 'https://api.github.com'): OAuthProvider {
  return {
    id: 'github',
    label: 'GitHub',
    clientId,
    clientSecret,
    authorizeUrl: `${site}/login/oauth/authorize`,
    tokenUrl: `${site}/login/oauth/access_token`,
    scope: 'read:user user:email',
    identify: async (token) => {
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'CADence server' };
      const user = await json<{ id: number; login: string; name?: string | null; email?: string | null }>(await fetch(`${api}/user`, { headers }));
      return { id: String(user.id), name: user.name || user.login, ...(user.email ? { email: user.email } : {}) };
    },
  };
}

/** Google (https://console.cloud.google.com/apis/credentials); OpenID Connect's user info. */
export function google(clientId: string, clientSecret: string, accounts = 'https://accounts.google.com', apis = 'https://oauth2.googleapis.com', userinfo = 'https://openidconnect.googleapis.com/v1/userinfo'): OAuthProvider {
  return {
    id: 'google',
    label: 'Google',
    clientId,
    clientSecret,
    authorizeUrl: `${accounts}/o/oauth2/v2/auth`,
    tokenUrl: `${apis}/token`,
    scope: 'openid email profile',
    identify: async (token) => {
      const user = await json<{ sub: string; name?: string; email?: string }>(await fetch(userinfo, { headers: { Authorization: `Bearer ${token}` } }));
      return { id: user.sub, name: user.name || user.email || user.sub, ...(user.email ? { email: user.email } : {}) };
    },
  };
}

/** Where to send someone to sign in; `state` comes back with them. */
export function authorizeAt(provider: OAuthProvider, redirectUri: string, state: string): string {
  const url = new URL(provider.authorizeUrl);
  url.search = new URLSearchParams({ client_id: provider.clientId, redirect_uri: redirectUri, scope: provider.scope, state, response_type: 'code' }).toString();
  return url.toString();
}

/** The provider's access token for the code it sent back. */
export async function exchange(provider: OAuthProvider, code: string, redirectUri: string): Promise<string> {
  const body = new URLSearchParams({ client_id: provider.clientId, client_secret: provider.clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  const answer = await json<{ access_token?: string; error?: string }>(
    await fetch(provider.tokenUrl, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body }),
  );
  if (!answer.access_token) throw new Error(`Sign-in refused: ${answer.error ?? 'no access token'}`);
  return answer.access_token;
}
