# Releases

This repository includes a small wrapper around the GitHub CLI to create a tag
and GitHub release together, with release notes generated from the difference
between the previous tag and the new release.

The wrapper is exposed through the root workspace script:

```bash
npm run release:create -- <tag> [options]
```

## What The Script Does

The release workflow is implemented in [scripts/create-release.mjs](scripts/create-release.mjs).

It will:

- accept a new tag such as `v1.0.0`;
- find the latest existing tag in the repository;
- call `gh release create` with `--generate-notes`;
- add `--notes-start-tag <previous-tag>` when a previous tag exists;
- create the tag automatically if it does not already exist remotely;
- optionally create draft or prerelease releases;
- optionally upload release assets.

It will not:

- push unrelated commits for you;
- decide the next version number automatically.

## Requirements

Before creating a release, make sure:

- `gh` is installed;
- you are authenticated with GitHub CLI;
- the repository is on the commit you want to release;
- you are using the tag format you want to keep consistently, for example `v1.0.0`.

Check authentication with:

```bash
gh auth status
```

## Common Commands

Unless `--draft` is used, `npm run release:create` creates and publishes the
release immediately.

### Preview Without Creating Anything

This is the safest first step. It shows the new tag, the previous tag, the
generated `gh` command, and the commit range.

```bash
npm run release:create -- v1.0.0 --dry-run
```

### Create A Normal Release

```bash
npm run release:create -- v1.0.0
```

If no previous tag exists, the release is treated as the first release.

### Create A Draft Release

```bash
npm run release:create -- v1.0.0 --draft
```

This creates the tag and the GitHub release, but keeps the release unpublished.

### After Creating A Draft Release

Common follow-up commands after creating a draft:

View the draft release in the terminal:

```bash
gh release view v1.0.0
```

Open the draft release in the browser:

```bash
gh release view v1.0.0 --web
```

Replace the draft notes from a file:

```bash
gh release edit v1.0.0 --notes-file ./release-notes.md
```

Replace the draft notes inline:

```bash
gh release edit v1.0.0 --notes "Includes deployment and dashboard fixes."
```

Update the title of the draft release:

```bash
gh release edit v1.0.0 --title "Private Communication v1.0.0"
```

Publish the draft release:

```bash
gh release edit v1.0.0 --draft=false
```

### Create A Prerelease

```bash
npm run release:create -- v1.1.0-beta.1 --prerelease
```

### Release From An Existing Tag Only

If you created and pushed the tag yourself and want the release step to fail
unless that tag already exists remotely:

```bash
npm run release:create -- v1.0.0 --verify-tag
```

You can still add assets, a title, and extra notes in the same command. The one
thing you should not combine with `--verify-tag` is `--target`, because those
two flags describe opposite situations.

### Release From A Specific Branch Or Commit

If the tag does not yet exist and you want GitHub to create it from a specific
ref:

```bash
npm run release:create -- v1.0.0 --target main
```

You can also use a commit SHA.

This mode can be combined with assets, `--title`, `--notes`, `--notes-file`,
`--draft`, and `--prerelease`.

### Add Extra Notes

```bash
npm run release:create -- v1.0.0 --notes "Includes deployment and dashboard fixes."
```

These notes are prepended to the generated release notes.

### Read Extra Notes From A File

```bash
npm run release:create -- v1.0.0 --notes-file ./release-notes.md
```

This only applies at creation time. If the release already exists as a draft,
use `gh release edit <tag> --notes-file <file>` instead.

### Upload Assets

Any additional positional arguments after the tag are passed through as release
assets.

```bash
npm run release:create -- v1.0.0 ./dist/app.tar.gz ./dist/checksums.txt
```

GitHub CLI also supports display labels using `file#label` syntax.

### Combine Multiple Options

Yes, you can combine multiple compatible options in one command. Keep the tag
as the first positional argument, add any asset paths after it, then add the
options you need.

Create the tag from `main`, upload two assets, and prepend extra notes:

```bash
npm run release:create -- v1.0.0 ./dist/app.tar.gz ./dist/checksums.txt --target main --notes "Includes deployment and dashboard fixes."
```

If the tag already exists remotely, use `--verify-tag` instead of `--target`:

```bash
npm run release:create -- v1.0.0 ./dist/app.tar.gz ./dist/checksums.txt --verify-tag --notes "Includes deployment and dashboard fixes."
```

Use these rules:

- `--target` only makes sense when GitHub still needs to create the tag;
- `--verify-tag` only makes sense when the tag already exists remotely;
- do not combine `--target` and `--verify-tag`;
- use either `--notes` or `--notes-file` for the extra notes source.

## Suggested Release Flow

Recommended flow for this repository:

1. Make sure the target branch is clean and pushed.
2. Run the relevant validation commands for the changes being released.
3. Run a dry run first.
4. Either create the release immediately, or create it as a draft.
5. If you used a draft, review or edit the draft notes.
6. Publish the draft when ready.

Example:

```bash
npm run release:create -- v1.0.0 --dry-run
npm run release:create -- v1.0.0
```

Draft-based example:

```bash
npm run release:create -- v1.0.0 --dry-run
npm run release:create -- v1.0.0 --draft
gh release view v1.0.0 --web
gh release edit v1.0.0 --draft=false
```