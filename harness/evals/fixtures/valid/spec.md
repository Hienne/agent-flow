---
artifact: spec
status: ready
workspace: remote-a
project: checker-maker
source: decisions.md
source_revision: 1
revision: 1
---

# Print V2

## Problem

Printing is inconsistent across transaction actions.

## Desired behaviour

Init, Confirm, and Recall use the accepted print contract.

## Observable acceptance criteria

- **AC-001:** Init, Confirm, and Recall print the correct document.

## Contracts and state transitions

The accepted confirmation contract remains unchanged.

## Verification seams

Exercise each action through the public print command.

## Constraints

Preserve the existing backend contract.

## Out of scope

Changing document content.

## Open decisions

None
