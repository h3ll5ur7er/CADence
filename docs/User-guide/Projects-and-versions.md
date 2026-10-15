# Projects and versions

A project holds your components, assemblies and imported files. CADence keeps every project's history as versions, and can share a project through a git repository so you can work on it from other devices or with other people.

[TOC]

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

> [!NOTE]
> Version names stay on the device where you gave them; sync exchanges the versions themselves.
