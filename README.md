# politty monorepo

| Package                                       | Description                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| [politty](./packages/politty)                 | A lightweight CLI framework inspired by citty with zod v4 registry integration |
| [politty-migrate](./packages/politty-migrate) | Codemods for upgrading politty projects (`npx politty-migrate`)                |

See [packages/politty/README.md](./packages/politty/README.md) for the framework documentation and [docs/](./docs) for guides.

## Development

```bash
pnpm install
pnpm build       # build all packages
pnpm test        # test all packages
pnpm typecheck
pnpm lint
```

Releases are managed with [Changesets](https://github.com/changesets/changesets).
