---
name: constitution-compliance-check
description: Verify code compliance with Engineering Constitution principles. Use this to validate PRs against the five core principles.
version: 1.0.0
license: MIT
---

# Constitution Compliance Check Skill

This skill validates pull requests against the Engineering Constitution principles defined in `.specify/memory/constitution.md`.

## When to Use

Use this skill when:
- Conducting code reviews
- Validating PR quality before merge
- Ensuring adherence to engineering standards

## The Five Principles

### Principle I: Specification-Driven Development

**Requirements**:
- Implementation matches specification (spec.md)
- User stories have clear acceptance criteria
- All acceptance criteria validated with tests
- No implementation without specification

**Verification**:
1. Read `specs/###-feature/spec.md`
2. Compare implementation to spec requirements
3. Check that acceptance scenarios are tested
4. Verify no unauthorized deviations

**Red Flags**:
- ❌ Implementation doesn't match spec
- ❌ Missing tests for acceptance criteria
- ❌ Unauthorized feature changes

---

### Principle II: Comprehensive Testing Standards

**Requirements**:
- Minimum 80% code coverage per module
- JUnit 5 for Java tests
- TestContainers for integration tests
- Given-When-Then test structure
- NO static mocking (PowerMock prohibited)

**Verification**:
1. Check test files exist for all implementation files
2. Verify coverage reports (≥80%)
3. Validate test structure (Given-When-Then)
4. Check for TestContainers in integration tests
5. Scan for PowerMock imports (prohibited)

**Red Flags**:
- ❌ Coverage <80%
- ❌ Missing tests for new code
- ❌ Using PowerMock or static mocking
- ❌ Tests without clear Given-When-Then structure

---

### Principle III: Independent User Story Implementation

**Requirements**:
- Each story delivers standalone value
- Can be deployed independently
- No hidden dependencies on incomplete work
- Clear boundaries between stories

**Verification**:
1. Check task breakdown by user story
2. Verify story can function without others
3. Check for dependencies on incomplete tasks
4. Validate database migrations are independent

**Red Flags**:
- ❌ Story depends on incomplete work
- ❌ Cannot deploy story independently
- ❌ Cross-story dependencies not documented

---

### Principle IV: Integration Testing

**Requirements**:
- Contract tests for APIs (OpenAPI specs)
- Integration tests with real dependencies (TestContainers)
- Spring Boot system tests (@SpringBootTest)
- End-to-end validation

**Verification**:
1. Check for contract tests (RestAssured)
2. Verify integration tests use TestContainers
3. Check for @SpringBootTest tests
4. Validate database/Kafka/Redis integration tests exist

**Red Flags**:
- ❌ No contract tests for APIs
- ❌ Integration tests using mocks instead of real dependencies
- ❌ No end-to-end validation

---

### Principle V: Observability

**Requirements**:
- Structured logging with correlation IDs
- Error messages include context (operation, inputs, state)
- Configuration externalized
- No hardcoded values
- Metrics and health checks

**Verification**:
1. Check for @Slf4j annotation
2. Verify structured logging format
3. Check error handling includes context
4. Verify no hardcoded config values
5. Check for health check implementations

**Red Flags**:
- ❌ Using System.out.println instead of logging
- ❌ Bare catch blocks without context
- ❌ Hardcoded configuration values
- ❌ Missing correlation IDs in logs

---

## Compliance Scoring

Rate each principle: **Compliant** / **Partial** / **Non-Compliant**

### Example Output

```markdown
## Constitution Compliance

### ✅ Principle I: Specification-Driven - COMPLIANT
- Implementation matches spec.md requirements
- All acceptance criteria tested

### ⚠️ Principle II: Comprehensive Testing - PARTIAL
- Coverage: 75% (below 80% threshold)
- TestContainers used correctly
- **ISSUE**: DeviceService missing unit tests

### ✅ Principle III: Independent User Story - COMPLIANT
- User Story 2 can deploy independently
- No dependencies on incomplete work

### ⚠️ Principle IV: Integration Testing - PARTIAL
- Contract tests present
- **ISSUE**: Missing Kafka integration test

### ✅ Principle V: Observability - COMPLIANT
- Structured logging implemented
- Correlation IDs present
- No hardcoded values

### Overall: 3 Compliant, 2 Partial, 0 Non-Compliant
**Recommendation**: Address Principles II and IV before merge
```

## Critical Violations

These violations require immediate fix:
- ❌ Coverage <60%
- ❌ Using PowerMock
- ❌ Hardcoded secrets or credentials
- ❌ No tests for new code
- ❌ Implementation doesn't match spec

## Constitution Location

`.specify/memory/constitution.md`

Load this file to get complete principle definitions and examples.
