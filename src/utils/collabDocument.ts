import * as Y from 'yjs';

export interface DocumentVersionMeta {
  version: number;
  last_modified: string;
  client_id: string | null;
  content_hash: string;
}

export const EMPTY_DOCUMENT_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export async function sha256Hex(content: string): Promise<string> {
  const encoded = new TextEncoder().encode(content);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  // Fallback for non-browser test environments. Runtime collaboration uses
  // WebCrypto SHA-256 in the Electron renderer.
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function normalizeVersion(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function isVersionNewer(incomingVersion: unknown, currentVersion: unknown): boolean {
  return normalizeVersion(incomingVersion) > normalizeVersion(currentVersion);
}

/**
 * Serialize a Y.Doc into canvas JSON or markdown text based on document type.
 */
export function getYDocContent(doc: Y.Doc, isCanvas: boolean): string {
  if (isCanvas) {
    const nodesMap = doc.getMap('nodes');
    const edgesMap = doc.getMap('edges');
    const scribblesMap = doc.getMap('scribbles');
    const metadataMap = doc.getMap('metadata');

    const nodes: any[] = [];
    for (const nodeId of nodesMap.keys()) {
      const nodeMap = nodesMap.get(nodeId);
      if (nodeMap instanceof Y.Map) {
        nodes.push(nodeMap.toJSON());
      }
    }

    const edges: any[] = [];
    for (const edgeId of edgesMap.keys()) {
      const edgeMap = edgesMap.get(edgeId);
      if (edgeMap instanceof Y.Map) {
        edges.push(edgeMap.toJSON());
      }
    }

    const scribbles: any[] = [];
    for (const scribbleId of scribblesMap.keys()) {
      const scribbleMap = scribblesMap.get(scribbleId);
      if (scribbleMap instanceof Y.Map) {
        scribbles.push(scribbleMap.toJSON());
      }
    }

    const metadata = metadataMap.toJSON();
    const canvasObj: any = {
      nodes,
      edges,
      scribbles,
    };
    Object.assign(canvasObj, metadata);
    return JSON.stringify(canvasObj, null, 2);
  } else {
    return doc.getText('content').toString();
  }
}

/**
 * Hydrate Y.Doc shared maps from raw canvas JSON content.
 */
export function populateYDocFromCanvasJSON(doc: Y.Doc, jsonStr: string): void {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[YJS] Failed to parse canvas JSON for Y.Doc population:', err);
    return;
  }

  doc.transact(() => {
    // 1. Populate nodes Map
    const nodesMap = doc.getMap('nodes');
    nodesMap.clear();
    if (Array.isArray(parsed.nodes)) {
      for (const node of parsed.nodes) {
        if (node && node.id) {
          const nodeMap = new Y.Map();
          for (const [key, value] of Object.entries(node)) {
            nodeMap.set(key, value);
          }
          nodesMap.set(node.id, nodeMap);
        }
      }
    }

    // 2. Populate edges Map
    const edgesMap = doc.getMap('edges');
    edgesMap.clear();
    if (Array.isArray(parsed.edges)) {
      for (const edge of parsed.edges) {
        if (edge && edge.id) {
          const edgeMap = new Y.Map();
          for (const [key, value] of Object.entries(edge)) {
            edgeMap.set(key, value);
          }
          edgesMap.set(edge.id, edgeMap);
        }
      }
    }

    // 3. Populate scribbles Map
    const scribblesMap = doc.getMap('scribbles');
    scribblesMap.clear();

    const rawScribbles =
      parsed.openonyxScribblesV1 ??
      parsed.openobsidianScribblesV1 ??
      parsed.scribbles ??
      parsed.noteworkScribblesV1;

    if (Array.isArray(rawScribbles)) {
      for (const stroke of rawScribbles) {
        if (stroke && stroke.id) {
          const strokeMap = new Y.Map();
          for (const [key, value] of Object.entries(stroke)) {
            if (key === 'points' && Array.isArray(value)) {
              const pointsArr = new Y.Array();
              pointsArr.push(value);
              strokeMap.set(key, pointsArr);
            } else {
              strokeMap.set(key, value);
            }
          }
          scribblesMap.set(stroke.id, strokeMap);
        }
      }
    }

    // 4. Populate metadata Map
    const metadataMap = doc.getMap('metadata');
    metadataMap.clear();
    for (const [key, value] of Object.entries(parsed)) {
      if (
        key !== 'nodes' &&
        key !== 'edges' &&
        key !== 'scribbles' &&
        key !== 'openonyxScribblesV1' &&
        key !== 'openobsidianScribblesV1' &&
        key !== 'noteworkScribblesV1' &&
        key !== 'openonyxCanvasViewportV1'
      ) {
        metadataMap.set(key, value);
      }
    }
  }, 'init');
}
