// The app's version, written in package.json, package-lock.json, the desktop app's tauri.conf.json,
// Cargo.toml and Cargo.lock, and shown in the About dialog. `node tools/release/version.mjs 0.16.0`
// sets it everywhere; without an argument it prints it. A test checks that all places agree.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collect, outputs, render, root } from '../licences/licences.mjs';

const files = {
  package: join(root, 'package.json'),
  lock: join(root, 'package-lock.json'),
  tauri: join(root, 'src-tauri', 'tauri.conf.json'),
  cargo: join(root, 'src-tauri', 'Cargo.toml'),
  cargoLock: join(root, 'src-tauri', 'Cargo.lock'),
};
const read = (path) => readFileSync(path, 'utf8');

/** The version as each file has it. */
export function versions() {
  const lock = JSON.parse(read(files.lock));
  return {
    'package.json': JSON.parse(read(files.package)).version,
    'package-lock.json': lock.version,
    'package-lock.json (root package)': lock.packages[''].version,
    'tauri.conf.json': JSON.parse(read(files.tauri)).version,
    'Cargo.toml': /^\[package\][^[]*?^version = "([^"]+)"/m.exec(read(files.cargo))?.[1],
    'Cargo.lock': /^name = "cadence"\nversion = "([^"]+)"/m.exec(read(files.cargoLock).replace(/\r\n/g, '\n'))?.[1],
  };
}

export function setVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`"${version}" is not a version like 1.2.3`);
  const json = (path, change) => {
    const data = JSON.parse(read(path));
    change(data);
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  };
  json(files.package, (p) => (p.version = version));
  json(files.lock, (l) => {
    l.version = version;
    l.packages[''].version = version;
  });
  json(files.tauri, (t) => (t.version = version));
  writeFileSync(files.cargo, read(files.cargo).replace(/^(\[package\][^[]*?^version = )"[^"]+"/m, `$1"${version}"`));
  writeFileSync(files.cargoLock, read(files.cargoLock).replace(/^(name = "cadence"\r?\nversion = )"[^"]+"/m, `$1"${version}"`));
  // The About dialog shows it.
  const { credits, texts } = render(collect());
  writeFileSync(outputs.credits, credits);
  writeFileSync(outputs.texts, texts);
}

if (process.argv[1]?.endsWith('version.mjs')) {
  const [version] = process.argv.slice(2);
  if (version) setVersion(version);
  console.log(JSON.parse(read(files.package)).version);
}
