import { Editor, rootCtx, defaultValueCtx } from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { nord } from "@milkdown/theme-nord";
import { listener, listenerCtx } from "@milkdown/plugin-listener";


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

let notes = [];
let currentNoteId = null;
let milkdownEditor = null;

let saveTimeout = null;

const guestBanner = document.getElementById("guestBanner");

const apiFetch = (url, options = {}) =>
  fetch(url, { credentials: "include", ...options });

async function createEditor(content) {
  if (milkdownEditor) {
    await milkdownEditor.destroy();
  }

  milkdownEditor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, textAreaMount);
      ctx.set(defaultValueCtx, content || "");
      ctx.get(listenerCtx).markdownUpdated((ctx, markdown) => {
        onEditorContentChange(markdown);
      });
    })
    .config(nord)
    .use(commonmark)
    .use(listener)
    .create();
}

function onEditorContentChange(markdown) {
  if (currentNoteId == null) return;

  const note = notes.find((n) => n.id == currentNoteId);
  if (!note) return;

  note.content = markdown;

  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveNoteToDB, 200);
}

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

function openNote(activenote) {
  clearTimeout(saveTimeout);

  noNotesSpace.style.display = "none";
  if (textDiv) textDiv.style.display = "flex";

  currentNoteId = activenote.id;
  noteTitle.value = activenote.title || "";
  createEditor(activenote.content || "");

  showNotes();
}

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

function limitChars(text, maxLetters) {
  if (text.length <= maxLetters) return text;
  return text.slice(0, maxLetters) + "...";
}

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

if (plusBtn) {
  plusBtn.addEventListener("click", async () => {
    createNewNote();
    plusBtn?.blur();
  });
}

if (noNotesSpace) noNotesSpace.addEventListener("click", createNewNote);

function showDeleteModal() {
  if (currentNoteId == null) return;
  deleteModal?.classList.remove("hidden");
}

function hideDeleteModal() {
  deleteModal?.classList.add("hidden");
}

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
  if (!deleteModal || deleteModal.classList.contains("hidden")) {
    return;
  }
 
  if (e.key === "Escape") {
    hideDeleteModal();
    deleteBtn?.blur();
  }
 
  if (e.key === "Enter") {
    e.preventDefault(); // Prevent any default action
    await performDelete();
    hideDeleteModal();
    deleteBtn?.blur();
  }
});
 
if (exportBtn) exportBtn.addEventListener("click", exportCurrentNote);

noteTitle.addEventListener("input", () => {
  if (currentNoteId == null) return;

  const note = notes.find(n => n.id == currentNoteId);
  if (!note) return;

  note.title = noteTitle.value;

  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveNoteToDB, 200);
});

noteTitle.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === "ArrowDown") {
    e.preventDefault();
    const editable = textAreaMount.querySelector('[contenteditable="true"]');
    if (editable) editable.focus();
  }
});

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
