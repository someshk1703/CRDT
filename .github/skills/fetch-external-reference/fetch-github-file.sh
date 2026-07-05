#!/bin/bash
# Fetch reference file from external GitHub repository
# Usage: ./fetch-github-file.sh <github-url>
# Exit codes: 0 = success, 1 = invalid URL, 2 = all methods failed
#
# Authentication (in order of preference):
#   1. GIAM_TOKEN env var   - Pre-configured in GitHub Actions workflows
#   2. gh CLI               - Run 'gh auth login' locally
#   3. Public repos only    - Unauthenticated curl (last resort)

set -euo pipefail

GITHUB_URL="${1:-}"

if [ -z "$GITHUB_URL" ]; then
  echo "Error: GitHub URL required" >&2
  echo "Usage: $0 <github-url>" >&2
  echo "Example: $0 https://github.com/org/repo/blob/main/path/to/file.java" >&2
  exit 1
fi

# Function to report file size (cross-platform compatible)
report_size() {
  local file="$1"
  local lines=$(/usr/bin/wc -l < "$file" 2>/dev/null || echo "unknown")
  local bytes=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo "unknown")
  echo "Size: $lines lines ($bytes bytes)"
}

# Function to show file preview
show_preview() {
  local file="$1"
  echo ""
  echo "Preview (first 10 lines):"
  /usr/bin/head -n 10 "$file" 2>/dev/null || echo "(preview not available)"
}

# Function to display successful fetch result
display_success() {
  local method="$1"
  local output_file="$2"
  echo "✅ SUCCESS via $method"
  echo "Content saved to: $output_file"
  report_size "$output_file"
  show_preview "$output_file"
  echo ""
  echo "=== Fetch Complete ==="
}

echo "=== Fetching External Reference ==="
echo ""
echo "URL: $GITHUB_URL"

# Parse GitHub URL with single regex pattern
if [[ $GITHUB_URL =~ https://github\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.+) ]]; then
  OWNER="${BASH_REMATCH[1]}"
  REPO="${BASH_REMATCH[2]}"
  BRANCH="${BASH_REMATCH[3]}"
  FILE_PATH="${BASH_REMATCH[4]}"
else
  echo "Error: Invalid GitHub URL format" >&2
  echo "Expected: https://github.com/[org]/[repo]/blob/[branch]/[path]" >&2
  exit 1
fi

echo "Owner: $OWNER"
echo "Repo: $REPO"
echo "Path: $FILE_PATH"
echo ""

# Extract filename for output (using parameter expansion instead of basename)
FILENAME="${FILE_PATH##*/}"
OUTPUT_FILE="/tmp/reference-${FILENAME}"

# Priority 1: GIAM_TOKEN via gh api (best for Best Buy private repos in GitHub Actions)
# Uses GH_TOKEN env var so the token is not exposed in the process listing
echo "Attempting Priority 1: GIAM_TOKEN via gh api..."
if [ -n "${GIAM_TOKEN:-}" ]; then
  if command -v gh &> /dev/null; then
    if GH_TOKEN="$GIAM_TOKEN" gh api "repos/$OWNER/$REPO/contents/$FILE_PATH" --jq '.content' 2>/dev/null | base64 -d > "$OUTPUT_FILE"; then
      if [ -s "$OUTPUT_FILE" ]; then
        display_success "GIAM_TOKEN" "$OUTPUT_FILE"
        exit 0
      fi
    fi
    echo "⚠️  GIAM_TOKEN fetch failed, trying next method..."
  else
    echo "⚠️  gh CLI not available (required to use GIAM_TOKEN), trying next method..."
  fi
else
  echo "⚠️  GIAM_TOKEN not set, trying next method..."
fi

# Priority 2: gh api (for local development with gh CLI)
echo "Attempting Priority 2: gh api..."
if command -v gh &> /dev/null; then
  if gh api "repos/$OWNER/$REPO/contents/$FILE_PATH" --jq '.content' 2>/dev/null | base64 -d > "$OUTPUT_FILE"; then
    if [ -s "$OUTPUT_FILE" ]; then
      display_success "gh api" "$OUTPUT_FILE"
      exit 0
    fi
  fi
  echo "⚠️  gh api failed, trying next method..."
else
  echo "⚠️  gh CLI not available, trying next method..."
fi

# Priority 3: curl to raw.githubusercontent.com (last resort, public repos only)
echo "Attempting Priority 3: curl (public repos only)..."
RAW_URL="https://raw.githubusercontent.com/$OWNER/$REPO/$BRANCH/$FILE_PATH"

if /usr/bin/curl -fsSL "$RAW_URL" -o "$OUTPUT_FILE" 2>&1; then
  if [ -s "$OUTPUT_FILE" ]; then
    display_success "curl" "$OUTPUT_FILE"
    exit 0
  fi
fi

# All methods failed
echo ""
echo "❌ Unable to fetch reference file"
echo ""
echo "Attempted methods:"
echo "1. GIAM_TOKEN - $([ -n "${GIAM_TOKEN:-}" ] && echo 'Failed' || echo 'Not set')"
echo "2. gh api - $(command -v gh &>/dev/null && echo 'Failed' || echo 'gh CLI not installed')"
echo "3. curl (public) - Failed"
echo ""
echo "Possible reasons:"
echo "- Repository is private and credentials lack access"
echo "- File path is incorrect or file was moved/deleted"
echo "- Repository does not exist"
echo "- Network connectivity issues"
echo ""
echo "Recommendation:"
echo "1. Verify the GitHub URL is correct"
echo "2. In GitHub Actions: ensure GIAM_TOKEN is available (set by tplat-gha-configure-github-credentials)"
echo "3. Locally: run 'gh auth login'"
echo "4. Confirm the file exists at that path"
echo ""

exit 2