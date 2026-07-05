---
name: pr-context-analysis
description: Extract PR context including feature number, spec paths, and tasks. Use this when analyzing pull requests in the modern-monorepo.
version: 1.0.0
license: MIT
---

# PR Context Analysis Skill

This skill helps extract and organize pull request context for code reviews.

## When to Use

Use this skill when you need to:
- Determine the feature number from a PR branch or title
- Locate feature specifications and task files
- Gather PR metadata for review

## Process

1. **Extract Feature Number**
   - Check PR branch name for pattern: `*/###-*` or `*/0*###*`
   - Check PR title for pattern: `Feature ###` or `US###`
   - Pad number to 3 digits with leading zeros (e.g., `1` → `001`)

2. **Locate Specifications**
   - Look for directory: `specs/###-*/`
   - Expected structure:
     ```
     specs/001-feature-name/
     ├── spec.md              # Feature specification
     ├── plan.md              # Implementation plan
     ├── data-model.md        # Data model design
     ├── tasks.md             # Task breakdown (CRITICAL)
     ├── research.md          # Research artifacts
     └── contracts/           # API contracts
         ├── api-spec.yaml    # OpenAPI specs
         └── events/          # Event schemas
     ```

3. **Detect Task File**
   - Check if `specs/###-feature/tasks.md` exists
   - This is CRITICAL for task completion verification

4. **Gather Changed Files**
   - Use GitHub API to list changed files
   - Group by type:
     - Source files: `src/main/java/**`
     - Test files: `src/test/java/**`
     - Configuration: `*.yml`, `*.xml`, `*.properties`
     - Build files: `build.gradle`, `settings.gradle`

## Output Format

Return structured context:

```
Feature: 001-pickup-push-notification
Spec Path: specs/001-pickup-push-notification
Has Specs: true
Has Tasks: true
Tasks Path: specs/001-pickup-push-notification/tasks.md
Changed Files: 25
  - Source: 12
  - Tests: 10
  - Config: 3
```

## Example Usage

```bash
# In PR review context
Extract feature context for PR #92 on branch copilot/implement-curbside-pickup-notifications
```

Expected output:
- Feature: `001`
- Spec Path: `specs/001-pickup-push-notification/`
- Tasks File: `specs/001-pickup-push-notification/tasks.md`

## Error Handling

- If no feature number found: Return `Feature: N/A`
- If no specs found: Return `Has Specs: false`
- If no tasks.md: Return `Has Tasks: false`
- Never fail - always return available context
