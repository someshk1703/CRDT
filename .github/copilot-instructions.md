# CRDT - GitHub Copilot Instructions

**Domain**: CRDT
**Tech Stack**: javascript
**Workflow**: Agentic Development (powered by @bestbuy/agentic-dev-toolkit)

---

## Project Structure

<!-- 📋 IMPORTANT: Define your project structure here. Agents read this to understand where code lives. -->

**Structure Type**: <!-- monorepo | single-app -->

```
CRDT/
├── .github/           # Agents, instructions, workflows
├── .specify/          # Spec Kit templates, constitution
├── specs/             # Feature specifications
├── docs/              # Documentation
<!-- Add your structure below -->
├── src/               # Source code
├── test/              # Tests
└── README.md
```

**Key Directories**:
- **Source Code**: `src/` <!-- Update to match your structure (e.g., services/, apps/, libs/) -->
- **Tests**: `test/` <!-- Update to match your structure -->
- **Shared Code**: <!-- Document where shared/common code lives -->
- **Contracts**: <!-- Document where API contracts/DTOs live -->

---

## Active Features

<!-- Features in development will be listed here -->

---

## Domain-Specific Context

<!-- Add domain-specific information here -->

---

## Tech Stack

- **Primary Language**: javascript
- **Framework**: <!-- Add framework details -->
- **Database**: <!-- Add database details -->
- **Messaging**: <!-- Add messaging details -->

---

## Development Workflow

### Feature Development
1. **Intake**: `@intake` creates `docs/intake/{feature}.md`
2. **Specification**: `/speckit.specify` creates `specs/###-feature/spec.md`
3. **Planning**: `/speckit.plan` creates plan, research, data model, contracts
4. **Tasks**: `/speckit.tasks` creates executable task breakdown
5. **Implementation**: Execute tasks with comprehensive testing

---

## Quality Gates

From Constitution:
- ✅ Minimum 80% test coverage
- ✅ All tests pass
- ✅ No critical linting issues
- ✅ Code follows constitution principles
- ✅ Documentation added for public APIs

---

<!-- AUTO-UPDATE: Do not manually edit below this line -->

## Recent Changes
- 002-rga-crdt-core: Added [if applicable, e.g., PostgreSQL 15, MySQL 8, MongoDB or N/A]
