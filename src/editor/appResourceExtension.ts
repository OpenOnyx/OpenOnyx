import { StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { CompletionSource } from "@codemirror/autocomplete";
import type { ExternalResource } from "../types/appResources";
import { resourceBlocks, serializeExternalResource } from "../utils/appResources";
import { createResourceCard, openResource } from "../components/apps/ResourceCard";
const resourceSizes = new WeakMap<HTMLElement, ResizeObserver>();

class ResourceWidget extends WidgetType {
  constructor(readonly resource: ExternalResource, readonly source: string, readonly getDocumentId: () => string) { super(); }
  eq(other: ResourceWidget): boolean { return this.source === other.source; }
  toDOM(view: EditorView): HTMLElement {
    const documentId = this.getDocumentId();
    const replace = (resource?: ExternalResource) => {
      if (!view.dom.isConnected || this.getDocumentId() !== documentId) return;
      const blocks = resourceBlocks(view.state.doc.toString()).filter((block) => view.state.doc.sliceString(block.from, block.to) === this.source);
      if (blocks.length !== 1) return;
      const block = blocks[0];
      view.dispatch({ changes: { from: block.from, to: block.to, insert: resource ? serializeExternalResource(resource) : "" } });
    };
    const card = createResourceCard(this.resource, () => openResource(this.resource, replace), { update: replace, remove: () => replace() });
    if (typeof ResizeObserver !== "undefined") {
      const size = new ResizeObserver(() => view.requestMeasure());
      size.observe(card); resourceSizes.set(card, size);
    }
    return card;
  }
  destroy(dom: HTMLElement): void { resourceSizes.get(dom)?.disconnect(); resourceSizes.delete(dom); }
  ignoreEvent(): boolean { return true; }
}

export function appResourceExtension(getDocumentId: () => string = () => ""): Extension {
  const build = (state: EditorView["state"]) => Decoration.set(resourceBlocks(state.doc.toString()).map((block) =>
    Decoration.replace({ widget: new ResourceWidget(block.resource, state.doc.sliceString(block.from, block.to), getDocumentId), block: true }).range(block.from, block.to)), true);
  return StateField.define<DecorationSet>({
    create: build,
    update: (decorations, transaction) => transaction.docChanged ? build(transaction.state) : decorations,
    provide: (field) => EditorView.decorations.from(field),
  });
}

export interface ResourceSlashApp { id: string; name: string; serverId?: string }

export function resourceSlashCompletion(open: (app: ResourceSlashApp, view: EditorView, from: number, to: number) => void, connectedApps: () => ResourceSlashApp[]): CompletionSource {
  return (context) => {
    const apps = connectedApps();
    if (!apps.length) return null;
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    if (!/^\s*\/[\w ]*$/.test(before)) return null;
    const node = syntaxTree(context.state).resolveInner(context.pos, -1);
    for (let current = node; current; current = current.parent!) {
      if (["FencedCode", "CodeBlock", "InlineCode"].includes(current.name)) return null;
    }
    const from = line.from + before.indexOf("/");
    return {
      from, options: apps.filter((app) => app.name.toLowerCase().includes(before.slice(before.indexOf("/") + 1).toLowerCase())).map((app) => ({
        label: app.name, detail: "Insert a resource", section: "Apps", type: "text",
        apply: (view, _completion, _from, to) => open(app, view, from, to),
      })), filter: false, validFor: /^\/[\w ]*$/,
    };
  };
}

// Compatibility for existing completion consumers.
export function appSlashCompletion(openGithub: (view: EditorView, from: number, to: number) => void, connected: () => boolean): CompletionSource {
  return resourceSlashCompletion((_app, view, from, to) => openGithub(view, from, to), () => connected() ? [{ id: "github", name: "GitHub" }] : []);
}
