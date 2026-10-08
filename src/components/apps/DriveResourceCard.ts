import { createElement, FileText, File, Sheet, Presentation, Folder, Maximize2 } from 'lucide';
import type { DriveResource } from '../../types/appResources';
import { driveResourceTypeName } from '../../utils/googleDriveProvider';
import { getAPI } from '../../utils/api';
import { attachResourceActions, resourceFreshness, openResource, type ResourceCardActions } from './ResourceCard';
import { resourceViewState } from '../documents/ResourceViewState';
import { createDriveFilePreview } from './DriveFilePreview';

const node = (tag: string, className: string, text = '') => { const element = document.createElement(tag); element.className = className; element.textContent = text; return element; };
export function createDriveResourceCard(resource: DriveResource, open: () => void, actions: ResourceCardActions): HTMLElement {
  const typeName = driveResourceTypeName(resource);
  const explorer = ['PowerPoint', 'Google Slides', 'Excel', 'Google Sheets'].includes(typeName);
  const compact = explorer && (resource.display === 'compact' || resource.display === 'link');
  const state = resourceViewState(`${resource.appId}:${resource.serverId}:${resource.externalId}`);
  const card = node('div', `app-resource-card app-resource-drive${resource.display === 'reference' || compact ? ' app-resource-reference' : ''}`);
  card.tabIndex = 0; card.setAttribute('role', 'group'); card.setAttribute('aria-label', `Google Drive ${driveResourceTypeName(resource)}: ${resource.title}`);
  const identity = node('div', 'app-resource-identity', `Google Drive · ${driveResourceTypeName(resource)}`);
  identity.prepend(createElement(['Word', 'Google Docs'].includes(typeName) ? FileText : ['Excel', 'Google Sheets'].includes(typeName) ? Sheet : ['PowerPoint', 'Google Slides'].includes(typeName) ? Presentation : resource.resourceType === 'folder' ? Folder : File, { width: 14, height: 14, 'aria-hidden': 'true' }));
  const title = node('div', 'app-resource-title', resource.title);
  let preview: HTMLElement | undefined;
  if (resource.display === 'reference' || compact) {
    const content = node('div', 'app-resource-reference-content');
    content.append(title, identity);
    if (state.count) identity.append(document.createTextNode(` · ${state.count} ${['PowerPoint', 'Google Slides'].includes(typeName) ? 'slides' : 'sheets'}`));
    const show = node('button', 'app-resource-compact-open', resource.display === 'link' ? 'Open ↗' : 'Preview') as HTMLButtonElement;
    show.type = 'button'; show.onclick = () => resource.display === 'link' ? void getAPI().openExternal(resource.url) : actions.update ? actions.update({ ...resource, display: 'embed' }) : open();
    card.append(content, show);
  }
  else {
    const header = node('div', 'app-resource-header');
    const external = node('button', 'app-resource-open-original', 'Open ↗') as HTMLButtonElement; external.type = 'button'; external.setAttribute('aria-label', 'Open in Google Drive'); external.onclick = () => { void getAPI().openExternal(resource.url); };
    const expand = node('button', 'app-resource-expand') as HTMLButtonElement; expand.type = 'button'; expand.setAttribute('aria-label', 'Expand document');
    expand.append(createElement(Maximize2, { width: 16, height: 16, 'aria-hidden': 'true' })); expand.onclick = open;
    const show = node('button', 'app-resource-show', 'Preview') as HTMLButtonElement; show.type = 'button'; show.hidden = true;
    show.onclick = () => { preview?.dispatchEvent(new Event('file-preview:show')); show.hidden = true; };
    header.append(identity, show, external, expand); card.append(header, title);
    if (explorer) {
      const metadata = node('div', 'app-resource-meta'); card.append(metadata);
      const updateCount = () => { metadata.textContent = state.count ? `${state.count} ${['PowerPoint', 'Google Slides'].includes(typeName) ? 'slides' : 'sheets'}` : ''; };
      card.addEventListener('resource-preview:metadata', updateCount); updateCount();
    }
    if (resource.resourceType !== 'folder') { preview = createDriveFilePreview(resource); card.append(preview); }
    const footer = node('div', 'app-resource-footer');
    if (resource.size !== undefined) footer.append(node('span', '', resource.size >= 1048576 ? `${(resource.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(resource.size / 1024))} KB`));
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    footer.append(node('span', 'app-resource-freshness', offline ? resourceFreshness(resource.cachedAt).replace('Updated', 'Saved') : resourceFreshness(resource.updatedAt).replace('Updated', 'Modified')));
    card.append(footer);
  }
  attachResourceActions(card, resource, open, actions, 'Open in Google Drive', preview ? {
    refresh: () => preview!.dispatchEvent(new Event('file-preview:refresh')),
    collapse: () => { preview!.dispatchEvent(new Event('file-preview:collapse')); card.querySelector<HTMLButtonElement>('.app-resource-show')!.hidden = false; },
  } : undefined);
  if (explorer) {
    const menu = card.querySelector<HTMLDetailsElement>('.app-resource-menu')!;
    const options = menu.querySelector<HTMLElement>('.app-resource-menu-options')!; options.replaceChildren();
    const action = (label: string, callback: () => void, checked = false) => {
      const button = node('button', '', `${label}${checked ? ' ✓' : ''}`) as HTMLButtonElement; button.type = 'button';
      button.onclick = event => { event.stopPropagation(); menu.open = false; callback(); }; options.append(button);
    };
    if (actions.update) {
      options.append(node('div', 'app-resource-menu-label', 'Display as'));
      action('Preview', () => actions.update!({ ...resource, display: 'embed' }), !compact && resource.display !== 'reference');
      action('Compact', () => actions.update!({ ...resource, display: 'compact' }), resource.display === 'compact' || resource.display === 'reference');
      action('Link', () => actions.update!({ ...resource, display: 'link' }), resource.display === 'link');
    }
    action('Refresh', () => preview ? preview.dispatchEvent(new Event('file-preview:refresh')) : openResource(resource, actions.update, true));
    action('Open in Google Drive', () => { void getAPI().openExternal(resource.url); });
    if (actions.remove) action('Remove from note', actions.remove);
    card.classList.add('app-resource-explorer');
  }
  return card;
}
