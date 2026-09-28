# Links and Backlinks

Links are explicit decisions that two notes belong together. Backlinks show the notes that already point to the current one. Together they are the spine of a connected vault.

## Link types

OpenOnyx supports ordinary Markdown links and wiki-style vault links.

```md
[Readable label](<Project Plan.md>)
[[Project Plan]]
[[Project Plan#Decisions]]
```

Use Markdown links when you want a custom label. Use wiki links when the note title itself is the best label.

## Create useful links

A useful link explains a relationship. The sentence around the link should make that relationship clear.

Weak:

```md
See [[Design]].
```

Stronger:

```md
The onboarding flow should follow the constraint in [[Design Principles#Progressive disclosure]].
```

## Backlinks

The backlinks panel answers, “What already refers to this note?” It helps you discover context you forgot, find orphan notes, and see which notes depend on a concept.

Use backlinks when:

- Renaming a note.
- Revising a central concept.
- Checking whether a decision has downstream references.
- Turning a draft into an index note.

## Unlinked mentions

If available, unlinked mentions show text references that are not links yet. Review them carefully. Not every repeated phrase deserves a link.

## Continue learning

- [Outgoing Links](<Outgoing Links.md>)
- [Knowledge Graph](<Knowledge Graph.md>)
- [Rename and Move Notes](<Rename and Move Notes.md>)
