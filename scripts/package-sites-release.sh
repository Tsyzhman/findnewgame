#!/usr/bin/env bash
set -euo pipefail

project_arg="${1:-$PWD}"
archive_arg="${2:?usage: package-sites-release.sh PROJECT_DIR ARCHIVE_PATH PACKAGE_SITE_HELPER}"
packager_arg="${3:?usage: package-sites-release.sh PROJECT_DIR ARCHIVE_PATH PACKAGE_SITE_HELPER}"

project="$(cd "$project_arg" && pwd -P)"
mkdir -p "$(dirname "$archive_arg")"
archive_dir="$(cd "$(dirname "$archive_arg")" && pwd -P)"
archive="$archive_dir/$(basename "$archive_arg")"
packager="$(cd "$(dirname "$packager_arg")" && pwd -P)/$(basename "$packager_arg")"
temp_root="${TMPDIR:-/tmp}"
stage="$(mktemp -d "$temp_root/findnewgame-sites-release.XXXXXX")"

case "$stage" in
  "$temp_root"/findnewgame-sites-release.*) ;;
  *) printf 'Unsafe temporary stage: %s\n' "$stage" >&2; exit 2 ;;
esac
trap 'rm -rf -- "$stage"' EXIT

test -f "$project/dist/server/index.js" || { printf 'Missing production build output.\n' >&2; exit 2; }
test -f "$project/.openai/hosting.json" || { printf 'Missing hosting metadata.\n' >&2; exit 2; }
test -x "$packager" || { printf 'Sites packager is not executable: %s\n' "$packager" >&2; exit 2; }
git -C "$project" diff --quiet HEAD -- || { printf 'Tracked source differs from HEAD.\n' >&2; exit 2; }
git -C "$project" diff --cached --quiet || { printf 'The index differs from HEAD.\n' >&2; exit 2; }

mkdir -p "$stage/dist" "$stage/.openai"
exclude_args=()
excluded_public_files=()
while IFS= read -r -d '' source; do
  relative="${source#public/}"
  exclude_args+=("--exclude=./client/$relative")
  excluded_public_files+=("dist/client/$relative")
done < <(git -C "$project" ls-files --others -z -- public)

tar -C "$project/dist" "${exclude_args[@]}" -cf - . | tar -C "$stage/dist" -xf -
cp "$project/.openai/hosting.json" "$stage/.openai/hosting.json"
if test -d "$project/drizzle"; then cp -R "$project/drizzle" "$stage/drizzle"; fi

"$packager" "$stage" "$archive"
tar -tzf "$archive" > "$stage/archive-entries.txt"
for excluded in "${excluded_public_files[@]}"; do
  if grep -Fqx "$excluded" "$stage/archive-entries.txt"; then
    printf 'Untracked public file entered the archive: %s\n' "$excluded" >&2
    exit 2
  fi
done

printf 'Excluded %d untracked public file(s).\n' "${#excluded_public_files[@]}"
