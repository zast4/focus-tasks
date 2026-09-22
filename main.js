/*
 * Focus Tasks — a focus list over plain Markdown notes.
 *
 * A task is a note of its own in the tasks folder: `type: задача`, everything else in the
 * frontmatter — `uid` (its identity, never rewritten), `status`, `area`, `projects`, `scheduled`,
 * `due`, `completedDate`, `priority`, `title` (only when the file name had to be cut); the body is
 * the description. The field names are TaskNotes' own, so that plugin reads and writes the same
 * notes; `uid` and `area` are ours and it keeps them untouched.
 *
 * Areas and projects are notes too, in the folder from the settings: a file with frontmatter
 * `area: <name>` is an area (it holds loose tasks); with
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
 * The checkbox completes a task (`status: done` + `completedDate`); for the rest of the day it stays
 * at the bottom of its area under «Completed», where its box brings it back.
 * The grip on the left drags areas, projects and tasks; a plain click on it opens the row's menu.
 * Shift-click selects every task from the last clicked one, Cmd/Ctrl-click adds or drops one; the
 * grip of a selected row then drags them all, and its date, its menu or ⌘1–4 (as in the editor)
 * set the date of all of them.
 */
const {
  Plugin, PluginSettingTab, Setting, ItemView, Modal, SuggestModal, FuzzySuggestModal, Notice, Menu,
  MarkdownRenderChild, MarkdownRenderer, Component, Keymap, moment, setIcon, prepareSimpleSearch,
  Platform, Scope, normalizePath,
} = require("obsidian");

const VIEW_TYPE = "focus-tasks-view";
const PROJECT_WORDS = ["project", "проект"];
const TASK_WORDS = ["task", "задача"];
const STATUS_OPEN = "open", STATUS_DONE = "done", STATUS_CANCELLED = "cancelled", STATUS_SOMEDAY = "someday";

const DEFAULTS = {
  folder: "Tasks",
  tasksFolder: "Задачи",
  language: "auto",
  areaNoteName: "{area}",
  areaFrontmatter: "",
  projectFrontmatter: "",
  typeArea: "area",
  typeProject: "project",
  projectsHeading: "Projects",
  dateFormat: "DD.MM.YY",
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
    overwritten: "The change did not stick: another device or plugin saved “{0}” over it",
    deleted: "Deleted: {0}", undo: "Undo", noteExists: "Note “{0}” already exists",
    areaExists: "Area “{0}” already exists", areaCreated: "Area “{0}” created",
    projectCreated: "Project “{0}” created", projectDeleted: "Project “{0}” deleted",
    areaDeleted: "Area {0} deleted", linked: "Linked to “{0}”", unlinked: "Note unlinked",
    newAreaTitle: "New area", areaPlaceholder: "Name — an emoji in front works: 💪Sport",
    areaNameTitle: "Area name for “{0}”", newProjectTitle: "New project in {0}",
    projectPlaceholder: "Project name", create: "Create", cancel: "Cancel", next: "Next", ok: "OK",
    deleteProjectQ: "Delete project “{0}”?", deleteProjectText: "Its note goes to the trash; its {0} tasks stay in the area as loose ones. A linked note stays.",
    deleteAreaQ: "Delete area {0}?", deleteAreaText: "The area, its {0} projects and its {1} tasks go to the trash. Linked notes stay.",
    taskIn: "Task added to “{0}”", where: "Where to: a project or an area (type a new name to create an area)",
    newAreaOption: "+ New area “{0}”", looseTasks: "(loose tasks)", whatToDo: "What to do",
    pickNote: "Pick a note", cmdToggleAll: "Show all / focus only", cmdFoldAll: "Collapse all",
    cmdUnfoldAll: "Expand all", cmdAddTask: "New task", cmdAddArea: "New area", cmdAreaFromNote: "New area from the current note",
    pickerPlaceholder: "DD.MM.YY or “tomorrow”", clearDate: "Clear date", completed: "Completed",
    daysShort: "d", overdueBy: "Overdue by {0} days", described: "This task holds a description — a plan belongs in a project", moveUp: "Move up", moveDown: "Move down",
    repeating: "This task repeats — install TaskNotes to close one occurrence, or remove `recurrence` from the note",
    undoKept: "Put back {0} of {1}: the rest changed in the meantime",
    allDone: "done {0}", focusDone: "Nothing due today — {0} tasks are waiting", showAll: "Show them",
    orphans: "Without an area", orphansHelp: "These tasks are in no area, so the focus cannot show them. Pick a place for each.",
    place: "Put in an area…", toProject: "Make it a project", toProjectDone: "“{0}” is a project now",
    toProjectBusy: "“{0}” cannot become a project: a note with that name already exists",
    dueOn: "Deadline: {0}", priorityLow: "Low priority", priorityNormal: "Priority", priorityHigh: "High priority",
    selected: "Selected: {0}", pickDate: "Date…", clearSelection: "Clear selection",
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
    sFolder: "Folder", sFolderDesc: "Where the notes of areas and projects live. Notes linked to them can be anywhere.",
    sTasksFolder: "Tasks folder", sTasksFolderDesc: "Where task notes are kept, one note per task.",
    sLanguage: "Language", sLanguageDesc: "Interface language (Auto follows Obsidian).",
    sAreaName: "Area note name", sAreaNameDesc: "File name of a new area note; {area} is the area name without a leading emoji.",
    sAreaFm: "Extra frontmatter for new area notes", sAreaFmDesc: "YAML lines added to every new area note (optional).",
    sProjectFm: "Extra frontmatter for new project notes", sProjectFmDesc: "YAML lines added to every new project note; {areaNote} is its area's note (optional).",
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
    overwritten: "Правка не сохранилась: заметку «{0}» перезаписало другое устройство или плагин",
    deleted: "Удалено: {0}", undo: "Вернуть", noteExists: "Заметка «{0}» уже есть",
    areaExists: "Область «{0}» уже есть", areaCreated: "Область «{0}» создана",
    projectCreated: "Проект «{0}» создан", projectDeleted: "Проект «{0}» удалён",
    areaDeleted: "Область {0} удалена", linked: "Привязана «{0}»", unlinked: "Заметка отвязана",
    newAreaTitle: "Новая область", areaPlaceholder: "Имя с эмодзи, например 💪Спорт",
    areaNameTitle: "Имя области для «{0}»", newProjectTitle: "Новый проект в {0}",
    projectPlaceholder: "Название проекта", create: "Создать", cancel: "Отмена", next: "Дальше", ok: "Готово",
    deleteProjectQ: "Удалить проект «{0}»?", deleteProjectText: "Заметка проекта уйдёт в корзину, его задачи ({0}) останутся в области разовыми. Привязанная заметка останется.",
    deleteAreaQ: "Удалить область {0}?", deleteAreaText: "В корзину уйдут область, её проекты ({0}) и её задачи ({1}). Привязанные заметки останутся.",
    taskIn: "Задача в «{0}»", where: "Куда: проект или область (новое имя — новая область)",
    newAreaOption: "＋ Новая область «{0}»", looseTasks: "(разовые задачи)", whatToDo: "Что сделать",
    pickNote: "Выбери заметку", cmdToggleAll: "Показать всё / только фокус", cmdFoldAll: "Свернуть всё",
    cmdUnfoldAll: "Развернуть всё", cmdAddTask: "Новая задача", cmdAddArea: "Новая область", cmdAreaFromNote: "Новая область из текущей заметки",
    pickerPlaceholder: "ДД.ММ.ГГ или «завтра»", clearDate: "Убрать дату", completed: "Выполненные",
    daysShort: " дн", overdueBy: "Просрочено на {0} дн.", described: "В задаче есть описание — план должен жить в проекте", moveUp: "Выше", moveDown: "Ниже",
    repeating: "Задача повторяется — закрыть одно вхождение может TaskNotes; либо убери `recurrence` из заметки",
    undoKept: "Вернул {0} из {1}: остальные с тех пор изменились",
    allDone: "сделано {0}", focusDone: "На сегодня ничего — в работе ещё {0}", showAll: "Показать",
    orphans: "Без области", orphansHelp: "Эти задачи ни в одной области, поэтому фокус их не показывает. Разложи их по местам.",
    place: "Положить в область…", toProject: "Сделать проектом", toProjectDone: "«{0}» теперь проект",
    toProjectBusy: "«{0}» не сделать проектом: заметка с таким именем уже есть",
    dueOn: "Дедлайн: {0}", priorityLow: "Низкий приоритет", priorityNormal: "Приоритет", priorityHigh: "Высокий приоритет",
    selected: "Выбрано: {0}", pickDate: "Дата…", clearSelection: "Снять выделение",
    months: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
    weekdays: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
    sFolder: "Папка", sFolderDesc: "Где лежат заметки областей и проектов. Привязанные к ним заметки могут быть где угодно.",
    sTasksFolder: "Папка задач", sTasksFolderDesc: "Где лежат заметки задач, по одной заметке на задачу.",
    sLanguage: "Язык", sLanguageDesc: "Язык интерфейса (Auto — как в Obsidian).",
    sAreaName: "Имя заметки области", sAreaNameDesc: "Имя файла новой области; {area} — имя области без эмодзи в начале.",
    sAreaFm: "Дополнительный frontmatter новых областей", sAreaFmDesc: "YAML-строки, которые добавятся в каждую новую заметку области (необязательно).",
    sProjectFm: "Дополнительный frontmatter новых проектов", sProjectFmDesc: "YAML-строки для каждой новой заметки проекта; {areaNote} — заметка его области (необязательно).",
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
// A date as the plugin reads it: «2026-09-22», «2026-09-22T18:30+03:00» and a Date all mean that day.
const day = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const text = value instanceof Date ? moment(value).format("YYYY-MM-DD") : String(value).trim();
  return text.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || text;
};
const isHead = (l) => /^#{1,6}\s/.test(l);
const headText = (l) => l.replace(/^#+\s*/, "").trim();
const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, "    ").length;
const collator = () => (a, b) => a.localeCompare(b, LANG);
const newUid = () => "ft-" + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5);
// The list a task is dragged within: the steps of its project, or the loose tasks of its area.
const listOf = (task) => (task.project ? "project:" + task.project : "area:" + task.area);
// What a selected row is known by across re-renders: the task's own identity.
const keyOf = (task) => task.uid;
// Shift or Cmd (Ctrl off the Mac) held: a click selects rather than edits.
const picking = (e) => e.shiftKey || (Platform.isMacOS ? e.metaKey : e.ctrlKey);

// What someone types into the date field → "YYYY-MM-DD", or null when it means nothing:
//   25.09 · 25.09.26 · 25/09/2026 · today · завтра · послезавтра · +3 · через 3 дня · пн · friday
const WEEKDAYS = { пн: 1, вт: 2, ср: 3, чт: 4, пт: 5, сб: 6, вс: 7,
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
function parseDay(text) {
  const s = String(text).trim().toLowerCase();
  if (!s) return null;
  if (["сегодня", "today", "сг"].includes(s)) return today();
  if (["завтра", "tomorrow", "зв"].includes(s)) return moment().add(1, "day").format("YYYY-MM-DD");
  if (["послезавтра", "day after tomorrow"].includes(s)) return moment().add(2, "days").format("YYYY-MM-DD");
  const plus = s.match(/^\+?\s*(\d{1,3})\s*(?:д|дн|дня|дней|d|day|days)?$/) || s.match(/^через\s+(\d{1,3})\s*(?:д|дн|дня|дней)?$/);
  if (plus && (s.startsWith("+") || s.startsWith("через") || /^\d{1,3}\s*(д|дн|дня|дней|d|day|days)$/.test(s))) {
    return moment().add(Number(plus[1]), "days").format("YYYY-MM-DD");
  }
  const weekday = Object.entries(WEEKDAYS).find(([k]) => s === k || s.startsWith(k) && s.length <= 12);
  if (weekday) {
    const want = weekday[1];
    const d = moment();
    do { d.add(1, "day"); } while (d.isoWeekday() !== want);  // the next one, never today
    return d.format("YYYY-MM-DD");
  }
  const m = s.match(/^(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2}|\d{4}))?$/);
  if (!m) return null;
  const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : moment().year();
  const d = moment({ year, month: Number(m[2]) - 1, day: Number(m[1]) });
  return d.isValid() ? d.format("YYYY-MM-DD") : null;
}

// Opens a menu where the finger or the pointer is: `showAtMouseEvent` only takes a mouse event, and
// a tap gives a pointer or a touch one — on a phone the menu would never appear.
function showMenu(menu, e) {
  if (e instanceof MouseEvent && e.type !== "pointerup" && e.type !== "pointerdown") return menu.showAtMouseEvent(e);
  const point = e?.touches?.[0] || e?.changedTouches?.[0] || e;
  const x = point?.clientX ?? point?.x ?? 0;
  const y = point?.clientY ?? point?.y ?? 0;
  return menu.showAtPosition({ x, y });
}

// A note split into its frontmatter block (with the fences) and what follows.
function splitNote(text) {
  if (!text.startsWith("---\n")) return ["", text];
  const end = text.indexOf("\n---", 3);
  if (end < 0) return ["", text];
  return [text.slice(0, end + 4), text.slice(end + 4).replace(/^\n/, "")];
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
    this.keys = (e) => { if (e.key === "Escape") { e.preventDefault(); this.close(); } };
    this.scrolled = (e) => { if (!this.el.contains(e.target)) this.close(); };
    // The click that opened the picker is still travelling, so listening starts a tick later — and
    // only if the picker is still open by then, or the listeners would outlive it.
    setTimeout(() => {
      if (this.closed) return;
      this.listening = true;
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
    nav.createEl("button", { text: t("tomorrow"), cls: "ft-picker-tomorrow" }).onclick = () => this.pick(moment().add(1, "day").format("YYYY-MM-DD"));
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
    if (this.listening) {
      document.removeEventListener("pointerdown", this.outside, true);
      document.removeEventListener("keydown", this.keys, true);
      document.removeEventListener("scroll", this.scrolled, true);
    }
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
    this.selected = new Set();  // tasks of the selected rows
    this.anchor = null;         // the last clicked task: Shift-click selects from it
  }

  // Opens a note: Cmd/Ctrl-click in a new tab; from the pane never over the list itself.
  open(file, e = null, eState = null) {
    const ws = this.plugin.app.workspace;
    let leaf = ws.getLeaf(e ? Keymap.isModEvent(e) : false);
    if (this.leaf && leaf === this.leaf) leaf = ws.getLeaf("tab");
    return leaf.openFile(file, eState ? { eState } : undefined);
  }

  // Every draggable row maps to what it shows: {type: "area" | "area-title" | "project" | "task", ...}.
  // The rows of a build in progress go to `fresh` and replace `items` with the DOM, so a click or a
  // drag meanwhile still finds the rows on screen.
  track(el, item) {
    el.setAttr("data-ft", item.type);
    this.fresh.set(el, item);
  }

  get scroller() { return this.containerEl.closest(".markdown-preview-view, .view-content"); }

  onload() {
    const later = () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.render(), 300); };
    this.registerEvent(this.plugin.app.metadataCache.on("changed", later));
    this.registerEvent(this.plugin.app.vault.on("delete", later));
    this.registerEvent(this.plugin.app.vault.on("rename", later));
    // a plain click anywhere else drops the selection; its hotkeys work only while this tab is active
    this.registerDomEvent(this.containerEl, "click", (e) => { if (!picking(e)) this.clearSelection(); });
    this.registerEvent(this.plugin.app.workspace.on("active-leaf-change", () => this.keys(this.selected.size > 0)));
    this.plugin.views.add(this);
    this.render();
  }
  // Closing the pane (or switching a note out of preview) must take everything this view opened with
  // it: the editor's hotkeys, the picker and its document listeners, a drag left mid-air.
  onunload() {
    clearTimeout(this.timer);
    clearTimeout(this.menuTimer);
    this.keys(false);
    this.endEdit?.(false, false);
    this.picker?.close();
    this.stopDrag?.();
    this.plugin.views.delete(this);
  }

  // The tab the list is in: the pane, or the note with the block.
  leafOf() {
    if (this.leaf) return this.leaf;
    let found = null;
    this.plugin.app.workspace.iterateAllLeaves((l) => { if (!found && l.containerEl.contains(this.containerEl)) found = l; });
    return found;
  }

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
    const rest = everything ? (await p.collect(true)).filter((a) => !areas.some((x) => x.name === a.name)) : [];
    const shownAreas = [...areas, ...rest];
    this.fresh = new WeakMap();
    // [key, all] of every foldable header on screen (also inside folded areas)
    this.folds = [
      ...areas.flatMap((a) => [["area:" + a.name, false], ...a.projects.map((pr) => ["project:" + pr.file.path, false]),
        ...a.future.projects.map((pr) => ["later:" + pr.file.path, false])]),
      ...rest.flatMap((a) => [["area:" + a.name, true], ...a.projects.map((pr) => ["project:" + pr.file.path, true])]),
    ];
    const seen = {};
    for (const a of shownAreas) {
      seen["area:" + a.name] = [...a.loose, ...a.future.loose].map((x) => x.uid);
      for (const pr of [...a.projects, ...a.future.projects]) {
        const key = "project:" + pr.file.basename;
        seen[key] = [...new Set([...(seen[key] || []), ...pr.tasks.map((x) => x.uid)])];
      }
    }
    this.shown = { areas: shownAreas.map((a) => a.name), tasks: seen,
      projects: Object.fromEntries(shownAreas.map((a) => [a.name, a.projects.map((pr) => pr.file.path)])) };
    const old = this.inner;
    this.inner = this.addChild(new Component());
    const el = createDiv();
    const none = !p.notes().length;
    if (none) el.createDiv({ cls: "ft-empty ft-onboarding", text: t("noAreas") });
    else if (!areas.length) {
      // An empty focus is not an empty vault: say how much is waiting and offer the way to it, or the
      // list looks broken on the first quiet day.
      const waiting = p.tasks().filter((x) => x.status !== STATUS_DONE && x.status !== STATUS_CANCELLED && x.status !== STATUS_SOMEDAY).length;
      const line = el.createDiv({ cls: "ft-empty" });
      line.createSpan({ text: waiting ? t("focusDone", waiting) : t("focusEmpty") });
      if (waiting && !everything) {
        const go = line.createEl("a", { cls: "ft-empty-link", text: t("showAll"), href: "#" });
        go.onclick = (e) => { e.preventDefault(); p.setEverything(true); };
      }
    }
    for (const area of areas) await this.area(el, area, false, everything);
    if (everything) {
      if (rest.length) el.createDiv({ cls: "ft-rest-title", text: t("restTitle") });
      for (const area of rest) await this.area(el, area, true);
    }
    const lost = p.orphans();
    if (lost.length) await this.orphanBlock(el, lost);
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
    this.items = this.fresh;
    this.paint();
    this.hold();
  }

  // The task rows on screen, top down: [row, task].
  rows() {
    return [...this.containerEl.querySelectorAll("li.ft-task[data-ft]")].map((el) => [el, this.items?.get(el)?.task]).filter(([, x]) => x);
  }

  // The selected tasks in screen order.
  chosen() { return this.rows().map(([, x]) => x).filter((x) => this.selected.has(x)); }

  // Shift-click: every row from the anchor to this one (with Cmd/Ctrl too: added to the selection);
  // Cmd/Ctrl-click (or Shift with nothing clicked before): this row in or out.
  select(task, e) {
    if (this.editing) document.activeElement?.blur();  // an open editor saves and closes
    const leaf = this.leafOf();
    // the hotkeys follow the active tab; focusing a note's editor could open the block's source instead
    if (leaf && this.plugin.app.workspace.activeLeaf !== leaf) this.plugin.app.workspace.setActiveLeaf(leaf, { focus: false });
    const tasks = this.rows().map(([, x]) => x);
    const to = tasks.indexOf(task);
    if (to < 0) return;
    const a = this.anchor;
    const from = a ? tasks.findIndex((x) => x === a || keyOf(x) === keyOf(a)) : -1;
    if (e.shiftKey && from >= 0) {
      if (!(Platform.isMacOS ? e.metaKey : e.ctrlKey)) this.selected.clear();
      for (const x of tasks.slice(Math.min(from, to), Math.max(from, to) + 1)) this.selected.add(x);
    } else {
      if (this.selected.has(task)) this.selected.delete(task);
      else this.selected.add(task);
      this.anchor = task;
    }
    this.paint();
  }

  // Marks the selected rows. After a re-render the selection follows its tasks to their new rows (by
  // note and line); those no longer on screen drop out.
  paint() {
    const keys = new Set([...this.selected].map(keyOf));
    this.selected = new Set();
    for (const [el, task] of this.rows()) {
      const on = keys.has(keyOf(task));
      if (on) this.selected.add(task);
      el.toggleClass("is-selected", on);
    }
    this.keys(this.selected.size > 0);
  }

  // While rows are selected and this tab is active: Mod+1 today, Mod+2 tomorrow, Mod+3 the picker,
  // Mod+4 no date (as in the editor, over Obsidian's «go to tab»), Esc drops the selection. A menu, a
  // modal or the editor pushes its own scope on top, so their keys come first.
  keys(on) {
    const keymap = this.plugin.app.keymap;
    if (!on || this.plugin.app.workspace.activeLeaf !== this.leafOf()) {
      if (this.scope) keymap.popScope(this.scope);
      this.scope = null;
      return;
    }
    if (this.scope) return;
    this.scope = new Scope(this.plugin.app.scope);
    const day = (n) => moment().add(n, "days").format("YYYY-MM-DD");
    const run = { 1: () => this.dateSelection(day(0)), 2: () => this.dateSelection(day(1)), 3: () => this.pickDates(), 4: () => this.dateSelection(null) };
    for (const [key, fn] of Object.entries(run)) {
      this.scope.register(["Mod"], key, () => {
        if (!this.editing) fn();
        return false;
      });
    }
    this.scope.register([], "Escape", () => {
      if (this.editing) return;  // the picker's own Esc
      this.clearSelection();
      return false;
    });
    keymap.pushScope(this.scope);
  }

  // One date for the selected rows; the selection is done then.
  dateSelection(day) {
    const tasks = this.chosen();
    this.clearSelection();
    return this.plugin.setDates(tasks, day);
  }

  // The picker for the selected rows, at the date of `task` (the top one by default).
  pickDates(task = this.chosen()[0]) {
    const row = this.rows().find(([, x]) => x === task)?.[0];
    const label = row?.querySelector(".ft-date");
    if (!label) return;
    row.scrollIntoView({ block: "nearest" });
    this.editDate(task, label);
  }

  clearSelection() {
    if (!this.selected.size) return;
    this.selected.clear();
    this.paint();
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
    else if (!open) {
      // «0» under an area's name reads as «broken»; when the day is simply finished here, say so.
      const count = title.createSpan({ cls: "ft-count", text: tasks.length ? String(tasks.length) : area.done.length ? t("allDone", area.done.length) : "" });
      if (!tasks.length && area.done.length) count.addClass("is-done");
    }
    this.plus(title, t("addToArea"), async () => ({ area: area.name, project: null, noDate: all }),
      () => [...box.querySelectorAll(":scope > ul.ft-list")].pop() || title);
    this.more(title, (menu) => this.areaMenu(menu, area));
    this.grip(title, { type: "area", area });
    if (!open) return;
    if (all) {
      if (area.loose.length) await this.list(box, area.loose, true);
      for (const project of area.projects) await this.project(box, area, project, false, true);
      if (!area.loose.length && !area.projects.length) {
        // «Empty» is the first row's placeholder: a click turns it into a new task being typed
        const empty = box.createDiv({ cls: "ft-empty ft-empty-add", text: t("empty"), attr: { "aria-label": t("addTask") } });
        empty.onclick = () => {
          this.draft(empty, { area: area.name, project: null, noDate: true });
          empty.remove();
        };
      }
      return;
    }
    if (area.loose.length) await this.list(box, area.loose);
    for (const project of area.projects) await this.project(box, area, project);
    if (area.later || area.future.projects.length) {
      const futureKey = (wide ? "futureoff:" : "future:") + area.name;
      const shown = wide ? !p.isShown(futureKey, true) : p.isShown(futureKey, true);
      this.upcoming(box, area, shown, futureKey);
      if (shown) {
        const block = box.createDiv({ cls: "ft-future-block" });
        if (area.future.loose.length) await this.list(block, area.future.loose);
        for (const project of area.future.projects) await this.project(block, area, project, true);
      }
    }
    if (area.done.length) await this.completed(box, area.done, "done:" + area.name);
  }

  // «Completed · N» at the bottom of an area: everything checked off there today, steps of its
  // projects included — each row carries the project it belongs to. Open unless folded; a box
  // unchecks its task. Not selectable, not draggable.
  async completed(box, done, key) {
    const p = this.plugin;
    const open = p.isShown(key, false);
    const block = box.createDiv({ cls: "ft-done-block" });  // not a direct list of the area: «+» adds after the loose tasks
    const head = block.createDiv({ cls: "ft-future ft-done-title" });
    setIcon(head.createSpan({ cls: "ft-future-icon" }), open ? "chevron-down" : "chevron-right");
    head.createSpan({ text: `${t("completed")} · ${done.length}` });
    head.onclick = async () => { await p.toggleShown(key, false); p.refresh(); };
    if (!open) return;
    const ul = block.createEl("ul", { cls: "contains-task-list ft-list" });
    for (const task of done) {
      const li = ul.createEl("li", { cls: "task-list-item ft-task ft-done" });  // no data-task: themes strike the whole row
      const check = li.createSpan({ cls: "ft-box" }).createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
      check.checked = true;
      this.check(li, check, task);
      await this.text(li, task);
      if (task.project) {
        const tag = li.createSpan({ cls: "ft-done-project" });
        tag.createSpan({ cls: "ft-icon", text: "📁" });
        tag.createSpan({ text: task.project });
      }
      this.grip(li, { type: "task", task });  // the phone has no right click: the grip is the way in
      li.oncontextmenu = (e) => {
        e.preventDefault();
        const menu = new Menu();
        menu.addItem((i) => i.setTitle(t("openInNote")).setIcon("file-text").onClick(() => this.open(task.file)));
        showMenu(menu, e);
      };
    }
  }

  // The box of a row. The whole cell around the box answers, not the 16 px box itself: a finger that
  // misses would otherwise land on the text and open the editor. It marks the row at once (the note
  // is written and the list re-read a moment later) and ignores further clicks until then — a second
  // click would undo the first.
  check(li, box, task) {
    const tick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (li.hasClass("is-toggling")) return;
      li.addClass("is-toggling");
      box.checked = !box.checked;
      if (await this.plugin.toggle(task)) return;
      li.removeClass("is-toggling");  // the note changed under it: the row goes back as it was
      box.checked = !box.checked;
    };
    box.onclick = tick;
    const cell = box.parentElement;
    if (cell) cell.onclick = (e) => { if (e.target !== box) tick(e); };
  }

  // Tasks with no area and no project: another tool wrote them and the focus cannot place them. They
  // are shown apart, with one action — put this task in an area or a project.
  async orphanBlock(el, tasks) {
    const p = this.plugin;
    const key = "orphans";
    const open = p.isShown(key, false);
    const block = el.createDiv({ cls: "ft-orphans" });
    const head = block.createDiv({ cls: "ft-future ft-orphans-title" });
    setIcon(head.createSpan({ cls: "ft-future-icon" }), open ? "chevron-down" : "alert-circle");
    head.createSpan({ text: `${t("orphans")} · ${tasks.length}` });
    head.setAttr("aria-label", t("orphansHelp"));
    head.onclick = async () => { await p.toggleShown(key, false); p.refresh(); };
    if (!open) return;
    const ul = block.createEl("ul", { cls: "contains-task-list ft-list" });
    for (const task of tasks) {
      const li = ul.createEl("li", { cls: "task-list-item ft-task ft-orphan" });
      const box = li.createSpan({ cls: "ft-box" }).createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
      this.check(li, box, task);
      await this.text(li, task);
      const place = li.createSpan({ cls: "ft-place", text: t("place") });
      place.onclick = (e) => { e.stopPropagation(); p.placeTask(task); };
      li.oncontextmenu = (e) => { e.preventDefault(); this.taskMenu(task, e); };
      this.grip(li, { type: "task", task });
    }
  }

  // The task's text as markdown (links work), without the paragraph around it.
  async text(li, task) {
    const text = li.createSpan({ cls: "ft-text" });
    await MarkdownRenderer.render(this.plugin.app, task.text, text, task.file.path, this.inner);
    const para = text.querySelector("p");
    if (para) para.replaceWith(...para.childNodes);
    const box = li.querySelector("input.task-list-item-checkbox");
    if (box) {  // the checkbox is named by the text next to it, so a screen reader reads the task
      const id = "ft-" + Math.random().toString(36).slice(2, 9);
      text.id = id;
      box.setAttr("aria-labelledby", id);
    }
    return text;
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
    this.plus(head, t("addStep"), () => ({ area: area.name, project: project.file.basename, noDate: later || all }), () => {
      const body = head.nextElementSibling?.hasClass("ft-project-body") ? head.nextElementSibling : null;
      if (body) return body.lastElementChild || body;
      const fresh = createDiv({ cls: "ft-project-body" });
      head.after(fresh);
      return fresh.appendChild(createDiv());
    });
    this.more(head, (menu) => this.projectMenu(menu, area, project, head));
    this.grip(head, { type: "project", area, project });
    if (!open) return;
    const body = box.createDiv({ cls: "ft-project-body" });
    await this.list(body, project.tasks, all);
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
    if (item.type === "task" && target.type === "task" && (item.tasks || [item.task]).some((x) => x.uid === target.task.uid)) return null;
    const r = hit.getBoundingClientRect();
    const into = item.type === "task" && target.type !== "task";
    return { el: hit, target, into, after: !into && y > r.top + r.height / 2 };
  }

  drag(e, item, grip) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const row = item.type === "area" ? grip.closest(".ft-area") : grip.closest(".ft-project, .ft-task");
    // the grip of a selected row carries the whole selection
    const group = item.type === "task" && this.selected.has(item.task) && this.selected.size > 1;
    if (group) item = { ...item, tasks: this.chosen() };
    const moving = group ? this.rows().filter(([, x]) => this.selected.has(x)).map(([el]) => el) : [row];
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
    const touch = e.pointerType === "touch";
    const slop = touch ? 10 : 5;  // a finger wobbles: a wider threshold before this counts as a drag
    const move = (ev) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!dragging && Math.hypot(lastX - x0, lastY - y0) < slop) return;
      if (!dragging) { dragging = true; moving.forEach((r) => r.addClass("ft-dragging")); document.body.addClass("ft-drag-active"); }
      drop = this.target(item, lastX, lastY);
      show();
    };
    // Obsidian's own swipe opens the sidebar from anywhere on a phone, so a finger dragging a row
    // sideways would open it and drop the row onto the file list. While a drag is on, the touch
    // never reaches that gesture.
    // Only the app's own listeners are cut off: preventDefault here would cancel the touch and with it
    // the pointer events this drag is built on.
    const swallow = (ev) => { if (dragging) ev.stopPropagation(); };
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
      window.removeEventListener("touchmove", swallow, true);
      this.held = false;
      this.stopDrag = null;
      marked?.removeClass("ft-drop-into");
      line.remove();
      moving.forEach((r) => r.removeClass("ft-dragging"));
      document.body.removeClass("ft-drag-active");
      if (commit && !dragging) {
        // A tap ends with a click that Obsidian's menu treats as «somewhere else» and closes itself,
        // so on a finger the menu opens just after that click, not on the pointer-up before it.
        const where = { clientX: ev?.clientX ?? 0, clientY: ev?.clientY ?? 0 };
        if (touch) this.menuTimer = setTimeout(() => this.openMenu(item, where, row), 80);
        else this.openMenu(item, ev, row);
      }
      else if (commit && drop) {
        this.clearSelection();  // a finished move ends the selection, whatever was dragged
        await this.plugin.drop(item, drop, this.shown);
      }
      if (this.again) { this.again = false; this.render(); }
    };
    this.held = true;  // no re-render under the finger
    this.stopDrag = () => end(false);
    grip.setPointerCapture(e.pointerId);
    window.addEventListener("touchmove", swallow, { capture: true });
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
  }

  openMenu(item, e, row) {
    if (item.type === "task") return this.taskMenu(item.task, e);
    const menu = new Menu();
    if (item.type === "area") this.areaMenu(menu, item.area);
    else this.projectMenu(menu, item.area, item.project, row);
    showMenu(menu, e);
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

  // What the frontmatter says about a task and the row would otherwise hide: its priority (low is the
  // mark of a task an agent added and the user has not looked at yet) and its deadline, when that is
  // a different day from the one the focus goes by.
  marks(li, task) {
    if (task.described) {
      const note = li.createSpan({ cls: "ft-described" });
      note.setAttr("aria-label", t("described"));
      setIcon(note, "text");
    }
    const level = String(task.priority || "").toLowerCase();
    if (["low", "normal", "high", "highest", "lowest", "medium"].includes(level)) {
      const rank = ["high", "highest"].includes(level) ? "high" : ["low", "lowest"].includes(level) ? "low" : "normal";
      const dot = li.createSpan({ cls: `ft-priority is-${rank}` });
      dot.setAttr("aria-label", t(rank === "high" ? "priorityHigh" : rank === "low" ? "priorityLow" : "priorityNormal"));
    }
    if (task.due && task.due !== task.date) {
      const due = li.createSpan({ cls: "ft-due" });
      due.setAttr("aria-label", t("dueOn", moment(task.due).format(this.plugin.settings.dateFormat || "DD.MM.YY")));
      setIcon(due.createSpan({ cls: "ft-due-icon" }), "flag");
      due.createSpan({ text: moment(task.due).format("DD.MM") });
      if (task.due < today()) due.addClass("is-late");
    }
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
    // Late is said in words as well as in red: colour alone is not something everyone can read, and
    // the number of days is the ZFG signal that a task is stuck.
    const late = task.date < now ? moment(now).diff(moment(task.date), "days") : 0;
    if (late >= 2) {
      el.createSpan({ cls: "ft-late", text: `· ${late}${t("daysShort")}` });
      el.setAttr("aria-label", t("overdueBy", late));
    }
  }

  // The picker for the date of the row, or of every selected row when this is one of them.
  editDate(task, el) {
    if (this.editing) return;
    if (!this.selected.has(task)) this.clearSelection();
    const tasks = this.selected.size ? this.chosen() : [task];
    const days = [...new Set(tasks.map((x) => x.date || null))];
    this.anchor = task;
    this.editing = true;
    el.addClass("is-active");
    this.picker = new DatePicker(el, days.length === 1 ? days[0] : null, async (day) => {
      this.editing = false;
      this.picker = null;
      this.clearSelection();
      const change = tasks.filter((x) => (x.date || null) !== day);
      if (change.length) await this.plugin.setDates(change, day);
      this.render();
    }, () => {
      this.editing = false;
      this.picker = null;
      el.removeClass("is-active");
      this.render();
    });
  }

  // Turns the text of a row into an editor: the raw markdown of the task, caret at the clicked
  // character (proportional when links render shorter than their source).
  editInline(task, el, e) {
    if (el.isContentEditable || this.editing) return;
    this.clearSelection();
    this.anchor = task;
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
    li.createSpan({ cls: "ft-box" }).createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { disabled: "" } });
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
    li.createSpan({ cls: "ft-box" }).createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { disabled: "" } });
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
      this.endEdit = null;
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
    this.endEdit = finish;
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
      showMenu(menu, e);
    };
    const btn = parent.createSpan({ cls: "ft-more", attr: { "aria-label": t("actions") } });
    setIcon(btn, "more-horizontal");
    btn.onclick = show;
    parent.oncontextmenu = show;
  }

  areaMenu(menu, area) {
    const p = this.plugin;
    menu.addItem((i) => i.setTitle(t("addToArea")).setIcon("plus").onClick(() => p.addTask(null, { area: area.name, project: null })));
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
    menu.addItem((i) => i.setTitle(t("addStep")).setIcon("plus").onClick(() => p.addTask(null, { area: area.name, project: project.file.basename })));
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
    if (this.selected.has(task) && this.selected.size > 1) return this.selectionMenu(task, e);
    const p = this.plugin;
    const day = (n) => moment().add(n, "days").format("YYYY-MM-DD");
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(t("today")).setIcon("calendar-check").onClick(() => p.setDate(task, day(0))));
    menu.addItem((i) => i.setTitle(t("tomorrow")).setIcon("calendar-plus").onClick(() => p.setDate(task, day(1))));
    menu.addItem((i) => i.setTitle(t("noDate")).setIcon("calendar-x").onClick(() => p.setDate(task, null)));
    menu.addSeparator();
    // A drag is not always possible — a finger loses to the scroll, a keyboard has no drag at all.
    menu.addItem((i) => i.setTitle(t("moveUp")).setIcon("arrow-up").onClick(() => this.shift(task, -1)));
    menu.addItem((i) => i.setTitle(t("moveDown")).setIcon("arrow-down").onClick(() => this.shift(task, 1)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t("place")).setIcon("folder-input").onClick(() => p.placeTask(task)));
    menu.addItem((i) => i.setTitle(t("toProject")).setIcon("folder-plus").onClick(() => p.toProject(task)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t("openInNote")).setIcon("file-text").onClick(() => this.open(task.file)));
    menu.addItem((i) => {
      i.setTitle(t("delete")).setIcon("trash-2").onClick(() => p.remove(task));
      if (i.setWarning) i.setWarning(true);
    });
    showMenu(menu, e);
  }

  // The menu of a selected row when there are several: one date for all of them.
  selectionMenu(task, e) {
    const day = (n) => moment().add(n, "days").format("YYYY-MM-DD");
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(t("selected", this.selected.size)).setIcon("list-checks").setDisabled(true));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t("today")).setIcon("calendar-check").onClick(() => this.dateSelection(day(0))));
    menu.addItem((i) => i.setTitle(t("tomorrow")).setIcon("calendar-plus").onClick(() => this.dateSelection(day(1))));
    menu.addItem((i) => i.setTitle(t("pickDate")).setIcon("calendar-days").onClick(() => this.pickDates(task)));
    menu.addItem((i) => i.setTitle(t("noDate")).setIcon("calendar-x").onClick(() => this.dateSelection(null)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t("clearSelection")).setIcon("x").onClick(() => this.clearSelection()));
    showMenu(menu, e);
  }

  // One step up or down among the rows it shares a list with (the steps of its project, or the loose
  // tasks of its area) — the same order a drag would write.
  async shift(task, by) {
    const list = this.rows().map(([, x]) => x).filter((x) => listOf(x) === listOf(task));
    const i = list.findIndex((x) => x.uid === task.uid);
    const to = i + by;
    if (i < 0 || to < 0 || to >= list.length) return;
    const target = list[to];
    await this.plugin.reorder([task], { into: false, after: by > 0, target: { type: "task", task: target } }, this.shown?.tasks || {});
    this.plugin.refresh();
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
      const li = ul.createEl("li", { cls: "task-list-item ft-task" });
      if (!all && !inFocus(task)) li.addClass("is-later");
      const box = li.createSpan({ cls: "ft-box" }).createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
      this.check(li, box, task);
      const text = await this.text(li, task);
      this.marks(li, task);
      const date = li.createSpan();
      this.dateLabel(date, task);
      date.onclick = (e) => {
        if (picking(e)) return;
        e.stopPropagation();
        this.editDate(task, date);
      };
      text.onclick = (e) => {
        if (e.target.closest("a") || picking(e)) return;
        e.stopPropagation();
        this.editInline(task, text, e);
      };
      li.onclick = (e) => {
        if (e.target.closest("a, input, .ft-box, .ft-grip, .ft-date, .ft-place") || picking(e)) return;
        this.editInline(task, text, null);
      };
      // on mousedown, so that Shift doesn't select text and an open editor isn't left mid-way
      li.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || !picking(e) || e.target.closest("a, input, .ft-grip")) return;
        e.preventDefault();
        this.select(task, e);
      });
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
    text("sTasksFolder", "sTasksFolderDesc", "tasksFolder");
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
    new Setting(containerEl).setName(t("sProjectFm")).setDesc(t("sProjectFmDesc")).addTextArea((c) => c
      .setPlaceholder('parents:\n  - "[[{areaNote}]]"').setValue(s.projectFrontmatter).onChange(async (v) => {
        s.projectFrontmatter = v.replace(/\s+$/, "");
        await p.saveAll();
      }));
    text("sTypeArea", "sTypeDesc", "typeArea");
    text("sTypeProject", "sTypeDesc", "typeProject");
    text("sProjects", "sProjectsDesc", "projectsHeading");
    text("sDateFormat", "sDateFormatDesc", "dateFormat");
  }
}

// --- the plugin ------------------------------------------------------------------------------

// The tests reach the small pure helpers through this.
if (typeof globalThis !== "undefined") globalThis.__ftParseDay = parseDay;

module.exports = class FocusTasks extends Plugin {
  async onload() {
    const saved = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULTS, saved.settings);
    this.data = { folded: saved.folded || {}, opened: saved.opened || {}, order: Object.assign({ areas: [], projects: {}, tasks: {} }, saved.order) };
    this.applyLanguage();
    this.views = new Set();
    this.toggling = new Set();  // lines with a toggle in flight
    for (const event of ["create", "delete", "modify"]) this.registerEvent(this.app.vault.on(event, () => this.forgetScan()));
    this.registerEvent(this.app.vault.on("rename", (file, old) => this.renamed(file.path, old)));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.forgetScan()));
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
    this.forgetScan();  // a changed folder or type means the vault has to be read again
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
    if (this.isTaskType(fm.type)) return null;  // a task note carries `area:` too
    return { file, area: String(fm.area), project: this.isProjectType(fm.type) };
  }

  isTaskType(type) {
    const s = String(type ?? "").trim().toLowerCase();
    return TASK_WORDS.includes(s) || s === String(this.settings.typeTask ?? "").trim().toLowerCase();
  }

  // Tasks nobody can see: no area of their own and no project to take one from. The view lists them
  // so that a note written by another tool never disappears without a trace.
  orphans() {
    const projects = this.notes().filter((n) => n.project);
    return this.tasks()
      .filter((x) => !x.area && !this.projectFile(x, projects) && ![STATUS_DONE, STATUS_CANCELLED, STATUS_SOMEDAY].includes(x.status))
      .sort((a, b) => collator()(a.text, b.text));
  }

  // Areas, projects and tasks are read in one pass over the vault and kept until something changes:
  // a render asks for them several times (the focus, «All», the lost ones), and on a big vault every
  // pass is thousands of cache lookups.
  read() {
    if (this.scan) return this.scan;
    const notes = [], tasks = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const task = this.taskOf(file);
      if (task) { tasks.push(task); continue; }
      const note = this.classify(file);
      if (note) notes.push(note);
    }
    this.scan = { notes, tasks };
    return this.scan;
  }

  forgetScan() { this.scan = null; }

  notes() { return this.read().notes; }

  get tasksFolder() { return normalizePath(this.settings.tasksFolder || DEFAULTS.tasksFolder); }

  // A task = its own note in the tasks folder: `type: задача`, the rest in the frontmatter. `uid` is
  // its identity and never changes; the file name is only a readable label.
  taskOf(file) {
    const folder = this.tasksFolder;
    if (folder && folder !== "/" && !file.path.startsWith(folder + "/")) return null;
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm || !this.isTaskType(fm.type)) return null;
    // A task is a service note: anything written under the frontmatter is a plan, and a plan is what
    // makes it a project. The row says so quietly; turning it into one stays the user's call.
    const described = (cache?.sections || []).some((x) => x.type !== "yaml");
    const link = (v) => {
      const one = Array.isArray(v) ? v[0] : v;  // `projects` is a list; we keep a task in one project
      return typeof one === "string" ? (one.match(/\[\[([^\]|#]+)/)?.[1] || one).trim() : null;
    };
    // «Marathon», «Areas/Marathon» or «Marathon|alias» all name the same project note
    const project = link(fm.projects);
    return { file, uid: fm.uid ? String(fm.uid) : file.path, text: String(fm.title ?? "").trim() || file.basename,
      status: String(fm.status ?? STATUS_OPEN).trim().toLowerCase(), date: day(fm.scheduled), due: day(fm.due),
      doneDate: day(fm.completedDate), priority: fm.priority || null,
      area: fm.area ? String(fm.area) : null, project, source: link(fm.source), described };
  }

  tasks() { return this.read().tasks; }

  // → [{name, note, loose, projects, focus, later, future, done}]. The focus keeps only tasks due today
  // or earlier (their areas, and areas with something checked off today); `all` keeps every task of
  // every area. `done`: checked off today. Tasks are notes; areas and projects are their own notes.
  async collect(all) {
    const byArea = new Map();
    const areaOf = (name) => {
      if (!byArea.has(name)) byArea.set(name, { name, note: null, loose: [], projects: [], focus: 0, later: 0, future: { loose: [], projects: [] }, done: [] });
      return byArea.get(name);
    };
    const first = (tasks) => tasks.map((x) => x.date).filter(Boolean).sort()[0] || "9999";
    const projects = new Map();  // basename of a project note → its bucket in its area
    const now = today();
    for (const n of this.notes()) {
      const area = areaOf(n.area);
      if (!n.project) { if (!area.note) area.note = n.file; continue; }
      const bucket = { file: n.file, area, tasks: [], later: [], first: "9999" };
      projects.set(n.file.path, bucket);
      area.buckets = [...(area.buckets || []), bucket];
    }
    const noteList = this.notes().filter((n) => n.project);
    for (const task of this.tasks()) {
      if (task.status === STATUS_CANCELLED || task.status === STATUS_SOMEDAY) continue;
      const file = task.project ? this.projectFile(task, noteList) : null;
      const bucket = file ? projects.get(file.path) : null;
      if (file) task.project = file.basename;  // the row shows the note it really points at
      // The project decides where a task is shown: its own `area` may be missing (another plugin
      // wrote it) or stale (the project moved), and a row that belongs to two places at once would
      // be counted in one and drawn in the other — that is how a due task goes missing.
      if (bucket) task.area = bucket.area.name;
      if (!task.area) continue;
      const area = areaOf(task.area);
      if (task.status === STATUS_DONE) {
        if (task.doneDate === now) area.done.push(task);  // one «Completed» per area, the project is on the row
        continue;
      }
      const focused = inFocus(task);
      area[focused ? "focus" : "later"]++;
      if (bucket) (focused || all ? bucket.tasks : bucket.later).push(task);
      else if (focused || all) area.loose.push(task);
      else area.future.loose.push(task);
    }
    // Notes have no order of their own: a dragged order wins, the rest follows the nearest date and
    // then the name.
    const seat = (task) => { const list = this.data.order.tasks[listOf(task)] || []; const i = list.indexOf(task.uid); return i < 0 ? 1e9 : i; };
    const cmpTask = (x, y) => seat(x) - seat(y) || (x.date || "9999").localeCompare(y.date || "9999") || collator()(x.text, y.text);
    for (const area of byArea.values()) {
      area.loose.sort(cmpTask);
      area.future.loose.sort(cmpTask);
      for (const b of area.buckets || []) {
        b.tasks.sort(cmpTask);
        b.later.sort(cmpTask);
      }
      for (const b of area.buckets || []) {
        b.first = first(b.tasks);
        if (all || b.tasks.length) area.projects.push(b);
        if (!all && (b.later.length || !b.tasks.length)) area.future.projects.push({ file: b.file, tasks: b.later, done: [], first: first(b.later) });
      }
      delete area.buckets;
    }
    let areas = [...byArea.values()];
    if (!all) areas = areas.filter((a) => a.focus || a.done.length);
    // A dragged order wins; the rest follows it: areas by name, projects by their nearest date.
    const rank = (list, key) => { const i = (list || []).indexOf(key); return i < 0 ? 1e9 : i; };
    const order = this.data.order;
    const cmp = collator();
    const byOrder = (a) => (x, y) => rank(order.projects[a.name], x.file.path) - rank(order.projects[a.name], y.file.path)
      || x.first.localeCompare(y.first) || cmp(x.file.basename, y.file.basename);
    for (const a of areas) {
      a.projects.sort(byOrder(a));
      a.future.projects.sort(byOrder(a));
      a.done.sort((x, y) => cmp(x.project || "", y.project || "") || cmp(x.text, y.text));
    }
    return areas.sort((a, b) => rank(order.areas, a.name) - rank(order.areas, b.name) || cmp(bare(a.name), bare(b.name)));
  }

  // --- tasks --------------------------------------------------------------------------------

  // --- tasks: each one is a note ------------------------------------------------------------

  // Writes fields into the task's note; a null value removes the key. The note is found by its path:
  // renames are followed by Obsidian itself, so nothing here depends on the text of the task.
  async setFields(task, fields) {
    return this.update(task, (fm) => {
      for (const [key, value] of Object.entries(fields)) {
        if (value === null || value === undefined) delete fm[key];
        else fm[key] = value;
      }
    });
  }

  // The one place a task note is written. `change(fm)` gets the frontmatter as it is on disk right
  // now — a decision made from what the screen showed a second ago (another device may have finished
  // the task since) must be taken inside it, not before.
  async update(task, change) {
    const file = this.app.vault.getAbstractFileByPath(task.file.path) || task.file;
    if (!file || file.deleted) { new Notice(t("changed")); return false; }
    let uid = null, wrong = false;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        // The row was read a moment ago; another note may have taken this path since (Sync, a script,
        // the user). Writing into it would change the wrong task — or turn an ordinary note into one.
        if (!this.isTaskType(fm.type)) { wrong = true; return; }
        if (fm.uid && task.uid && String(fm.uid) !== task.uid) { wrong = true; return; }
        if (!fm.uid) fm.uid = uid = newUid();  // a note written by another plugin gets its identity here
        change(fm);
      });
      if (wrong) { new Notice(t("changed")); return false; }
      if (uid) {
        // it lived under its path until now: the order it was dragged into moves to the real identity
        for (const [key, list] of Object.entries(this.data.order.tasks)) {
          const i = list.indexOf(task.file.path);
          if (i >= 0) { list[i] = uid; this.saveAll(); }
        }
        task.uid = uid;
      }
      this.forgetScan();
    } catch (e) {
      new Notice(t("changed"));
      console.warn("focus-tasks: the task note could not be written", task.file.path, e);
      return false;
    }
    return true;
  }

  // Done ⇄ open, with the day it was done. One write per task at a time (the same task can be on
  // screen twice); a second click on the same row is held by the row itself until it is rebuilt.
  async toggle(task) {
    const guard = task.uid;  // `update` may give the task a real uid on the way: unlock what was locked
    if (this.toggling.has(guard)) return false;
    this.toggling.add(guard);
    try {
      const repeats = this.app.metadataCache.getFileCache(task.file)?.frontmatter?.recurrence;
      if (repeats) {
        const api = this.app.plugins.plugins["tasknotes"]?.api?.recurring;
        // One occurrence is done, not the task. Only TaskNotes knows that rule; without it, writing
        // `status: done` here would quietly end the whole series.
        if (!api?.toggleCompleteInstance) { new Notice(t("repeating")); return false; }
        await api.toggleCompleteInstance(task.file.path, task.date || today());
        this.forgetScan();
        return true;
      }
      let done = null;
      const ok = await this.update(task, (fm) => {
        done = String(fm.status ?? STATUS_OPEN).trim().toLowerCase() !== STATUS_DONE;
        fm.status = done ? STATUS_DONE : STATUS_OPEN;
        if (done) fm.completedDate = today();
        else delete fm.completedDate;
      });
      if (ok) Object.assign(task, { status: done ? STATUS_DONE : STATUS_OPEN, doneDate: done ? today() : null });
      return ok;
    } finally {
      this.toggling.delete(guard);
    }
  }

  // The date the focus goes by; null takes the task back to the someday list.
  async setDate(task, day) {
    const ok = await this.setFields(task, { scheduled: day || null });
    if (ok) task.date = day || null;
    return ok;
  }

  async setDates(tasks, day) {
    for (const task of tasks) await this.setDate(task, day);
  }

  // New text: the note keeps its uid and is renamed to match (the whole text stays in `title` when it
  // is too long for a file name).
  async rename(task, text) {
    const name = fileName(text).slice(0, 60).trim();
    let file = name && name !== task.file.basename ? await this.freeName(name) : task.file.basename;
    // the file name may be cut or taken: then the whole text lives in `title`
    const ok = await this.setFields(task, { title: !name || file !== text ? text : null });
    if (!ok) return;  // the note is not the one this row was read from: leave its name alone too
    if (file !== task.file.basename) {
      await this.app.fileManager.renameFile(task.file, normalizePath(`${this.tasksFolder}/${file}.md`));
    }
    task.text = text;
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
    } else return this.moveTasks(item.tasks || [item.task], drop, shown.tasks || {});
    await this.saveAll();
    this.refresh();
  }

  // Where the dragged tasks now sit in their list: the order on screen is kept, so the rows that were
  // not dragged stay where they were.
  async reorder(tasks, drop, shown) {
    const key = listOf(tasks[0]);
    const moved = tasks.map((x) => x.uid);
    const target = drop.into ? null : drop.target.task;
    // Tasks that no longer exist are dropped from the saved order here: the file is merged key by key
    // between devices, so a list that only ever grows would carry dead ids forever.
    const alive = new Set(this.tasks().map((x) => x.uid));
    const list = [...new Set([...(this.data.order.tasks[key] || []), ...(shown[key] || []), ...moved])]
      .filter((uid) => !moved.includes(uid) && alive.has(uid));
    const at = target && listOf(target) === key ? list.indexOf(target.uid) : -1;
    list.splice(at < 0 ? list.length : at + (drop.after ? 1 : 0), 0, ...moved);
    this.data.order.tasks[key] = list;
    await this.saveAll();
  }

  // Into a header means «into that area or project», onto a task means «where that task lives».
  async moveTasks(tasks, drop, shown = {}) {
    const tg = drop.target;
    const area = drop.into ? tg.area.name : tg.task.area;
    const file = drop.into ? (tg.type === "project" ? tg.project.file : null) : (tg.task.project ? this.projectFile(tg.task) : null);
    const project = file ? file.basename : null;
    for (const task of tasks) {
      // the link is written the way Obsidian writes links, so two notes of the same name stay apart
      const link = file ? this.app.metadataCache.fileToLinktext(file, task.file.path) : null;
      const ok = await this.setFields(task, { area, projects: link ? [`[[${link}]]`] : null });
      if (ok) Object.assign(task, { area, project });
    }
    await this.reorder(tasks, drop, shown);
    this.refresh();
  }

  // --- undo ---------------------------------------------------------------------------------

  // What deleting touches is written down first: the notes that go to the trash and the ones that
  // are edited on the way (the tasks of a deleted project, the area's own note). Undo writes every
  // one of them back as it was, so nothing is half-restored.
  async snapshot(files) {
    const out = [];
    for (const file of files) {
      if (!file) continue;
      const live = this.app.vault.getAbstractFileByPath(file.path);
      if (!live) continue;
      out.push({ path: file.path, text: await this.app.vault.read(live) });
    }
    return out;
  }

  // Runs `action` and keeps what it destroyed; the notice puts it back within its ten seconds. What
  // the action left behind is kept too, so undo can tell «still as I left it» from «someone has
  // written here since» and never overwrite the second.
  async undoable(message, files, action) {
    const snap = await this.snapshot(files);
    await action();
    for (const item of snap) {
      const live = this.app.vault.getAbstractFileByPath(item.path);
      item.after = live ? await this.app.vault.read(live) : null;
    }
    this.undoStack = snap;
    // Every notice holds its own snapshot: two deletes in a row must not undo each other's work.
    const put = () => this.restore(snap);
    let undo;
    const notice = new Notice(createFragment((f) => {
      f.appendText(message + " ");
      undo = f.createEl("a", { text: t("undo"), href: "#", cls: "ft-undo" });
    }), 10000);
    if (undo) undo.onclick = async (e) => {
      e.preventDefault();
      notice.hide();
      await put();
    };
    return put;
  }

  // Puts the last deleted notes back exactly as they were, uid and all — unless something has been
  // written at that path since (Sync, a script, the user): that is left alone and reported.
  async undoLast() {
    const snap = this.undoStack || [];
    this.undoStack = null;
    return this.restore(snap);
  }

  // Writes a snapshot back, skipping anything that has changed at that path since.
  async restore(snap) {
    let back = 0;
    for (const { path, text, after } of snap) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) { await this.app.vault.create(path, text); back++; continue; }
      let same = false;
      await this.app.vault.process(file, (now) => { same = now === after; return same ? text : now; });
      if (same) back++;
    }
    this.forgetScan();
    if (back < snap.length) new Notice(t("undoKept", back, snap.length));
    this.refresh();
    return back;
  }

  // The note goes to the trash; the notice puts it back with the same uid.
  async remove(task) { return this.removeTask(task); }

  // → the function that puts this very task back.
  async removeTask(task) {
    return this.undoable(t("deleted", task.text), [task.file], () => this.trash(task.file));
  }

  // A free file name in the tasks folder.
  async freeName(base) {
    let name = base, i = 2;
    while (this.app.vault.getAbstractFileByPath(normalizePath(`${this.tasksFolder}/${name}.md`))) name = `${base} (${i++})`;
    return name;
  }

  // A new task note. `target`: {area, project (basename or null)}; `day` — the focus date.
  async createTask(text, target, day) {
    await this.ensureFolder(this.tasksFolder);
    const name = await this.freeName(fileName(text).slice(0, 60) || t("newTask"));
    const front = ["---", `uid: ${newUid()}`, "type: задача", `status: ${STATUS_OPEN}`];
    if (target.area) front.push(`area: ${JSON.stringify(target.area)}`);
    if (target.project) front.push("projects:", `  - "[[${target.project}]]"`);
    if (day) front.push(`scheduled: ${day}`);
    if (name !== text) front.push(`title: ${JSON.stringify(text)}`);
    front.push("---", "");
    const file = await this.app.vault.create(normalizePath(`${this.tasksFolder}/${name}.md`), front.join("\n"));
    this.lastTarget = target;
    return this.taskOf(file) || { file, uid: front[1].slice(5), text, status: STATUS_OPEN, date: day || null, area: target.area, project: target.project };
  }

  // Puts a task where the user picks: an area, or a project inside it.
  placeTask(task) {
    new TargetModal(this.app, this.targets(), async (tg) => {
      if (tg.create) { if (!await this.createArea(tg.create)) return; tg = { area: tg.create, project: null }; }
      const ok = await this.setFields(task, { area: tg.area, projects: tg.project ? [`[[${tg.project}]]`] : null });
      if (ok) new Notice(t("taskIn", tg.project || tg.area));
      this.refresh();
    }).open();
  }

  // A task turns into a project when it stops being one step: its text becomes the project's name,
  // its description the project's note, and the checklist in that description its steps. A task
  // whose description had no checklist stays on as the project's first step, so nothing drops out of
  // the focus; a task that was only a container for a checklist is replaced by those steps and
  // leaves its `uid` on the project, so anything that pointed at it still finds it.
  async toProject(task) {
    // Everything below moves notes around; do it from what is on disk now, not from the row that was
    // drawn a minute ago.
    const live = this.app.vault.getAbstractFileByPath(task.file.path);
    const fresh = live && this.taskOf(live);
    if (!fresh || (task.uid && /^ft-/.test(task.uid) && fresh.uid !== task.uid)) { new Notice(t("changed")); return null; }
    task = fresh;
    const area = task.area || this.tasks().find((x) => x.uid === task.uid)?.area;
    if (!area) { new Notice(t("changed")); return null; }
    const name = fileName(task.text).slice(0, 60).trim();
    if (!name || this.app.vault.getAbstractFileByPath(normalizePath(`${this.folder}/${name}.md`))) {
      new Notice(t("toProjectBusy", task.text));
      return null;
    }
    const areas = await this.collect(true);
    const holder = areas.find((a) => a.name === area) || { name: area, note: null };
    const body = await this.app.vault.read(task.file);
    const [front, rest] = splitNote(body);
    const steps = [], keep = [];
    for (const line of rest.split("\n")) {
      const m = line.match(/^\s*[-*]\s*\[[ xX-]\]\s*(.*)$/);
      if (m && m[1].trim()) steps.push(m[1].trim());
      else keep.push(line);
    }
    const file = await this.createProject(holder, name);
    if (!file) return null;
    const text = keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text) await this.app.vault.process(file, (t0) => t0.replace(/\s*$/, "\n\n") + text + "\n");
    await this.app.fileManager.processFrontMatter(file, (fm) => { if (task.uid && !fm.uid) fm.uid = task.uid; });
    if (steps.length) {
      let day = task.date;
      for (const step of steps) {
        await this.createTask(step, { area, project: name }, day);
        day = null;  // the date the task carried goes to the first step only
      }
      await this.trash(task.file);
    } else if (task.date) {
      // It was in the focus today: it stays there as the project's first step, or the day would
      // quietly lose it. The row reads the same as the project — one click renames it.
      await this.setFields(task, { projects: [`[[${name}]]`] });
      if (rest.trim()) await this.app.vault.process(task.file, (t0) => splitNote(t0)[0] + "\n");
    } else {
      // Nothing was due: the project starts empty, under «Show upcoming», with no twin row.
      await this.trash(task.file);
    }
    new Notice(t("toProjectDone", name));
    this.refresh();
    return file;
  }

  // The view asks for these when a row is typed: a task right after another one, or in a container.
  async insertAfter(anchor, text, day) {
    return this.createTask(text, { area: anchor.area, project: anchor.project }, day);
  }

  async addLine(target, text, day) {
    await this.createTask(text, { area: target.area ?? target.file?.parent?.name, project: target.project }, day);
  }

  targets() {
    const cmp = collator();
    const out = this.notes().map((n) => ({
      area: n.area, project: n.project ? n.file.basename : null,
      label: n.project ? `📁 ${n.file.basename} · ${n.area}` : `🗂 ${n.area} ${t("looseTasks")}`,
    }));
    const last = this.lastTarget;
    const same = (x) => last && x.area === last.area && (x.project || null) === (last.project || null);
    return out.sort((a, b) => same(b) - same(a) || cmp(bare(a.area), bare(b.area)) || (!!a.project - !!b.project) || cmp(a.project || "", b.project || ""));
  }

  // --- areas and projects ------------------------------------------------------------------

  async ensureFolder(folder = this.folder) {
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
    const extra = (this.settings.projectFrontmatter || "").trim().replaceAll("{areaNote}", this.app.metadataCache.fileToLinktext(note, path));
    const file = await this.app.vault.create(path, ["---", ...(extra ? extra.split("\n") : []), `area: "${area.name.replace(/"/g, "'")}"`,
      `type: ${this.settings.typeProject}`, "---", ""].join("\n"));
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

  // A note moved or renamed anywhere — by this plugin, by the file explorer, by another device —
  // takes its place in the saved order and its fold state with it.
  async renamed(path, old) {
    if (!old || old === path) return;
    let touched = false;
    for (const list of Object.values(this.data.order.projects)) {
      const i = list.indexOf(old);
      if (i >= 0) { list[i] = path; touched = true; }
    }
    for (const map of [this.data.opened, this.data.folded]) {
      for (const prefix of ["project:", "later:", "done:"]) {
        if (map[prefix + old]) { delete map[prefix + old]; map[prefix + path] = true; touched = true; }
      }
    }
    // the steps of a project are ordered under its name: the name has just changed
    const was = "project:" + old.split("/").pop().replace(/\.md$/, "");
    const now = "project:" + path.split("/").pop().replace(/\.md$/, "");
    if (was !== now && this.data.order.tasks[was]) {
      this.data.order.tasks[now] = [...new Set([...(this.data.order.tasks[now] || []), ...this.data.order.tasks[was]])];
      delete this.data.order.tasks[was];
      touched = true;
    }
    this.forgetScan();
    if (touched) await this.saveAll();
  }

  // Renames a project note; Obsidian updates the links to it. The saved order and fold state follow.
  async renameProject(file, name) {
    const path = normalizePath(`${file.parent?.path && file.parent.path !== "/" ? file.parent.path + "/" : ""}${fileName(name)}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) { new Notice(t("noteExists", path)); return; }
    const old = file.path;
    await this.app.fileManager.renameFile(file, path);
    await this.renamed(path, old);
  }

  trash(file) {
    return this.app.fileManager.trashFile ? this.app.fileManager.trashFile(file) : this.app.vault.trash(file, true);
  }

  // The project's note goes to the trash; its tasks stay in the area as loose ones. Undo brings back
  // the note and the links its tasks had to it.
  async removeProject(area, project) {
    const name = project.file.basename;
    const mine = this.tasks().filter((x) => this.samePlace(x, project.file));
    const touched = this.notes().filter((n) => !n.project && n.area === area.name).map((n) => n.file);
    await this.undoable(t("projectDeleted", name), [project.file, ...mine.map((x) => x.file), ...touched], async () => {
      // a task that only knew where it was through this project keeps the area it was shown in
      for (const task of mine) await this.setFields(task, { projects: null, area: task.area || area.name });
      await this.dropLinks(project.file, area.name);
      await this.trash(project.file);
      await this.forget("project:" + project.file.path);
      await this.forget("later:" + project.file.path);
    });
  }

  deleteProject(area, project) {
    const mine = this.tasks().filter((x) => this.samePlace(x, project.file));
    new ConfirmModal(this.app, t("deleteProjectQ", project.file.basename), t("deleteProjectText", mine.length), t("delete"),
      () => this.removeProject(area, project)).open();
  }

  // The area, its projects and its tasks all go to the trash; undo brings all of them back.
  async removeArea(area) {
    const files = this.notes().filter((n) => n.area === area.name).map((n) => n.file);
    const mine = this.tasks().filter((x) => x.area === area.name);
    await this.undoable(t("areaDeleted", area.name), [...mine.map((x) => x.file), ...files], async () => {
      for (const task of mine) await this.trash(task.file);
      for (const f of files) {
        await this.trash(f);
        await this.forget("project:" + f.path);
      }
      await this.forget("area:" + area.name);
    });
  }

  deleteArea(area) {
    const mine = this.tasks().filter((x) => x.area === area.name);
    new ConfirmModal(this.app, t("deleteAreaQ", area.name), t("deleteAreaText", area.projects.length, mine.length), t("delete"),
      () => this.removeArea(area)).open();
  }

  // The project note a task points at. The link may be a name, a path or an alias; two notes may
  // share a name, so Obsidian resolves it from the task's own note first, and an area of its own
  // decides the rest.
  projectFile(task, candidates = null) {
    if (!task.project) return null;
    const found = this.app.metadataCache.getFirstLinkpathDest(task.project, task.file.path);
    const list = candidates || this.notes().filter((n) => n.project);
    const known = found && list.some((n) => n.file.path === found.path);
    // A link by path says exactly which note. A bare name may fit several, and then the task's own
    // area decides — every task folder is equally far from every project note.
    if (known && task.project.includes("/")) return found;
    if (known && !(task.area && list.some((n) => n.file.basename === found.basename && n.area === task.area && n.file.path !== found.path))) return found;
    const named = list.filter((n) => n.file.basename === task.project || n.file.path.replace(/\.md$/, "") === task.project.replace(/\.md$/, ""));
    if (!named.length) return null;
    return (task.area && named.find((n) => n.area === task.area) || named[0]).file;
  }

  // Does this task belong to that project note?
  samePlace(task, file) {
    const found = this.projectFile(task);
    return !!found && found.path === file.path;
  }

  // Text first, then where it goes (a known place skips the question).
  addTask(day, target) {
    new NameModal(this.app, t("newTask"), t("whatToDo"), async (text) => {
      const put = async (tg) => {
        if (tg.create) { if (!await this.createArea(tg.create)) return; tg = { area: tg.create, project: null }; }
        await this.addLine(tg, text, day);
        new Notice(t("taskIn", tg.project || tg.area));
      };
      if (target) await put(target);
      else new TargetModal(this.app, this.targets(), put).open();
    }, t("next")).open();
  }
};
