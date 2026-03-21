# CLAUDE.md

This file provides guidance for AI assistants working in this repository.

## Repository Overview

This is a **GitHub Desktop tutorial repository** created by alexkendel90. Its purpose is to serve as a starter project for learning GitHub Desktop workflows — specifically practicing creating repositories, editing files, committing changes, and pushing to GitHub.

## Repository Structure

```
desktop-tutorial/
├── README.md       # Welcome message and tutorial prompt
└── CLAUDE.md       # This file — AI assistant guidance
```

## Project State

- **No application code** — this is a tutorial/learning repository, not a production codebase
- **No dependencies** — no package.json, no build system, no test framework
- **No CI/CD** — no GitHub Actions workflows or other automation configured

## Development Workflows

Since this is a documentation/tutorial repository, the primary operations are:

### Making Changes
1. Edit files directly (no build step required)
2. Commit with descriptive messages
3. Push to the appropriate branch

### Git Conventions
- Branch naming follows the pattern `claude/<description>-<id>` for AI-assisted branches
- The default branch on the remote is `main`; local development may use `master`
- Commit messages should be clear and describe what changed

## Key Conventions

- **README.md** is the primary user-facing document; keep it accessible and beginner-friendly
- This repository is intentionally minimal — avoid adding unnecessary files or complexity
- Changes should align with the tutorial purpose: helping users learn GitHub Desktop basics

## Notes for AI Assistants

- There is no test suite to run before committing
- There is no linter or formatter configured
- Do not add build tooling, dependencies, or application code unless explicitly requested
- When making changes, prefer editing existing files over creating new ones
- Keep contributions simple and consistent with the educational nature of the repository
