# Properties

Properties are structured metadata stored in Markdown frontmatter. They make notes easier to filter, sort, script, or share with tools that understand YAML metadata.

## Basic frontmatter

Frontmatter appears at the top of a Markdown file between `---` markers.

```md
---
status: draft
project: OpenOnyx
created: 2026-09-26
tags:
  - docs
  - product
---
```

The rest of the note remains ordinary Markdown.

## When to use properties

Use properties for stable, structured facts:

- Status.
- Project.
- Owner.
- Date.
- Source.
- Review state.
- Related IDs from another system.

Use normal prose for meaning, reasoning, and nuance.

## Properties panel

The properties panel gives a contextual view of metadata for the active note. It is useful when you are reviewing many notes with the same schema.

## Practical schema

Start small:

```yaml
status: draft
type: note
project:
reviewed:
```

Add fields only when you know how you will search, sort, or maintain them.

## Continue learning

- [Markdown](<Markdown.md>)
- [Search](<Search.md>)
- [Reference](<Reference.md>)

