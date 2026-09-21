const TOOLTIP_DELAY_MS = 400;
const VIEWPORT_MARGIN = 8;
const TOOLTIP_GAP = 8;

let tooltipEl: HTMLDivElement | null = null;
let activeTarget: Element | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;

type TooltipWindow = Window & {
  __openOnyxTooltipCleanup?: () => void;
  __openOnyxTooltipOriginalSetAttribute?: typeof Element.prototype.setAttribute;
  __openOnyxTooltipOriginalTitleDescriptor?: PropertyDescriptor;
};

function getTooltipText(target: Element): string {
  if (target instanceof HTMLElement) {
    return target.dataset.tooltip || target.getAttribute("title") || "";
  }
  return target.getAttribute("data-tooltip") || target.getAttribute("title") || "";
}

function getTooltipTarget(node: EventTarget | null): Element | null {
  return node instanceof Element
    ? node.closest("[data-tooltip], [title]")
    : null;
}

function suppressNativeTooltip(target: Element) {
  const title = target.getAttribute("title");
  if (!title) return;
  if (target instanceof HTMLElement) {
    target.dataset.tooltip = target.dataset.tooltip || title;
  } else {
    target.setAttribute("data-tooltip", target.getAttribute("data-tooltip") || title);
  }
  target.removeAttribute("title");
}

function suppressSvgTitle(target: SVGTitleElement) {
  const parent = target.parentElement as Element | null;
  const title = target.textContent?.trim();
  if (parent && title) {
    if (parent instanceof HTMLElement) {
      parent.dataset.tooltip = parent.dataset.tooltip || title;
    } else {
      parent.setAttribute("data-tooltip", parent.getAttribute("data-tooltip") || title);
    }
  }
  target.remove();
}

function suppressNativeTooltipsIn(element: Element) {
  suppressNativeTooltip(element);
  if (element instanceof SVGTitleElement) suppressSvgTitle(element);
  element.querySelectorAll("[title]").forEach(suppressNativeTooltip);
  element.querySelectorAll("svg title").forEach((node) => {
    if (node instanceof SVGTitleElement) suppressSvgTitle(node);
  });
}

function installNativeTooltipBlocker(tooltipWindow: TooltipWindow) {
  if (tooltipWindow.__openOnyxTooltipOriginalSetAttribute) return;

  const originalSetAttribute = Element.prototype.setAttribute;
  const originalTitleDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "title");

  tooltipWindow.__openOnyxTooltipOriginalSetAttribute = originalSetAttribute;
  tooltipWindow.__openOnyxTooltipOriginalTitleDescriptor = originalTitleDescriptor;

  Element.prototype.setAttribute = function setAttributeWithoutNativeTooltip(name: string, value: string) {
    if (name.toLowerCase() === "title") {
      const tooltip = String(value || "").trim();
      if (tooltip) {
        originalSetAttribute.call(this, "data-tooltip", tooltip);
      } else {
        this.removeAttribute("data-tooltip");
      }
      this.removeAttribute("title");
      return;
    }
    originalSetAttribute.call(this, name, value);
  };

  Object.defineProperty(HTMLElement.prototype, "title", {
    configurable: true,
    enumerable: originalTitleDescriptor?.enumerable ?? true,
    get() {
      return this.getAttribute("data-tooltip") || "";
    },
    set(value: string) {
      const tooltip = String(value || "").trim();
      if (tooltip) {
        originalSetAttribute.call(this, "data-tooltip", tooltip);
      } else {
        this.removeAttribute("data-tooltip");
      }
      this.removeAttribute("title");
    },
  });
}

function uninstallNativeTooltipBlocker(tooltipWindow: TooltipWindow) {
  if (tooltipWindow.__openOnyxTooltipOriginalSetAttribute) {
    Element.prototype.setAttribute = tooltipWindow.__openOnyxTooltipOriginalSetAttribute;
    delete tooltipWindow.__openOnyxTooltipOriginalSetAttribute;
  }

  if (tooltipWindow.__openOnyxTooltipOriginalTitleDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "title",
      tooltipWindow.__openOnyxTooltipOriginalTitleDescriptor,
    );
    delete tooltipWindow.__openOnyxTooltipOriginalTitleDescriptor;
  }
}

function removeLegacyTooltipElements() {
  document.querySelectorAll(".app-tooltip, .titlebar-tooltip").forEach((element) => {
    if (element.id !== "openonyx-tooltip") element.remove();
  });
}

function ensureTooltip(): HTMLDivElement {
  if (tooltipEl) return tooltipEl;
  const existing = document.getElementById("openonyx-tooltip");
  tooltipEl = existing instanceof HTMLDivElement ? existing : document.createElement("div");
  tooltipEl.id = "openonyx-tooltip";
  tooltipEl.className = "app-tooltip";
  tooltipEl.setAttribute("role", "tooltip");
  if (!tooltipEl.isConnected) document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function positionTooltip(target: Element, tooltip: HTMLDivElement) {
  const targetRect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const isTitlebarItem = Boolean(target.closest(".titlebar"));
  const isRibbonItem = Boolean(target.closest(".ribbon"));
  const isGraphRailItem = Boolean(target.closest(".graph-tools-rail"));
  type Placement = "right" | "left" | "top" | "bottom";
  const preferred = (target.getAttribute("data-tooltip-position") as Placement | undefined)
    || (isTitlebarItem ? "bottom" : isRibbonItem ? "right" : isGraphRailItem ? "left" : "bottom");
  const placementOrder: Record<Placement, Placement[]> = {
    bottom: ["bottom", "top", "right", "left"],
    top: ["top", "bottom", "right", "left"],
    right: ["right", "left", "bottom", "top"],
    left: ["left", "right", "bottom", "top"],
  };
  const coordinates = (placement: Placement) => {
    if (placement === "right") {
      return {
        left: targetRect.right + TOOLTIP_GAP,
        top: targetRect.top + targetRect.height / 2 - tooltipRect.height / 2,
      };
    }
    if (placement === "left") {
      return {
        left: targetRect.left - tooltipRect.width - TOOLTIP_GAP,
        top: targetRect.top + targetRect.height / 2 - tooltipRect.height / 2,
      };
    }
    return {
      left: targetRect.left + targetRect.width / 2 - tooltipRect.width / 2,
      top: placement === "bottom"
        ? targetRect.bottom + TOOLTIP_GAP
        : targetRect.top - tooltipRect.height - TOOLTIP_GAP,
    };
  };
  const fitsPlacement = (placement: Placement, { left, top }: { left: number; top: number }) => {
    if (placement === "bottom") {
      return top + tooltipRect.height <= window.innerHeight - VIEWPORT_MARGIN;
    }
    if (placement === "top") return top >= VIEWPORT_MARGIN;
    if (placement === "right") {
      return left + tooltipRect.width <= window.innerWidth - VIEWPORT_MARGIN;
    }
    return left >= VIEWPORT_MARGIN;
  };

  let placement = placementOrder[preferred][0];
  let { left, top } = coordinates(placement);
  for (const candidate of placementOrder[preferred]) {
    const candidateCoordinates = coordinates(candidate);
    if (!fitsPlacement(candidate, candidateCoordinates)) continue;
    placement = candidate;
    ({ left, top } = candidateCoordinates);
    break;
  }

  left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(left, window.innerWidth - tooltipRect.width - VIEWPORT_MARGIN),
  );
  top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(top, window.innerHeight - tooltipRect.height - VIEWPORT_MARGIN),
  );

  tooltip.dataset.placement = placement;
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function hideTooltip() {
  if (showTimer) clearTimeout(showTimer);
  showTimer = null;
  activeTarget = null;
  tooltipEl?.classList.remove("is-visible");
}

function queueTooltip(target: Element) {
  suppressNativeTooltip(target);
  const text = getTooltipText(target).trim();
  if (!text) return;

  if (showTimer) clearTimeout(showTimer);
  activeTarget = target;
  showTimer = setTimeout(() => {
    if (activeTarget !== target || !target.isConnected) return;
    const tooltip = ensureTooltip();
    tooltip.textContent = text;
    tooltip.classList.add("is-visible");
    positionTooltip(target, tooltip);
  }, TOOLTIP_DELAY_MS);
}

export function installGlobalTooltips(): () => void {
  const tooltipWindow = window as TooltipWindow;
  tooltipWindow.__openOnyxTooltipCleanup?.();
  installNativeTooltipBlocker(tooltipWindow);
  document.querySelectorAll(".app-tooltip, .titlebar-tooltip").forEach((element) => element.remove());
  tooltipEl = null;

  const migrateNativeTooltip = (element: Element) => {
    suppressNativeTooltipsIn(element);
  };
  migrateNativeTooltip(document.body);
  const titleObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        suppressNativeTooltip(mutation.target as Element);
        continue;
      }
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) migrateNativeTooltip(node);
      });
    }
  });
  titleObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["title"],
  });

  const onPointerOver = (event: PointerEvent) => {
    removeLegacyTooltipElements();
    const target = getTooltipTarget(event.target);
    if (target) suppressNativeTooltipsIn(target);
    if (!target || target === activeTarget) return;
    queueTooltip(target);
  };
  const onPointerMove = (event: PointerEvent) => {
    removeLegacyTooltipElements();
    const target = getTooltipTarget(event.target);
    if (target) suppressNativeTooltipsIn(target);
  };
  const onPointerOut = (event: PointerEvent) => {
    if (!activeTarget) return;
    const nextTarget = getTooltipTarget(event.relatedTarget);
    if (nextTarget === activeTarget) return;
    hideTooltip();
  };
  const onFocusIn = (event: FocusEvent) => {
    const target = getTooltipTarget(event.target);
    if (target) {
      suppressNativeTooltipsIn(target);
      queueTooltip(target);
    }
  };
  const onFocusOut = () => hideTooltip();
  const onViewportChange = () => {
    if (activeTarget && tooltipEl?.classList.contains("is-visible")) {
      positionTooltip(activeTarget, tooltipEl);
    }
  };

  document.addEventListener("pointerover", onPointerOver, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerout", onPointerOut, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);

  const cleanup = () => {
    hideTooltip();
    titleObserver.disconnect();
    document.removeEventListener("pointerover", onPointerOver, true);
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerout", onPointerOut, true);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onViewportChange, true);
    tooltipEl?.remove();
    tooltipEl = null;
    uninstallNativeTooltipBlocker(tooltipWindow);
    if (tooltipWindow.__openOnyxTooltipCleanup === cleanup) {
      delete tooltipWindow.__openOnyxTooltipCleanup;
    }
  };
  tooltipWindow.__openOnyxTooltipCleanup = cleanup;
  return cleanup;
}
