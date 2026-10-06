import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, useParams } from "react-router-dom";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import { App } from "../src/App";
import { Docs } from "../src/pages/Docs";
import { DOC_PAGES, docBySlug } from "../src/data/docs";
import { PUBLIC_PAGES, structuredData } from "../src/data/seo";
import { renderManual } from "../src/lib/manual";
import { ThemeProvider } from "../src/theme";

// Build-time DOM only, not a browser/UI test. Keep the same sanitizer as the client.
const dom = new JSDOM("");
const sanitize = createDOMPurify(dom.window);

function StaticDocs() {
  const { slug = "start" } = useParams();
  const page = docBySlug(slug);
  return <Docs serverHtml={sanitize.sanitize(renderManual(page.markdown).html)} serverSourceUrl={`/manual/${encodeURIComponent(page.filename)}`} />;
}

export function renderPublic(path: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}><ThemeProvider><App docsElement={<StaticDocs />} /></ThemeProvider></MemoryRouter>,
  );
}

export function closeRenderer() { dom.window.close(); }
export { PUBLIC_PAGES, DOC_PAGES, structuredData };
