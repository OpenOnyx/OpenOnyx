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

    it("renders CommentCard with pasted image and reply with image", async () => {
      const React = await import("react");
      const ReactDOMServer = await import("react-dom/server");
      const { CommentCard, getCommentImage, getReplyImage } = await import(
        "../src/components/editor/CommentComponents"
      );

      const testImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const testReplyImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

      const parsed = getCommentImage({
        id: "c-img",
        notePath: "note.md",
        from: 0,
        to: 3,
        selectedText: "img",
        content: "Check this diagram",
        image: testImage,
        author: { name: "Varshith Programmer" },
        createdAt: Date.now(),
      });
      expect(parsed.image).toBe(testImage);
      expect(parsed.text).toBe("Check this diagram");

      const parsedReply = getReplyImage({
        id: "r-img",
        author: { name: "Varshith Programmer" },
        content: "Here is the chromosome",
        image: testReplyImage,
        createdAt: Date.now(),
      });
      expect(parsedReply.image).toBe(testReplyImage);

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(CommentCard, {
          comment: {
            id: "c-img-card",
            notePath: "note.md",
            from: 0,
            to: 3,
            selectedText: "img",
            content: "Check this diagram",
            image: testImage,
            author: { name: "Varshith Programmer" },
            createdAt: Date.now(),
            replies: [
              {
                id: "rep-1",
                author: { name: "Varshith Programmer" },
                content: "Chromosome detail",
                image: testReplyImage,
                createdAt: Date.now(),
              },
            ],
          },
          onDelete: () => {},
        })
      );

      expect(html).toContain('alt="Comment attachment"');
      expect(html).toContain(testImage);
      expect(html).toContain('alt="Reply attachment"');
      expect(html).toContain(testReplyImage);
    });

    it("saves and loads comments with images in store", async () => {
      const testImage = "data:image/png;base64,test-image-data";
      const testNote = "test/image-note.md";
      await saveComments(testNote, []);

      const comment = await addComment(testNote, {
        from: 5,
        to: 8,
        selectedText: "img",
        content: "Diagram note",
        image: testImage,
      });

      expect(comment.image).toBe(testImage);

      const list = await loadComments(testNote);
      expect(list.length).toBe(1);
      expect(list[0].image).toBe(testImage);

      const updated = await addReply(testNote, comment.id, "Reply with image", testImage);
      expect(updated?.replies?.[0].image).toBe(testImage);
    });
  });

  describe("Table Comments Alignment", () => {
    it("EditorCommentsLayer positions pending comment using targetTop", async () => {
      const React = await import("react");
      const ReactDOM = await import("react-dom/client");
      const { EditorCommentsLayer } = await import("../src/components/editor/EditorCommentsLayer");

      const container = document.createElement("div");
      document.body.appendChild(container);

      const scrollEl = document.createElement("div");
      scrollEl.style.height = "500px";
      container.appendChild(scrollEl);

      const pendingComment = {
        id: "pending",
        from: 45,
        to: 55,
        selectedText: "TableCellWord",
        targetTop: 185,
      };

      const root = ReactDOM.createRoot(container);
      await React.act(async () => {
        root.render(
          React.createElement(EditorCommentsLayer, {
            containerEl: scrollEl,
            comments: [],
            pendingComment,
            onSaveComment: () => {},
            onCancelPending: () => {},
            onSelectComment: () => {},
            onDeleteComment: () => {},
            onResolveComment: () => {},
            onReplyComment: () => {},
          })
        );
      });

      const layer = scrollEl.querySelector(".cm-comments-layer");
      expect(layer).not.toBeNull();
      const inputWrapper = scrollEl.querySelector(".cm-comment-input-box")?.parentElement;
      expect(inputWrapper).not.toBeNull();
      expect(inputWrapper?.getAttribute("style")).toContain("top: 185px");

      root.unmount();
      container.remove();
    });

    it("EditorCommentsLayer aligns comment to DOM highlight mark inside a table cell", async () => {
      const React = await import("react");
      const ReactDOM = await import("react-dom/client");
      const { EditorCommentsLayer } = await import("../src/components/editor/EditorCommentsLayer");

      const container = document.createElement("div");
      document.body.appendChild(container);

      const scrollEl = document.createElement("div");
      scrollEl.style.height = "500px";
      scrollEl.getBoundingClientRect = () => ({
        top: 100,
        bottom: 600,
        left: 0,
        right: 800,
        width: 800,
        height: 500,
        x: 0,
        y: 100,
        toJSON: () => {},
      });
      container.appendChild(scrollEl);

      // Add table inside scrollEl
      const table = document.createElement("table");
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      const mark = document.createElement("mark");
      mark.className = "cm-comment-highlight";
      mark.setAttribute("data-comment-id", "tbl-comment-1");
      mark.textContent = "WordInCell";
      mark.getBoundingClientRect = () => ({
        top: 240, // 240 - 100 = 140px relative to scroller
        bottom: 260,
        left: 50,
        right: 150,
        width: 100,
        height: 20,
        x: 50,
        y: 240,
        toJSON: () => {},
      });
      td.appendChild(mark);
      tr.appendChild(td);
      table.appendChild(tr);
      scrollEl.appendChild(table);

      const comment = {
        id: "tbl-comment-1",
        notePath: "note.md",
        from: 30,
        to: 40,
        selectedText: "WordInCell",
        content: "Comment on table cell",
        author: { name: "Varshith Programmer" },
        createdAt: Date.now(),
      };

      const root = ReactDOM.createRoot(container);
      await React.act(async () => {
        root.render(
          React.createElement(EditorCommentsLayer, {
            containerEl: scrollEl,
            comments: [comment],
            onSaveComment: () => {},
            onCancelPending: () => {},
            onSelectComment: () => {},
            onDeleteComment: () => {},
            onResolveComment: () => {},
            onReplyComment: () => {},
          })
        );
      });

      const layer = scrollEl.querySelector(".cm-comments-layer");
      expect(layer).not.toBeNull();
      const cardWrapper = layer?.querySelector("div[style*=\"top:\"]") as HTMLElement;
      expect(cardWrapper).not.toBeNull();
      // Should align to 140px (240 - 100)
      expect(cardWrapper?.getAttribute("style")).toContain("top: 140px");

      root.unmount();
      container.remove();
    });
  });
});


