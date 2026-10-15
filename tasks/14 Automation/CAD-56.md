---
id: CAD-56
title: MCP server
type: feature
status: done
priority: medium
---

Let agentic AI tools drive CADence.

- [x] MCP server exposing the scripting API as tools (projects, sketches, features, checks, exports): `cadence mcp`, stdio ([[src/automation/mcp.ts]])
- [x] Instructions with a worked example on connect; `command_reference` returns the command and feature types
- [x] Tested through the server and over stdio against the built bundle
- [x] Wiki how-to: connect it to an MCP client ([[User-guide/Automation#AI agents (MCP)]])
