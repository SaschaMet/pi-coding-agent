#!/usr/bin/env bash
set -u

usage() {
  cat <<'EOF'
Purpose:
  Run the repository coding-standard checks through the repo's canonical commands.

Usage:
  run-coding-standard.sh [--repo DIR] [--mode fast|full|ci|pre-commit] [--dry-run] [--strict]
  run-coding-standard.sh --help

Defaults:
  --repo .      Repository root.
  --mode fast  Fast local check.

Modes:
  fast        Prefer make check-fast, package check:fast/check, common lint/type/test commands, then pre-commit fallback.
  full        Prefer make check-full, package check:full/check, duplicate-code scripts, or common coverage commands.
  ci          Prefer make ci-verify, package ci/check:ci, or full-mode commands.
  pre-commit  Run pre-commit only.

Flags:
  --dry-run   Print planned commands as JSON without executing.
  --strict    Fail when no matching command exists for a mode.

Output:
  stdout: JSON summary.
  stderr: command diagnostics and subprocess output.

Exit codes:
  0  all selected checks passed, or dry-run succeeded
  1  one or more checks failed
  2  invalid arguments
  3  no executable checks found in strict mode

Examples:
  ./scripts/run-coding-standard.sh --mode fast
  ./scripts/run-coding-standard.sh --mode pre-commit --strict
  ./scripts/run-coding-standard.sh --mode ci --dry-run
EOF
}

repo="."
mode="fast"
dry_run=0
strict=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      [ "$#" -ge 2 ] || { echo "error: --repo requires a directory" >&2; exit 2; }
      repo="$2"
      shift 2
      ;;
    --mode)
      [ "$#" -ge 2 ] || { echo "error: --mode requires fast, full, ci, or pre-commit" >&2; exit 2; }
      mode="$2"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --strict)
      strict=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$mode" in
  fast|full|ci|pre-commit) ;;
  *)
    echo "error: invalid --mode '$mode'; expected fast, full, ci, or pre-commit" >&2
    exit 2
    ;;
esac

if [ ! -d "$repo" ]; then
  echo "error: repo directory does not exist: $repo" >&2
  exit 2
fi

cd "$repo" || exit 2

commands=()
labels=()

add_command() {
  labels+=("$1")
  commands+=("$2")
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

make_has_target() {
  [ -f Makefile ] || [ -f makefile ] || return 1
  make -qp 2>/dev/null | awk -F: '/^[A-Za-z0-9_.-]+:/ {print $1}' | grep -qx "$1"
}

package_manager() {
  if [ -f pnpm-lock.yaml ]; then
    printf 'pnpm'
  elif [ -f package-lock.json ]; then
    printf 'npm'
  elif [ -f yarn.lock ]; then
    printf 'yarn'
  elif [ -f bun.lockb ] || [ -f bun.lock ]; then
    printf 'bun'
  else
    printf 'npm'
  fi
}

package_has_script() {
  [ -f package.json ] || return 1
  node -e 'const p=require("./package.json"); process.exit(p.scripts && p.scripts[process.argv[1]] ? 0 : 1)' "$1" 2>/dev/null
}

add_package_script() {
  pm="$(package_manager)"
  script="$1"
  case "$pm" in
    npm) add_command "package:$script" "npm run $script" ;;
    pnpm) add_command "package:$script" "pnpm run $script" ;;
    yarn) add_command "package:$script" "yarn run $script" ;;
    bun) add_command "package:$script" "bun run $script" ;;
  esac
}

add_duplication_check() {
  for script in dup:check duplicates:check duplication:check cpd jscpd; do
    if package_has_script "$script"; then
      add_package_script "$script"
      return 0
    fi
  done

  if [ -f .jscpd.json ] || [ -f .jscpd.cjs ] || [ -f .jscpd.js ]; then
    if has_cmd cpd; then
      add_command "duplicate-code:cpd" "cpd ."
      return 0
    fi
    if has_cmd jscpd; then
      add_command "duplicate-code:jscpd" "jscpd ."
      return 0
    fi
    echo "warning: jscpd config found but cpd/jscpd command is unavailable" >&2
  fi

  return 1
}

add_pre_commit() {
  if [ -f .pre-commit-config.yaml ] || [ -f .pre-commit-config.yml ]; then
    if has_cmd pre-commit; then
      add_command "pre-commit" "pre-commit run --all-files"
      return 0
    fi
    echo "warning: pre-commit config found but pre-commit command is unavailable" >&2
  fi
  if [ -x .git/hooks/pre-commit ]; then
    add_command "git-hook:pre-commit" ".git/hooks/pre-commit"
    return 0
  fi
  return 1
}

add_common_type_script() {
  script="$1"
  if package_has_script "$script"; then
    add_package_script "$script"
    return 0
  fi
  return 1
}

build_commands() {
  case "$mode" in
    pre-commit)
      add_pre_commit || true
      ;;
    fast)
      if make_has_target check-fast; then add_command "make:check-fast" "make check-fast"; return; fi
      for script in check:fast check lint typecheck test; do add_common_type_script "$script" || true; done
      if [ "${#commands[@]}" -gt 0 ]; then return; fi
      add_pre_commit || true
      if [ "${#commands[@]}" -gt 0 ]; then return; fi
      if [ -f pyproject.toml ] && has_cmd uv; then
        add_command "python:ruff-format" "uv run ruff format --check ."
        add_command "python:ruff-check" "uv run ruff check ."
        add_command "python:pyright" "uv run pyright"
        add_command "python:pytest" "uv run pytest"
      fi
      ;;
    full)
      if make_has_target check-full; then add_command "make:check-full" "make check-full"; return; fi
      for script in check:full check test:coverage test:mutation; do add_common_type_script "$script" || true; done
      add_duplication_check || true
      if [ "${#commands[@]}" -gt 0 ]; then return; fi
      if [ -f pyproject.toml ] && has_cmd uv; then
        add_command "python:pytest-cov" "uv run pytest --cov=src --cov-context=test --cov-report=xml --cov-report=term-missing"
      fi
      ;;
    ci)
      if make_has_target ci-verify; then add_command "make:ci-verify" "make ci-verify"; return; fi
      for script in ci check:ci check:full check; do add_common_type_script "$script" || true; done
      add_duplication_check || true
      ;;
  esac
}

print_plan_json() {
  printf '{"mode":"%s","repo":"%s","dryRun":%s,"commands":[' "$(json_escape "$mode")" "$(json_escape "$(pwd)")" "$([ "$dry_run" -eq 1 ] && printf true || printf false)"
  first=1
  i=0
  while [ "$i" -lt "${#commands[@]}" ]; do
    [ "$first" -eq 1 ] || printf ','
    first=0
    printf '{"label":"%s","command":"%s"}' "$(json_escape "${labels[$i]}")" "$(json_escape "${commands[$i]}")"
    i=$((i + 1))
  done
  printf ']}\n'
}

build_commands

if [ "${#commands[@]}" -eq 0 ]; then
  if [ "$strict" -eq 1 ]; then
    echo "error: no executable checks found for mode '$mode'. Expected pre-commit, Makefile targets, package scripts, or supported Python tooling." >&2
    exit 3
  fi
  printf '{"mode":"%s","repo":"%s","dryRun":%s,"commands":[],"status":"skipped","reason":"no matching checks found"}\n' "$(json_escape "$mode")" "$(json_escape "$(pwd)")" "$([ "$dry_run" -eq 1 ] && printf true || printf false)"
  exit 0
fi

if [ "$dry_run" -eq 1 ]; then
  print_plan_json
  exit 0
fi

failed=0
i=0
while [ "$i" -lt "${#commands[@]}" ]; do
  label="${labels[$i]}"
  cmd="${commands[$i]}"
  echo "running [$label]: $cmd" >&2
  if ! sh -c "$cmd" >&2; then
    echo "failed [$label]: $cmd" >&2
    failed=1
    break
  fi
  i=$((i + 1))
done

if [ "$failed" -eq 0 ]; then
  printf '{"mode":"%s","repo":"%s","status":"passed","commandsRun":%s}\n' "$(json_escape "$mode")" "$(json_escape "$(pwd)")" "${#commands[@]}"
  exit 0
fi

printf '{"mode":"%s","repo":"%s","status":"failed","failedCommand":"%s"}\n' "$(json_escape "$mode")" "$(json_escape "$(pwd)")" "$(json_escape "$cmd")"
exit 1
