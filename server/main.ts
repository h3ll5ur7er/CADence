// The CADence server (docs/Architecture/Server.md): `node dist/server/server.mjs`, configured by the environment.
import { startServer } from './server';
import { github, google, type OAuthProvider } from './sign-in';

const env = process.env;
const providers: OAuthProvider[] = [];
if (env['CADENCE_GITHUB_CLIENT_ID'] && env['CADENCE_GITHUB_CLIENT_SECRET']) providers.push(github(env['CADENCE_GITHUB_CLIENT_ID'], env['CADENCE_GITHUB_CLIENT_SECRET']));
if (env['CADENCE_GOOGLE_CLIENT_ID'] && env['CADENCE_GOOGLE_CLIENT_SECRET']) providers.push(google(env['CADENCE_GOOGLE_CLIENT_ID'], env['CADENCE_GOOGLE_CLIENT_SECRET']));
const devSignIn = env['CADENCE_DEV_SIGN_IN'] === '1';
if (!providers.length && !devSignIn) {
  console.error('No way to sign in: set CADENCE_GITHUB_CLIENT_ID and _SECRET, CADENCE_GOOGLE_CLIENT_ID and _SECRET, or CADENCE_DEV_SIGN_IN=1 (names only, for a private network).');
  process.exit(1);
}
const origins = env['CADENCE_APP_ORIGINS']?.split(',').map((o) => o.trim()).filter(Boolean);

const server = await startServer(
  {
    data: env['CADENCE_DATA'] ?? 'cadence-data',
    ...(env['CADENCE_PUBLIC_URL'] ? { publicUrl: env['CADENCE_PUBLIC_URL'].replace(/\/+$/, '') } : {}),
    providers,
    devSignIn,
    ...(origins?.length ? { origins } : {}),
  },
  Number(env['PORT'] ?? 8787),
  env['HOST'] ?? '0.0.0.0',
);
console.log(`CADence server at ${server.url}: sign-in with ${[...providers.map((p) => p.label), ...(devSignIn ? ['names'] : [])].join(', ')}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void server.close().then(() => process.exit(0)));
