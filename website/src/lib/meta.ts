import { useEffect } from "react";
import { PRODUCT } from "../data/facts";

export function usePageMeta(title: string, description: string = PRODUCT.description) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    const set = (selector: string, value: string) => {
      const node = document.querySelector(selector);
      if (node) node.setAttribute("content", value);
    };

    const previousDescription = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
    const previousOgTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "";
    const previousOgDescription =
      document.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? "";
    const previousTwitterTitle = document.querySelector('meta[name="twitter:title"]')?.getAttribute("content") ?? "";
    const previousTwitterDescription =
      document.querySelector('meta[name="twitter:description"]')?.getAttribute("content") ?? "";

    set('meta[name="description"]', description);
    set('meta[property="og:title"]', title);
    set('meta[property="og:description"]', description);
    set('meta[name="twitter:title"]', title);
    set('meta[name="twitter:description"]', description);

    return () => {
      document.title = previousTitle;
      set('meta[name="description"]', previousDescription);
      set('meta[property="og:title"]', previousOgTitle);
      set('meta[property="og:description"]', previousOgDescription);
      set('meta[name="twitter:title"]', previousTwitterTitle);
      set('meta[name="twitter:description"]', previousTwitterDescription);
    };
  }, [title, description]);
}
