# Claude Code Available Plugins

Marketplace: `claude-plugins-official` (anthropics/claude-plugins-official)

Install: `claude plugin install <name>`

---

## Currently Installed

| Plugin | Description |
|--------|-------------|
| **frontend-design** | Frontend design skill for UI/UX implementation |

---

## External Plugins (3rd-party integrations)

| Plugin | Description | Relevant? |
|--------|-------------|-----------|
| **asana** | Asana project management integration. Create and manage tasks, search projects, update assignments, track progress. | No |
| **context7** | Upstash Context7 MCP server for up-to-date documentation lookup. Pull version-specific docs and code examples directly from source repos. | Maybe |
| **firebase** | Google Firebase MCP integration. Manage Firestore, auth, cloud functions, hosting, and storage. | No |
| **github** | Official GitHub MCP server. Create issues, manage PRs, review code, search repos, interact with GitHub API. | Maybe |
| **gitlab** | GitLab DevOps platform integration. Manage repos, merge requests, CI/CD, issues, wikis. | No |
| **greptile** | AI code review agent for GitHub/GitLab. View and resolve PR review comments. | No |
| **laravel-boost** | Laravel development toolkit. Artisan, Eloquent, routing, migrations, Laravel-specific code gen. | No |
| **linear** | Linear issue tracking. Create issues, manage projects, update statuses. | No |
| **playwright** | Browser automation and e2e testing by Microsoft. Interact with web pages, screenshots, forms, automated testing. | Yes |
| **serena** | Semantic code analysis. Intelligent code understanding, refactoring suggestions, codebase navigation via LSP. | Maybe |
| **slack** | Slack workspace integration. Search messages, access channels, read threads. | No |
| **stripe** | Stripe development plugin. | No |
| **supabase** | Supabase MCP integration. Database, auth, storage, real-time. | No |

## Built-in Plugins

| Plugin | Description | Relevant? |
|--------|-------------|-----------|
| **agent-sdk-dev** | Claude Agent SDK Development Plugin | No |
| **clangd-lsp** | C/C++ language server | No |
| **claude-code-setup** | Analyze codebases and recommend tailored Claude Code automations (hooks, skills, MCP servers, subagents) | Yes |
| **claude-md-management** | Tools to maintain and improve CLAUDE.md files - audit quality, capture session learnings, keep project memory current | Yes |
| **code-review** | Automated code review for PRs using multiple specialized agents with confidence-based scoring | Yes |
| **code-simplifier** | Agent that simplifies and refines code for clarity, consistency, and maintainability | Maybe |
| **commit-commands** | Streamline git workflow with simple commands for committing, pushing, and creating PRs | Maybe |
| **example-plugin** | Comprehensive example plugin demonstrating all Claude Code extension options | No |
| **feature-dev** | Comprehensive feature development workflow with specialized agents for exploration, architecture, and quality review | Yes |
| **frontend-design** | Frontend design skill for UI/UX implementation | **Installed** |
| **hookify** | Easily create hooks to prevent unwanted behaviors by analyzing conversation patterns | Maybe |
| **playground** | Creates interactive HTML playgrounds - self-contained single-file explorers with visual controls and live preview | Maybe |
| **pr-review-toolkit** | Comprehensive PR review agents (comments, tests, error handling, type design, code quality, simplification) | Maybe |
| **security-guidance** | Security reminder hook - warns about potential security issues (command injection, XSS, unsafe patterns) | Yes |
| **skill-creator** | Create/improve/test skills, run evals, benchmark performance | Maybe |

*(Language server plugins omitted — only relevant if you use that language)*

---

## Detailed Plugin Profiles (Recommended for This Project)

### 1. frontend-design (Installed)

**Type:** Skill (auto-activates)
**Invoke:** Automatically triggers when you ask Claude to build frontend components. No command needed — just describe what you want.

**Features:**
- Generates bold, distinctive UI code (avoids generic AI look)
- Production-ready HTML/CSS/JS with meticulous attention to detail
- Chooses creative typography, color palettes, animations
- Context-aware — reads your existing styles and matches/extends them

**Example prompts:**
- "Create a dashboard for a music streaming app"
- "Build a settings panel with dark mode"
- "Design a modal for setlist sharing"

**GUI:** None — works inline in conversation. Output is code you paste/apply.

---

### 2. security-guidance

**Type:** Hook (auto-triggers on file edits)
**Invoke:** Automatic — fires whenever you edit files. No manual command.

**Features:**
- Warns about potential security issues when code is being modified
- Checks for: command injection, XSS, SQL injection, unsafe patterns
- Particularly useful when editing auth code, API handlers, form inputs
- Non-blocking — shows warnings but doesn't prevent edits

**GUI:** None — warnings appear inline during editing.

**Good for:** Our Cloudflare Worker auth code, admin.js password handling, any GitHub API calls.

---

### 3. code-review

**Type:** Slash command
**Invoke:** `/code-review` (on a PR branch)

**Features:**
- Launches **4 parallel review agents**, each with a different focus:
  - Agents 1-2: CLAUDE.md compliance audit
  - Agent 3: Obvious bug scanning in changes
  - Agent 4: Git blame/history context analysis
- **Confidence scoring** (0-100) on each finding — only reports issues scoring 80+
- Posts formatted review comment with direct code links
- Auto-skips: closed PRs, drafts, trivial changes, already-reviewed PRs

**Workflow:**
1. Create a PR branch with your changes
2. Run `/code-review`
3. Claude launches 4 agents, scores findings, posts comment
4. Only high-confidence issues shown (reduces noise)

**GUI:** None — output is a structured review comment (markdown).

---

### 4. claude-code-setup

**Type:** Skill (on-demand)
**Invoke:** Ask "recommend automations for this project" or "help me set up Claude Code" or "what hooks should I use?"

**Features:**
- Scans your codebase structure, dependencies, and patterns
- Recommends top 1-2 automations in each category:
  - **MCP Servers** — external integrations (context7 for docs, Playwright for testing)
  - **Skills** — packaged expertise (plan agent, frontend-design)
  - **Hooks** — automatic actions (auto-format, auto-lint, block sensitive files)
  - **Subagents** — specialized reviewers (security, performance, accessibility)
  - **Slash Commands** — quick workflows (/test, /pr-review)
- **Read-only** — analyzes but never modifies your files

**GUI:** None — output is a structured recommendations list.

---

### 5. feature-dev

**Type:** Slash command + agents
**Invoke:** `/feature-dev <description>` or just `/feature-dev`

**Features:**
- **7-phase structured workflow:**
  1. **Discovery** — clarifies requirements, asks questions
  2. **Codebase Exploration** — launches 2-3 `code-explorer` agents to map existing patterns
  3. **Architecture Design** — proposes implementation plan with trade-offs
  4. **Approval** — presents plan for user sign-off
  5. **Implementation** — writes the code
  6. **Quality Review** — launches review agents for bugs, style, integration
  7. **Summary** — final report of what was built

- **Two specialized agents:**
  - `code-architect` — designs architecture blueprints, identifies integration points
  - `code-explorer` — traces feature implementations across the codebase, maps patterns

**Example:**
```
/feature-dev Add WikiCharts text-based chord chart system
```
Claude will explore your codebase, ask clarifying questions, design the architecture, implement, and review.

**GUI:** None — interactive conversation with phase markers.

---

### 6. playwright (External)

**Type:** MCP Server
**Invoke:** Installed as an MCP server — Claude can then interact with browsers programmatically.

**Features:**
- Browser automation via Playwright MCP protocol
- Take screenshots, fill forms, click elements, navigate pages
- Run automated tests against your live app
- Useful for visual regression testing and e2e flows

**Setup:** `claude plugin install playwright` — adds MCP config that runs `npx @playwright/mcp@latest`

**Note:** We already use Playwright for tests (`tests/` folder). This plugin gives Claude direct browser control during conversations.

**GUI:** None — Claude controls the browser in the background.

---

### 7. claude-md-management

**Type:** Skill + Slash command
**Invoke:**
- Skill: "audit my CLAUDE.md files" or "check if my CLAUDE.md is up to date"
- Command: `/revise-claude-md` (at end of session)

**Features:**
- **claude-md-improver** (skill):
  - Audits CLAUDE.md files against current codebase state
  - Finds outdated rules, missing patterns, stale references
  - Suggests specific updates with quality scores
  - Good for periodic maintenance

- **/revise-claude-md** (command):
  - Captures learnings from the current session
  - Identifies patterns, decisions, and preferences that emerged
  - Proposes additions to CLAUDE.md so future sessions have that context
  - Best used at the end of a productive session

**GUI:** None — structured output with before/after suggestions.

---

## Installation Cheat Sheet

```bash
# Already installed
claude plugin install frontend-design    # Done

# Recommended to install
claude plugin install security-guidance
claude plugin install code-review
claude plugin install claude-code-setup
claude plugin install feature-dev
claude plugin install playwright
claude plugin install claude-md-management
```
