// Milkdown editor core, CommonMark/GFM presets, theme, and supporting plugins.
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, editorViewOptionsCtx } from "@milkdown/core";
import { commonmark, linkSchema } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { nord } from "@milkdown/theme-nord";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { prism } from "@milkdown/plugin-prism";
import { history } from "@milkdown/plugin-history";
import { clipboard } from "@milkdown/plugin-clipboard";
import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";


// References for the sidebar, editor surface, deletion dialogue, and mobile drawer.
const plusBtn = document.getElementById("plusBtn");
const noNotesSpace = document.getElementById("noNotesSpace");
const noteList = document.getElementById("noteList");
const noteTitle = document.getElementById("noteTitle");
const textAreaMount = document.getElementById("textArea");
const deleteBtn = document.getElementById("deleteBtn");
const exportBtn = document.getElementById("exportBtn");
const deleteModal = document.getElementById("deleteModal");
const deleteConfirmBtn = document.getElementById("deleteConfirmBtn");
const deleteCancelBtn = document.getElementById("deleteCancelBtn");
const textDiv = document.querySelector(".text-div");
const layout = document.querySelector(".layout");
const notesListBtn = document.getElementById("notesListBtn");
const notesBackdrop = document.getElementById("notesBackdrop");
const notesDrawerCloseBtn = document.getElementById("notesDrawerCloseBtn");
const mobileNotesQuery = window.matchMedia("(max-width: 768px)");

// In-memory collection of notes, the identifier of the open note, and the editor instance.
let notes = [];
let currentNoteId = null;
let milkdownEditor = null;

// Debounce handle so successive keystrokes result in a single persistence request.
let saveTimeout = null;

const guestBanner = document.getElementById("guestBanner");

// Issues a fetch that always includes session credentials (cookies). //
const apiFetch = (url, options = {}) =>
  fetch(url, { credentials: "include", ...options });

if (textAreaMount) {
  textAreaMount.addEventListener("click", (event) => {
    openEditorLink(event);
  });
}

// Opens an in-editor hyperlink in a new browsing context, if the target is a valid URL. //
function openEditorLink(event) {
  const target = event.target;
  if (!(target instanceof Element)) return false;

  const anchor = target.closest("a");
  if (!anchor || !textAreaMount.contains(anchor)) return false;

  const href = anchor.getAttribute("href");
  if (!isLinkHref(href)) return false;

  event.preventDefault();
  event.stopPropagation();
  window.open(href, "_blank", "noopener,noreferrer");
  return true;
}

// Returns true when the href uses http, https, or mailto. //
function isLinkHref(href) {
  if (!href) return false;
  try {
    const url = new URL(href, window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

/**
 * Normalises stored markdown: repairs escaped link syntax and discards
 * an otherwise empty fenced code block that would otherwise pollute the editor.
 */
function normalizeNoteContent(content) {
  if (!content) return "";
  let next = content.replace(
    /\\\[([^\]]+)\\\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    "[$1]($2)"
  );
  if (/^```[^\n]*\r?\n(?:\s*\r?\n)*```\s*$/.test(next.trim())) {
    return "";
  }
  return next;
}

// Schema mark used for hyperlinks, if the document schema defines one. //
function getLinkType(state) {
  return state.schema.marks.link || null;
}

// True when the typing cursor currently lies within a link mark. //
function isInsideLink(state) {
  const linkType = getLinkType(state);
  if (!linkType) return false;
  return !!linkType.isInSet(state.storedMarks || state.selection.$from.marks());
}

// True when the selection resides inside a fenced code block. //
function isInCodeBlock(state) {
  return state.selection.$from.parent.type.name === "code_block";
}

// True when the typing cursor is on the final line of a code block (used to leave the block). //
function isOnLastLineOfCodeBlock(state) {
  const { $from, empty } = state.selection;
  if (!empty || !isInCodeBlock(state)) return false;
  return !$from.parent.textContent.slice($from.parentOffset).includes("\n");
}

// True when the typing cursor sits at the end of the code-block content. //
function isAtEndOfCodeBlock(state) {
  const { $from, empty } = state.selection;
  if (!empty || !isInCodeBlock(state)) return false;
  return $from.parentOffset === $from.parent.content.size;
}

// True when the last line of the current code block contains no text. //
function lastLineOfCodeBlockIsEmpty(state) {
  if (!isInCodeBlock(state)) return false;
  const text = state.selection.$from.parent.textContent;
  const lastBreak = text.lastIndexOf("\n");
  return (lastBreak === -1 ? text : text.slice(lastBreak + 1)) === "";
}

// Places the typing cursor in a paragraph immediately after the current block, creating one if needed. //
function insertParagraphAfterBlock(view) {
  const { state } = view;
  const $from = state.selection.$from;
  const paragraphType = state.schema.nodes.paragraph;
  if (!paragraphType || $from.depth < 1) return false;

  const after = $from.after();
  const next = after < state.doc.content.size ? state.doc.nodeAt(after) : null;
  let tr = state.tr;

  if (next && next.isTextblock) {
    tr = tr.setSelection(TextSelection.create(state.doc, after + 1));
  } else {
    tr = tr.insert(after, paragraphType.create());
    tr = tr.setSelection(TextSelection.create(tr.doc, after + 1));
  }

  view.dispatch(tr.scrollIntoView().setMeta("CHARCOAL_LINKS", true));
  return true;
}

// True when the typing cursor is at the trailing edge of a link (so further typing should not extend it). //
function isAtEndOfLink(state) {
  const { $from, empty } = state.selection;
  if (!empty || !isInsideLink(state)) return false;
  if ($from.parentOffset === $from.parent.content.size) return true;
  const after = $from.nodeAfter;
  const linkType = getLinkType(state);
  return !after || !linkType.isInSet(after.marks);
}

// True when the clipboard or pasted string is markdown of the form [label](url). //
function isMarkdownLinkText(text) {
  return /^\[[^\]]+\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)$/.test(text.trim());
}

// True when the string is a standalone http(s) URL. //
function isBareUrlText(text) {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/**
 * Replaces empty code blocks with ordinary paragraphs so that a vacant fence
 * does not remain in the document. When `all` is false, only blocks that were
 * already empty in the previous state are converted.
 */
function unwrapEmptyCodeBlocks(state, { all = false, oldState = null } = {}) {
  const paragraphType = state.schema.nodes.paragraph;
  if (!paragraphType) return null;

  const replacements = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "code_block") return;
    if (node.textContent.trim() !== "") return;

    if (!all && oldState) {
      const oldNode = oldState.doc.nodeAt(pos);
      if (!oldNode || oldNode.type.name !== "code_block") return;
    }

    replacements.push({ from: pos, to: pos + node.nodeSize });
  });

  if (replacements.length === 0) return null;

  let tr = state.tr;
  for (let i = replacements.length - 1; i >= 0; i--) {
    tr = tr.replaceWith(replacements[i].from, replacements[i].to, paragraphType.create());
  }
  return tr;
}

/**
 * Converts literal markdown link syntax that are in textblocks into a proper link marks,
 * excluding content that already are in a code block.
 */
function convertMarkdownLinks(state) {
  const linkType = getLinkType(state);
  if (!linkType) return null;

  const replacements = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock || node.type.name === "code_block") return;
    const text = node.textContent;
    const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g;
    let match;
    while ((match = pattern.exec(text))) {
      replacements.push({
        from: pos + 1 + match.index,
        to: pos + 1 + match.index + match[0].length,
        label: match[1],
        href: match[2]
      });
    }
  });

  if (replacements.length === 0) return null;

  let tr = state.tr;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const item = replacements[i];
    tr = tr.replaceWith(
      item.from,
      item.to,
      state.schema.text(item.label, [linkType.create({ href: item.href })])
    );
  }
  return tr.setStoredMarks([]);
}

// CommonMark without the default inclusive link mark; a non-inclusive variant is supplied below.
const commonmarkWithoutLink = commonmark.filter(
  (plugin) => plugin !== linkSchema.ctx && plugin !== linkSchema.mark
);

const nonInclusiveLink = linkSchema.extendSchema((prev) => (ctx) => ({
  ...prev(ctx),
  inclusive: false
}));

/**
 * ProseMirror plugin that (a) converts markdown links after edits, (b) unwraps
 * empty code fences, (c) treats pasted URLs as links, and (d) allows the typing cursor
 * to leave a link or code block via keyboard navigation.
 */
const linkBehaviorPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey("CHARCOAL_LINKS"),
    appendTransaction(transactions, _oldState, newState) {
      if (transactions.some((tr) => tr.getMeta("CHARCOAL_LINKS"))) return null;

      const converted = convertMarkdownLinks(newState);
      if (converted) return converted.setMeta("CHARCOAL_LINKS", true);

      const unwrapped = unwrapEmptyCodeBlocks(newState, { oldState: _oldState });
      if (unwrapped) return unwrapped.setMeta("CHARCOAL_LINKS", true);

      if (isAtEndOfLink(newState) || transactions.some((tr) => tr.getMeta("paste"))) {
        return newState.tr.setStoredMarks([]).setMeta("CHARCOAL_LINKS", true);
      }

      return null;
    },
    props: {
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain")?.trim() || "";
        if (!text || (!isMarkdownLinkText(text) && !isBareUrlText(text))) return false;

        const { state } = view;
        const from = state.selection.from;
        const to = state.selection.to;
        const linkType = getLinkType(state);
        if (!linkType) return false;

        if (isMarkdownLinkText(text)) {
          view.dispatch(state.tr.insertText(text, from, to));
          return true;
        }

        view.dispatch(
          state.tr
            .replaceWith(from, to, state.schema.text(text, [linkType.create({ href: text })]))
            .setStoredMarks([])
            .setMeta("CHARCOAL_LINKS", true)
        );
        return true;
      },
      handleTextInput(view, from, to, text) {
        if (!isAtEndOfLink(view.state)) return false;
        const linkType = getLinkType(view.state);
        view.dispatch(
          view.state.tr
            .removeStoredMark(linkType)
            .insertText(text, from, to)
            .setMeta("CHARCOAL_LINKS", true)
        );
        return true;
      },
      handleKeyDown(view, event) {
        if (event.key === "Backspace") {
          const { $from, empty } = view.state.selection;
          if (
            empty &&
            $from.parent.type.name === "code_block" &&
            $from.parent.textContent.trim() === ""
          ) {
            const paragraphType = view.state.schema.nodes.paragraph;
            if (paragraphType) {
              view.dispatch(
                view.state.tr
                  .replaceWith($from.before(), $from.after(), paragraphType.create())
                  .setMeta("CHARCOAL_LINKS", true)
              );
              return true;
            }
          }
        }

        if (isInCodeBlock(view.state)) {
          const leaveWithEnter =
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey || (isAtEndOfCodeBlock(view.state) && lastLineOfCodeBlockIsEmpty(view.state)));
          const leaveWithArrow =
            (event.key === "ArrowDown" && isOnLastLineOfCodeBlock(view.state)) ||
            (event.key === "ArrowRight" && isAtEndOfCodeBlock(view.state));

          if (leaveWithEnter || leaveWithArrow) {
            return insertParagraphAfterBlock(view);
          }
        }

        const linkType = getLinkType(view.state);
        if (!linkType || !isAtEndOfLink(view.state)) return false;

        if (event.key === "ArrowRight") {
          view.dispatch(view.state.tr.removeStoredMark(linkType));
          return true;
        }

        if (event.key === "ArrowDown") {
          return insertParagraphAfterBlock(view);
        }

        if (event.key === "Enter") {
          view.dispatch(view.state.tr.removeStoredMark(linkType));
          return false;
        }

        return false;
      }
    }
  });
});

// Destroys any existing editor and mounts a new Milkdown instance with the given markdown. //
async function createEditor(content) {
  if (milkdownEditor) {
    await milkdownEditor.destroy();
  }

  try {
    milkdownEditor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, textAreaMount);
        ctx.set(defaultValueCtx, normalizeNoteContent(content || ""));
        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          transformPastedHTML(html) {
            const template = document.createElement("template");
            template.innerHTML = html;
            const code = template.content.querySelector("pre, code");
            const text = (code?.textContent || "").trim();
            if (code && (isMarkdownLinkText(text) || isBareUrlText(text))) {
              const escaped = text
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;");
              return `<p>${escaped}</p>`;
            }
            return html;
          }
        }));
        ctx.get(listenerCtx).markdownUpdated((ctx, markdown) => {
          onEditorContentChange(markdown);
        });
      })
      .config(nord)
      .use(commonmarkWithoutLink)
      .use(nonInclusiveLink)
      .use(gfm)
      .use(history)
      .use(prism)
      .use(clipboard)
      .use(linkBehaviorPlugin)
      .use(listener)
      .create();

    milkdownEditor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const unwrapped = unwrapEmptyCodeBlocks(view.state, { all: true });
      if (unwrapped) view.dispatch(unwrapped.setMeta("CHARCOAL_LINKS", true));
    });
  } catch (err) {
    console.error("Create editor error:", err);
    milkdownEditor = null;
  }
}

// Records markdown changes on the active note and schedules a debounced save. //
function onEditorContentChange(markdown) {
  if (currentNoteId == null) return;

  const note = notes.find((n) => n.id == currentNoteId);
  if (!note) return;

  note.content = markdown;

  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveNoteToDB, 200);
}

// Reveals the guest-mode banner when notes are stored only for the current session. //
async function updateNotesModeBanner() {
  if (!guestBanner) return;
  try {
    const res = await apiFetch("/notes/mode");
    if (!res.ok) return;
    const { mode } = await res.json();
    guestBanner.classList.toggle("hidden", mode !== "guest");
  } catch {
    guestBanner.classList.add("hidden");
  }
}

/**
 * Fetches the user's notes from the backend. Opening the document as a local
 * file is rejected, since the API is only available through the HTTP server.
 */
async function loadNotes() {
  if (window.location.protocol === "file:") {
    console.error(
      "Open this app through the server, not as a file. Example: http://localhost:3000/notespage.html"
    );
    if (noNotesSpace) {
      noNotesSpace.textContent =
        "Open via the server: start Backend, then visit http://localhost:3000/ (not a file:// tab).";
      noNotesSpace.style.display = "flex";
    }
    return;
  }

  try {
    await updateNotesModeBanner();

    const res = await apiFetch("/notes");
    if (!res.ok) throw new Error("Failed to load notes");

    notes = await res.json();

    if (notes.length === 0) {
      currentNoteId = null;
      noteTitle.value = "";
      createEditor("");
      noNotesSpace.style.display = "flex";
      if (textDiv) textDiv.style.display = "none";
      showNotes();
    } else {
      openNote(notes[0]);
    }
  } catch (err) {
    console.error("Load notes error:", err);
    if (noNotesSpace) {
      noNotesSpace.textContent =
        "Could not load notes. Is the backend running on the same host/port? (e.g. http://localhost:3000/)";
      noNotesSpace.style.display = "flex";
    }
  }
}

loadNotes();

// Makes the given note the active document and (on narrow viewports) closes the drawer. //
function openNote(activenote) {
  clearTimeout(saveTimeout);

  noNotesSpace.style.display = "none";
  if (textDiv) textDiv.style.display = "flex";

  currentNoteId = activenote.id;
  noteTitle.value = activenote.title || "";
  const normalized = normalizeNoteContent(activenote.content || "");
  if (normalized !== (activenote.content || "")) {
    activenote.content = normalized;
    saveNoteToDB();
  }
  createEditor(normalized);

  showNotes();
  if (mobileNotesQuery.matches) closeNotesDrawer();
}

/**
 * Sidebar label: prefer the explicit title, otherwise the first line of the
 * body, otherwise a numbered placeholder for an entirely empty note.
 */
function getNoteSidebarTitle(note) {
  const completeTitle = (note.title || "").trim();
  const firstlineTitle = (note.content || "").trim();

  if (completeTitle) {
    return limitChars(completeTitle, 25);
  }
  if (firstlineTitle) {
    return limitChars(firstlineTitle, 25);
  }

  let notesNum = 0;
  for (const n of notes) {
    const t = (n.title || "").trim();
    const c = (n.content || "").trim();
    if (!t && !c) {
      notesNum++;
      if (n.id == note.id) return `Note ${notesNum}`;
    }
  }
  return "Note";
}

// Rebuilds the sidebar list to reflect `notes` and highlights the open item. //
function showNotes(){
  noteList.innerHTML = "";

  notes.forEach(note => {
    const li = document.createElement("li");
    const title = getNoteSidebarTitle(note);

    const titleEl = document.createElement("div");
    titleEl.className = "note-title-list";
    titleEl.textContent = title;

    li.appendChild(titleEl);

    if (note.id == currentNoteId) {
      li.classList.add("note-selected");
    }

    li.onclick = () => openNote(note);

    noteList.appendChild(li);
  });
}

// Truncates a string to `maxLetters` characters and appends an ellipsis when needed. //
function limitChars(text, maxLetters) {
  if (text.length <= maxLetters) return text;
  return text.slice(0, maxLetters) + "...";
}

// Creates an empty note on the server and opens it in the editor. //
async function createNewNote() {
  try {
    const res = await apiFetch("/notes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: "",
        content: ""
      })
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || "Failed to create note");
    }

    const newNote = await res.json();

    notes.push(newNote);
    openNote(newNote);
  } catch (err) {
    console.error("Create note error:", err);
  }
}

// The plus control and the empty-state surface both create a new note.
if (plusBtn) {
  plusBtn.addEventListener("click", async () => {
    createNewNote();
    plusBtn?.blur();
  });
}

if (noNotesSpace) noNotesSpace.addEventListener("click", createNewNote);

// Reveals the deletion confirmation dialogue, provided a note is currently open. //
function showDeleteModal() {
  if (currentNoteId == null) return;
  deleteModal?.classList.remove("hidden");
}

// Hides the deletion confirmation dialogue. //
function hideDeleteModal() {
  deleteModal?.classList.add("hidden");
}

// Removes the active note via DELETE and either opens another note or the empty state. //
async function performDelete() {
  if (currentNoteId == null) return;

  const id = currentNoteId;

  try {
    const res = await apiFetch(`/notes/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || "Failed to delete note");
    }

    notes = notes.filter((n) => n.id != id);

    if (notes.length === 0) {
      currentNoteId = null;
      noteTitle.value = "";
      createEditor("");
      noNotesSpace.style.display = "flex";
      if (textDiv) textDiv.style.display = "none";
      showNotes();
    } else {
      openNote(notes[0]);
    }
  } catch (err) {
    console.error("Delete note error:", err);
  }
}

// Downloads the active note as a markdown file whose name is derived from the note title. //
function exportCurrentNote() {
  const note = notes.find((n) => n.id == currentNoteId);
  if (!note) return;

  const rawTitle = getNoteSidebarTitle(note);
  const safe = rawTitle.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 80);
  const body = `# ${note.title || ""}\n\n${note.content || ""}`;
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

// Deletion dialogue: confirm, cancel, overlay click, Escape, and Enter.
if (deleteBtn) deleteBtn.addEventListener("click", showDeleteModal);
if (deleteCancelBtn) deleteCancelBtn.addEventListener("click", hideDeleteModal);
if (deleteConfirmBtn) {
  deleteConfirmBtn.addEventListener("click", async () => {
    deleteConfirmBtn?.blur();
    await performDelete();
    hideDeleteModal();
    deleteConfirmBtn?.blur();
  });
}
if (deleteModal) {
  deleteModal.addEventListener("click", (e) => {
    if (e.target === deleteModal) hideDeleteModal();
  });
}
document.addEventListener("keydown", async (e) => {
  if (deleteModal && !deleteModal.classList.contains("hidden")) {
    if (e.key === "Escape") {
      hideDeleteModal();
      deleteBtn?.blur();
    }

    if (e.key === "Enter") {
      e.preventDefault();
      await performDelete();
      hideDeleteModal();
      deleteBtn?.blur();
    }
    return;
  }

  if (e.key === "Escape" && isNotesDrawerOpen()) {
    closeNotesDrawer();
  }
});
 
if (exportBtn) exportBtn.addEventListener("click", exportCurrentNote);

// True when the narrow-viewport drawer is open and overlays the note list above the editor. //
function isNotesDrawerOpen() {
  return layout?.classList.contains("notes-drawer-open");
}

function setNotesDrawerOpen(open) {
  layout?.classList.toggle("notes-drawer-open", open);
  notesListBtn?.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeNotesDrawer() {
  setNotesDrawerOpen(false);
}

function toggleNotesDrawer() {
  setNotesDrawerOpen(!isNotesDrawerOpen());
}

// Drawer open/close on mobile; closed automatically when the viewport widens.
if (notesListBtn) notesListBtn.addEventListener("click", toggleNotesDrawer);
if (notesBackdrop) notesBackdrop.addEventListener("click", closeNotesDrawer);
if (notesDrawerCloseBtn) notesDrawerCloseBtn.addEventListener("click", closeNotesDrawer);

if (mobileNotesQuery.addEventListener) {
  mobileNotesQuery.addEventListener("change", (event) => {
    if (!event.matches) closeNotesDrawer();
  });
}

// Title edits are persisted with the same debounce interval as body edits.
noteTitle.addEventListener("input", () => {
  if (currentNoteId == null) return;

  const note = notes.find(n => n.id == currentNoteId);
  if (!note) return;

  note.title = noteTitle.value;

  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveNoteToDB, 200);
});

// Enter or ArrowDown from the title field moves focus into the editor body.
noteTitle.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === "ArrowDown") {
    e.preventDefault();
    const editable = textAreaMount.querySelector('[contenteditable="true"]');
    if (editable) editable.focus();
  }
});

// True when the typing cursor is at the very beginning of the contenteditable editor. //
function isCursorAtStartOfEditor(editableEl) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return false;

  const range = selection.getRangeAt(0);
  if (!range.collapsed) return false; // has a selection, not just a cursor

  // Create a range from the very start of the editable area to the cursor
  const preRange = range.cloneRange();
  preRange.selectNodeContents(editableEl);
  preRange.setEnd(range.startContainer, range.startOffset);

  return preRange.toString().length === 0;
}

// Backspace or ArrowUp at the start of the body returns focus to the title field.
textAreaMount.addEventListener("keydown", (e) => {
  const editable = textAreaMount.querySelector('[contenteditable="true"]');
  if (!editable) return;

  if (e.key === "Backspace" || e.key === "ArrowUp") {
    if (isCursorAtStartOfEditor(editable)) {
      e.preventDefault();
      noteTitle.focus();
    }
  }
});

// Persists the active note's title and content to the server via PUT. //
async function saveNoteToDB() {
  const note = notes.find(n => n.id == currentNoteId);
  if (!note) return;

  try {
    const res = await apiFetch(`/notes/${currentNoteId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: note.title,
        content: note.content
      })
    });

    if (!res.ok) throw new Error("Save failed");

    showNotes();
  } catch (err) {
    console.error("Save error:", err);
  }
}
