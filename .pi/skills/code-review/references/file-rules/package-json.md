# package.json Rules

Applies to `**/package.json`. Check newly added or changed lines only. The tag names the owning lens.

- [security] A new dependency on `latest`, `*`, or a git, tarball, or file URL: installs change with no diff.
- [security] A new or changed `preinstall`, `install`, `postinstall`, or `prepare` script that downloads or
  runs remote code.
- [security] `publishConfig.registry` or an `npm:` alias that points to an unexpected registry or package
  name (dependency confusion, typosquat).
- [qa] The same package declared in `dependencies` and `devDependencies`, or with conflicting ranges.
- [qa] A tool called in `scripts` (for example `eslint`, `vitest`, `tsc`) that no dependency list declares:
  it works only where a global install exists.
- [qa] A package imported at runtime but moved to `devDependencies`: `npm ci --omit=dev` breaks it.
- [qa] Changed `main`, `module`, `types`, `exports`, `bin`, or `type`: consumers resolve different files.
  Check that the new targets exist.
- [qa] A renamed or removed `scripts` entry that CI, docs, or other scripts still call.
