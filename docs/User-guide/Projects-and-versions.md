# Projects and versions

A project holds your components, assemblies and imported files, with notes and attachments about it. CADence keeps every project's history as versions, keeps what you delete in a trash for 30 days, and can share a project through a git repository so you can work on it from other devices or with other people. A project can also be a library whose parts other projects use.

[TOC]

## Notes and attachments

**Project notes** (the note in the editor's top bar) holds what the project is about ([[CAD-149]]):

- A **description** in Markdown: headings (`#`), lists, **bold**, *italics*, `code` and links (`[text](https://…)`), shown next to where you type it. **Save description** keeps it.
- **Attach files…** keeps photos, datasheets (PDF) or any other file with the project, exactly as they are (up to 100 MB each); pictures show small. Click a file's name to save a copy of it. **Add link** keeps a web address with a name.

Notes and attachments are part of the project: they are in its versions, in its `.cadence` archives and in git syncs, and copies of the project have them too. Agents read and write them with `project_notes` ([[User guide/Automation]]).

## Trash

Deleting a project or a document moves it to the **trash** ([[CAD-148]]). It stays there for 30 days, then it is deleted for good. The home page shows **Trash** below the projects when something is in it:

- **Restore** brings a project back as it was, or a document as it was when you deleted it, into its project. A restored document has its history again: its earlier versions, the version it was deleted in, and the restore.
- **Delete for good** (the bin on an item) and **Empty trash** delete at once. A document's earlier versions stay in its project's history.
- A project in the trash keeps its own deleted documents: restore the project first.
- A document that a git sync removes (deleted on another device) goes to the trash here too.

## Libraries

A project can be a **library** of parts that other projects use without copying them by hand: a company's brackets, your favourite clips ([[CAD-151]]). Tick **A library** in the project's notes; the home page marks it *Library*. CADence also has a built-in library, **Standard parts**: ISO 4762 screws, ISO 4032 nuts, ISO 7089 washers, heat-set inserts and ball bearings in every size ([[CAD-152]]).

- In an assembly, **Insert → From a library…** inserts a library's part ([[User guide/Assemblies#Library parts and standard parts]]).
- The project keeps the part **as the library's version it took**: it is listed under **Library parts** in the documents panel, with the library's name, and opens read only (it changes in the library). Updates never surprise you.
- When the library has a newer version of the part, the part shows **Update**: click it, and the assemblies and drawings that use it follow.
- Library parts are ordinary documents of the project, so archives and git syncs carry them. **Export as one file** can also include the libraries the project uses (agents: `export_project` with `libraries`), and opening such a file adds those libraries to this device when it does not have them. A library is a project of its own and syncs with its own repository (agents: `sync_project` with `libraries`).

## Changes made elsewhere

An open editor follows what changes its document elsewhere: another tab or window of the app and, on the desktop, other programs writing the project folders, such as an AI agent through the MCP server or a script ([[CAD-150]]). The documents panel and the home page follow new, renamed and deleted documents and projects. When you are in the middle of something (a feature dialog, a sketch, a joint being made), the editor asks first: **Load its changes** or **Keep editing**.

## Pictures

Each document gets a picture a moment after its model settles: it shows on the document in the documents panel, and the most recently changed document's picture shows on the project's card on the home page. Pictures are made on your device; they are not part of the versions.

## Versions

A few seconds after you change something, CADence records the project as a version: every document and the project's name and parameters. Nothing to save or commit by hand.

- Open **History of …** (the clock button on a document in the documents panel) to see the versions in which that document changed, newest first, with what changed (*Changed Component 1*, *Added Lid*).
- **Name…** a version to find it again, such as `v1.0` or `sent-to-printer`. Names are short words without spaces (letters, digits, dots, dashes and underscores); giving a name again moves it to the other version.
- **Restore** brings the document back as it was in that version. The restore is a change of its own, so the newer versions stay in the history and you can go forward again.

On the web, versions are kept in your browser next to the project. On the desktop, they are a git repository in the project's folder (`projects/<id>/.git`), which any git tool can read.

## Sync with git

Click **Sync with git** (the arrows in the top bar of the editor) and enter the address of a git repository, such as `https://github.com/you/bracket.git`. An empty repository is fine: the first sync fills it. A dot on the button shows that the project is synced.

- **Sign-in.** For private repositories, enter your user name and a password or, with GitHub and GitLab, an access token with write access to the repository. CADence keeps the sign-in only while it is open and never saves it.
- **CORS proxy.** Browsers may only talk to servers that allow it, and most git hosts do not. On the web, enter a CORS proxy such as `https://cors.isomorphic-git.org` (or run your own). The desktop app usually needs one too.
- **Sync** first records your latest changes as a version, then:
  - sends your versions when the repository has nothing newer,
  - takes the repository's versions when you have nothing newer,
  - otherwise combines both: documents changed on only one side are taken from that side.
- **Conflicts.** A document changed both here and in the repository is listed with a choice: **Mine** or **Theirs**. Choose for each and click **Sync with these choices**. Nothing changes until you do.
- **Stop syncing** forgets the repository's address. The versions stay here and in the repository.

To work on a synced project on another device, click **Open from git…** on the home page and enter the same address. The project opens with all its documents, imported files included, and stays synced.

Version names travel with the versions. A name given to different versions here and in the repository stays as it is on each side, and the sync says which names those are. In the history, versions the repository does not have yet are marked *not synced yet*.

## New projects, copies and files

- **New project** starts from nothing or from a template: *Box with lid*, *Wall bracket* or *Enclosure*. Templates are ordinary projects whose sizes are project parameters (*width*, *wall*, *screw*, …): change them in the Parameters panel and every part follows.
- **Duplicate** (the two squares on a project card or a document) makes a copy with new ids: a project copy has its own history, which starts with the original's versions of its documents (restoring one of them gives it the copy's ids); a document copy sits next to the original as *Name (copy)*. Importing a project that is here already makes such a copy too.
- A document saved by a newer CADence is listed but does not open: update CADence first. An older app would leave out what it does not know and show the document wrongly.
- **Export as one file** (the arrow on a project card) saves the whole project as a `.cadence` file: documents, imported files, parameters and, if you like, the version history. **Open file…** on the home page (or dropping the file there, or double-clicking it on the desktop) opens it again as a project, here or on another device.

## Share a model

**Export → Viewer (HTML, to share)** in a component or an assembly saves one HTML file that anyone can open in a browser, without CADence and offline: turn, pan and zoom the model, hide parts, measure distances between two points, and explode assemblies with a slider.
