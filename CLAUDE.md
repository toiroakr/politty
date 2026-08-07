# CLAUDE.md

This file provides guidance to Claude Code when working on this repository.

## Versioning (Changesets)

This project uses [Changesets](https://github.com/changesets/changesets) for version management.

Since this is a 0.x version (pre-1.0), the versioning policy is:

- **patch**: Non-breaking changes (bug fixes, new features, refactoring)
- **minor**: Breaking changes only
- **major**: Not used until 1.0 release

## Publishing a brand-new package (manual first release)

`.github/workflows/release.yml` authenticates to npm with **trusted publishing
(OIDC)** — it grants `id-token: write`, runs in the `release` environment, and
carries no `NODE_AUTH_TOKEN`. A trusted publisher can only be attached to a
package that npm already knows about: `npm trust` states _"The package you're
configuring must already exist on the npm registry."_ ([npm trust docs](https://docs.npmjs.com/cli/v11/commands/npm-trust/))

So whenever this repo starts shipping a package name for the first time, the
release workflow cannot publish it — the very first version has to go out by
hand, and only then can CI take over:

1. Publish the new package manually with a token-authenticated account, e.g.
   `pnpm --filter <package> publish --access public` (scoped packages need
   `--access public`, which is why `.changeset/config.json` sets
   `"access": "public"`).
2. Configure the trusted publisher for it — `npm trust github <package>` or
   npmjs.com → Packages → the package → Settings → Trusted publishing — naming
   this repository, `release.yml`, and the `release` environment.
3. From then on `changeset publish` in CI publishes it like every other package.

Skipping step 1 makes the first `changeset publish` after the merge fail on the
new name while the already-registered packages publish, leaving a half-released
set.
