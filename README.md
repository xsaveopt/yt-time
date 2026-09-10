# yt-time

Watching YouTube without an account means YouTube never remembers where you left off, so a refresh, a crashed tab, or one of those "confirm you're not a bot" interruptions drops you back at the beginning of whatever you were watching.
yt-time is a Firefox extension that keeps that position for you, locally, and puts you back where you were the next time the video opens.

It stores a timestamp per video id rather than per tab, so a reload, or a second tab opened on the same link, picks up from the same spot.
Positions are written to the browser's own extension storage, so nothing leaves the machine and no account is involved anywhere.

## Installing

Grab the .xpi from the latest GitHub release and open it in Firefox, either by dragging the file onto a window or through the gear menu on about:addons, choosing "Install Add-on From File".
Firefox will show the permissions it asks for, which are storage and access to youtube.com, and after you accept it the icon appears in the toolbar.

Every release is signed by Mozilla through the unlisted channel, which is what lets it install on a normal Firefox without any about:config changes.
It is not published on addons.mozilla.org, so releases here are the only place to get it, and new versions are installed the same way as the first one.

## How it decides what to remember

While a video plays, the current position is written every couple of seconds, and again whenever you pause, seek, or leave the page, so even an abrupt navigation away keeps something useful.
When the page loads again, the video seeks straight to the saved position, silently.

A position is only worth keeping in the middle of a video, so anything under a minute in is treated as "barely started" and anything within 95% of the end, or with less than 90 seconds left, is treated as finished.
In both cases the entry is deleted instead of saved, which also means a short clip never accumulates an entry at all.
Reaching the end of a video clears its entry too, and anything untouched for 30 days is swept away by a cleanup pass that runs at most twice a day.

A position is only kept while its video is open somewhere, so closing the tab, or moving that tab on to another video or page, forgets it unless another tab still has the same video open.
Quitting Firefox is treated differently, and every position that was open at the time is still there when the browser starts again, whether or not the session brings those tabs back.
Closing one window while others stay open counts as closing its tabs, while closing the last window counts as quitting.

A link that already carries an explicit start time (the t or start parameter you get from "copy link at current time") is left alone, since you asked for that position on purpose.

## The toolbar popup

Clicking the toolbar button lists everything currently remembered, newest first, with the saved position against the total length.
Each row links back to the video at its timestamp, the × next to it forgets that one video, and "Clear all" empties the store.

## Building it

The stack is pnpm, oxlint and oxfmt, TypeScript for type checking, and Node's built-in test runner.
Firefox needs plain JavaScript, so esbuild bundles the TypeScript sources and the static files in public into dist, which is the folder Firefox actually loads.

```sh
pnpm install
pnpm build
```

To try it against a real browser, this launches a temporary Firefox profile with the extension already loaded:

```sh
pnpm dev
```

You can also load it by hand from about:debugging, choosing "This Firefox", then "Load Temporary Add-on", and picking dist/manifest.json.
A temporary add-on is gone after a restart, so for something permanent use pnpm package, which writes a signed-ready zip into artifacts.

The checks that CI runs are the same ones you can run locally:

```sh
pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm test
```
