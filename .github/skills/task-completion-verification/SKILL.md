---
name: task-completion-verification
description: Parse tasks.md and verify implementation completion against changed files. Use this for PRs with feature tasks to ensure accuracy.
version: 1.0.0
license: MIT
---

# Task Completion Verification Skill

This skill verifies that tasks marked as complete in `tasks.md` are actually implemented in the PR.

## When to Use

Use this skill when:
- A PR has an associated `tasks.md` file
- Reviewing code against a task breakdown
- Validating task completion status

## Task Format

Tasks in `tasks.md` follow this format:

```markdown
- [x] T001 Create DeviceService in src/main/java/com/bestbuy/order/pickup/pushnotification/service/DeviceService.java
- [ ] T002 Create DeviceController in src/main/java/com/bestbuy/order/pickup/pushnotification/controller/DeviceController.java
- [x] T003 [P] Create Device entity in src/main/java/com/bestbuy/order/pickup/pushnotification/model/Device.java
```

- `[x]` = Completed
- `[ ]` = Incomplete
- `[ID]` = Task identifier (e.g., T001)
- `[P]` = Can run in parallel (optional)
- `[Story]` = User story label (e.g., US1, US2)
- File paths are explicit in descriptions

## Verification Process

### 1. Parse tasks.md

Extract all tasks:
```
Task ID | Status | Description | File Path
--------|--------|-------------|----------
T001    | [x]    | Create DeviceService | src/main/java/com/bestbuy/order/pickup/pushnotification/service/DeviceService.java
T002    | [ ]    | Create DeviceController | src/main/java/com/bestbuy/order/pickup/pushnotification/controller/DeviceController.java
```

### 2. Get Changed Files

From PR, get list of all changed files:
```
services/pickup-push-notification-service/src/main/java/com/bestbuy/order/pickup/pushnotification/service/DeviceService.java
services/pickup-push-notification-service/src/test/java/com/bestbuy/order/pickup/pushnotification/service/DeviceServiceTest.java
```

### 3. Verify Each Completed Task

For EACH task marked `[x]`:

**Check 1: File Exists**
- Extract file path from task description
- Check if file appears in changed files list
- Account for service path prefix

**Check 2: Implementation Matches**
- Read the file content
- Verify implementation matches task description
- Check for:
  - Class/method exists
  - Required annotations present
  - Core functionality implemented

**Check 3: Test Coverage**
- If implementation file, check for corresponding test file
- Verify test file is also changed (if new implementation)

### 4. Calculate Metrics

```
Total Tasks: 72
Completed: 48 (67%)
Incomplete: 24 (33%)

Verified Complete: 45 ✅
Marked Complete but NOT Implemented: 3 ❌ CRITICAL
Implemented but NOT Marked Complete: 2 ⚠️
```

## Output Format

### Task Completion Status

**Overall Progress**: 48/72 tasks completed (67%)

#### ✅ Verified Complete
- [T001] Create DeviceService - ✅ Implemented in `service/DeviceService.java`
- [T003] Create Device entity - ✅ Implemented in `model/Device.java`

#### ❌ Marked Complete But NOT Implemented (CRITICAL)
- [T025] Create DomainException - ❌ **MISSING**: Expected in `exception/DomainException.java` but not found in changed files
- [T040] Add device token validation - ❌ **MISSING**: Implementation not found in `DeviceService.java`

#### ⚠️ Implemented But NOT Marked Complete
- [T026] Create DeviceNotFoundException - ⚠️ Found in `exception/DeviceNotFoundException.java` but task unchecked

#### 🔲 Incomplete Tasks
- [T044] Create KafkaEventContractTest - Not yet implemented
- [T045] Create KafkaConsumerIntegrationTest - Not yet implemented

## Recommendations

If discrepancies found:
1. **Critical**: Tasks marked complete but not implemented → REQUEST CHANGES
2. **Warning**: Tasks implemented but not marked → Update tasks.md
3. **Info**: Incomplete tasks → Note remaining work

## Error Handling

- If tasks.md not found: Skip verification
- If file path ambiguous: Check multiple possible locations
- If implementation partial: Report as "Partially Implemented"
- If test missing: Report as "Implementation without tests"

## Example Script

This skill includes a helper script for parsing:

```bash
# See parse-tasks.sh in this directory
./parse-tasks.sh tasks.md changed-files.txt
```
