/*
 * Focus Tasks — a focus list over plain Markdown notes.
 *
 * Tasks are ordinary checkbox lines in the plugin's task files, all in the folder from the settings.
 * A file with frontmatter `area: <name>` is an area (it holds loose tasks); with
 * `type: <project word>` it is a project of that area (its tasks are the steps). A task file can be
 * linked to any note of the vault (`note: "[[...]]"`): a click on the area or project then opens
 * that note, and the task file stays one menu item away. Linked notes are never changed.
 *
 * The view (a pane, or a ```focus-tasks``` block in a note) shows area → its loose tasks → its
 * projects:
 *  - on top, the focus: open tasks dated today or earlier; «Show upcoming» under an area opens a
 *    block with its undated and future tasks and projects;
 *  - «All» at the bottom (kept per device) opens every such block and lists the areas with nothing
 *    due below, folded; «Collapse all» / «Expand all» fold every area and project on screen.
 *
 * A click on a task's text edits it in place (Enter saves and opens the next row, Esc cancels;
 * ⌘1 today, ⌘2 tomorrow, ⌘3 date picker, ⌘4 no date). The date on the right opens a date picker.
 * The checkbox completes a task (through the Tasks plugin when it is installed: recurrence, ✅).
 * The grip on the left drags areas, projects and tasks; a plain click on it opens the row's menu.
 * Dates use the Tasks emoji format (⏳ scheduled, 📅 due, 🛫 start, ✅ done), so both plugins agree.
 */
const {
  Plugin, PluginSettingTab, Setting, ItemView, Modal, SuggestModal, FuzzySuggestModal, Notice, Menu,
  MarkdownRenderChild, MarkdownRenderer, Component, Keymap, moment, setIcon, prepareSimpleSearch,
  Platform, Scope, normalizePath,
} = require("obsidian");

const VIEW_TYPE = "focus-tasks-view";
const DATE_RE = /\s*(⏳|📅|🛫|✅|➕|❌)️?\s*(\d{4}-\d{2}-\d{2})/g;
const FOCUS_MARKS = ["⏳", "📅", "🛫"];
const PROJECT_WORDS = ["project", "проект"];
const CATCH_ALL = ["Без раздела", "No section"];

const DEFAULTS = {
  folder: "Tasks",
  language: "auto",
  areaNoteName: "{area}",
  areaFrontmatter: "",
  typeArea: "area",
  typeProject: "project",
  stepsHeading: "Steps",
  inboxHeading: "Inbox",
  projectsHeading: "Projects",
  dateFormat: "DD.MM.YY",
  useTasksPlugin: true,
};

// --- strings ----------------------------------------------------------------------------------

const STRINGS = {
  en: {
    viewTitle: "Focus", open: "Open Focus", focusEmpty: "Nothing due today",
    noAreas: "No areas yet — create the first one", restTitle: "Other areas", all: "All", hide: "Hide",
    newArea: "+ Area", areaFromNote: "+ Area from a note", foldAll: "Collapse all", unfoldAll: "Expand all",
    openCount: "open {0}", inFocus: ", in focus {0}", addToArea: "Task in this area", empty: "Empty",
    addTask: "Add a task", showUpcoming: "Show upcoming", hideUpcoming: "Hide upcoming",
    addStep: "Step in this project", drag: "Drag", collapse: "Collapse", expand: "Expand",
    setDate: "Set a date", today: "Today", yesterday: "Yesterday", tomorrow: "Tomorrow",
    newTask: "New task", newStep: "New step", newProject: "New project", actions: "Actions",
    projectFromNote: "Project from a note", deleteArea: "Delete area", rename: "Rename",
    openNote: "Open linked note", openFile: "Open task file", linkNote: "Link a note…", relinkNote: "Link another note…",
    unlinkNote: "Unlink the note", linkedNote: "Linked note: {0}",
    deleteProject: "Delete project", noDate: "No date (someday)", tasksDialog: "Tasks dialog (date, priority)",
    openInNote: "Open in note", delete: "Delete", changed: "The task changed in the note — try again",
    deleted: "Deleted: {0}", undo: "Undo", noteExists: "Note “{0}” already exists",
    areaExists: "Area “{0}” already exists", areaCreated: "Area “{0}” created",
    projectCreated: "Project “{0}” created", projectDeleted: "Project “{0}” deleted",
    areaDeleted: "Area {0} deleted", linked: "Linked to “{0}”", unlinked: "Note unlinked",
    newAreaTitle: "New area", areaPlaceholder: "Name — an emoji in front works: 💪Sport",
    areaNameTitle: "Area name for “{0}”", newProjectTitle: "New project in {0}",
    projectPlaceholder: "Project name", create: "Create", cancel: "Cancel", next: "Next", ok: "OK",
    deleteProjectQ: "Delete project “{0}”?", deleteProjectText: "Its task file goes to the trash; open steps in it: {0}. A linked note stays.",
    deleteAreaQ: "Delete area {0}?", deleteAreaText: "The task files of the area and of its {0} projects go to the trash; open tasks in them: {1}. Linked notes stay.",
    taskIn: "Task added to “{0}”", where: "Where to: a project or an area (type a new name to create an area)",
    newAreaOption: "+ New area “{0}”", looseTasks: "(loose tasks)", whatToDo: "What to do",
    pickNote: "Pick a note", cmdToggleAll: "Show all / focus only", cmdFoldAll: "Collapse all",
    cmdUnfoldAll: "Expand all", cmdAddTask: "New task", cmdAddArea: "New area", cmdAreaFromNote: "New area from the current note",
    pickerPlaceholder: "DD.MM.YY or “tomorrow”", clearDate: "Clear date",
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
    sFolder: "Folder", sFolderDesc: "Where the task files of areas and projects live. Notes linked to them can be anywhere.",
    sLanguage: "Language", sLanguageDesc: "Interface language (Auto follows Obsidian).",
    sAreaName: "Area note name", sAreaNameDesc: "File name of a new area note; {area} is the area name without a leading emoji.",
    sAreaFm: "Extra frontmatter for new area notes", sAreaFmDesc: "YAML lines added to every new area note (optional).",
    sTypeArea: "“type” of an area note", sTypeProject: "“type” of a project note",
    sTypeDesc: "Value of the type property. project / проект and area / область are always recognised.",
    sSteps: "Steps heading", sStepsDesc: "Section of a project note that new steps go to.",
    sInbox: "Inbox heading", sInboxDesc: "Section of an area note that new loose tasks go to.",
    sProjects: "Projects heading", sProjectsDesc: "Section of an area note that lists its projects.",
    sDateFormat: "Date format", sDateFormatDesc: "moment.js format of the dates on the right, e.g. DD.MM.YY or MMM D.",
    sTasks: "Use the Tasks plugin", sTasksDesc: "When Tasks is installed, completing goes through it (recurrence) and its dialog is in the menu.",
  },
  ru: {
    viewTitle: "Фокус", open: "Открыть Фокус", focusEmpty: "В фокусе пусто",
    noAreas: "Областей пока нет — создай первую", restTitle: "Остальные области", all: "Все", hide: "Скрыть",
    newArea: "+ Область", areaFromNote: "+ Область из заметки", foldAll: "Свернуть всё", unfoldAll: "Развернуть всё",
    openCount: "открыто {0}", inFocus: ", в фокусе {0}", addToArea: "Задача в область", empty: "Пусто",
    addTask: "Добавить задачу", showUpcoming: "Показать будущее", hideUpcoming: "Скрыть будущее",
    addStep: "Шаг в проект", drag: "Перетащить", collapse: "Свернуть", expand: "Развернуть",
    setDate: "Поставить дату", today: "Сегодня", yesterday: "Вчера", tomorrow: "Завтра",
    newTask: "Новая задача", newStep: "Новый шаг", newProject: "Новый проект", actions: "Действия",
    projectFromNote: "Проект из заметки", deleteArea: "Удалить область", rename: "Переименовать",
    openNote: "Открыть привязанную заметку", openFile: "Открыть файл задач", linkNote: "Привязать заметку…", relinkNote: "Привязать другую заметку…",
    unlinkNote: "Отвязать заметку", linkedNote: "Привязанная заметка: {0}",
    deleteProject: "Удалить проект", noDate: "Без даты (в отложку)", tasksDialog: "Окно Tasks (дата, приоритет)",
    openInNote: "Открыть в заметке", delete: "Удалить", changed: "Задача изменилась в заметке, попробуй ещё раз",
    deleted: "Удалено: {0}", undo: "Вернуть", noteExists: "Заметка «{0}» уже есть",
    areaExists: "Область «{0}» уже есть", areaCreated: "Область «{0}» создана",
    projectCreated: "Проект «{0}» создан", projectDeleted: "Проект «{0}» удалён",
    areaDeleted: "Область {0} удалена", linked: "Привязана «{0}»", unlinked: "Заметка отвязана",
    newAreaTitle: "Новая область", areaPlaceholder: "Имя с эмодзи, например 💪Спорт",
    areaNameTitle: "Имя области для «{0}»", newProjectTitle: "Новый проект в {0}",
    projectPlaceholder: "Название проекта", create: "Создать", cancel: "Отмена", next: "Дальше", ok: "Готово",
    deleteProjectQ: "Удалить проект «{0}»?", deleteProjectText: "Файл задач проекта уйдёт в корзину, открытых шагов в нём: {0}. Привязанная заметка останется.",
    deleteAreaQ: "Удалить область {0}?", deleteAreaText: "В корзину уйдут файлы задач области и её проектов ({0}); открытых задач в них: {1}. Привязанные заметки останутся.",
    taskIn: "Задача в «{0}»", where: "Куда: проект или область (новое имя — новая область)",
    newAreaOption: "＋ Новая область «{0}»", looseTasks: "(разовые задачи)", whatToDo: "Что сделать",
    pickNote: "Выбери заметку", cmdToggleAll: "Показать всё / только фокус", cmdFoldAll: "Свернуть всё",
    cmdUnfoldAll: "Развернуть всё", cmdAddTask: "Новая задача", cmdAddArea: "Новая область", cmdAreaFromNote: "Новая область из текущей заметки",
    pickerPlaceholder: "ДД.ММ.ГГ или «завтра»", clearDate: "Убрать дату",
    months: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
    weekdays: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
    sFolder: "Папка", sFolderDesc: "Где лежат файлы задач областей и проектов. Привязанные к ним заметки могут быть где угодно.",
    sLanguage: "Язык", sLanguageDesc: "Язык интерфейса (Auto — как в Obsidian).",
    sAreaName: "Имя заметки области", sAreaNameDesc: "Имя файла новой области; {area} — имя области без эмодзи в начале.",
    sAreaFm: "Дополнительный frontmatter новых областей", sAreaFmDesc: "YAML-строки, которые добавятся в каждую новую заметку области (необязательно).",
    sTypeArea: "«type» заметки области", sTypeProject: "«type» заметки проекта",
    sTypeDesc: "Значение свойства type. project / проект и area / область узнаются всегда.",
    sSteps: "Раздел шагов", sStepsDesc: "Раздел заметки проекта, куда пишутся новые шаги.",
    sInbox: "Раздел входящих", sInboxDesc: "Раздел заметки области, куда пишутся новые разовые задачи.",
    sProjects: "Раздел проектов", sProjectsDesc: "Раздел заметки области со ссылками на её проекты.",
    sDateFormat: "Формат даты", sDateFormatDesc: "Формат moment.js для дат справа, например DD.MM.YY или D MMM.",
    sTasks: "Использовать плагин Tasks", sTasksDesc: "Если Tasks установлен, галочка идёт через него (повторы), а его окно есть в меню.",
  },
};

let LANG = "en";
function t(key, ...args) {
  const s = (STRINGS[LANG] && STRINGS[LANG][key]) ?? STRINGS.en[key] ?? key;
  return typeof s === "string" ? s.replace(/\{(\d)\}/g, (_, i) => args[i] ?? "") : s;
}

// --- pure helpers ----------------------------------------------------------------------------

const bare = (name) => name.replace(/^[^\p{L}\p{N}]+/u, "");
const today = () => moment().format("YYYY-MM-DD");
const fileName = (name) => name.replace(/[\\/#^\[\]|?*<>":]/g, "-").replace(/\s+/g, " ").trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const inFocus = (task) => task.date && task.date <= today();
const isHead = (l) => /^#{1,6}\s/.test(l);
const headText = (l) => l.replace(/^#+\s*/, "").trim();
const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, "    ").length;
const collator = () => (a, b) => a.localeCompare(b, LANG);

// "25.09", "25.09.26", "25/09/2026", "today", "завтра" → "YYYY-MM-DD" or null.
function parseDay(text) {
  const s = text.trim().toLowerCase();
  if (["сегодня", "today"].includes(s)) return today();
  if (["завтра", "tomorrow"].includes(s)) return moment().add(1, "day").format("YYYY-MM-DD");
  const m = s.match(/^(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2}|\d{4}))?$/);
  if (!m) return null;
  const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : moment().year();
  const d = moment({ year, month: Number(m[2]) - 1, day: Number(m[1]) });
  return d.isValid() ? d.format("YYYY-MM-DD") : null;
}

// Lines at the end of `section` (a heading's text); a missing section is added at the bottom.
function insertBlock(text, block, section) {
  const lines = text.replace(/\n+$/, "").split("\n");
  const fmEnd = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  const start = lines.findIndex((l, i) => i > fmEnd && isHead(l) && headText(l) === section);
  if (start >= 0) {
    let end = lines.findIndex((l, i) => i > start && isHead(l));
    if (end < 0) end = lines.length;
    while (end > start + 1 && !lines[end - 1].trim()) end--;
    lines.splice(end, 0, ...(end === start + 1 ? ["", ...block] : block));  // an empty section: a blank line under its heading
  } else lines.push("", "## " + section, "", ...block);
  return lines.join("\n") + "\n";
}

// A task line plus the lines nested under it (steps, description): [start, end).
function blockAt(lines, i) {
  let end = i + 1;
  while (end < lines.length && lines[end].trim() && indentOf(lines[end]) > indentOf(lines[i])) end++;
  return end;
}

// Shifts a block so its first line sits at `indent` spaces; tabs become four spaces.
function reindent(block, indent) {
  const base = indentOf(block[0]);
  return block.map((l) => " ".repeat(Math.max(0, indentOf(l) - base + indent)) + l.replace(/^\s*/, ""));
}

// "    - [ ] Step ⏫ ⏳ 2026-09-22" → {indent: 1, text: "Step ⏫", date: "2026-09-22", mark: "⏳"};
// date = the earliest focus date, mark = the emoji it came with (the one a date edit changes).
function parseLine(line) {
  const m = line.match(/^(\s*)[-*] \[(.)\] (.*)$/);
  if (!m) return null;
  const dates = [];
  for (const [, mark, day] of m[3].matchAll(DATE_RE)) if (FOCUS_MARKS.includes(mark)) dates.push({ mark, day });
  dates.sort((a, b) => a.day.localeCompare(b.day));
  return { indent: Math.floor(m[1].replace(/\t/g, "    ").length / 4), status: m[2],
    text: m[3].replace(DATE_RE, "").trim(), date: dates[0]?.day || null, mark: dates[0]?.mark || null };
}

// "- [ ] Task ⏳ 2026-09-22" → "- [x] Task ⏳ 2026-09-22 ✅ <today>" and back.
function toggleLine(line) {
  const m = line.match(/^(\s*[-*] \[)(.)(\] .*)$/);
  if (!m) return line;
  if (m[2] === " ") return `${m[1]}x${m[3].replace(/\s+$/, "")} ✅ ${today()}`;
  return `${m[1]} ${m[3].replace(/\s*✅️?\s*\d{4}-\d{2}-\d{2}/g, "")}`;
}

// --- modals and the date picker --------------------------------------------------------------

// A Notion-like date picker: a field to type a date, the month (Monday first) with arrows and
// «Today», «Clear date» below. A picked day saves at once; Esc, a click outside or a scroll closes it.
class DatePicker {
  constructor(anchor, value, onPick, onCancel) {
    Object.assign(this, { value, onPick, onCancel });
    this.month = moment(value || today()).startOf("month");
    this.el = document.body.createDiv({ cls: "ft-picker" });
    this.input = this.el.createEl("input", { type: "text", cls: "ft-picker-input", attr: { placeholder: t("pickerPlaceholder") } });
    this.input.value = value ? moment(value).format("DD.MM.YY") : "";
    this.head = this.el.createDiv({ cls: "ft-picker-head" });
    this.grid = this.el.createDiv({ cls: "ft-picker-grid" });
    this.el.createDiv({ cls: "ft-picker-foot" }).createEl("button", { text: t("clearDate") }).onclick = () => this.pick(null);
    this.draw();
    this.place(anchor);
    this.input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); this.close(); return; }
      if (e.key !== "Enter") return;
      e.preventDefault();
      const day = parseDay(this.input.value);
      if (day) this.pick(day);
      else this.input.addClass("is-invalid");
    };
    this.input.oninput = () => this.input.removeClass("is-invalid");
    this.outside = (e) => { if (!this.el.contains(e.target)) this.close(); };
    this.keys = (e) => { if (e.key === "Escape") this.close(); };
    this.scrolled = (e) => { if (!this.el.contains(e.target)) this.close(); };
    setTimeout(() => {
      document.addEventListener("pointerdown", this.outside, true);
      document.addEventListener("keydown", this.keys, true);
      document.addEventListener("scroll", this.scrolled, true);
    }, 0);
    if (!Platform.isMobile) this.input.focus();  // on a phone the keyboard would cover the month
  }

  draw() {
    this.head.empty();
    this.grid.empty();
    this.head.createDiv({ cls: "ft-picker-title", text: `${t("months")[this.month.month()]} ${this.month.year()}` });
    const nav = this.head.createDiv({ cls: "ft-picker-nav" });
    nav.createEl("button", { text: t("today"), cls: "ft-picker-today" }).onclick = () => this.pick(today());
    for (const [icon, step] of [["chevron-left", -1], ["chevron-right", 1]]) {
      const b = nav.createEl("button", { cls: "ft-picker-arrow" });
      setIcon(b, icon);
      b.onclick = () => { this.month.add(step, "month"); this.draw(); };
    }
    for (const w of t("weekdays")) this.grid.createDiv({ cls: "ft-picker-weekday", text: w });
    const day = this.month.clone().isoWeekday(1);
    const now = today();
    for (let i = 0; i < 42; i++, day.add(1, "day")) {
      const iso = day.format("YYYY-MM-DD");
      const cell = this.grid.createDiv({ cls: "ft-picker-day", text: String(day.date()) });
      if (day.month() !== this.month.month()) cell.addClass("is-other");
      if (iso === now) cell.addClass("is-today");
      if (iso === this.value) cell.addClass("is-selected");
      cell.onclick = () => this.pick(iso);
    }
  }

  place(anchor) {
    const r = anchor.getBoundingClientRect();
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    Object.assign(this.el.style, { left: `${left}px`, top: `${top}px` });
  }

  pick(day) {
    this.close(true);
    this.onPick(day);
  }

  close(picked) {
    if (this.closed) return;
    this.closed = true;
    document.removeEventListener("pointerdown", this.outside, true);
    document.removeEventListener("keydown", this.keys, true);
    document.removeEventListener("scroll", this.scrolled, true);
    this.el.remove();
    if (!picked) this.onCancel();
  }
}

class TargetModal extends SuggestModal {
  constructor(app, items, onChoose) {
    super(app);
    this.items = items;
    this.onChoose = onChoose;
    this.setPlaceholder(t("where"));
  }
  getSuggestions(query) {
    const q = query.trim();
    if (!q) return this.items;
    const match = prepareSimpleSearch(q);
    const found = this.items.filter((i) => match(i.label));
    const known = this.items.some((i) => !i.project && bare(i.area).toLowerCase() === bare(q).toLowerCase());
    if (!known) found.push({ create: q, label: t("newAreaOption", q) });
    return found;
  }
  renderSuggestion(item, el) { el.setText(item.label); }
  onChooseSuggestion(item) { this.onChoose(item); }
}

// Any note of the vault that is not an area or a project yet.
class NotePicker extends FuzzySuggestModal {
  constructor(app, files, onChoose) {
    super(app);
    this.files = files;
    this.onChoose = onChoose;
    this.setPlaceholder(t("pickNote"));
  }
  getItems() { return this.files; }
  getItemText(file) { return file.path.replace(/\.md$/, ""); }
  onChooseItem(file) { this.onChoose(file); }
}

// One line of text: the name of a new area, project or task.
class NameModal extends Modal {
  constructor(app, title, placeholder, onSubmit, action, value = "") {
    super(app);
    Object.assign(this, { heading: title, placeholder, onSubmit, action: action || t("create"), value });
  }
  onOpen() {
    this.titleEl.setText(this.heading);
    const input = this.contentEl.createEl("input", { type: "text", cls: "ft-input", attr: { placeholder: this.placeholder } });
    input.value = this.value;
    const submit = () => {
      const value = input.value.trim();
      if (!value) return;
      this.close();
      this.onSubmit(value);
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); submit(); } });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: this.action, cls: "mod-cta" }).onclick = submit;
    row.createEl("button", { text: t("cancel") }).onclick = () => this.close();
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }
  onClose() { this.contentEl.empty(); }
}

class ConfirmModal extends Modal {
  constructor(app, title, text, action, onConfirm) {
    super(app);
    Object.assign(this, { heading: title, text, action, onConfirm });
  }
  onOpen() {
    this.titleEl.setText(this.heading);
    this.contentEl.createEl("p", { text: this.text });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: this.action, cls: "mod-warning" }).onclick = () => { this.close(); this.onConfirm(); };
    row.createEl("button", { text: t("cancel") }).onclick = () => this.close();
  }
  onClose() { this.contentEl.empty(); }
}

// --- the view --------------------------------------------------------------------------------

class FocusRenderer extends MarkdownRenderChild {
  // `leaf`: the pane the list fills (none for a code block in a note).
  constructor(plugin, el, sourcePath, leaf = null) {
    super(el);
    Object.assign(this, { plugin, sourcePath, leaf });
  }

  // Opens a note: Cmd/Ctrl-click in a new tab; from the pane never over the list itself.
  open(file, e = null, eState = null) {
    const ws = this.plugin.app.workspace;
    let leaf = ws.getLeaf(e ? Keymap.isModEvent(e) : false);
    if (this.leaf && leaf === this.leaf) leaf = ws.getLeaf("tab");
    return leaf.openFile(file, eState ? { eState } : undefined);
  }

  // Every draggable row maps to what it shows: {type: "area" | "area-title" | "project" | "task", ...}.
  track(el, item) {
    el.setAttr("data-ft", item.type);
    this.items.set(el, item);
  }

  get scroller() { return this.containerEl.closest(".markdown-preview-view, .view-content"); }

  onload() {
    const later = () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.render(), 300); };
    this.registerEvent(this.plugin.app.metadataCache.on("changed", later));
    this.registerEvent(this.plugin.app.vault.on("delete", later));
    this.registerEvent(this.plugin.app.vault.on("rename", later));
    this.plugin.views.add(this);
    this.render();
  }
  onunload() { clearTimeout(this.timer); this.plugin.views.delete(this); }

  // Renders run one at a time; a change during a render, an edit or a drag queues one more.
  async render() {
    if (this.busy || this.editing || this.held) { this.again = true; return; }
    this.busy = true;
    try { await this.build(); } finally { this.busy = false; }
    if (this.again) { this.again = false; this.render(); }
  }

  // Builds off-screen and swaps in one go: emptying the live block first would collapse the page
  // and throw the scroll back to the top on every change.
  async build() {
    const p = this.plugin;
    const everything = p.everything();
    const areas = await p.collect(false);
    const rest = everything ? (await p.collect(true)).filter((a) => !a.focus) : [];
    const shownAreas = [...areas, ...rest];
    this.items = new WeakMap();
    // [key, all] of every foldable header on screen (also inside folded areas)
    this.folds = [
      ...areas.flatMap((a) => [["area:" + a.name, false], ...a.projects.map((pr) => ["project:" + pr.file.path, false]),
        ...a.future.projects.map((pr) => ["later:" + pr.file.path, false])]),
      ...rest.flatMap((a) => [["area:" + a.name, true], ...a.projects.map((pr) => ["project:" + pr.file.path, true])]),
    ];
    this.shown = { areas: shownAreas.map((a) => a.name), projects: Object.fromEntries(shownAreas.map((a) => [a.name, a.projects.map((pr) => pr.file.path)])) };
    const old = this.inner;
    this.inner = this.addChild(new Component());
    const el = createDiv();
    const none = !p.notes().length;
    if (none) el.createDiv({ cls: "ft-empty ft-onboarding", text: t("noAreas") });
    else if (!areas.length) el.createDiv({ cls: "ft-empty", text: t("focusEmpty") });
    for (const area of areas) await this.area(el, area, false, everything);
    if (everything) {
      if (rest.length) el.createDiv({ cls: "ft-rest-title", text: t("restTitle") });
      for (const area of rest) await this.area(el, area, true);
    }
    const foot = el.createDiv({ cls: "ft-foot" });
    // The bottom buttons keep their spot on screen: what opens or closes above them grows or shrinks
    // out of sight, and after «All» the place of the button is taken by «Other areas».
    const pin = (selector) => { this.pin = { selector, y: foot.getBoundingClientRect().top }; document.activeElement?.blur(); };
    if (!none) {
      const toggle = foot.createEl("button", { cls: "ft-foot-button ft-all-toggle" });
      setIcon(toggle.createSpan(), everything ? "chevron-up" : "chevrons-down");
      toggle.createSpan({ text: everything ? t("hide") : t("all") });
      toggle.onclick = () => { pin(everything ? ".ft-foot" : ".ft-rest-title, .ft-foot"); p.setEverything(!everything); };
    }
    foot.createEl("button", { text: t("newArea"), cls: "ft-foot-button ft-new-area" }).onclick = () => p.newArea();
    foot.createEl("button", { text: t("areaFromNote"), cls: "ft-foot-button ft-area-from-note" }).onclick = () => p.areaFromNote();
    foot.createDiv({ cls: "ft-foot-gap" });
    if (!none) {
      for (const [label, icon, open] of [["foldAll", "chevrons-down-up", false], ["unfoldAll", "chevrons-up-down", true]]) {
        const b = foot.createEl("button", { cls: "ft-foot-button" });
        setIcon(b.createSpan(), icon);
        b.createSpan({ text: t(label) });
        b.onclick = () => { pin(".ft-foot"); p.foldAll(this.folds, open); };
      }
    }
    if (old) this.removeChild(old);
    this.containerEl.addClass("focus-tasks-view");
    this.containerEl.replaceChildren(...el.childNodes);
    this.hold();
  }

  // Obsidian may move the scroll a moment after a re-render; a pinned spot is held for a second,
  // unless you scroll yourself.
  hold() {
    if (!this.pin) return;
    const { selector, y } = this.pin;
    this.pin = null;
    const target = this.containerEl.querySelector(selector);
    const scroller = this.scroller;
    if (!target || !scroller) return;
    const fix = () => {
      const drift = target.getBoundingClientRect().top - y;
      if (Math.abs(drift) > 1) scroller.scrollTop += drift;
    };
    const release = () => {
      scroller.removeEventListener("scroll", fix);
      scroller.removeEventListener("wheel", release);
      scroller.removeEventListener("touchstart", release);
    };
    fix();
    scroller.addEventListener("scroll", fix);
    scroller.addEventListener("wheel", release, { passive: true });
    scroller.addEventListener("touchstart", release, { passive: true });
    setTimeout(release, 1200);
  }

  // `all`: an area of «Other areas» (every task, folded until opened); `wide`: «All» is on, so the
  // upcoming block of a focus area is open unless hidden there (a separate key from the plain view).
  async area(el, area, all = false, wide = false) {
    const p = this.plugin;
    const box = el.createDiv({ cls: "ft-area" });
    const title = box.createDiv({ cls: "ft-area-title" });
    this.track(box, { type: "area", area });
    this.track(title, { type: "area-title", area });
    const key = "area:" + area.name;
    const open = p.isShown(key, all);
    this.caret(title, open, () => p.toggleShown(key, all));
    const emoji = area.name.slice(0, area.name.length - bare(area.name).length).trim();
    title.createSpan({ cls: "ft-emoji", text: emoji });  // empty keeps the column when there is none
    const name = title.createSpan({ text: bare(area.name) || area.name });
    if (area.note) this.link(name, area.note);
    const tasks = [...area.loose, ...area.projects.flatMap((pr) => pr.tasks)];
    const focus = tasks.filter(inFocus).length;
    if (all) title.createSpan({ cls: "ft-count", text: t("openCount", tasks.length) + (focus ? t("inFocus", focus) : "") });
    else if (!open) title.createSpan({ cls: "ft-count", text: String(tasks.length) });
    this.plus(title, t("addToArea"), async () => {
      const file = area.note || await p.createArea(area.name);
      return file && { file, project: false, noDate: all };
    }, () => [...box.querySelectorAll(":scope > ul.ft-list")].pop() || title);
    this.more(title, (menu) => this.areaMenu(menu, area));
    this.grip(title, { type: "area", area });
    if (!open) return;
    if (all) {
      if (area.loose.length) await this.list(box, area.loose, true);
      for (const project of area.projects) await this.project(box, area, project, false, true);
      if (!area.loose.length && !area.projects.length) {
        // «Empty» is the first row's placeholder: a click turns it into a new task being typed
        const empty = box.createDiv({ cls: "ft-empty ft-empty-add", text: t("empty"), attr: { "aria-label": t("addTask") } });
        empty.onclick = async () => {
          const file = area.note || await p.createArea(area.name);
          if (!file) return;
          this.draft(empty, { file, project: false, noDate: true });
          empty.remove();
        };
      }
      return;
    }
    if (area.loose.length) await this.list(box, area.loose);
    for (const project of area.projects) await this.project(box, area, project);
    if (!area.later && !area.future.projects.length) return;
    const futureKey = (wide ? "futureoff:" : "future:") + area.name;
    const shown = wide ? !p.isShown(futureKey, true) : p.isShown(futureKey, true);
    this.upcoming(box, area, shown, futureKey);
    if (!shown) return;
    const block = box.createDiv({ cls: "ft-future-block" });
    if (area.future.loose.length) await this.list(block, area.future.loose);
    for (const project of area.future.projects) await this.project(block, area, project, true);
  }

  // «Show upcoming · N» under the focus of an area; «Hide upcoming» when the block is open.
  upcoming(box, area, shown, key) {
    const row = box.createDiv({ cls: "ft-future" });
    setIcon(row.createSpan({ cls: "ft-future-icon" }), shown ? "chevron-up" : "calendar-clock");
    row.createSpan({ text: shown ? t("hideUpcoming") : t("showUpcoming") + (area.later ? ` · ${area.later}` : "") });
    row.onclick = async () => {
      await this.plugin.toggleShown(key, true);
      this.plugin.refresh();
    };
  }

  // `later`: the project's copy in the upcoming block (its own fold state, new steps without a date).
  async project(box, area, project, later = false, all = false) {
    const p = this.plugin;
    const path = project.file.path;
    const key = (later ? "later:" : "project:") + path;
    const open = p.isShown(key, all);
    const head = box.createDiv({ cls: "ft-project" });
    if (later) head.addClass("is-later");
    this.track(head, { type: "project", area, project });
    this.caret(head, open, () => p.toggleShown(key, all));
    head.createSpan({ cls: "ft-icon", text: "📁" });
    this.link(head.createSpan({ text: project.file.basename }), project.file);
    const focus = project.tasks.filter(inFocus).length;
    if (all) head.createSpan({ cls: "ft-count", text: `${project.tasks.length}` + (focus ? t("inFocus", focus) : "") });
    else if (!open) head.createSpan({ cls: "ft-count", text: String(project.tasks.length) });
    this.plus(head, t("addStep"), () => ({ file: project.file, project: true, noDate: later || all }), () => {
      const body = head.nextElementSibling?.hasClass("ft-project-body") ? head.nextElementSibling : null;
      if (body) return body.lastElementChild || body;
      const fresh = createDiv({ cls: "ft-project-body" });
      head.after(fresh);
      return fresh.appendChild(createDiv());
    });
    this.more(head, (menu) => this.projectMenu(menu, area, project, head));
    this.grip(head, { type: "project", area, project });
    if (open) await this.list(box.createDiv({ cls: "ft-project-body" }), project.tasks, all);
  }

  // Drag by the grip (mouse or finger — pointer events). Areas reorder among areas, projects within
  // their area, tasks move before/after another task (any note) or into a project / area when
  // dropped on its header. A click without moving opens the row's menu.
  grip(parent, item) {
    const grip = parent.createSpan({ cls: "ft-grip", attr: { "aria-label": t("drag") } });
    setIcon(grip, "grip-vertical");
    grip.addEventListener("click", (e) => e.stopPropagation());
    grip.addEventListener("pointerdown", (e) => this.drag(e, item, grip));
  }

  target(item, x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || !this.containerEl.contains(el)) return null;
    let hit;
    if (item.type === "area") hit = el.closest(".ft-area[data-ft]");
    else if (item.type === "project") hit = el.closest(".ft-project[data-ft]");
    else hit = el.closest(".ft-task[data-ft], .ft-project[data-ft], .ft-area-title[data-ft]");
    const target = hit && this.items.get(hit);
    if (!target) return null;
    if (item.type === "area" && target.area.name === item.area.name) return null;
    if (item.type === "project" && (target.area.name !== item.area.name || target.project.file === item.project.file)) return null;
    if (item.type === "task" && target.type === "task" && target.task.file === item.task.file && target.task.lineNo === item.task.lineNo) return null;
    const r = hit.getBoundingClientRect();
    const into = item.type === "task" && target.type !== "task";
    return { el: hit, target, into, after: !into && y > r.top + r.height / 2 };
  }

  drag(e, item, grip) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const row = item.type === "area" ? grip.closest(".ft-area") : grip.closest(".ft-project, .ft-task");
    const scroller = this.scroller;
    const line = document.body.createDiv({ cls: "ft-drop-line" });
    const x0 = e.clientX, y0 = e.clientY;
    let drop = null, lastY = y0, lastX = x0, marked = null, dragging = false;
    const show = () => {
      marked?.removeClass("ft-drop-into");
      marked = null;
      line.style.display = "none";
      if (!drop) return;
      if (drop.into) { marked = drop.el; marked.addClass("ft-drop-into"); return; }
      let r = drop.el.getBoundingClientRect();
      const body = drop.el.nextElementSibling;
      if (drop.after && drop.target.type === "project" && body?.hasClass("ft-project-body")) r = { ...r.toJSON(), bottom: body.getBoundingClientRect().bottom };
      Object.assign(line.style, { display: "block", left: `${r.left}px`, width: `${r.width}px`, top: `${(drop.after ? r.bottom : r.top) - 1}px` });
    };
    const scroll = setInterval(() => {
      if (!scroller || !dragging) return;
      const b = scroller.getBoundingClientRect();
      const step = lastY < b.top + 60 ? -12 : lastY > b.bottom - 60 ? 12 : 0;
      if (step) { scroller.scrollTop += step; drop = this.target(item, lastX, lastY); show(); }
    }, 30);
    const move = (ev) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!dragging && Math.hypot(lastX - x0, lastY - y0) < 5) return;
      if (!dragging) { dragging = true; row.addClass("ft-dragging"); document.body.addClass("ft-drag-active"); }
      drop = this.target(item, lastX, lastY);
      show();
    };
    // Listened on the window: a row that goes away mid-drag must not leave the drag hanging.
    const up = (ev) => end(true, ev), cancel = () => end(false);
    let ended = false;
    const end = async (commit, ev) => {
      if (ended) return;
      ended = true;
      clearInterval(scroll);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      this.held = false;
      marked?.removeClass("ft-drop-into");
      line.remove();
      row.removeClass("ft-dragging");
      document.body.removeClass("ft-drag-active");
      if (commit && !dragging) this.openMenu(item, ev, row);
      else if (commit && drop) await this.plugin.drop(item, drop, this.shown);
      if (this.again) { this.again = false; this.render(); }
    };
    this.held = true;  // no re-render under the finger
    grip.setPointerCapture(e.pointerId);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
  }

  openMenu(item, e, row) {
    if (item.type === "task") return this.taskMenu(item.task, e);
    const menu = new Menu();
    if (item.type === "area") this.areaMenu(menu, item.area);
    else this.projectMenu(menu, item.area, item.project, row);
    menu.showAtMouseEvent(e);
  }

  caret(parent, open, toggle) {
    const caret = parent.createSpan({ cls: "ft-caret", attr: { "aria-label": open ? t("collapse") : t("expand") } });
    setIcon(caret, open ? "chevron-down" : "chevron-right");
    caret.onclick = async (e) => { e.stopPropagation(); await toggle(); this.plugin.refresh(); };
  }

  // "+" on a header: an empty row right there — the area's inbox or the project's steps.
  plus(parent, label, target, anchor) {
    const btn = parent.createSpan({ cls: "ft-plus", attr: { "aria-label": label } });
    setIcon(btn, "plus");
    btn.onclick = async (e) => {
      e.stopPropagation();
      const tg = await target();
      if (tg) this.draft(anchor(), tg);
    };
  }

  // «Today» / «Yesterday» / the date: past red, today green, future in the accent colour; no date — a
  // faint calendar.
  dateLabel(el, task) {
    el.empty();
    el.className = "ft-date";
    if (!task.date) {
      el.addClass("is-empty");
      el.setAttr("aria-label", t("setDate"));
      setIcon(el, "calendar-plus");
      return;
    }
    const now = today(), yesterday = moment().subtract(1, "day").format("YYYY-MM-DD");
    el.setText(task.date === now ? t("today") : task.date === yesterday ? t("yesterday") : moment(task.date).format(this.plugin.settings.dateFormat || "DD.MM.YY"));
    el.addClass(task.date === now ? "is-today" : task.date < now ? "is-past" : "is-future");
  }

  editDate(task, el) {
    if (this.editing) return;
    this.editing = true;
    el.addClass("is-active");
    new DatePicker(el, task.date, async (day) => {
      this.editing = false;
      if (day !== (task.date || null)) await this.plugin.setDate(task, day);
      this.render();
    }, () => {
      this.editing = false;
      el.removeClass("is-active");
      this.render();
    });
  }

  // Turns the text of a row into an editor: the raw markdown of the task, caret at the clicked
  // character (proportional when links render shorter than their source).
  editInline(task, el, e) {
    if (el.isContentEditable || this.editing) return;
    let offset = null;
    const hit = e && document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (hit && el.contains(hit.startContainer)) {
      const before = document.createRange();
      before.selectNodeContents(el);
      before.setEnd(hit.startContainer, hit.startOffset);
      offset = before.toString().length;
    }
    const shown = el.textContent;
    if (offset !== null && shown !== task.text) offset = Math.round((offset * task.text.length) / Math.max(1, shown.length));
    el.textContent = task.text;
    const saveText = async (value) => {
      if (value && value !== task.text) await this.plugin.rename(task, value);
      return task;
    };
    // The date changes at once and the label on the right follows; the text stays in edit.
    const redate = async (day) => {
      await this.plugin.setDate(task, day);
      const parsed = parseLine(task.line);
      Object.assign(task, { date: parsed?.date || null, mark: parsed?.mark || null });
      const label = el.closest("li")?.querySelector(".ft-date");
      if (label) this.dateLabel(label, task);
    };
    const day = (n) => moment().add(n, "days").format("YYYY-MM-DD");
    this.editor(el, Math.min(offset ?? task.text.length, task.text.length), saveText, {
      1: () => redate(day(0)),
      2: () => redate(day(1)),
      4: () => redate(null),
      // the picker takes the focus, so the text is saved first and the editor closes
      3: async (close) => {
        const label = el.closest("li")?.querySelector(".ft-date");
        await close(true, false);
        if (label) this.editDate(task, label);
      },
    }, (anchor) => this.rowAfter(el.closest("li"), anchor, inFocus(task) ? today() : null));
  }

  // An empty task row right under `prev`, written after `anchor`'s line (same indent) on Enter; then
  // the next one, until an empty Enter or Esc.
  rowAfter(prev, anchor, day) {
    const li = createEl("li", { cls: "task-list-item ft-task ft-draft-row" });
    const level = prev.style.getPropertyValue("--ft-level");
    if (level) li.style.setProperty("--ft-level", level);
    li.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { disabled: "" } });
    const text = li.createSpan({ cls: "ft-text", attr: { "data-placeholder": t("newTask") } });
    prev.after(li);
    this.editor(text, 0, async (value) => {
      if (!value) { li.remove(); return null; }
      return this.plugin.insertAfter(anchor, value, day);
    }, {}, (next) => this.rowAfter(li, next, day));
  }

  // An empty row under `anchor` for a new task in `target`; Enter saves it and opens the next one.
  draft(anchor, target) {
    if (this.editing) return;
    const ul = createEl("ul", { cls: "contains-task-list ft-list ft-draft" });
    const li = ul.createEl("li", { cls: "task-list-item ft-task" });
    li.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { disabled: "" } });
    const text = li.createSpan({ cls: "ft-text", attr: { "data-placeholder": target.project ? t("newStep") : t("newTask") } });
    anchor.after(ul);
    this.editor(text, 0, async (value) => {
      if (!value) { ul.remove(); return null; }
      await this.plugin.addLine(target, value, target.noDate ? null : today());
      return ul;
    }, {}, (prev) => this.draft(prev, target));
  }

  // The project's name becomes editable; Enter renames the note (links follow) and opens a row for
  // a new project right below.
  renameProject(head, area, project) {
    const name = head.querySelector(".ft-link");
    if (!name || this.editing) return;
    this.editor(name, project.file.basename.length, async (value) => {
      if (value && value !== project.file.basename) await this.plugin.renameProject(project.file, value);
      return head;
    }, {}, (prev) => this.projectRow(prev, area, project.file.path));
  }

  // An empty project row after `prev`; Enter creates the project note in this area, ordered right
  // after `afterPath`.
  projectRow(prev, area, afterPath) {
    let spot = prev;
    while (spot.nextElementSibling?.hasClass("ft-project-body")) spot = spot.nextElementSibling;
    const row = createDiv({ cls: "ft-project ft-draft-row" });
    row.createSpan({ cls: "ft-caret" });
    row.createSpan({ cls: "ft-icon", text: "📁" });
    const text = row.createSpan({ cls: "ft-link ft-text", attr: { "data-placeholder": t("newProject") } });
    spot.after(row);
    this.editor(text, 0, async (value) => {
      if (!value) { row.remove(); return null; }
      const file = await this.plugin.createProject(area, value, afterPath);
      return file && { row, path: file.path };
    }, {}, (made) => this.projectRow(made.row, area, made.path));
  }

  // contenteditable with note-like keys: Enter or leaving saves, Esc cancels; one line, plain text.
  // `hotkeys`: Mod+<key> handlers; `onEnter(result of save)` continues with a next row.
  editor(el, offset, save, hotkeys = {}, onEnter = null) {
    this.editing = true;
    el.contentEditable = "true";
    el.addClass("is-editing");
    el.focus();
    const node = el.firstChild;
    const range = document.createRange();
    if (node && node.nodeType === Node.TEXT_NODE) range.setStart(node, offset);
    else range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    let done = false;
    const scope = new Scope(this.plugin.app.scope);
    const finish = async (keep, rerender = true) => {
      if (done) return;
      done = true;
      this.plugin.app.keymap.popScope(scope);
      el.contentEditable = "false";
      el.removeClass("is-editing");
      const value = el.textContent.replace(/\s+/g, " ").trim();
      let result;
      if (keep) result = await save(value);
      else el.closest(".ft-draft, .ft-draft-row")?.remove();
      this.editing = false;
      if (rerender) this.render();
      return result;
    };
    for (const [key, run] of Object.entries(hotkeys)) {
      scope.register(["Mod"], key, (ev) => {
        ev.preventDefault();
        if (!done) run(finish);
        return false;
      });
    }
    this.plugin.app.keymap.pushScope(scope);
    el.onkeydown = (ev) => {
      if (ev.key === "Enter" && !ev.isComposing && onEnter) {
        ev.preventDefault();
        finish(true, false).then((r) => (r ? onEnter(r) : this.render()));
      } else if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
      ev.stopPropagation();
    };
    el.onblur = () => finish(true);
    el.onpaste = (ev) => {
      ev.preventDefault();
      document.execCommand("insertText", false, ev.clipboardData.getData("text/plain").replace(/\s+/g, " "));
    };
  }

  // ⋯ button and right click on a header open the same menu.
  more(parent, build) {
    const show = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const menu = new Menu();
      build(menu);
      menu.showAtMouseEvent(e);
    };
    const btn = parent.createSpan({ cls: "ft-more", attr: { "aria-label": t("actions") } });
    setIcon(btn, "more-horizontal");
    btn.onclick = show;
    parent.oncontextmenu = show;
  }

  areaMenu(menu, area) {
    const p = this.plugin;
    menu.addItem((i) => i.setTitle(t("addToArea")).setIcon("plus").onClick(async () => {
      const file = area.note || await p.createArea(area.name);
      if (file) p.addTask(null, { file, project: false });
    }));
    menu.addItem((i) => i.setTitle(t("newProject")).setIcon("folder-plus").onClick(() => p.newProject(area)));
    menu.addItem((i) => i.setTitle(t("projectFromNote")).setIcon("file-plus").onClick(() => p.projectFromNote(area)));
    menu.addSeparator();
    this.noteItems(menu, area.note, async () => area.note || await p.createArea(area.name));
    menu.addSeparator();
    menu.addItem((i) => {
      i.setTitle(t("deleteArea")).setIcon("trash-2").onClick(() => p.deleteArea(area));
      if (i.setWarning) i.setWarning(true);
    });
  }

  projectMenu(menu, area, project, head) {
    const p = this.plugin;
    menu.addItem((i) => i.setTitle(t("addStep")).setIcon("plus").onClick(() => p.addTask(null, { file: project.file, project: true })));
    if (head) menu.addItem((i) => i.setTitle(t("rename")).setIcon("pencil").onClick(() => this.renameProject(head, area, project)));
    menu.addSeparator();
    this.noteItems(menu, project.file, () => project.file);
    menu.addSeparator();
    menu.addItem((i) => {
      i.setTitle(t("deleteProject")).setIcon("trash-2").onClick(() => p.deleteProject(area, project));
      if (i.setWarning) i.setWarning(true);
    });
  }

  // The linked note and the task file behind an area or a project. `file`: the task file (an area
  // may have none yet); `ensure()` makes it when a note is linked.
  noteItems(menu, file, ensure) {
    const p = this.plugin;
    const note = file && p.linked(file);
    if (note) menu.addItem((i) => i.setTitle(t("openNote")).setIcon("file-symlink").onClick(() => this.open(note)));
    if (file) menu.addItem((i) => i.setTitle(t("openFile")).setIcon("file-check").onClick(() => this.open(file)));
    menu.addItem((i) => i.setTitle(note ? t("relinkNote") : t("linkNote")).setIcon("link").onClick(async () => {
      const own = await ensure();
      if (own) p.pickNote((picked) => p.setLinked(own, picked));
    }));
    if (note) menu.addItem((i) => i.setTitle(t("unlinkNote")).setIcon("unlink").onClick(() => p.setLinked(file, null)));
  }

  taskMenu(task, e) {
    const p = this.plugin;
    const day = (n) => moment().add(n, "days").format("YYYY-MM-DD");
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(t("today")).setIcon("calendar-check").onClick(() => p.setDate(task, day(0))));
    menu.addItem((i) => i.setTitle(t("tomorrow")).setIcon("calendar-plus").onClick(() => p.setDate(task, day(1))));
    menu.addItem((i) => i.setTitle(t("noDate")).setIcon("calendar-x").onClick(() => p.setDate(task, null)));
    menu.addSeparator();
    if (p.tasksApi()) menu.addItem((i) => i.setTitle(t("tasksDialog")).setIcon("calendar-days").onClick(() => p.edit(task)));
    menu.addItem((i) => i.setTitle(t("openInNote")).setIcon("file-text").onClick(() => this.open(task.file, null, { line: task.lineNo })));
    menu.addItem((i) => {
      i.setTitle(t("delete")).setIcon("trash-2").onClick(() => p.remove(task));
      if (i.setWarning) i.setWarning(true);
    });
    menu.showAtMouseEvent(e);
  }

  // The name of an area or a project opens its linked note, or the task file when there is none.
  link(el, file) {
    el.addClass("ft-link");
    const note = this.plugin.linked(file);
    if (note) {
      el.addClass("is-linked");
      el.setAttr("aria-label", t("linkedNote", note.basename));
    }
    el.onclick = (e) => { if (!el.isContentEditable) this.open(this.plugin.linked(file) || file, e); };
  }

  async list(parent, tasks, all = false) {
    const ul = parent.createEl("ul", { cls: "contains-task-list ft-list" });
    for (const task of tasks) {
      const li = ul.createEl("li", { cls: "task-list-item ft-task", attr: { "data-task": task.status } });
      if (!all && !inFocus(task)) li.addClass("is-later");
      if (all && task.indent) li.style.setProperty("--ft-level", task.indent);
      const box = li.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
      box.onclick = (e) => { e.preventDefault(); this.plugin.toggle(task); };
      const text = li.createSpan({ cls: "ft-text" });
      await MarkdownRenderer.render(this.plugin.app, task.text, text, task.file.path, this.inner);
      const para = text.querySelector("p");
      if (para) para.replaceWith(...para.childNodes);
      const date = li.createSpan();
      this.dateLabel(date, task);
      date.onclick = (e) => { e.stopPropagation(); this.editDate(task, date); };
      text.onclick = (e) => {
        if (e.target.closest("a")) return;
        e.stopPropagation();
        this.editInline(task, text, e);
      };
      li.onclick = (e) => {
        if (e.target.closest("a, input, .ft-grip, .ft-date")) return;
        this.editInline(task, text, null);
      };
      li.oncontextmenu = (e) => { e.preventDefault(); this.taskMenu(task, e); };
      this.track(li, { type: "task", task });
      this.grip(li, { type: "task", task });
    }
  }
}

// The same list as a pane of its own (ribbon icon / command).
class FocusView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return t("viewTitle"); }
  getIcon() { return "list-checks"; }
  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("focus-tasks-pane");
    this.addChild(new FocusRenderer(this.plugin, this.contentEl.createDiv(), "", this.leaf));
  }
}

// --- settings --------------------------------------------------------------------------------

class FocusSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;
    containerEl.empty();
    const text = (name, desc, key, placeholder) => new Setting(containerEl).setName(t(name)).setDesc(t(desc))
      .addText((c) => c.setPlaceholder(placeholder || DEFAULTS[key]).setValue(s[key]).onChange(async (v) => {
        s[key] = v.trim() || DEFAULTS[key];
        await p.saveAll();
        p.refresh();
      }));
    text("sFolder", "sFolderDesc", "folder");
    new Setting(containerEl).setName(t("sLanguage")).setDesc(t("sLanguageDesc")).addDropdown((d) => d
      .addOptions({ auto: "Auto", en: "English", ru: "Русский" }).setValue(s.language).onChange(async (v) => {
        s.language = v;
        p.applyLanguage();
        await p.saveAll();
        p.refresh();
        this.display();
      }));
    text("sAreaName", "sAreaNameDesc", "areaNoteName");
    new Setting(containerEl).setName(t("sAreaFm")).setDesc(t("sAreaFmDesc")).addTextArea((c) => c
      .setPlaceholder('parents:\n  - "[[Projects]]"').setValue(s.areaFrontmatter).onChange(async (v) => {
        s.areaFrontmatter = v.replace(/\s+$/, "");
        await p.saveAll();
      }));
    text("sTypeArea", "sTypeDesc", "typeArea");
    text("sTypeProject", "sTypeDesc", "typeProject");
    text("sSteps", "sStepsDesc", "stepsHeading");
    text("sInbox", "sInboxDesc", "inboxHeading");
    text("sProjects", "sProjectsDesc", "projectsHeading");
    text("sDateFormat", "sDateFormatDesc", "dateFormat");
    new Setting(containerEl).setName(t("sTasks")).setDesc(t("sTasksDesc")).addToggle((c) => c
      .setValue(s.useTasksPlugin).onChange(async (v) => { s.useTasksPlugin = v; await p.saveAll(); }));
  }
}

// --- the plugin ------------------------------------------------------------------------------

module.exports = class FocusTasks extends Plugin {
  async onload() {
    const saved = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULTS, saved.settings);
    this.data = { folded: saved.folded || {}, opened: saved.opened || {}, order: Object.assign({ areas: [], projects: {} }, saved.order) };
    this.applyLanguage();
    this.views = new Set();
    this.registerView(VIEW_TYPE, (leaf) => new FocusView(leaf, this));
    this.registerMarkdownCodeBlockProcessor("focus-tasks", (_src, el, ctx) => ctx.addChild(new FocusRenderer(this, el, ctx.sourcePath)));
    this.addRibbonIcon("list-checks", t("open"), () => this.openView());
    this.addSettingTab(new FocusSettingTab(this.app, this));
    this.addCommand({ id: "open", name: t("open"), callback: () => this.openView() });
    this.addCommand({ id: "toggle-all", name: t("cmdToggleAll"), callback: () => this.setEverything(!this.everything()) });
    const folds = () => [...this.views].find((v) => v.containerEl.isConnected && v.containerEl.offsetParent)?.folds;
    this.addCommand({ id: "fold-all", name: t("cmdFoldAll"), callback: () => this.foldAll(folds(), false) });
    this.addCommand({ id: "unfold-all", name: t("cmdUnfoldAll"), callback: () => this.foldAll(folds(), true) });
    this.addCommand({ id: "add-task", name: t("cmdAddTask"), callback: () => this.addTask(today()) });
    this.addCommand({ id: "add-area", name: t("cmdAddArea"), callback: () => this.newArea() });
    this.addCommand({ id: "area-from-note", name: t("cmdAreaFromNote"), checkCallback: (checking) => {
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== "md" || this.classify(file)) return false;
      if (!checking) this.areaFromNote(file);
      return true;
    } });
  }

  applyLanguage() {
    const chosen = this.settings.language;
    const obsidian = (window.localStorage.getItem("language") || "en").slice(0, 2);
    LANG = chosen === "auto" ? (STRINGS[obsidian] ? obsidian : "en") : chosen;
  }

  async saveAll() {
    await this.saveData({ settings: this.settings, folded: this.data.folded, opened: this.data.opened, order: this.data.order });
  }

  async openView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  refresh() { for (const v of this.views) v.render(); }

  // «All» is per device (a phone may stay on the focus while a laptop shows everything).
  everything() { return this.app.loadLocalStorage("focus-tasks-all") === "1"; }
  setEverything(on) { this.app.saveLocalStorage("focus-tasks-all", on ? "1" : null); this.refresh(); }

  // The focus: areas and projects open unless folded. «Other areas»: closed unless opened.
  isShown(key, all) { return all ? !!this.data.opened[key] : !this.data.folded[key]; }

  async toggleShown(key, all) {
    const map = all ? this.data.opened : this.data.folded;
    if (map[key]) delete map[key];
    else map[key] = true;
    await this.saveAll();
  }

  // open=false folds every header in `folds` ([key, all]); open=true opens them.
  async foldAll(folds, open) {
    for (const [key, all] of folds || []) {
      if (all) { if (open) this.data.opened[key] = true; else delete this.data.opened[key]; }
      else if (open) delete this.data.folded[key];
      else this.data.folded[key] = true;
    }
    await this.saveAll();
    this.refresh();
  }

  async forget(key) {
    delete this.data.opened[key];
    delete this.data.folded[key];
    await this.saveAll();
  }

  async setOpen(key, open) {
    if (open) this.data.opened[key] = true;
    else delete this.data.opened[key];
    await this.saveAll();
  }

  tasksApi() {
    if (!this.settings.useTasksPlugin) return null;
    return this.app.plugins?.plugins?.["obsidian-tasks-plugin"]?.apiV1 || null;
  }

  // --- notes --------------------------------------------------------------------------------

  get folder() { return normalizePath(this.settings.folder || DEFAULTS.folder); }

  isProjectType(type) {
    const s = String(type ?? "").trim();
    return s === this.settings.typeProject || [this.settings.typeProject.toLowerCase(), ...PROJECT_WORDS].includes(s.toLowerCase());
  }

  inFolder(file) {
    const folder = this.folder;
    return folder === "/" || folder === "" || file.path.startsWith(folder + "/");
  }

  // A task file: a note in the folder with `area:` in its frontmatter; `type: <project word>` makes it
  // a project, anything else an area.
  classify(file) {
    if (!this.inFolder(file)) return null;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || !fm.area) return null;
    return { file, area: String(fm.area), project: this.isProjectType(fm.type) };
  }

  notes() {
    const out = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const n = this.classify(file);
      if (n) out.push(n);
    }
    return out;
  }

  // Where an area note takes a new task: its last section when that's the catch-all, else the inbox.
  areaSection(text) {
    const heads = text.split("\n").filter(isHead).map(headText);
    const last = heads[heads.length - 1];
    return [this.settings.inboxHeading, ...CATCH_ALL].includes(last) ? last : this.settings.inboxHeading;
  }

  async openTasks(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const items = (cache?.listItems || []).filter((i) => i.task !== undefined && !"xX-".includes(i.task));
    if (!items.length) return [];
    const lines = (await this.app.vault.cachedRead(file)).split("\n");
    const out = [];
    for (const i of items) {
      const lineNo = i.position.start.line;
      const parsed = parseLine(lines[lineNo] || "");
      if (parsed && parsed.text) out.push({ ...parsed, file, lineNo, line: lines[lineNo] });
    }
    return out;
  }

  // → [{name, note, loose, projects, focus, later, future}]. The focus keeps only tasks due today or
  // earlier (their areas only); `all` keeps every task of every area.
  async collect(all) {
    const byArea = new Map();
    const areaOf = (name) => {
      if (!byArea.has(name)) byArea.set(name, { name, note: null, loose: [], projects: [], focus: 0, later: 0, future: { loose: [], projects: [] } });
      return byArea.get(name);
    };
    const first = (tasks) => tasks.map((x) => x.date).filter(Boolean).sort()[0] || "9999";
    for (const n of this.notes()) {
      const area = areaOf(n.area);
      if (!n.project && !area.note) area.note = n.file;
      const open = await this.openTasks(n.file);
      const focus = open.filter(inFocus), later = open.filter((x) => !inFocus(x));
      area.focus += focus.length;
      area.later += later.length;
      const tasks = all ? open : focus;
      if (n.project) {
        if (all || tasks.length) area.projects.push({ file: n.file, tasks, first: first(tasks) });
        if (!all && (later.length || !focus.length)) area.future.projects.push({ file: n.file, tasks: later, first: first(later) });
      } else {
        area.loose.push(...tasks);
        if (!all) area.future.loose.push(...later);
      }
    }
    let areas = [...byArea.values()];
    if (!all) areas = areas.filter((a) => a.focus);
    // A dragged order wins; the rest follows it: areas by name, projects by their nearest date.
    const rank = (list, key) => { const i = (list || []).indexOf(key); return i < 0 ? 1e9 : i; };
    const order = this.data.order;
    const cmp = collator();
    const byOrder = (a) => (x, y) => rank(order.projects[a.name], x.file.path) - rank(order.projects[a.name], y.file.path)
      || x.first.localeCompare(y.first) || cmp(x.file.basename, y.file.basename);
    for (const a of areas) { a.projects.sort(byOrder(a)); a.future.projects.sort(byOrder(a)); }
    return areas.sort((a, b) => rank(order.areas, a.name) - rank(order.areas, b.name) || cmp(bare(a.name), bare(b.name)));
  }

  // --- tasks --------------------------------------------------------------------------------

  // Swap a task's line for new text (Tasks may return two lines: a recurring task's next copy).
  async replace(task, text) {
    let ok = false;
    await this.app.vault.process(task.file, (data) => {
      const lines = data.split("\n");
      const i = lines[task.lineNo] === task.line ? task.lineNo : lines.indexOf(task.line);
      if (i < 0) return data;
      ok = true;
      lines.splice(i, 1, ...text.replace(/\n$/, "").split("\n"));
      task.lineNo = i;
      return lines.join("\n");
    });
    if (ok) task.line = text.replace(/\n$/, "").split("\n")[0];
    else new Notice(t("changed"));
  }

  // Changes the date the row shows (its emoji kept: ⏳ stays ⏳, 📅 stays 📅); a task without one gets
  // ⏳; null drops it.
  async setDate(task, day) {
    const mark = task.mark || "⏳";
    const re = new RegExp(`\\s*${mark}\\uFE0F?\\s*\\d{4}-\\d{2}-\\d{2}`, "g");
    const body = task.line.replace(re, "").replace(/\s+$/, "");
    await this.replace(task, day ? `${body} ${mark} ${day}` : body);
  }

  // `drop` comes from FocusRenderer.target; `shown` is the order on screen.
  async drop(item, drop, shown) {
    const place = (list, key, targetKey, after) => {
      const out = list.filter((k) => k !== key);
      const i = out.indexOf(targetKey);
      out.splice(i < 0 ? out.length : i + (after ? 1 : 0), 0, key);
      return out;
    };
    const merge = (...lists) => [...new Set(lists.flat())];
    const cmp = collator();
    if (item.type === "area") {
      const rank = (a) => { const i = this.data.order.areas.indexOf(a); return i < 0 ? 1e9 : i; };
      const all = [...new Set(this.notes().map((n) => n.area))].sort((a, b) => rank(a) - rank(b) || cmp(bare(a), bare(b)));
      this.data.order.areas = place(all, item.area.name, drop.target.area.name, drop.after);
    } else if (item.type === "project") {
      const name = item.area.name;
      const mine = this.notes().filter((n) => n.project && n.area === name).map((n) => n.file.path);
      const all = merge(this.data.order.projects[name] || [], shown.projects[name] || [], mine);
      this.data.order.projects[name] = place(all, item.project.file.path, drop.target.project.file.path, drop.after);
    } else return this.moveTask(item.task, drop);
    await this.saveAll();
    this.refresh();
  }

  // Moves a task with its nested lines. Into another note it is written there first and only then
  // cut from its old place, so a failure leaves a copy rather than a loss.
  async moveTask(task, drop) {
    const eol = (before, after) => (before.endsWith("\n") && !after.endsWith("\n") ? after + "\n" : after);
    const find = (lines) => (lines[task.lineNo] === task.line ? task.lineNo : lines.indexOf(task.line));
    let dest, section = null;
    if (drop.into) {
      const tg = drop.target;
      dest = tg.type === "project" ? tg.project.file : (tg.area.note || await this.createArea(tg.area.name));
      if (!dest) return;
      section = tg.type === "project" ? this.settings.stepsHeading : null;
    } else dest = drop.target.task.file;
    const insert = (lines, block) => {
      if (drop.into) {
        const text = lines.join("\n");
        return insertBlock(text, reindent(block, 0), section || this.areaSection(text)).replace(/\n$/, "").split("\n");
      }
      const tg = drop.target.task;
      let j = lines[tg.lineNo] === tg.line ? tg.lineNo : lines.indexOf(tg.line);
      if (j < 0) return null;
      const indent = indentOf(lines[j]);
      if (drop.after) j = blockAt(lines, j);
      lines.splice(j, 0, ...reindent(block, indent));
      return lines;
    };
    let ok = false;
    if (dest === task.file) {
      await this.app.vault.process(dest, (data) => {
        const lines = data.split("\n");
        const i = find(lines);
        if (i < 0) return data;
        const end = blockAt(lines, i);
        const tg = drop.into ? null : drop.target.task;
        if (tg && tg.lineNo >= i && tg.lineNo < end && lines[tg.lineNo] === tg.line) return data;  // onto its own step
        const block = lines.splice(i, end - i);
        const out = insert(lines, block);
        if (!out) return data;
        ok = true;
        return eol(data, out.join("\n"));
      });
    } else {
      const src = (await this.app.vault.read(task.file)).split("\n");
      const i = find(src);
      if (i >= 0) {
        const block = src.slice(i, blockAt(src, i));
        await this.app.vault.process(dest, (data) => {
          const out = insert(data.split("\n"), block);
          if (!out) return data;
          ok = true;
          return eol(data, out.join("\n"));
        });
        if (ok) await this.app.vault.process(task.file, (data) => {
          const lines = data.split("\n");
          const k = find(lines);
          if (k >= 0) lines.splice(k, blockAt(lines, k) - k);
          return lines.join("\n");
        });
      }
    }
    if (!ok) new Notice(t("changed"));
  }

  // Deletes the task line and the lines nested under it; the notice can undo.
  async remove(task) {
    let removed = null, at = -1;
    await this.app.vault.process(task.file, (data) => {
      const lines = data.split("\n");
      const i = lines[task.lineNo] === task.line ? task.lineNo : lines.indexOf(task.line);
      if (i < 0) return data;
      const end = blockAt(lines, i);
      removed = lines.splice(i, end - i);
      at = i;
      return lines.join("\n");
    });
    if (!removed) { new Notice(t("changed")); return; }
    let undo;
    const notice = new Notice(createFragment((f) => {
      f.appendText(t("deleted", task.text) + " ");
      undo = f.createEl("a", { text: t("undo"), href: "#", cls: "ft-undo" });
    }), 10000);
    undo.onclick = async (e) => {
      e.preventDefault();
      notice.hide();
      await this.app.vault.process(task.file, (data) => {
        const lines = data.split("\n");
        lines.splice(Math.min(at, lines.length), 0, ...removed);
        return lines.join("\n");
      });
    };
  }

  // New text for a task, its dates kept.
  async rename(task, text) {
    const m = task.line.match(/^(\s*[-*] \[.\] )(.*)$/);
    if (!m) return;
    const dates = [...m[2].matchAll(DATE_RE)].map((d) => d[0].trim());
    await this.replace(task, m[1] + text + (dates.length ? " " + dates.join(" ") : ""));
    task.text = text;
  }

  // A new task line right after `anchor`'s block, at its indent → the new line (the next anchor).
  async insertAfter(anchor, text, day) {
    let made = null;
    await this.app.vault.process(anchor.file, (data) => {
      const lines = data.split("\n");
      const i = lines[anchor.lineNo] === anchor.line ? anchor.lineNo : lines.indexOf(anchor.line);
      if (i < 0) return data;
      const at = blockAt(lines, i);
      const line = `${lines[i].match(/^\s*/)[0]}- [ ] ${text}` + (day ? ` ⏳ ${day}` : "");
      lines.splice(at, 0, line);
      made = { file: anchor.file, line, lineNo: at };
      return lines.join("\n");
    });
    if (!made) new Notice(t("changed"));
    return made;
  }

  async addLine(target, text, day) {
    const line = `- [ ] ${text}` + (day ? ` ⏳ ${day}` : "");
    await this.app.vault.process(target.file, (body) => insertBlock(body, [line], target.project ? this.settings.stepsHeading : this.areaSection(body)));
    this.lastPath = target.file.path;
  }

  // Through Tasks when it is there (recurrence, its own ✅), otherwise [ ] ⇄ [x] with a ✅ date.
  async toggle(task) {
    const api = this.tasksApi();
    await this.replace(task, api ? api.executeToggleTaskDoneCommand(task.line, task.file.path) : toggleLine(task.line));
  }

  async edit(task) {
    const api = this.tasksApi();
    if (!api) return;
    const line = await api.editTaskLineModal(task.line);
    if (line && line !== task.line) await this.replace(task, line);
  }

  targets() {
    const cmp = collator();
    const out = this.notes().map((n) => ({
      ...n, label: n.project ? `📁 ${n.file.basename} · ${n.area}` : `🗂 ${n.area} ${t("looseTasks")}`,
    }));
    const last = this.lastPath;
    return out.sort((a, b) => (b.file.path === last) - (a.file.path === last)
      || cmp(bare(a.area), bare(b.area)) || (a.project - b.project) || cmp(a.file.basename, b.file.basename));
  }

  // --- areas and projects ------------------------------------------------------------------

  async ensureFolder() {
    const folder = this.folder;
    if (folder && folder !== "/" && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
  }

  async createArea(name, note = null) {
    await this.ensureFolder();
    const base = fileName((this.settings.areaNoteName || "{area}").replace("{area}", bare(name) || name));
    const path = normalizePath(`${this.folder}/${base}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) { new Notice(t("noteExists", path)); return null; }
    const extra = (this.settings.areaFrontmatter || "").trim();
    const file = await this.app.vault.create(path, ["---", ...(extra ? extra.split("\n") : []), `area: "${name.replace(/"/g, "'")}"`,
      `type: ${this.settings.typeArea}`, "---", ""].join("\n"));
    if (note) await this.setLinked(file, note, true);
    return file;
  }

  areaTaken(name) {
    return this.notes().some((n) => bare(n.area).toLowerCase() === bare(name).toLowerCase());
  }

  // `note`: an existing note the area is linked to (its name is offered as the area's name).
  newArea(note = null) {
    const title = note ? t("areaNameTitle", note.basename) : t("newAreaTitle");
    new NameModal(this.app, title, t("areaPlaceholder"), async (name) => {
      if (this.areaTaken(name)) { new Notice(t("areaExists", name)); return; }
      if (!await this.createArea(name, note)) return;
      await this.setOpen("area:" + name, true);
      new Notice(t("areaCreated", name));
      // a new area has nothing due yet, so it lives under «All»
      if (!this.everything()) this.setEverything(true);
      else this.refresh();
    }, t("create"), note ? note.basename : "").open();
  }

  areaFromNote(file) {
    if (file) this.newArea(file);
    else this.pickNote((note) => this.newArea(note));
  }

  projectFromNote(area) {
    this.pickNote(async (note) => {
      const file = await this.createProject(area, note.basename, null, note);
      if (file) new Notice(t("projectCreated", file.basename));
    });
  }

  // The note a task file is linked to (`note: "[[...]]"` in its frontmatter), if it still exists.
  linked(file) {
    const value = this.app.metadataCache.getFileCache(file)?.frontmatter?.note;
    const m = typeof value === "string" && value.match(/^\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/);
    if (!m) return null;
    const note = this.app.metadataCache.getFirstLinkpathDest(m[1].trim(), file.path);
    return note && note !== file ? note : null;
  }

  // Links (or with null unlinks) a note to a task file; Obsidian keeps the link right on renames.
  async setLinked(file, note, quiet = false) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (note) fm.note = `[[${this.app.metadataCache.fileToLinktext(note, file.path)}]]`;
      else delete fm.note;
    });
    if (!quiet) new Notice(note ? t("linked", note.basename) : t("unlinked"));
  }

  // Any note of the vault except the task files; recently edited first.
  pickNote(onChoose) {
    const files = this.app.vault.getMarkdownFiles().filter((f) => !this.classify(f)).sort((a, b) => b.stat.mtime - a.stat.mtime);
    new NotePicker(this.app, files, onChoose).open();
  }

  // Drops the 📁 lines pointing at a project file (by name or by path) from its area's files.
  async dropLinks(file, areaName) {
    const names = [file.basename, file.path.replace(/\.md$/, "")].map(escapeRe).join("|");
    const link = new RegExp(`^\\s*[-*] 📁 \\[\\[(${names})(\\|[^\\]]*)?\\]\\]\\s*$`);
    for (const n of this.notes()) {
      if (n.project || n.area !== areaName) continue;
      await this.app.vault.process(n.file, (body) => body.split("\n").filter((l) => !link.test(l)).join("\n"));
    }
  }

  newProject(area) {
    new NameModal(this.app, t("newProjectTitle", area.name), t("projectPlaceholder"), async (name) => {
      const file = await this.createProject(area, name);
      if (file) new Notice(t("projectCreated", file.basename));
    }).open();
  }

  // A project's task file in the folder, listed in the area's file; with `afterPath` it is ordered
  // right after that project; with `linkTo` it is linked to that note.
  async createProject(area, name, afterPath, linkTo = null) {
    await this.ensureFolder();
    const path = normalizePath(`${this.folder}/${fileName(name)}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) { new Notice(t("noteExists", path)); return null; }
    const note = area.note || await this.createArea(area.name);
    if (!note) return null;
    const file = await this.app.vault.create(path, ["---", `area: "${area.name.replace(/"/g, "'")}"`,
      `type: ${this.settings.typeProject}`, "---", "", `## ${this.settings.stepsHeading}`, ""].join("\n"));
    if (linkTo) await this.setLinked(file, linkTo, true);
    await this.app.vault.process(note, (body) => insertBlock(body, [`- 📁 [[${this.app.metadataCache.fileToLinktext(file, note.path)}]]`], this.settings.projectsHeading));
    await this.setOpen("area:" + area.name, true);
    await this.setOpen("project:" + file.path, true);
    if (afterPath) {
      const mine = this.notes().filter((n) => n.project && n.area === area.name).map((n) => n.file.path);
      const list = [...new Set([...(this.data.order.projects[area.name] || []), ...mine])].filter((k) => k !== file.path);
      const i = list.indexOf(afterPath);
      list.splice(i < 0 ? list.length : i + 1, 0, file.path);
      this.data.order.projects[area.name] = list;
      await this.saveAll();
    }
    return file;
  }

  // Renames a project note; Obsidian updates the links to it. The saved order and fold state follow.
  async renameProject(file, name) {
    const path = normalizePath(`${file.parent?.path && file.parent.path !== "/" ? file.parent.path + "/" : ""}${fileName(name)}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) { new Notice(t("noteExists", path)); return; }
    const old = file.path;
    await this.app.fileManager.renameFile(file, path);
    for (const list of Object.values(this.data.order.projects)) {
      const i = list.indexOf(old);
      if (i >= 0) list[i] = path;
    }
    for (const map of [this.data.opened, this.data.folded]) {
      for (const prefix of ["project:", "later:"]) {
        if (map[prefix + old]) { delete map[prefix + old]; map[prefix + path] = true; }
      }
    }
    await this.saveAll();
  }

  trash(file) {
    return this.app.fileManager.trashFile ? this.app.fileManager.trashFile(file) : this.app.vault.trash(file, true);
  }

  deleteProject(area, project) {
    const name = project.file.basename;
    new ConfirmModal(this.app, t("deleteProjectQ", name), t("deleteProjectText", project.tasks.length), t("delete"), async () => {
      await this.dropLinks(project.file, area.name);
      await this.trash(project.file);
      await this.forget("project:" + project.file.path);
      await this.forget("later:" + project.file.path);
      new Notice(t("projectDeleted", name));
    }).open();
  }

  deleteArea(area) {
    const files = this.notes().filter((n) => n.area === area.name).map((n) => n.file);
    const open = area.loose.length + area.projects.reduce((s, pr) => s + pr.tasks.length, 0);
    new ConfirmModal(this.app, t("deleteAreaQ", area.name), t("deleteAreaText", area.projects.length, open), t("delete"), async () => {
      for (const f of files) {
        await this.trash(f);
        await this.forget("project:" + f.path);
      }
      await this.forget("area:" + area.name);
      new Notice(t("areaDeleted", area.name));
    }).open();
  }

  // Text first, then where it goes (a known place skips the question).
  addTask(day, target) {
    new NameModal(this.app, t("newTask"), t("whatToDo"), async (text) => {
      const put = async (tg) => {
        if (tg.create) tg = { file: await this.createArea(tg.create), project: false };
        if (!tg.file) return;
        await this.addLine(tg, text, day);
        new Notice(t("taskIn", tg.file.basename));
      };
      if (target) await put(target);
      else new TargetModal(this.app, this.targets(), put).open();
    }, t("next")).open();
  }
};
