import reference from 'cadence:reference';
import { runCli } from './cli';

declare const CADENCE_VERSION: string;

const args = process.argv.slice(2);
// The MCP server owns stdout (one JSON message per line): any other output goes to stderr.
if (args[0] === 'mcp') console.log = console.info = console.debug = console.warn = console.error;
const code = await runCli(args, { out: (text) => process.stdout.write(`${text}\n`), err: (text) => process.stderr.write(`${text}\n`) }, reference, CADENCE_VERSION);
// The geometry kernel keeps handles open; leave once the command is done.
process.exit(code);
