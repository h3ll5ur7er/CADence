// Builds the web app for a static host below a sub-path, such as GitHub Pages (https://<user>.github.io/CADence/).
// The base path comes from the first argument or BASE_HREF (default /CADence/). Static hosts answer unknown
// paths with 404.html, so it is a copy of index.html and deep links (/CADence/projects/...) open the app.
import { execSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';

const raw = process.argv[2] ?? process.env.BASE_HREF ?? '/CADence/';
const base = `/${raw.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
execSync(`npx ng build --base-href ${base}`, { stdio: 'inherit' });
copyFileSync('dist/cadence/browser/index.html', 'dist/cadence/browser/404.html');
console.log(`Built for ${base} into dist/cadence/browser`);
