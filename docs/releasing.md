# Releasing

A release goes from a merged pull request to the Chrome Web Store and Firefox
Add-ons without any manual packaging. This page describes that path, what you
do by hand, and what to do when a step fails.

## The path

```
pull request ──merge──▶ main ──▶ release pull request ──merge──▶ tag + GitHub release
                                  (release-please)                      │
                                                          build and check packages
                                                              │                │
                                                     Firefox Add-ons   Chrome Web Store
```

1. **Merge pull requests as usual.** Titles follow
   [Conventional Commits](https://www.conventionalcommits.org), because the
   repository squash-merges and the title becomes the commit.
2. **release-please keeps a release pull request open.** On every push to
   `main`, `.github/workflows/release.yml` updates a pull request that bumps the
   version in `package.json` and writes `CHANGELOG.md`.
3. **Merge the release pull request when you want to ship.** That creates the
   tag (`detour-v1.8.0`) and the GitHub release.
4. **The same workflow run publishes.** It builds both packages from the tag,
   runs the packaging checks, attaches the zips to the GitHub release, and
   submits to each store in its own job.

Submitting is not the same as going live. Each store reviews the new version
and publishes it when the review passes.

## What cuts a release

| Commit type                                    | Effect                           |
| ---------------------------------------------- | -------------------------------- |
| `feat:`                                        | minor version                    |
| `fix:`, `perf:`, `revert:`                     | patch version                    |
| `feat!:` or a `BREAKING CHANGE:` footer        | major version                    |
| `chore:`, `docs:`, `test:`, `refactor:`, `ci:` | no release, not in the changelog |

Dependabot is set up to match: a production dependency bump is `fix(deps):` and
releases, because it changes what ships. A development dependency bump is
`chore(deps-dev):` and does not.

The version lives in `package.json` and nowhere else. WXT copies it into each
manifest, and the release workflow refuses to publish a tag that does not match
it.

## Before merging the release pull request

- CI is green on it. The release workflow starts CI on the release pull request
  itself, because GitHub does not do so for pull requests opened by a workflow.
- The changelog reads the way you want users to read it.
- If the release adds or changes a permission, `store/permissions.md` has the
  justification ready. The Chrome Web Store asks for it at review.
- If the release changes what users see, `store/listing.md` and the screenshots
  are up to date. Listing text and images are updated by hand in each store's
  dashboard; the workflow only uploads the package.

## Secrets

Repository secrets, read only by the two submit jobs:

| Secret                                | Store   | What it is                             |
| ------------------------------------- | ------- | -------------------------------------- |
| `FIREFOX_EXTENSION_ID`                | Firefox | The add-on id                          |
| `FIREFOX_JWT_ISSUER`                  | Firefox | Add-ons API key                        |
| `FIREFOX_JWT_SECRET`                  | Firefox | Add-ons API secret                     |
| `CHROME_EXTENSION_ID`                 | Chrome  | The extension id                       |
| `CHROME_PUBLISHER_ID`                 | Chrome  | The publisher id that owns the listing |
| `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` | Chrome  | Service account allowed to publish     |
| `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`  | Chrome  | That account's private key             |

The Chrome key can be pasted straight from the service account JSON, with its
`\n` sequences. The workflow turns it back into a PEM.

## Checking credentials without publishing

Store credentials expire and get rotated. To find out before release day, run
the workflow by hand with **dry_run** ticked:

**Actions → Release → Run workflow → dry_run: true**

Leave `tag` empty to use `main`. The run builds the packages, then signs in to
each store and stops there. Nothing is uploaded and nothing is attached to a
release.

Run it once after changing a secret, and after any change to the release
workflow.

## When a submission fails

Each store has its own job, so one failing does not stop the other.

**One store failed, the other succeeded.** Open the run and choose **Re-run
failed jobs**. Only the failed store is submitted again. Do not re-run all
jobs: Firefox Add-ons rejects a version it already has.

**You need to publish a tag again later.** Run the workflow by hand with the
tag and pick the store:

**Actions → Release → Run workflow → tag: `detour-v1.8.0`, store: `chrome`**

This works for tags created after this pipeline was introduced. Older tags do
not contain the scripts it calls, and there is no reason to republish them: a
store only accepts a version newer than the one it has.

**Common causes.**

| Symptom                                           | Cause and fix                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Firefox: `401`, "Unknown JWT iss"                 | The Add-ons API key was revoked or mistyped. Create a new one and update both Firefox secrets. |
| Firefox: "Version already exists"                 | That version was already submitted. Nothing to do for Firefox.                                 |
| Chrome: `ERR_OSSL_UNSUPPORTED` or a decoder error | The private key secret is not a usable key. Paste the `private_key` value from the JSON again. |
| Chrome: permission or publisher errors            | The service account lost access to the publisher, or `CHROME_PUBLISHER_ID` is wrong.           |
| "Tag ... does not match package.json"             | The tag was created by hand. Tags come from merging the release pull request.                  |
| A packaging check fails                           | The message names the file and the problem. Fix it on `main` and release again as a patch.     |

A pending Chrome review does not block a new submission. The workflow cancels
it and submits the new version in its place.

## What the packaging checks protect

`bun run package` runs in CI on every pull request and again in the release.
It exists because each of these has broken a release before, or would:

- **Zip timestamps.** WXT's zip writer leaves them at zero and Firefox Add-ons
  rejects the upload. The script rewrites them and verifies the contents are
  unchanged.
- **Version and manifest.** The manifest version matches `package.json`, and
  every file the manifest points at is in the package.
- **Permissions.** The list matches what the stores reviewed. A change has to
  be made on purpose, in `scripts/package.ts`.
- **Sources.** `bun run package:verify` rebuilds the Firefox package from the
  sources zip and compares it byte for byte, which is what the Add-ons reviewer
  does.

## Running it locally

```sh
bun run package          # build, zip, and check both packages in .output/
bun run package:verify   # rebuild the Firefox package from the sources zip
```

There is no reason to submit from a laptop. If you ever have to, the commands
are `bun run submit:firefox` and `bun run submit:chrome`, with the secrets above
as environment variables.
