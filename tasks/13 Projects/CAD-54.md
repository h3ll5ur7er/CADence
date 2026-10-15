---
id: CAD-54
title: Git sync of projects
type: feature
status: done
priority: medium
---

A project's version history ([[CAD-53]]) is exchanged with a git repository over HTTP(S), so a project can be worked on from other devices and by other people.

- [x] A remote per project (address and optional CORS proxy on the project record; the sign-in is asked for when syncing and kept in memory only, never stored)
- [x] Push and pull: a version is recorded, the remote's `main` fetched, then ours sent, theirs taken (fast-forward) or both combined in a merge version
- [x] Conflicts resolved per document (mine or theirs) in the Sync dialog; documents changed on one side only merge on their own
- [x] Imported originals travel along as files of their own (`originals/<asset id>`, read only once)
- [x] Open a project from a repository (home page, "Open from git…")
- [x] Tests against a real git server (`git http-backend` behind a Node server): access contract, manager sync, and the browser journey across two browser contexts (evidence 59-sync, 60-sync-conflict)

Decisions: [[Architecture/Decisions#ADR-30]].
