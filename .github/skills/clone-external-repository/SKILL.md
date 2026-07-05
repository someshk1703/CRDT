---
name: clone-external-repository
description: Clone external GitHub repositories to reference code, explore implementations, or analyze patterns. Use this when you need to examine entire repositories rather than individual files.
version: 1.0.0
license: MIT
---

# Clone External Repository Skill

This skill enables agents to clone, search, and examine external GitHub repositories (both public and private) to reference code, understand implementations, or analyze patterns.

## When to Use

Use this skill when:
- Exploring implementation patterns from external repositories
- Analyzing code structure across multiple files in a repository
- Comparing your implementation with reference implementations
- Understanding architecture by browsing an entire codebase
- Migrating code from one repository to another
- Validating compatibility with existing systems

## Prerequisites

### Required
- **Git**: Available in the execution environment (pre-installed in GitHub Actions runners)

### Authentication (for private repositories)
The script uses a **priority-based authentication cascade**:

1. **GIAM_TOKEN** env var (set by `tplat-gha-configure-github-credentials` action)
2. **gh CLI** (`gh auth login` locally)
3. **Public repos only** (no authentication - unauthenticated fallback)

### For Public Repositories
- No authentication required - the script works without any credentials

## Authentication

### Local Development

```bash
# Authenticate with GitHub CLI (one-time setup)
gh auth login

# Verify authentication
gh auth status
```

## Usage

### Using the Helper Script

```bash
# Clone an external repository (private or public)
./clone-external-repo.sh clone bby-corp/mp-return-consumer
./clone-external-repo.sh clone spring-projects/spring-boot

# Find a specific file
./clone-external-repo.sh find KafkaHealthChecker.java

# View a file's contents
./clone-external-repo.sh view mp-return-consumer/src/main/java/com/bestbuy/mp/healthcheck/KafkaHealthChecker.java

# Full workflow: clone, find, and view
./clone-external-repo.sh workflow spring-projects/spring-boot RestController.java
```

### Direct Commands

```bash
# Clone private repository with authentication
cd /tmp && gh repo clone bby-corp/mp-return-consumer

# Clone public repository (no auth needed)
cd /tmp && git clone https://github.com/spring-projects/spring-boot.git

# Find source files
find spring-boot -name "RestController.java"

# View source
cat spring-boot/spring-boot-project/spring-boot/src/main/java/org/springframework/boot/web/servlet/RestController.java
```

## Common Workflows

### Workflow 1: Explore Implementation Patterns

```bash
# Clone a reference repository
./clone-external-repo.sh clone spring-projects/spring-boot

# Search for specific patterns
find spring-boot -name "*Controller.java" | head -10

# Examine implementation details
./clone-external-repo.sh view spring-boot/spring-boot-project/.../RestController.java
```

### Workflow 2: Compare Implementations

```bash
# Clone both repositories
./clone-external-repo.sh clone your-org/your-service
./clone-external-repo.sh clone reference-org/reference-service

# Compare similar files
diff your-service/src/config.js reference-service/src/config.js
```

### Workflow 3: Migration from External Source

```bash
# Clone source repository
./clone-external-repo.sh clone source-org/old-service

# Find and document the code you're migrating
./clone-external-repo.sh find OrderStatus.java
./clone-external-repo.sh view old-service/src/.../OrderStatus.java

# Implement in your repository with reference to source
# Document source in commit message
git commit -m "feat: implement OrderStatus based on source-org/old-service"
```

## Example Scenarios

### Example 1: Study Spring Boot Architecture

```bash
# Clone Spring Boot repository
./clone-external-repo.sh workflow spring-projects/spring-boot RestController.java

# Explore auto-configuration patterns
find spring-boot -path "*/autoconfigure/*.java" | head -20

# Study specific implementation
./clone-external-repo.sh view spring-boot/spring-boot-project/.../RestController.java
```

### Example 2: Reference Best Buy Internal Service

```bash
# Clone internal service for reference
./clone-external-repo.sh clone bby-corp/mp-return-consumer

# Find health check implementation
./clone-external-repo.sh find KafkaHealthChecker.java

# View and adapt the pattern
./clone-external-repo.sh view mp-return-consumer/src/.../KafkaHealthChecker.java
```

### Example 3: Analyze Open Source Implementation

```bash
# Clone popular library
./clone-external-repo.sh clone apache/kafka

# Search for specific functionality
find kafka -name "*Consumer*.java" | grep -v test

# Study implementation approach
cat kafka/clients/src/main/java/org/apache/kafka/clients/consumer/KafkaConsumer.java
```

## Integration with Agents

Agents can use this skill when they detect:
1. References to external repositories (e.g., "similar to spring-boot/...")
2. Need to understand patterns across multiple files
3. Questions about implementation approaches in other codebases
4. Migration tasks requiring source code examination

Agent workflow:
```
1. Detect need for external repository reference
2. Invoke clone-external-repository skill
3. Clone and search the repository
4. Analyze relevant code
5. Apply patterns to current task
6. Document source of inspiration in commits
```

## Error Handling

### Clone Failed - Private Repository
```bash
# Check token validity
gh auth status

# Check repository access
gh repo view org-name/repo-name

# Verify repository name spelling
```

### Clone Failed - Public Repository
```bash
# Verify repository exists
curl -I https://github.com/org-name/repo-name

# Check network connectivity
ping github.com

# Try direct git clone
git clone https://github.com/org-name/repo-name.git
```

### File Not Found
```bash
# Search with broader pattern
find repo-name -name "*.java" | grep -i "classname"

# List all directories to understand structure
find repo-name -type d -maxdepth 3

# Search file contents for specific text
grep -r "className" repo-name/
```

### Permission Denied (Private Repository)
```bash
# Verify token has read access
gh api repos/org-name/repo-name --jq '.permissions'

# For Best Buy repos, check if SSO authorization is required
# Visit: https://github.com/settings/tokens and authorize SSO
```

## Best Practices

| Do | Don't |
|----|-------|
| ✅ Clone to /tmp to keep workspace clean | ❌ Clone inside your working directory |
| ✅ Search before examining entire files | ❌ Read every file without purpose |
| ✅ Document source repository in commits | ❌ Copy code without attribution |
| ✅ Adapt patterns, don't blindly copy | ❌ Copy-paste without understanding |
| ✅ Use for reference and learning | ❌ Violate licenses or copy proprietary code |

## Related Skills

- **fetch-external-reference**: For fetching single files from GitHub URLs (use when you only need one file)
- **constitution-compliance-check**: Validate code follows Constitution principles
- **pr-context-analysis**: Analyze PR context when implementing based on external references

## Troubleshooting

### Common Issues

1. **"Repository not found"**
   - Verify repository name is correct (check org/repo spelling)
   - For private repos, ensure authentication is configured (see [Authentication](#authentication))
   - For public repos, verify repository exists on GitHub

2. **"Authentication failed"**
   - In GitHub Actions: Ensure `id-token: write` permission is set
   - In GitHub Actions with GIAM action: Verify action is configured correctly
   - Locally: Run `gh auth status` to check authentication, use `gh auth login` if needed
   - For Best Buy repos: Ensure GIAM role has appropriate access (default: `org-read`)

3. **"Could not find file"**
   - File may be in different branch (try `main` vs `master` vs `develop`)
   - Path may have changed in recent commits
   - Repository structure may differ from expectations
   - Use broader search: `find . -name "*ClassName*"`

4. **"Clone is too slow"**
   - Large repositories take time to clone
   - Consider using `--depth 1` for shallow clone
   - Alternatively, use fetch-external-reference skill for single files
