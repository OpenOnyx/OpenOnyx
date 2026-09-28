/** The website and desktop manual read the same Markdown files. */
const sources = import.meta.glob('../../../docs/manual/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const downloads = import.meta.glob('../../../docs/manual/*.md', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const entries = [
  ['start', 'README', 'Getting started'],
  ['install', 'Installation', 'Getting started'],
  ['vault', 'Open a Vault', 'Getting started'],
  ['import-export', 'Import and Export', 'Getting started'],
  ['obsidian', 'Obsidian Compatibility', 'Getting started'],
  ['workspace', 'Workspace', 'Workspace'],
  ['file-explorer', 'File Explorer', 'Workspace'],
  ['tabs-panes', 'Tabs and Panes', 'Workspace'],
  ['right-sidebar', 'Right Sidebar', 'Workspace'],
  ['status-bar', 'Status Bar', 'Workspace'],
  ['settings', 'Settings', 'Workspace'],
  ['write', 'Writing Notes', 'Daily workflow'],
  ['editor', 'Editor', 'Daily workflow'],
  ['editor-toolbar', 'Editor Toolbar', 'Daily workflow'],
  ['search-replace', 'Search and Replace', 'Daily workflow'],
  ['markdown', 'Markdown', 'Daily workflow'],
  ['callouts', 'Callouts', 'Daily workflow'],
  ['tables', 'Tables', 'Daily workflow'],
  ['attachments-embeds', 'Attachments and Embeds', 'Daily workflow'],
  ['links-backlinks', 'Links and Backlinks', 'Navigation'],
  ['outgoing-links', 'Outgoing Links', 'Navigation'],
  ['outline', 'Outline', 'Navigation'],
  ['find', 'Search', 'Daily workflow'],
  ['quick-switcher', 'Quick Switcher', 'Navigation'],
  ['command-palette', 'Command Palette', 'Navigation'],
  ['bookmarks', 'Bookmarks', 'Navigation'],
  ['graph', 'Knowledge Graph', 'Daily workflow'],
  ['canvas', 'Canvas', 'Daily workflow'],
  ['tags', 'Tags', 'Organization'],
  ['properties', 'Properties', 'Organization'],
  ['rename-move', 'Rename and Move Notes', 'Organization'],
  ['vault-intelligence', 'Vault Intelligence', 'Thinking layer'],
  ['ai-writing', 'AI Writing Tools', 'Thinking layer'],
  ['ai-graph', 'AI Graph', 'Thinking layer'],
  ['spaces', 'Spaces', 'Thinking layer'],
  ['plugins', 'Plugins', 'Your workspace'],
  ['plugin-permissions', 'Plugin Permissions', 'Your workspace'],
  ['themes', 'Themes', 'Your workspace'],
  ['wallpaper', 'Wallpaper', 'Your workspace'],
  ['sync', 'Sync', 'Sync & privacy'],
  ['privacy', 'Privacy', 'Sync & privacy'],
  ['shortcuts', 'Keyboard Shortcuts', 'Reference'],
  ['develop', 'Developer Guide', 'Reference'],
  ['reference', 'Reference', 'Reference'],
  ['troubleshooting', 'Troubleshooting', 'Reference'],
  ['faq', 'FAQ', 'Reference'],
] as const;

export const DOC_PAGES = entries.map(([slug, name, group]) => {
  const sourcePath = `../../../docs/manual/${name}.md`;
  const markdown = sources[sourcePath];
  if (!markdown) throw new Error(`Missing manual page: ${name}`);
  return {
    slug, group, markdown, filename: `${name}.md`,
    title: slug === 'start' ? 'Getting started' : name,
    summary: markdown.split('\n\n')[1] ?? '',
    sourceUrl: downloads[sourcePath],
  };
});
export type DocPage = typeof DOC_PAGES[number];
export const DOC_GROUPS = [...new Set(DOC_PAGES.map(page => page.group))];
export function docBySlug(slug: string) { return DOC_PAGES.find(page => page.slug === slug) ?? DOC_PAGES[0]; }
export function neighbors(slug: string) {
  const index = DOC_PAGES.findIndex(page => page.slug === slug);
  return { prev: DOC_PAGES[index - 1] ?? null, next: DOC_PAGES[index + 1] ?? null };
}
