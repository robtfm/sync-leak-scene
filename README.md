# Sync-filter leak repro

Minimal `authoritativeMultiplayer` scene reproducing the `@dcl/sdk` network sync-filter
"first write" leak: a **client-local** component written on a **server-owned mirror** entity is
forwarded to the server and to every later joiner, while the client's later delete is not.

The server owns 8 synced cubes (`Transform`, `MeshRenderer`, `Material`). Each client hides its
local mirrors with a `VisibilityComponent` that is **not** in the sync list, then deletes it 3 s
later. Nothing about that write should ever leave the client.

Mechanism (`packages/@dcl/sdk/src/network/filter.ts`): the filter forwards any write with
`timestamp <= 1` on an entity that carries `SyncComponents`, regardless of the sync list and of who
owns the entity. The server's state dump includes `SyncComponents`, so client mirrors carry it;
the client's first `VisibilityComponent` write (timestamp 1) is broadcast, the server accepts it
(no `validateBeforeChange`), re-broadcasts it and includes it in every later state dump. The
delete (timestamp 2) is never forwarded.

## What you see

A centre-top panel shows both sides:

- `SERVER sees VisibilityComponent on N/8 cubes` — replicated from the server through a synced
  `leak:report` component. Expected `0` always.
- `CLIENT mirrors 8/8, hidden H (by me M, leaked-in L)` — this client's own view.

1. First visit: cubes vanish for 3 s and come back; `SERVER` climbs to `8/8` and stays there.
2. Reload, or join from another account: the cubes never appear. `CLIENT` reads
   `hidden 8 (by me 0, leaked-in 8)`; the client sees them arrive already hidden and leaves them
   alone. `SERVER` stays `8/8`.

Both sides also log `LEAK|<server|client>|...` lines.

Observed locally (bevy headless auth server via `sdk-commands start`, bevy-web client):

```
[Server] 1 scene(s) live, first tick reached
[Server] 17:38:22 "LEAK|server|main"
[Server] 17:38:32 "LEAK|server|hidden=8/8"     <- first client's local hides reached the server
```

## Running it

Requires Node >= 24. Pinned to the `auth-server` dist-tag build of the SDK (the only one with
`isServer`).

```bash
npm install
npm start -- --web --no-watch      # preview + bevy headless auth server; prints the bevy-web URL
```

Chrome needs the local-network-access permission for `decentraland.org` (the start command
prints the settings link). To deploy to a world instead, set `worldConfiguration.name` in
`scene.json` and run `npm run deploy`.
