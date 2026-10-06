import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { CareerRolePage, Careers } from "./pages/Careers";
import { Docs } from "./pages/Docs";
import { Download } from "./pages/Download";
import { Home } from "./pages/Home";
import { Privacy, Terms } from "./pages/Legal";
import { NotFound } from "./pages/NotFound";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="careers" element={<Careers />} />
        <Route path="careers/:slug" element={<CareerRolePage />} />
        <Route path="download" element={<Download />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="terms" element={<Terms />} />
        <Route path="docs" element={<Navigate to="/docs/start" replace />} />
        <Route path="docs/:slug" element={<Docs />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
