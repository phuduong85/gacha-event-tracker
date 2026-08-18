# Game icons

Runtime data, not a source file: bind-mounted into the container at
`/app/public/game-icons` (`docker-compose.yml`), same pattern as `public/data`
for the event feed. Nothing in the build produces these — they persist across
image rebuilds because the folder lives outside the image.

```
<game-id>.<ext>   an icon for that game, shown next to its title/chips
```

`<game-id>` is the id from `GameId` in `src/shared/schema.ts` — `genshin`,
`hsr`, `zzz`, `wuwa`, `endfield`, `nte`, `p5x`, `r1999`, `ptn`. `<ext>` is
whatever image format the file actually is (`.png`, `.webp`, `.jpg`, `.svg`).

Every file in this folder except this README is gitignored — see
`CLAUDE.md` § Game icons for how they get here and how the app finds them.
