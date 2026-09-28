# File Explorer

The file explorer shows the vault as folders and files on disk. It is not a separate database view. Renaming, moving, creating, and deleting items from the explorer affects the real vault folder.

## What appears in the file explorer

The explorer is built from the active vault path. It can show Markdown notes, Canvas files, folders, and supported attachments. File types that OpenOnyx cannot edit may still matter because Markdown links can point to them.

## Create notes and folders

Create a note when you have a durable thought, a meeting record, a reference, or a question worth revisiting. Create a folder when it gives a broad place to put related material.

Good folder names are stable:

```text
Projects/
Areas/
Resources/
Archive/
```

Avoid making a new folder for every thought. Links, backlinks, tags, and search are better for relationships that cross categories.

## Rename and move files

Renaming is a real filesystem operation. If link updating is enabled in settings, OpenOnyx can rewrite internal links that point to the renamed note. Always review important renames in a small batch first.

When moving a folder, remember that every file underneath it receives a new path. This is useful for reorganizing a project, but it is also a bigger operation than moving one note.

## Delete and recover

Deletion removes an item from the vault path. Before deleting a folder, confirm that it does not contain attachments, Canvas files, or notes referenced by other pages. Backups and version control are the best recovery layer.

## Recommended practice

- Use folders for broad lifecycle states.
- Use note titles for specific identity.
- Use links for meaning.
- Use tags for cross-cutting states.
- Use search when the location is not obvious.

## Continue learning

- [Open a Vault](<Open a Vault.md>)
- [Links and Backlinks](<Links and Backlinks.md>)
- [Search](<Search.md>)

