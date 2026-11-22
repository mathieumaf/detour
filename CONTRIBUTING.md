# Contributing

Thanks for looking at Detour. Bug reports, fixes, and focused features are all
welcome. For anything larger than a fix, open an issue first so we can agree on
the shape before you write it.

## Setup

You need [Bun](https://bun.sh) 1.4.5 and Node 26 (`.nvmrc`).

```sh
git clone https://github.com/mathieumaf/detour.git
cd detour
bun install
bun run dev            # or: bun run dev:firefox
```

`bun run dev` opens a browser with the extension loaded and reloads it when you
save.

## Where things go

[docs/architecture.md](docs/architecture.md) explains the layout. The short
version: decisions live in `src/core` as plain TypeScript with tests beside
them, and `src/entrypoints/background` applies those decisions to the browser.
If you are unsure where a change belongs, that page has a section on adding
things.

## Checks

Run these before you push. CI runs the same commands.

```sh
bun run check       # lint, formatting, types, unit tests with coverage
bun run test:e2e    # real Chrome and Firefox; run `bun run browsers` once first
bun run package     # only if you touched the build, the manifest, or scripts/
```

`bun run format` fixes formatting. [docs/testing.md](docs/testing.md) describes
each test layer and how to run a single test.

A change to behavior comes with a test that fails without it. Code that affects
routing or authentication needs to hold in both browsers, so prefer an
end-to-end test there: the suite runs every test on Chrome and Firefox.

## Pull requests

- **One change per pull request.** A fix and an unrelated cleanup are two.
- **Title in [Conventional Commits](https://www.conventionalcommits.org) form.**
  Pull requests are squash-merged and the title becomes the commit, which
  decides the next version: `fix:` is a patch, `feat:` a minor, and `docs:`,
  `test:`, `refactor:`, `chore:` release nothing.
- **Say how you checked it.** The template asks for the commands you ran or
  what you observed in the browser.
- **Keep both browsers working.** If something can only work in one, say so in
  the pull request and in the UI, the way SOCKS credentials are handled today.

Two kinds of change need extra care, and the pull request should call them out:

- **Stored data.** Users upgrade with their profiles in place. A change to
  `ProxyState` must load every older shape (see "State" in the architecture
  page).
- **Permissions.** A new permission means a store review and a prompt for every
  user. The packaging check fails until the expected list is updated on
  purpose.

## Reporting bugs and vulnerabilities

Use the issue forms for bugs and ideas. For anything that could expose a user's
traffic or credentials, follow [SECURITY.md](SECURITY.md) instead of opening a
public issue.

## Conduct

Be decent to each other. The details are in
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

By contributing you agree that your work is released under the
[MIT license](LICENSE.md).
