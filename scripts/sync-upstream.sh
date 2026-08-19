#!/usr/bin/env bash
# Pull upstream/main into origin/main and push the result.
# See CLAUDE.md "Upstream sync" for why this stays a manual, hand-run step.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain)" ]]; then
	echo "Working tree not clean — commit or stash before syncing upstream." >&2
	git status --short
	exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" ]]; then
	echo "On branch '$branch', expected 'main' — switch branches first." >&2
	exit 1
fi

echo "Fetching upstream..."
git fetch upstream

if git merge-base --is-ancestor upstream/main HEAD; then
	echo "Already up to date with upstream/main."
	exit 0
fi

echo "Merging upstream/main..."
if ! git merge upstream/main --no-edit; then
	echo
	echo "Merge conflicts — resolve them, then:" >&2
	echo "  git add <files> && git commit && git push origin main" >&2
	exit 1
fi

echo "Pushing to origin..."
git push origin main

echo "Done."
