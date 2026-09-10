// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getCurrentUser,
  formatRelativeTime,
  addComment,
  loadComments,
  deleteComment,
  resolveComment,
  addReply,
  getCommentsSync,
  saveComments,
} from "../src/utils/commentsStore";
import { EditorState } from "@codemirror/state";
import {
  commentExtension,
  setCommentsEffect,
  setPendingCommentEffect,
  commentStateField,
} from "../src/components/editor/commentExtension";

// Mock disk-store so tests don't touch real files
vi.mock("../src/utils/disk-store", () => {
  const store = new Map<string, string>();
  return {
    readData: vi.fn(async (key: string) => {
      const val = store.get(key);
      return val ? JSON.parse(val) : null;
    }),
    writeData: vi.fn(async (key: string, data: any) => {
      store.set(key, JSON.stringify(data));
    }),
  };
});

describe("Comments System", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("User and Relative Time Helpers", () => {
    it("returns default Varshith Programmer when no auth or custom user", () => {
      const user = getCurrentUser();
      expect(user.name).toBe("Varshith Programmer");
      expect(user.avatar).toBe("/default-avatar.png");
    });

    it("respects custom user name in localStorage", () => {
      localStorage.setItem("openonyx:user_name", "Test User");
      const user = getCurrentUser();
      expect(user.name).toBe("Test User");
    });

    it("formats relative timestamps correctly", () => {
      const now = Date.now();
      expect(formatRelativeTime(now)).toBe("Just now");
      expect(formatRelativeTime(now - 1000 * 60 * 14)).toBe("14m");
      expect(formatRelativeTime(now - 1000 * 60 * 60 * 2)).toBe("2h");
      expect(formatRelativeTime(now - 1000 * 60 * 60 * 24 * 3)).toBe("3d");
    });
  });

  describe("Comments Store CRUD", () => {
    const notePath = "test/note.md";

    it("adds and retrieves comments", async () => {
      await saveComments(notePath, []);

      const comment = await addComment(notePath, {
        from: 0,
        to: 10,
        selectedText: "Intentions",
        content: "WAssup bitch",
      });

      expect(comment.id).toBeDefined();
      expect(comment.selectedText).toBe("Intentions");
      expect(comment.content).toBe("WAssup bitch");
      expect(comment.author.name).toBe("Varshith Programmer");

      const list = await loadComments(notePath);
      expect(list.length).toBe(1);
      expect(list[0].id).toBe(comment.id);

      const syncList = getCommentsSync(notePath);
      expect(syncList.length).toBe(1);
    });

    it("resolves and deletes comments", async () => {
      const comment = await addComment(notePath, {
        from: 12,
        to: 22,
        selectedText: "Happenings",
        content: "0",
      });

      await resolveComment(notePath, comment.id);
      let list = await loadComments(notePath);
      expect(list.find((c) => c.id === comment.id)?.resolved).toBe(true);

      await deleteComment(notePath, comment.id);
      list = await loadComments(notePath);
      expect(list.find((c) => c.id === comment.id)).toBeUndefined();
    });

    it("supports replies", async () => {
      const comment = await addComment(notePath, {
        from: 0,
        to: 10,
        selectedText: "Intentions",
        content: "Main comment",
      });

      const updated = await addReply(notePath, comment.id, "Reply text");
      expect(updated).not.toBeNull();
      expect(updated?.replies?.length).toBe(1);
      expect(updated?.replies?.[0].content).toBe("Reply text");
    });
  });

  describe("CodeMirror Comment Extension", () => {
    it("sets decorations for comments and updates on document edits", () => {
      const doc = "Intentions\n1. List\nHappenings\n• List";
      const state = EditorState.create({
        doc,
        extensions: [commentExtension()],
      });

      // Dispatch comment effect
      const commentId = "c1";
      const tr = state.update({
        effects: setCommentsEffect.of([
          {
            id: commentId,
            notePath: "note.md",
            from: 0,
            to: 10,
            selectedText: "Intentions",
            content: "WAssup bitch",
            author: { name: "Varshith Programmer" },
            createdAt: Date.now(),
          },
        ]),
      });

      const fieldVal = tr.state.field(commentStateField);
      expect(fieldVal.comments.length).toBe(1);
      expect(fieldVal.decorations.size).toBe(1);

      // Insert 5 characters at the very beginning of the document
      const editTr = tr.state.update({
        changes: { from: 0, insert: "NOTE " },
      });

      const updatedField = editTr.state.field(commentStateField);
      // Comment range should have shifted from [0, 10] to [5, 15]
      expect(updatedField.comments[0].from).toBe(5);
      expect(updatedField.comments[0].to).toBe(15);
      expect(updatedField.decorations.size).toBe(1);
    });

    it("renders pending comment decoration", () => {
      const doc = "Intentions\n1. List";
      const state = EditorState.create({
        doc,
        extensions: [commentExtension()],
      });

      const tr = state.update({
        effects: setPendingCommentEffect.of({ from: 0, to: 10 }),
      });

      const fieldVal = tr.state.field(commentStateField);
      expect(fieldVal.pending).toEqual({ from: 0, to: 10 });
      expect(fieldVal.decorations.size).toBe(1);
    });
  });

  describe("Right Click Context Menu for Comments", () => {
    it("renders context menu with Add Comment option at high z-index", async () => {
      const { Menu } = await import("../src/lib/obsidian-api/components");
      const menu = new Menu();
      let commentClicked = false;

      menu.addItem((item) =>
        item
          .setTitle("Add Comment")
          .setIcon("message-square")
          .onClick(() => {
            commentClicked = true;
          })
      );
      menu.addSeparator();

      // Show at mouse event
      const fakeEvt = new MouseEvent("contextmenu", {
        clientX: 120,
        clientY: 240,
      });
      menu.showAtMouseEvent(fakeEvt);

      // Verify DOM
      const menuDom = document.querySelector(".oo-plugin-menu") as HTMLElement;
      expect(menuDom).not.toBeNull();
      expect(menuDom.style.zIndex).toBe("99999");
      expect(menuDom.style.position).toBe("fixed");

      const titleEl = menuDom.querySelector(".menu-item-title");
      expect(titleEl?.textContent).toBe("Add Comment");

      const iconEl = menuDom.querySelector(".menu-item-icon");
      expect(iconEl).not.toBeNull();

      // Trigger click on the Add Comment item
      const itemEl = menuDom.querySelector(".menu-item") as HTMLElement;
      itemEl.click();
      expect(commentClicked).toBe(true);

      // Menu should be dismissed
      expect(document.querySelector(".oo-plugin-menu")).toBeNull();
    });

    it("maps comment icon alias properly in obsidian API utils", async () => {
      const { setIcon } = await import("../src/lib/obsidian-api/utils");
      const container = document.createElement("div");
      setIcon(container, "comment");

      expect(container.getAttribute("data-icon")).toBe("comment");
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("data-icon-name")).toBe("comment");
      expect(svg?.innerHTML).toContain("path");
    });
  });

  describe("Comment UI Components", () => {
    it("renders CommentBadge with count and icon for compact mode", async () => {
      const React = await import("react");
      const ReactDOMServer = await import("react-dom/server");
      const { CommentBadge } = await import("../src/components/editor/CommentComponents");

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(CommentBadge, {
          count: 3,
          onClick: () => {},
        })
      );

      expect(html).toContain("3");
      expect(html).toContain("cm-comment-badge");
      expect(html).toContain("svg");
    });

    it("renders CommentCard with ONLY delete action and NO check/resolve tick mark", async () => {
      const React = await import("react");
      const ReactDOMServer = await import("react-dom/server");
      const { CommentCard } = await import("../src/components/editor/CommentComponents");

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(CommentCard, {
          comment: {
            id: "c-test",
            notePath: "note.md",
            from: 10,
            to: 20,
            selectedText: "power.",
            content: "Test comment text",
            author: { name: "Varshith Programmer" },
            createdAt: Date.now(),
          },
          onDelete: () => {},
        })
      );

      expect(html).toContain("Test comment text");
      expect(html).toContain("Varshith Programmer");
      expect(html).toContain('title="Delete comment"');
      // Must NOT contain resolve or check mark
      expect(html).not.toContain('title="Resolve comment"');
      // Must NOT contain ml-[32px]
      expect(html).not.toContain("ml-[32px]");
    });
  });
});

