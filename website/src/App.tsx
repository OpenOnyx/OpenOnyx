import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Docs } from "./pages/Docs";
import { Download } from "./pages/Download";
import { Home } from "./pages/Home";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="download" element={<Download />} />
        <Route path="docs" element={<Navigate to="/docs/start" replace />} />
        <Route path="docs/:slug" element={<Docs />} />
      </Route>
    </Routes>
  );
}
