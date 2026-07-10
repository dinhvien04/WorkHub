# WorkHub — agent notes

## Git workflow

- **Push target:** always push to `main` (no feature-branch deploy required for now).
- **Commit messages:** follow Git Flow / Conventional Commits style:

```
type: short description in English or Vietnamese
```

### Types (Git Flow–oriented)

| Type | When |
|------|------|
| `feat` | New feature (feature/* work) |
| `fix` | Bug fix (bugfix/*) |
| `hotfix` | Urgent production fix (hotfix/*) |
| `refactor` | Code restructure, no behavior change |
| `docs` | README / docs only |
| `style` | Formatting, no logic change |
| `chore` | Build, deps, config, housekeeping |
| `test` | Tests only |
| `perf` | Performance |

### Examples

```
feat: add host booking calendar filter
fix: correct payment total on cancel
hotfix: block double booking race condition
chore: update .env.example MongoDB URI
docs: document seed script usage
```

### Rules

- Imperative mood, concise subject line (≈50–72 chars).
- Optional body for *why* if the change is non-obvious.
- Do not commit `.env`, `.env.save`, secrets, or `node_modules/`.
- Prefer small, focused commits over one huge dump when practical.
