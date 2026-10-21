# Projects and versions

A project holds your components, assemblies and imported files. CADence keeps every project's history as versions, can share a project through a git repository so you can work on it from other devices, and through a CADence server with other people, who then edit it with you, live.

[TOC]

## Pictures

Each document gets a picture a moment after its model settles: it shows on the document in the documents panel, and the most recently changed document's picture shows on the project's card on the home page. Pictures are made on your device; they are not part of the versions.

## Versions

A few seconds after you change something, CADence records the project as a version: every document and the project's name and parameters. Nothing to save or commit by hand.

- Open **History of …** (the clock button on a document in the documents panel) to see the versions in which that document changed, newest first, with what changed (*Changed Component 1*, *Added Lid*).
- **Name…** a version to find it again, such as `v1.0` or `sent-to-printer`. Names are short words without spaces (letters, digits, dots, dashes and underscores); giving a name again moves it to the other version.
- **Restore** brings the document back as it was in that version. The restore is a change of its own, so the newer versions stay in the history and you can go forward again.

## Compare versions

In **History of …**, tick two versions and click **Compare the two**, or tick one and click **Compare with now**. The document's place shows both:

- **Overlaid**: both see-through, what was added in green, what was removed in red.
- **Side by side**: the older on the left (removed material in red), the newer on the right (added in green).

Beside them, what changed: sketches and features added, removed, changed (with what, such as *distance 6 mm → 8 mm*) or moved in the timeline, elements of sketches, parameters (also the project's) and settings such as the material; and the volume before and after, with how much was added and removed. **Close comparison** goes back to editing. Assemblies and drawings show the list.

On the web, versions are kept in your browser next to the project. On the desktop, they are a git repository in the project's folder (`projects/<id>/.git`), which any git tool can read.

## Sync with git

Click **Sync with git** (the arrows in the top bar of the editor) and enter the address of a git repository, such as `https://github.com/you/bracket.git`. An empty repository is fine: the first sync fills it. A dot on the button shows that the project is synced.

- **Sign-in.** For private repositories, enter your user name and a password or, with GitHub and GitLab, an access token with write access to the repository. CADence keeps the sign-in only while it is open and never saves it.
- **CORS proxy.** Browsers may only talk to servers that allow it, and most git hosts do not. On the web, enter a CORS proxy such as `https://cors.isomorphic-git.org` (or run your own). The desktop app usually needs one too.
- **Sync** first records your latest changes as a version, then:
  - sends your versions when the repository has nothing newer,
  - takes the repository's versions when you have nothing newer,
  - otherwise combines both: documents changed on only one side are taken from that side, and a document changed on both sides is combined by its parts: sketches and features by their timeline place, the curves of a sketch one by one, parameters by name. A hole cut here and a plate made thicker there end up in one part.
- **Conflicts.** Only what both sides changed differently is asked: the same feature, parameter or setting (or one deleted on one side and changed on the other). Each is listed under its document with how *Mine* and *Theirs* have it, side by side; choose for each and click **Sync with these choices**. Nothing changes until you do. A document deleted on one side and changed on the other is chosen whole.
- **Stop syncing** forgets the repository's address. The versions stay here and in the repository.

To work on a synced project on another device, click **Open from git…** on the home page and enter the same address. The project opens with all its documents, imported files included, and stays synced.

Version names travel with the versions. A name given to different versions here and in the repository stays as it is on each side, and the sync says which names those are. In the history, versions the repository does not have yet are marked *not synced yet*.

## Share with people on a CADence server

A CADence server keeps projects for the people who sign in to it: your club's, your workshop's, or one you run yourself ([[Architecture/Server]]).

- **Share** (the people button in the top bar of the editor): enter the server's address, **Connect**, and sign in (with GitHub or Google, or with your name on a server on a private network). **Share on this server** puts the project there; it stays synced with it from then on, and the top bar says *Shared*.
- **Members.** Invite people who signed in to the server once, by name or e-mail address, to view or to edit; owners also share. Change a role or remove someone in the same list.
- **Links to view.** **Make a link to view** gives an address anyone can open in a browser, without an account: the project opens there to look at (*View only*) and keeps up with the server. **Stop** ends a link.
- **Shared projects…** on the home page lists the projects on a server that you own or that were shared with you; **Open** brings one here.

## Edit together, live

Open a component of a shared project, and you edit it together with everyone who has it open: a bar at the bottom left says *Live* and who else is there, in which sketch. Changes, theirs and yours, show at once on every screen; in a sketch, you see the others' pointers with their names.

- Changes made at the same moment are put in one order for everyone. One that no longer fits (a curve added to a sketch someone just deleted) is dropped everywhere, and the bar says so.
- **Offline**, keep working: the bar says your changes wait, and they are sent when you are back. If you were away long, your changes are combined with the others' as a sync would combine them; where you both changed the same thing, theirs is kept and the bar says which (yours stays in the history).
- **Undo** takes back your last change and also what others changed since, so use it with care while others edit.
- Assemblies and drawings are not edited live yet: they reach the others through syncs.

## New projects, copies and files

- **New project** starts from nothing or from a template: *Box with lid*, *Wall bracket* or *Enclosure*. Templates are ordinary projects whose sizes are project parameters (*width*, *wall*, *screw*, …): change them in the Parameters panel and every part follows.
- **Duplicate** (the two squares on a project card or a document) makes a copy with new ids: a project copy has its own history, which starts with the original's versions of its documents (restoring one of them gives it the copy's ids); a document copy sits next to the original as *Name (copy)*. Importing a project that is here already makes such a copy too.
- A document saved by a newer CADence is listed but does not open: update CADence first. An older app would leave out what it does not know and show the document wrongly.
- **Export as one file** (the arrow on a project card) saves the whole project as a `.cadence` file: documents, imported files, parameters and, if you like, the version history. **Open file…** on the home page (or dropping the file there, or double-clicking it on the desktop) opens it again as a project, here or on another device.

## Share a model

**Export → Viewer (HTML, to share)** in a component or an assembly saves one HTML file that anyone can open in a browser, without CADence and offline: turn, pan and zoom the model, hide parts, measure distances between two points, and explode assemblies with a slider.
