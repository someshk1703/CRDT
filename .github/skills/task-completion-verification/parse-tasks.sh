#!/bin/bash
# Parse tasks.md and verify against changed files
# Exit codes: 0 = success, 1 = file not found, 2 = parse error

set -euo pipefail

TASKS_FILE="${1:-tasks.md}"
CHANGED_FILES="${2:-/dev/stdin}"

if [ ! -f "$TASKS_FILE" ]; then
  echo "Error: tasks.md not found at $TASKS_FILE" >&2
  exit 1
fi

# Read changed files into an array if provided as a file
declare -a CHANGED_FILES_ARRAY=()
if [ -f "$CHANGED_FILES" ]; then
  while IFS= read -r file; do
    CHANGED_FILES_ARRAY+=("$file")
  done < "$CHANGED_FILES"
elif [ "$CHANGED_FILES" != "/dev/stdin" ]; then
  # If it's not stdin and not a file, treat it as empty
  :
fi

# Function to check if a test file exists for an implementation file
check_test_file() {
  local impl_file="$1"
  
  # Skip if not a Java file or already a test file
  if [[ ! "$impl_file" =~ \.java$ ]] || [[ "$impl_file" =~ Test\.java$ ]]; then
    echo ""
    return
  fi
  
  # Convert implementation path to test path
  # e.g., src/main/java/com/example/Service.java -> src/test/java/com/example/ServiceTest.java
  local test_file=""
  if [[ "$impl_file" =~ src/main/java/ ]]; then
    test_file="${impl_file/src\/main\/java/src/test/java}"
    test_file="${test_file/.java/Test.java}"
  else
    # Try common pattern: FileName.java -> FileNameTest.java
    test_file="${impl_file/.java/Test.java}"
  fi
  
  # Check if test file exists in changed files
  local found=false
  for changed_file in "${CHANGED_FILES_ARRAY[@]}"; do
    if [[ "$changed_file" == *"$test_file" ]] || [[ "$changed_file" =~ $(basename "$test_file")$ ]]; then
      found=true
      break
    fi
  done
  
  if [ "$found" = true ]; then
    echo "TEST_FOUND"
  else
    echo "TEST_MISSING"
  fi
}

# Extract all tasks with checkboxes
echo "=== Parsing Tasks ==="
declare -a MISSING_TESTS=()
grep -E '^[[:space:]]*- \[(x| )\]' "$TASKS_FILE" | while IFS= read -r line; do
  # Extract status
  if echo "$line" | grep -q '\[x\]'; then
    STATUS="COMPLETE"
  else
    STATUS="INCOMPLETE"
  fi
  
  # Extract task ID (e.g., T001)
  TASK_ID=$(echo "$line" | grep -oE 'T[0-9]{3}' | head -1)
  
  # Extract description
  DESC=$(echo "$line" | sed -E 's/.*T[0-9]{3}[[:space:]]*(\[P\])?[[:space:]]*(\[US[0-9]+\])?[[:space:]]*//')
  
  # Try to extract file path from description
  FILE_PATH=$(echo "$DESC" | grep -oE '[^[:space:]]+\.(java|yml|xml|properties)' | head -1)
  
  # Check for test coverage if task is complete and has a Java implementation file
  TEST_STATUS=""
  if [ "$STATUS" = "COMPLETE" ] && [ -n "$FILE_PATH" ] && [ ${#CHANGED_FILES_ARRAY[@]} -gt 0 ]; then
    TEST_STATUS=$(check_test_file "$FILE_PATH")
  fi
  
  if [ "$TEST_STATUS" = "TEST_MISSING" ]; then
    echo "$TASK_ID|$STATUS|$FILE_PATH|$DESC|⚠️ TEST_MISSING"
  else
    echo "$TASK_ID|$STATUS|$FILE_PATH|$DESC"
  fi
done

echo ""
echo "=== Summary ==="
TOTAL=$(grep -cE '^[[:space:]]*- \[(x| )\]' "$TASKS_FILE" || echo "0")

if [ "$TOTAL" -eq 0 ]; then
  echo "Warning: No tasks found in $TASKS_FILE" >&2
  exit 2
fi

COMPLETE=$(grep -cE '^[[:space:]]*- \[x\]' "$TASKS_FILE" || echo "0")
INCOMPLETE=$((TOTAL - COMPLETE))
PERCENTAGE=$((COMPLETE * 100 / TOTAL))

echo "Total Tasks: $TOTAL"
echo "Complete: $COMPLETE ($PERCENTAGE%)"
echo "Incomplete: $INCOMPLETE ($((100 - PERCENTAGE))%)"

# Report on test coverage
if [ ${#CHANGED_FILES_ARRAY[@]} -gt 0 ]; then
  echo ""
  echo "=== Test Coverage Check ==="
  TASKS_WITH_MISSING_TESTS=$(grep -E '^[[:space:]]*- \[x\]' "$TASKS_FILE" | while IFS= read -r line; do
    DESC=$(echo "$line" | sed -E 's/.*T[0-9]{3}[[:space:]]*(\[P\])?[[:space:]]*(\[US[0-9]+\])?[[:space:]]*//')
    FILE_PATH=$(echo "$DESC" | grep -oE '[^[:space:]]+\.(java|yml|xml|properties)' | head -1)
    if [ -n "$FILE_PATH" ]; then
      TEST_STATUS=$(check_test_file "$FILE_PATH")
      if [ "$TEST_STATUS" = "TEST_MISSING" ]; then
        echo "1"
      fi
    fi
  done | wc -l)
  
  if [ "$TASKS_WITH_MISSING_TESTS" -gt 0 ]; then
    echo "⚠️  $TASKS_WITH_MISSING_TESTS completed task(s) missing corresponding test files"
  else
    echo "✅ All completed implementation tasks have corresponding test files"
  fi
fi

exit 0
