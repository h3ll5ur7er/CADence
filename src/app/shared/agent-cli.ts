import { InjectionToken } from '@angular/core';

/** Where the command line and MCP server installed with the desktop app is (CAD-132): for agents to start. */
export interface AgentCli {
  path(): Promise<string | undefined>;
}

export const AGENT_CLI = new InjectionToken<AgentCli | undefined>('Command line for agents', { factory: () => undefined });

/** How Claude Code adds CADence's MCP server, started from this file. */
export const mcpCommand = (path: string) => `claude mcp add cadence -- "${path}" mcp`;
