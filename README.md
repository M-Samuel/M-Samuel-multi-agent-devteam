# Multi-Agent Development Team

An autonomous development team framework where specialized agents collaborate using different LLM models to reduce cost while maintaining quality.

## Architecture Overview

### Agents
- **Planner**: Breaks requests into testable tickets
- **Implementer**: Codes solutions (starts on cheapest tier, escalates on failure)
- **Tester**: Validates tests, lint, typecheck, security
- **Reviewer**: Checks correctness and security
- **Merger**: Prepares approved work for merge

### Model Tiers
- **Tier A** (Premium): Planning, architecture, final review
- **Tier B** (Mid): Complex coding, refactors, bug investigation
- **Tier C** (Cheap): Boilerplate, tests, docs, commits

### Escalation
Work starts on Tier C and escalates to B/A on:
- Test failures (after 2 repair loops)
- Protected path modifications (auth, payments, migrations)
- Large changes (>400 LOC)
- Reviewer escalation requests
- Security concerns

## Quick Start

```bash
npm install
npm run typecheck
npm run test
npm run run:ticket
```

## Configuration

- `config/models.yaml`: Model mapping and pricing
- `config/policies.yaml`: Security rules and protected paths
- `config/prompts/`: System prompts for each agent

## Project Structure

```
src/
  core/          # Shared types
  agents/        # Agent implementations
  orchestrator/  # DAG, router, state machine
  tools/         # Git, GitHub, test, lint, security tools
  memory/        # Task store, vector store, artifacts
  eval/          # Metrics and cost reporting
  scripts/       # CLI drivers

config/
  models.yaml
  policies.yaml
  prompts/       # System prompts

tests/           # Unit tests
```

## Budget & Quality Gates

- Max 3 repair loops per ticket (hard cap)
- Token budgets per tier
- All quality gates must pass before merge:
  - Unit tests
  - Lint
  - Type checking
  - Security scanning
  - Review approval

## Development

```bash
# Type check
npm run typecheck

# Run tests
npm run test

# Watch mode
npm run test:watch

# Build
npm run build
```
