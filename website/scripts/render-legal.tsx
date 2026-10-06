import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Layout } from "../src/components/Layout";
import { LEGAL_POLICIES, type LegalPolicy } from "../src/data/legal";
import { LegalDocument } from "../src/pages/Legal";
import { ThemeProvider } from "../src/theme";

export function renderLegal(policy: LegalPolicy) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[policy.path]}>
      <ThemeProvider>
        <Routes><Route element={<Layout />}><Route path={policy.path} element={<LegalDocument policy={policy} />} /></Route></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

export { LEGAL_POLICIES };
