import React, { useEffect, useRef } from 'react';
import { getAPI } from '../../utils/api';
import { createPdfViewer } from './PdfViewer';

/** Local vault PDFs use the same canvas reader as external PDF resources. */
export function PdfDocumentView({ path, title, onFocus }: { path: string; title: string; onFocus?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewer = createPdfViewer({ title, mode: 'full', load: () => getAPI().readBinary(path) });
    viewer.classList.add('pdf-viewer-document');
    host.current?.append(viewer);
    return () => viewer.remove();
  }, [path, title]);
  return <section className="pdf-document-view" onPointerDown={onFocus} onFocus={onFocus} aria-label={title}>
    <h2>{title}</h2>
    <div className="pdf-document-host" ref={host} />
  </section>;
}
