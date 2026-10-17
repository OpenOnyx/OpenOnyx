import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '/tmp/openonyx-embedding-fixtures');
// Refuse existing directories, including real vaults. All content is synthetic.
await mkdir(root);
for (const count of [50, 500, 2000]) {
  const vault = path.join(root, `${count}-notes`); await mkdir(vault);
  for (let i = 0; i < count; i++) {
    const paragraphs = Array.from({ length: i % 10 === 0 ? 100 : 4 }, (_, paragraph) =>
      `Paragraph ${paragraph}: topic ${i % 12} connects example ${i} to concept ${paragraph}. Deterministic observations explain relationships, evidence, applications, and limitations.`,
    );
    await writeFile(path.join(vault, `note-${String(i).padStart(4, '0')}.md`), `# Topic ${i}\n\n${paragraphs.join('\n\n')}\n`);
  }
}
console.log(`Created synthetic 50/500/2000-note vaults at ${root}. No real vaults were read or changed.`);
