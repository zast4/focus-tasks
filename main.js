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
 * The view (a pane, or a ```focus-tasks``` block in a note) shows each area as one list of rows,
 * tasks and projects alike, in one order set by hand. A project is one row — «📁 Name › its first
 * step  +N» — and doing the project means doing that step; +N opens the other steps under the row.
 *  - on top, the focus: open tasks dated today or earlier, and the projects with such a step (or
 *    emptied today); the ⏳ on an area opens its pile of what is not today — undated, later, sent off,
 *    and the projects whose every step is such;
 *  - «All» at the bottom (kept per device) opens every such pile and lists the areas with nothing
 *    due below, folded; «Collapse all» / «Expand all» fold every area and project on screen.
 *
 * A click on a task's text edits it in place (Enter saves and opens the next row, Esc saves and
 * leaves the row selected; ⌘1 today, ⌘2 tomorrow, ⌘3 date picker, ⌘4 no date; ⌘Z with nothing typed
 * takes back the list's last change). The date on the right opens a date picker.
 * The checkbox completes a task (`status: done` + `completedDate`): the row leaves the list at once;
 * «✓ Done · N» at the bottom opens the day's closed work, by area, where a box brings a task back.
 * Nothing closed keeps an area on screen. A project is closed by hand, from its menu, once nothing in
 * it is open; till then an emptied project keeps its row, «no step yet», and takes the next one.
 * The grip on the left drags areas, projects and tasks; a plain click on it selects the row (on a
 * phone it opens the menu; a right click opens it anywhere). Shift-click selects every task from the
 * last clicked one, Cmd/Ctrl-click adds or drops one. With rows selected the keys work on them, as
 * on a selected block in Notion: ↑/↓ walk (Shift extends), Enter edits, ⌫ deletes, ⌘1–4 date them,
 * ⌘Z takes back the last change, Esc drops the selection; the grip drags them all, and their date
 * or menu set the date of all of them.
 */
const {
  Plugin, PluginSettingTab, Setting, ItemView, Modal, SuggestModal, FuzzySuggestModal, Notice, Menu,
  MarkdownRenderChild, MarkdownRenderer, Component, Keymap, moment, setIcon, prepareSimpleSearch,
  Platform, Scope, normalizePath, requestUrl,
} = require("obsidian");

const VIEW_TYPE = "focus-tasks-view";
const PROJECT_WORDS = ["project", "проект"];
const TASK_WORDS = ["task", "задача"];
const TASK_TYPE = "задача";   // what a new task note gets; TASK_WORDS is what we also read
// TaskNotes: the optional companion on the same notes. Its own field names are our contract
// already; the one thing it has to be told is how to recognise a task.
const COMPANION = { id: "tasknotes", repo: "callumalpass/tasknotes", property: "type" };
const STATUS_OPEN = "open", STATUS_DONE = "done", STATUS_CANCELLED = "cancelled", STATUS_SOMEDAY = "someday";
// Started and out of my hands: delegated, sent, waiting on someone. It leaves the focus but not the
// list — its date stops meaning «do it» and starts meaning «look at it again». TaskNotes knows this
// status out of the box, so a task marked here reads the same in both plugins.
const STATUS_PROGRESS = "in-progress";

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
    noStep: "no step yet", moreSteps: "{0} more — show them", hideSteps: "Hide the other steps", projectDone: "Project done",
    projectDoneNotice: "“{0}” is done", projectBack: "“{0}” is open again", doneButton: "Done", doneEmpty: "Nothing closed today yet", aProjectDone: "closing a project",
    setDate: "Set a date", today: "Today", yesterday: "Yesterday", tomorrow: "Tomorrow",
    newTask: "New task", newStep: "New step", newProject: "New project", actions: "Actions",
    projectFromNote: "Project from a note", deleteArea: "Delete area", rename: "Rename",
    openNote: "Open linked note", openFile: "Open task file", linkNote: "Link a note…", relinkNote: "Link another note…",
    unlinkNote: "Unlink the note", linkedNote: "Linked note: {0}",
    deleteProject: "Delete project", noDate: "No date (someday)", tasksDialog: "Tasks dialog (date, priority)",
    openInNote: "Open in note", delete: "Delete", changed: "The task changed in the note — try again",
    overwritten: "The change did not stick: another device or plugin saved “{0}” over it",
    deleted: "Deleted: {0}", deletedMany: "Deleted {0} tasks", undo: "Undo", noteExists: "Note “{0}” already exists",
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
    allDone: "done {0}", undone: "Undone: {0}", nothingToUndo: "Nothing to undo", cmdUndo: "Undo the last change",
    aDate: "the date", aPriority: "the priority", aRunning: "the status", aMove: "the move", aRename: "the new text", aDone: "completing the task", aNew: "the new task", aProject: "making it a project", focusDone: "Nothing due today — {0} tasks are waiting", showAll: "Show them",
    orphans: "Without an area", orphansHelp: "These tasks are in no area, so the focus cannot show them. Pick a place for each.",
    place: "Put in an area…", toProject: "Make it a project", toProjectDone: "“{0}” is a project now",
    toProjectBusy: "“{0}” cannot become a project: a note with that name already exists",
    dueOn: "Deadline: {0}", priorityLow: "Low priority", priorityNormal: "Normal priority", priorityHigh: "High priority", priorityNone: "No priority",
    inProgress: "In progress…", backToWork: "Back to the focus",
    waitingSince: "Running; look again {0}", waitingNoDate: "Running; no day set to look again",
    ofThemRunning: "{0} of them running", sendOff: "Send it off…",
    timeHint: "hh:mm", hourHint: "hh", minuteHint: "mm",
    wip: "Focus Tasks is still being built. A stable version is on the way — write to me on Telegram to hear when it lands:",
    wipWho: "@zastashkov", sWip: "Work in progress",
    sBuild: "Build", buildStable: "Stable", buildTest: "Test", buildLine: "{0} · {1} · {2}",
    buildQueue: "test: {0} {1} over the stable one", buildCommit: ["commit", "commits", "commits"],
    buildOnly: "no test build here", buildSame: "the test build is the stable one",
    buildUnknown: "installed as usual, not delivered from the workshop", buildSwitched: "Switched to {0}",
    buildBadge: "test", buildBadgeHelp: "A test build is running. Its stable one is one click away, in the settings.",
    returnWhen: "Look at it again", returnHint: "tomorrow or later",
    returnTooSoon: "The day to come back cannot be in the past",
    selected: "Selected: {0}", pickDate: "Date…", clearSelection: "Clear selection",
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
    sFolder: "Folder", sFolderDesc: "Where the notes of areas and projects live. Notes linked to them can be anywhere.",
    sTasksFolder: "Tasks folder", sTasksFolderDesc: "Where task notes are kept, one note per task.",
    sLanguage: "Language", sLanguageDesc: "Interface language (Auto follows Obsidian).",
    doneToday: "Done today: {0}", doneHide: "Hide what is done", doneShow: "Show what is done",
    laterHide: "Hide the upcoming steps", laterShow: "Show the upcoming steps",
    oldFormat: "{0} tasks here are still checkbox lines from version 0.1.0 — a task is a note of its own now, so they are not shown. ",
    oldFormatHow: "How to move them",
    sCompanion: "TaskNotes",
    sCompanionOff: "Optional. On the same task notes it adds recurrence, reminders, time tracking and calendar views — this list stays the daily focus on top.",
    sCompanionOn: "Installed. It reads the same notes: tasks are found by the property “{0}” = “{1}” in the folder “{2}”.",
    sCompanionStale: "Installed, but looking elsewhere — it will not see these tasks until it finds them by the property “{0}” = “{1}” in “{2}”.",
    sInstall: "Install", sEnable: "Turn on", sTune: "Point it at these tasks", sCompanionOpen: "Its settings",
    installing: "Installing TaskNotes…", installed: "TaskNotes is installed and on",
    installFailed: "Could not install TaskNotes: {0}. Settings → Community plugins → Browse → TaskNotes",
    tuned: "TaskNotes now looks for “{0}” = “{1}” in “{2}”",
    tuneFailed: "TaskNotes keeps its settings differently now — set task identification by hand: property “{0}” = “{1}”, folder “{2}”",
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
    noStep: "пока пусто", moreSteps: "ещё {0} — показать", hideSteps: "Скрыть остальные шаги", projectDone: "Проект выполнен",
    projectDoneNotice: "«{0}» выполнен", projectBack: "«{0}» снова открыт", doneButton: "Сделано", doneEmpty: "Сегодня ещё ничего не закрыто", aProjectDone: "закрытие проекта",
    setDate: "Поставить дату", today: "Сегодня", yesterday: "Вчера", tomorrow: "Завтра",
    newTask: "Новая задача", newStep: "Новый шаг", newProject: "Новый проект", actions: "Действия",
    projectFromNote: "Проект из заметки", deleteArea: "Удалить область", rename: "Переименовать",
    openNote: "Открыть привязанную заметку", openFile: "Открыть файл задач", linkNote: "Привязать заметку…", relinkNote: "Привязать другую заметку…",
    unlinkNote: "Отвязать заметку", linkedNote: "Привязанная заметка: {0}",
    deleteProject: "Удалить проект", noDate: "Без даты (в отложку)", tasksDialog: "Окно Tasks (дата, приоритет)",
    openInNote: "Открыть в заметке", delete: "Удалить", changed: "Задача изменилась в заметке, попробуй ещё раз",
    overwritten: "Правка не сохранилась: заметку «{0}» перезаписало другое устройство или плагин",
    deleted: "Удалено: {0}", deletedMany: "Удалено задач: {0}", undo: "Вернуть", noteExists: "Заметка «{0}» уже есть",
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
    allDone: "сделано {0}", undone: "Отменено: {0}", nothingToUndo: "Нечего отменять", cmdUndo: "Отменить последнее действие",
    aDate: "дата", aPriority: "приоритет", aRunning: "статус", aMove: "перенос", aRename: "текст задачи", aDone: "выполнение задачи", aNew: "новая задача", aProject: "превращение в проект", focusDone: "На сегодня ничего — в работе ещё {0}", showAll: "Показать",
    orphans: "Без области", orphansHelp: "Эти задачи ни в одной области, поэтому фокус их не показывает. Разложи их по местам.",
    place: "Положить в область…", toProject: "Сделать проектом", toProjectDone: "«{0}» теперь проект",
    toProjectBusy: "«{0}» не сделать проектом: заметка с таким именем уже есть",
    dueOn: "Дедлайн: {0}", priorityLow: "Низкий приоритет", priorityNormal: "Обычный приоритет", priorityHigh: "Высокий приоритет", priorityNone: "Без приоритета",
    inProgress: "В работу…", backToWork: "Вернуть в фокус",
    waitingSince: "Запущено; вернуться {0}", waitingNoDate: "Запущено; день возврата не назначен",
    ofThemRunning: "из них запущено {0}", sendOff: "В работу…",
    timeHint: "чч:мм", hourHint: "чч", minuteHint: "мм",
    wip: "Focus Tasks ещё в работе. Стабильная версия готовится - напишите мне в Telegram, и я скажу, когда она выйдет:",
    wipWho: "@zastashkov", sWip: "Плагин в работе",
    sBuild: "Сборка", buildStable: "Стабильная", buildTest: "Тестовая", buildLine: "{0} · {1} · {2}",
    buildQueue: "тест: {0} {1} сверх стабильной", buildCommit: ["коммит", "коммита", "коммитов"],
    buildOnly: "тестовой сборки нет", buildSame: "тестовая совпадает со стабильной",
    buildUnknown: "поставлена обычным способом, не из мастерской", buildSwitched: "Переключил на: {0}",
    buildBadge: "тест", buildBadgeHelp: "Работает тестовая сборка. Стабильная - в один клик, в настройках.",
    returnWhen: "Вернуться к задаче", returnHint: "завтра или позже",
    returnTooSoon: "День возврата не может быть в прошлом",
    selected: "Выбрано: {0}", pickDate: "Дата…", clearSelection: "Снять выделение",
    months: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
    weekdays: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
    sFolder: "Папка", sFolderDesc: "Где лежат заметки областей и проектов. Привязанные к ним заметки могут быть где угодно.",
    sTasksFolder: "Папка задач", sTasksFolderDesc: "Где лежат заметки задач, по одной заметке на задачу.",
    sLanguage: "Язык", sLanguageDesc: "Язык интерфейса (Auto — как в Obsidian).",
    doneToday: "Сделано сегодня: {0}", doneHide: "Скрыть выполненные", doneShow: "Показать выполненные",
    laterHide: "Скрыть будущие шаги", laterShow: "Показать будущие шаги",
    oldFormat: "Здесь ещё {0} задач строками-чекбоксами из версии 0.1.0 — теперь задача это отдельная заметка, поэтому их не видно. ",
    oldFormatHow: "Как перенести",
    sCompanion: "TaskNotes",
    sCompanionOff: "По желанию. На тех же заметках задач он добавляет повторы, напоминания, учёт времени и календарь — этот список остаётся фокусом на день.",
    sCompanionOn: "Стоит. Читает те же заметки: задачи ищет по свойству «{0}» = «{1}» в папке «{2}».",
    sCompanionStale: "Стоит, но смотрит не туда — наших задач он не увидит, пока не будет искать их по свойству «{0}» = «{1}» в «{2}».",
    sInstall: "Поставить", sEnable: "Включить", sTune: "Навести на эти задачи", sCompanionOpen: "Его настройки",
    installing: "Ставлю TaskNotes…", installed: "TaskNotes поставлен и включён",
    installFailed: "Не поставился TaskNotes: {0}. Настройки → Сторонние плагины → Обзор → TaskNotes",
    tuned: "TaskNotes теперь ищет «{0}» = «{1}» в «{2}»",
    tuneFailed: "TaskNotes хранит настройки иначе — поставь опознавание задач руками: свойство «{0}» = «{1}», папка «{2}»",
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
// A file name for a task: a link in the text becomes the words it shows, the rest loses the
// characters a file name may not carry. «Прочитать [[Books/Дюна|Дюну]]» → «Прочитать Дюну».
const fileName = (name) => name
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
  .replace(/\[\[([^\]]+)\]\]/g, (_, path) => path.split("/").pop())
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[\\/#^\[\]|?*<>":]/g, "-").replace(/\s+/g, " ").trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// «16», «16:00», «16.30», «1630» → «16:00» / «16:30»; anything else is not a time.
const parseTime = (text) => {
  const m = String(text ?? "").trim().match(/^(\d{1,2})(?:[:. ]?(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2] || 0);
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null;
};
const inFocus = (task) => task.date && task.date <= today();
// A running task is given the moment it comes back — a day, and the time of day when one was named.
const timeOf = (value) => String(value ?? "").match(/T(\d{2}:\d{2})/)?.[1] || null;
const backDue = (task) => !!task.date && (task.at
  ? `${task.date}T${task.at}` <= moment().format("YYYY-MM-DDTHH:mm")
  : task.date <= today());
// Sent off and still waiting for that moment: it stays where it lives, but the row goes quiet.
const waitingBack = (task) => task.status === STATUS_PROGRESS && !backDue(task);
// A date as the plugin reads it: «2026-09-22», «2026-09-22T18:30+03:00» and a Date all mean that day.
const day = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const text = value instanceof Date ? moment(value).format("YYYY-MM-DD") : String(value).trim();
  return text.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || text;
};
// The line that says which build is running: «Стабильная · 23.09 19:40 · заголовок коммита».
const buildText = (build) => {
  if (!build || !build.mode) return null;
  const name = t(build.mode === "test" ? "buildTest" : "buildStable");
  const when = build.at ? moment(build.at).format("DD.MM HH:mm") : "";
  return t("buildLine", name, when, build.subject || build.commit || "").replace(/ · $/, "").replace(/ ·  · /, " · ");
};
// Which of the three forms a count takes (English keeps two of them the same).
const plural = (n, forms) => {
  const ten = Math.abs(n) % 10, hundred = Math.abs(n) % 100;
  if (ten === 1 && hundred !== 11) return forms[0];
  if (ten >= 2 && ten <= 4 && (hundred < 10 || hundred >= 20)) return forms[1];
  return forms[2];
};
const isHead = (l) => /^#{1,6}\s/.test(l);
const headText = (l) => l.replace(/^#+\s*/, "").trim();
const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, "    ").length;
const collator = () => (a, b) => a.localeCompare(b, LANG);
const newUid = () => "ft-" + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5);
// The list a task is dragged within: the steps of its project, or the loose tasks of its area.
const listOf = (task) => (task.project ? "project:" + task.project : "area:" + task.area);
// `tags: [archived]`, `tags: archived` or `#archived`: the note is in the archive.
const isArchived = (tags) => (Array.isArray(tags) ? tags : tags ? [tags] : []).some((x) => String(x).replace(/^#/, "").toLowerCase() === "archived");
// A row's place in its area's saved order: a task by its id, a project by its note.
const seatKey = (row) => (row.kind === "task" ? row.task.uid : "p:" + row.project.file.path);
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
  // `opts` turns the same card into a question: `title` says what the day is for, `min` is the
  // earliest day that answers it at all, `clear: false` takes away «no date» where having none would
  // make no sense, and `time` adds the two fields for an hour of that day.
  constructor(anchor, value, onPick, onCancel, opts = {}) {
    Object.assign(this, { value, onPick, onCancel, min: opts.min || null, tooEarly: opts.tooEarly || null });
    this.month = moment(value || opts.min || today()).startOf("month");
    this.el = document.body.createDiv({ cls: "ft-picker" });
    if (opts.title) this.el.createDiv({ cls: "ft-picker-caption", text: opts.title });
    const field = this.el.createDiv({ cls: "ft-picker-field" });
    this.input = field.createEl("input", { type: "text", cls: "ft-picker-input", attr: { placeholder: opts.hint || t("pickerPlaceholder") } });
    this.input.value = value ? moment(value).format("DD.MM.YY") : "";
    // An hour is asked for only where it means something — the moment a task comes back. Two fields,
    // not one: type two digits for the hour and the caret moves to the minutes by itself, two more
    // and Tab closes the card with the time set. Hands stay on the keyboard the whole way.
    if (opts.time) {
      const pair = field.createDiv({ cls: "ft-picker-clock" });
      const cell = (cls, value) => pair.createEl("input", { type: "text", cls: `ft-picker-part ${cls}`,
        attr: { placeholder: t(cls === "is-hh" ? "hourHint" : "minuteHint"), maxlength: "2", inputmode: "numeric", value } });
      this.hh = cell("is-hh", (opts.at || "").slice(0, 2));
      pair.createSpan({ cls: "ft-picker-colon", text: ":" });
      this.mm = cell("is-mm", (opts.at || "").slice(3, 5));
      // The segments are filled from the keyboard and nothing else: two digits for the hour and the
      // caret moves on by itself, two for the minutes and Tab ends the run. A segment selects itself
      // when it is entered, so typing always replaces what was there.
      const cap = (el) => (el === this.hh ? 23 : 59);
      const digits = (el) => { el.value = el.value.replace(/\D/g, "").slice(0, 2); };
      const fill = (el) => {
        digits(el);
        const full = el.value.length === 2 || Number(el.value) * 10 > cap(el);   // «3» cannot start an hour
        if (full && el === this.hh) { this.hh.value = this.hh.value.padStart(2, "0"); this.mm.focus(); }
      };
      this.hh.oninput = () => fill(this.hh);
      this.mm.oninput = () => digits(this.mm);
      for (const el of [this.hh, this.mm]) {
        el.onfocus = () => el.select();
        el.onblur = () => { if (el.value) el.value = String(Math.min(Number(el.value), cap(el))).padStart(2, "0"); };
        el.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === "Escape") { e.preventDefault(); this.close(); return; }
          if (e.key === "Enter") { e.preventDefault(); this.submit(); return; }
          // the last Tab of the run is the «done» of the run: nothing else to fill in
          if (e.key === "Tab" && !e.shiftKey && el === this.mm) { e.preventDefault(); this.submit(); return; }
          if (e.key === "Backspace" && el === this.mm && !this.mm.value) { e.preventDefault(); this.hh.focus(); }
        };
      }
    }
    this.head = this.el.createDiv({ cls: "ft-picker-head" });
    this.grid = this.el.createDiv({ cls: "ft-picker-grid" });
    if (opts.clear !== false) this.el.createDiv({ cls: "ft-picker-foot" }).createEl("button", { text: t("clearDate") }).onclick = () => this.pick(null);
    this.draw();
    this.place(anchor);
    this.input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); this.close(); return; }
      if (e.key !== "Enter") return;
      e.preventDefault();
      this.submit();
    };
    this.input.oninput = () => this.input.removeClass("is-invalid");
    this.outside = (e) => { if (!this.el.contains(e.target)) this.commit(); };
    this.keys = (e) => { if (e.key === "Escape") { e.preventDefault(); this.close(); } };
    this.scrolled = (e) => { if (!this.el.contains(e.target)) this.commit(); };
    // The click that opened the picker is still travelling, so listening starts a tick later — and
    // only if the picker is still open by then, or the listeners would outlive it.
    setTimeout(() => {
      if (this.closed) return;
      this.listening = true;
      document.addEventListener("pointerdown", this.outside, true);
      document.addEventListener("keydown", this.keys, true);
      document.addEventListener("scroll", this.scrolled, true);
    }, 0);
    // The day is already answered (today, unless told otherwise); the hour is what is actually being
    // typed, so that is where the caret starts.
    if (!Platform.isMobile) (this.hh || this.input).focus();  // on a phone the keyboard would cover the month
  }

  draw() {
    this.head.empty();
    this.grid.empty();
    this.head.createDiv({ cls: "ft-picker-title", text: `${t("months")[this.month.month()]} ${this.month.year()}` });
    // No «Today» / «Tomorrow» buttons: the field takes «сегодня», «завтра», «+3» and the grid marks
    // today anyway — two more buttons only crowded the card.
    const nav = this.head.createDiv({ cls: "ft-picker-nav" });
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
      if (!this.allowed(iso)) cell.addClass("is-blocked");
      // With an hour still to type, a day is an answer to half the question: it fills the field and
      // hands the caret back to the clock instead of closing the card.
      else if (this.hh) cell.onclick = () => {
        this.value = iso;
        this.input.value = moment(iso).format("DD.MM.YY");
        this.input.removeClass("is-invalid");
        this.draw();
        this.hh.focus();
      };
      else cell.onclick = () => this.pick(iso);
    }
  }

  // A day the card was told not to accept: drawn, so the month still reads as a month, but dead.
  allowed(iso) { return !this.min || iso >= this.min; }

  place(anchor) {
    const r = anchor.getBoundingClientRect();
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    Object.assign(this.el.style, { left: `${left}px`, top: `${top}px` });
  }

  // What the fields add up to, whichever key ended the run.
  submit() {
    const day = parseDay(this.input.value) || this.value;
    if (!day || !this.allowed(day)) {
      this.input.addClass("is-invalid");
      if (day && this.tooEarly) new Notice(this.tooEarly);
      return;
    }
    this.pick(day);
  }

  // The hour rides along with the day: empty hours simply mean «that whole day», and minutes left
  // empty on a filled hour mean o'clock. Returns false when the fields hold something unreadable.
  pick(day) {
    let at = null;
    if (this.hh && this.hh.value.trim()) {
      at = parseTime(`${this.hh.value}:${this.mm.value.trim() || "00"}`);
      if (!at) { this.hh.addClass("is-invalid"); return false; }
    }
    this.close(true);
    this.onPick(day, at);
    return true;
  }

  // Walking away from the card is an answer too: what stands in the fields is applied. Typing a day
  // and an hour and then clicking elsewhere used to throw both away — the one gesture nobody reads
  // as «cancel». Escape is what cancels.
  commit() {
    if (this.closed) return;
    const day = parseDay(this.input.value) || this.value;
    if (!day || !this.allowed(day) || !this.pick(day)) this.close();
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
    this.cursor = null;         // the selected row the arrow keys go on from
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

  // The element that actually scrolls around the list: the pane's own content, a note's preview, or
  // the editor's scroller in Live Preview. Picking the wrong one means the page jumps on every
  // rebuild, because the scroll is kept on something that does not scroll.
  get scroller() {
    for (let el = this.containerEl.parentElement; el; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 1) {
        const how = getComputedStyle(el).overflowY;
        if (how === "auto" || how === "scroll" || el.matches(".markdown-preview-view, .view-content, .cm-scroller")) return el;
      }
      if (el.classList?.contains("workspace-leaf")) break;
    }
    return this.containerEl.closest(".cm-scroller, .markdown-preview-view, .view-content");
  }

  onload() {
    // The list takes keyboard focus when it is worked with: otherwise the keys go to whatever was
    // focused before (a note's editor swallows Esc and ⌘1–4) and the list looks deaf.
    this.containerEl.tabIndex = -1;
    const later = () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.render(), 300); };
    // A task waiting for an hour of the day has nothing to wake it: nothing in the vault changes at
    // 16:00. The list watches the clock itself — a timeout set for the nearest moment, and a slow
    // sweep behind it in case the machine slept through the timeout.
    this.registerInterval(window.setInterval(() => this.wake(), 30000));
    this.register(() => clearTimeout(this.alarm));
    this.registerEvent(this.plugin.app.metadataCache.on("changed", later));
    this.registerEvent(this.plugin.app.vault.on("delete", later));
    this.registerEvent(this.plugin.app.vault.on("rename", later));
    // A plain click anywhere else drops the selection, as it does a selected block in Notion — in
    // another pane too, and on the parts of a row that keep their clicks to themselves (a chip, a
    // «+»). Not a click that works on the selection: its grip (a drag, a pick), a selected row's
    // date or box, a menu, a card, a notice with «Undo».
    this.registerDomEvent(document, "mousedown", (e) => {
      if (!this.selected.size || picking(e) || e.button !== 0) return;
      if (e.target.closest(".menu, .modal, .prompt, .ft-picker, .notice, .suggestion-container, .ft-grip, li.ft-task.is-selected")) return;
      this.clearSelection();
    }, true);
    // Esc must drop a selection wherever the keyboard happens to be — a note's editor would swallow
    // the key otherwise, and the marked rows could not be unmarked at all.
    this.registerDomEvent(document, "keydown", (e) => {
      if (e.key !== "Escape" || !this.selected.size || this.editing) return;
      if (document.querySelector(".modal, .menu, .prompt")) return;   // those own Escape while they are open
      this.clearSelection();
      e.preventDefault();
      e.stopPropagation();
    }, true);
    this.registerEvent(this.plugin.app.workspace.on("active-leaf-change", () => this.keys(true)));
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
    this.dropScopes();
    this.picker?.close();
    this.stopDrag?.();
    this.plugin.views.delete(this);
  }

  // Any editor scope still pushed — its row was rebuilt or the view went away — is taken off.
  dropScopes() {
    for (const scope of this.scopes || []) this.plugin.app.keymap.popScope(scope);
    this.scopes?.clear();
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
    // Among the other areas, the ones with nothing open at all go last: a row that says «open 0» is
    // not a place to look for work. The order set by hand holds within each group.
    rest.sort((a, b) => (a.focus + a.later ? 0 : 1) - (b.focus + b.later ? 0 : 1));
    const shownAreas = [...areas, ...rest];
    this.fresh = new WeakMap();
    // Every task still waiting to come back — from the model, not from the rows on screen: the group
    // they live in is usually folded, and then there was nothing to watch and the moment passed by.
    this.pending = p.tasks().filter(waitingBack);
    this.setAlarm();
    // [key, all] of every foldable header on screen (also inside folded areas)
    this.folds = [
      ...areas.flatMap((a) => [["area:" + a.name, false], ...a.projects.map((pr) => ["steps:" + pr.file.path, true])]),
      ...rest.flatMap((a) => [["area:" + a.name, true], ...a.projects.map((pr) => ["steps:" + pr.file.path, true])]),
    ];
    // The order on screen of every list: an area's rows (tasks and «p:…» projects), a project's steps.
    const seen = {};
    for (const a of shownAreas) {
      seen["area:" + a.name] = [...a.rows, ...a.ahead].map(seatKey);
      for (const pr of a.projects) {
        const key = "project:" + pr.file.basename;
        seen[key] = [...new Set([...(seen[key] || []), ...pr.tasks.map((x) => x.uid), ...pr.later.map((x) => x.uid)])];
      }
    }
    this.shown = { areas: shownAreas.map((a) => a.name), tasks: seen };
    const old = this.inner;
    this.inner = this.addChild(new Component());
    const el = createDiv();
    const none = !p.notes().length;
    // Anyone who installed this from GitHub is looking at unfinished work, and has no way of knowing
    // it. The builds delivered into the author's own vault carry a `build.json`; nobody else's does,
    // and that is exactly who this line is for.
    if (!p.build) {
      const strip = el.createDiv({ cls: "ft-wip" });
      strip.createSpan({ text: t("wip") + " " });
      strip.createEl("a", { text: t("wipWho"), href: "https://t.me/zastashkov" });
    }
    // Coming from 0.1.0 the areas are still there but every task is a checkbox line, which this
    // version does not read: without a word the list just looks broken.
    const old010 = !p.tasks().length ? await p.checkboxLeftovers() : 0;
    if (old010) {
      const line = el.createDiv({ cls: "ft-empty ft-onboarding" });
      line.createSpan({ text: t("oldFormat", old010) });
      line.createEl("a", { cls: "ft-empty-link", text: t("oldFormatHow"),
        href: "https://github.com/zast4/focus-tasks#upgrading-from-010" });
    }
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
    // The day's closed work, all of it, in one block under the areas: nothing closed keeps an area
    // or a project on screen, so this is the one place to see it — and to untick a slip.
    const closed = p.closedToday();
    const closedCount = closed.reduce((n, g) => n + g.tasks.length + g.projects.length, 0);
    if (!none && p.doneShown()) {
      const block = el.createDiv({ cls: "ft-done-today" });
      if (!closed.length) block.createDiv({ cls: "ft-empty", text: t("doneEmpty") });
      for (const g of closed) {
        const head = block.createDiv({ cls: "ft-done-area" });
        head.createSpan({ cls: "ft-emoji", text: g.name.slice(0, g.name.length - bare(g.name).length).trim() });
        head.createSpan({ text: bare(g.name) || g.name });
        await this.completed(block, g.tasks, g.projects);
      }
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
      const done = foot.createEl("button", { cls: "ft-foot-button ft-done-toggle" });
      done.toggleClass("is-on", p.doneShown());
      setIcon(done.createSpan(), "check");
      done.createSpan({ text: t("doneButton") + (closedCount ? ` · ${closedCount}` : "") });
      done.setAttr("aria-label", t("doneToday", closedCount));
      done.onclick = () => { pin(".ft-foot"); p.setDoneShown(!p.doneShown()); };
    }
    foot.createEl("button", { text: t("newArea"), cls: "ft-foot-button ft-new-area" }).onclick = () => p.newArea();
    foot.createEl("button", { text: t("areaFromNote"), cls: "ft-foot-button ft-area-from-note" }).onclick = () => p.areaFromNote();
    // A test build has to say so where it is used, not only in the settings.
    if (p.build?.mode === "test") {
      const badge = foot.createSpan({ cls: "ft-foot-badge", text: t("buildBadge") });
      badge.setAttr("aria-label", `${t("buildBadgeHelp")}\n${buildText(p.build) || ""}`);
    }
    foot.createDiv({ cls: "ft-foot-gap" });
    if (!none) {
      for (const [label, icon, open] of [["foldAll", "chevrons-down-up", false], ["unfoldAll", "chevrons-up-down", true]]) {
        const b = foot.createEl("button", { cls: "ft-foot-button" });
        setIcon(b.createSpan(), icon);
        b.createSpan({ text: t(label) });
        b.onclick = () => { pin(".ft-foot"); p.foldAll(this.folds, open); };
      }
    }
    // Someone started typing while this was being built: leave the screen as it is and build again
    // when they are done, or the row under the cursor would vanish mid-word.
    if (this.editing) {
      this.removeChild(this.inner);
      this.inner = old;
      this.again = true;
      return;
    }
    if (old) this.removeChild(old);
    // Ticking a box moves its row to «Completed» at the bottom, so everything below it shifts up. The
    // page must not move under the reader: a row that stays on screen is remembered, and after the
    // swap the scroll is nudged so that row keeps the same place in the window.
    const anchor = this.anchorRow();
    this.containerEl.addClass("focus-tasks-view");
    this.containerEl.replaceChildren(...el.childNodes);
    this.items = this.fresh;
    this.keepPlace(anchor);
    this.paint();
    this.hold();
  }

  // The row to steer by when the list is rebuilt: the first one that is fully on screen and is not
  // the row being ticked (that one is about to move), plus where it sits in the window.
  anchorRow() {
    const scroller = this.scroller;
    if (!scroller) return null;
    const top = scroller.getBoundingClientRect().top;
    for (const [el, task] of this.rows()) {
      if (el.hasClass("is-toggling")) continue;
      const y = el.getBoundingClientRect().top;
      if (y >= top - 1 && y <= top + scroller.clientHeight) return { uid: task.uid, offset: y - top, scrollTop: scroller.scrollTop };
    }
    return { uid: null, offset: 0, scrollTop: scroller.scrollTop };
  }

  // Puts the remembered row back where it was; with nothing to steer by, at least the raw position
  // is kept (emptying the container alone would clamp it to the top).
  keepPlace(anchor) {
    const scroller = this.scroller;
    if (!anchor || !scroller) return;
    if (anchor.uid) {
      const row = this.rows().find(([, task]) => task.uid === anchor.uid);
      if (row) {
        const drift = row[0].getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
        if (Math.abs(drift) > 1) scroller.scrollTop += drift;
        return;
      }
    }
    if (Math.abs(scroller.scrollTop - anchor.scrollTop) > 1) scroller.scrollTop = anchor.scrollTop;
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
    this.grab();
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
    this.cursor = task;
    this.paint();
  }

  // The keyboard comes to the list before a selection is made.
  grab() {
    if (this.editing) document.activeElement?.blur();  // an open editor saves and closes
    const leaf = this.leafOf();
    // the hotkeys follow the active tab; focusing a note's editor could open the block's source instead
    if (leaf && this.plugin.app.workspace.activeLeaf !== leaf) this.plugin.app.workspace.setActiveLeaf(leaf, { focus: false });
    this.take();
  }

  // These rows and no others are selected; the first is where ↑/↓ go on from.
  mark(tasks) {
    const list = Array.isArray(tasks) ? tasks : [tasks];
    this.grab();
    this.selected = new Set(list);
    this.anchor = this.cursor = list[0] || null;
    this.paint();
  }

  // The same, once the list shows the row again: its note may have just been written (a rename, an
  // undo) and the cache be a beat behind.
  async markSoon(task) {
    await this.cachedAll([task.uid]);
    await this.rerendered();
    const now = this.rows().map(([, x]) => x).find((x) => x.uid === task.uid);
    if (now) this.mark(now);
  }

  // A plain click on the grip: this row alone is selected, or dropped when it was the only one;
  // with Shift or ⌘ it is a click on the row.
  pick(task, e) {
    if (picking(e)) return this.select(task, e);
    if (this.selected.size === 1 && this.selected.has(task)) return this.clearSelection();
    this.mark(task);
  }

  // ↑/↓ take the selection to the row above or below the cursor; with Shift, every row from the
  // anchor to there is selected, as a Shift-click would.
  walk(by, extend) {
    const rows = this.rows().filter(([el]) => el.offsetParent !== null);
    const tasks = rows.map(([, x]) => x);
    const at = (t) => (t ? tasks.findIndex((x) => keyOf(x) === keyOf(t)) : -1);
    let i = at(this.cursor);
    if (i < 0 || !this.selected.has(tasks[i])) {
      const chosen = tasks.map((x, k) => (this.selected.has(x) ? k : -1)).filter((k) => k >= 0);
      i = by > 0 ? chosen[chosen.length - 1] : chosen[0];
    }
    const to = i + by;
    if (to < 0 || to >= tasks.length) return;
    let from = extend ? at(this.anchor) : -1;
    if (from < 0 || !this.selected.has(tasks[from])) from = to;
    this.selected = new Set(tasks.slice(Math.min(from, to), Math.max(from, to) + 1));
    this.anchor = tasks[from];
    this.cursor = tasks[to];
    this.paint();
    rows[to][0].scrollIntoView({ block: "nearest" });
  }

  // Enter: the row under the cursor (the first selected one otherwise) is edited, caret at the end.
  editSelected() {
    const chosen = this.chosen();
    const task = chosen.find((x) => this.cursor && keyOf(x) === keyOf(this.cursor)) || chosen[0];
    const row = task && this.rows().find(([, x]) => x === task)?.[0];
    const text = row?.querySelector(":scope > .ft-text");
    if (text) this.editInline(task, text, null);
  }

  // ⌫: the selected tasks go to the trash; the notice (or ⌘Z) puts them back.
  deleteSelected() {
    const tasks = this.chosen();
    this.clearSelection();
    return this.plugin.removeTasks(tasks);
  }

  // ⌘Z: the last change taken back, and the rows it touched selected, so the keys go on from there
  // — the row ⌘2 just sent away is back under the cursor.
  async undo() {
    const last = (this.plugin.history || []).at(-1);
    const uids = last ? last.snap.map((x) => /^uid:\s*(\S+)/m.exec(x.text || "")?.[1]).filter(Boolean) : [];
    if (!(await this.plugin.undo()) || !uids.length) return;
    await this.cachedAll(uids);
    await this.rerendered();
    const back = this.rows().map(([, x]) => x).filter((x) => uids.includes(x.uid));
    if (back.length) this.mark(back);
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
    this.keys(true);
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
        if (this.editing || !this.selected.size) return true;   // nothing of ours: let the app have the key
        fn();
        return false;
      });
    }
    // ⌘Z belongs to whatever is in front. Here it undoes the last change to the list; anywhere else
    // — a note, another pane — this scope is not pushed at all and the key never reaches us.
    this.scope.register(["Mod"], "z", () => {
      if (this.editing) return true;
      this.undo();
      return false;
    });
    this.scope.register([], "Escape", () => {
      if (this.editing || !this.selected.size) return true;  // the picker's own Esc, or nothing to clear
      this.clearSelection();
      return false;
    });
    // With rows selected the keys work on them, as on a selected block in Notion: ↑/↓ walk (Shift
    // extends), Enter edits, ⌫ deletes. Not while something is typed in — the picker's field, say.
    const typing = () => { const a = document.activeElement; return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName)); };
    const own = (fn) => () => {
      if (this.editing || !this.selected.size || typing()) return true;
      fn();
      return false;
    };
    this.scope.register([], "ArrowDown", own(() => this.walk(1, false)));
    this.scope.register([], "ArrowUp", own(() => this.walk(-1, false)));
    this.scope.register(["Shift"], "ArrowDown", own(() => this.walk(1, true)));
    this.scope.register(["Shift"], "ArrowUp", own(() => this.walk(-1, true)));
    this.scope.register([], "Enter", own(() => this.editSelected()));
    for (const key of ["Backspace", "Delete"]) {
      this.scope.register([], key, own(() => this.deleteSelected()));
      this.scope.register(["Mod"], key, own(() => this.deleteSelected()));
    }
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
    this.cursor = null;
    if (!this.selected.size) return;
    this.selected.clear();
    this.paint();
  }

  // Brings the keyboard into the list. Without it Esc and ⌘1–4 go to whatever had the focus — a
  // note's editor, usually — and the selection cannot even be dropped with Esc.
  take() {
    const active = document.activeElement;
    if (active && this.containerEl.contains(active)) return;
    if (active && (active.isContentEditable || /^(INPUT|TEXTAREA)$/.test(active.tagName))) active.blur();
    this.containerEl.focus({ preventScroll: true });
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
  // ⏳ pile of an area in the focus is open unless closed.
  async area(el, area, all = false, wide = false) {
    const p = this.plugin;
    const box = el.createDiv({ cls: "ft-area" });
    if (all) box.addClass("is-rest");   // one list, nothing leaves it
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
    if (all) {
      const open = area.rows.filter((r) => r.kind === "task").length + area.projects.reduce((n, b) => n + b.tasks.length, 0);
      title.createSpan({ cls: "ft-count", text: t("openCount", open) + (area.focus ? t("inFocus", area.focus) : "") });
    } else if (!open) title.createSpan({ cls: "ft-count", text: String(area.rows.length) });
    // What the area holds beside today's work hangs off its own header: the ⏳ opens the pile of
    // what is not today. An icon without a number, there under the pointer and lit while its pile is
    // open — the count is in its tooltip.
    const futureKey = (wide ? "futureoff:" : "future:") + area.name;
    const futureShown = wide ? !p.isShown(futureKey, true) : p.isShown(futureKey, true);
    if (!all && open && area.ahead.length)
      // `true`, not `!wide`: the flag is read from the «opened» map either way, and writing it to the
      // other one in «All» mode meant the click landed where nobody was looking.
      this.chip(title, "ft-later-chip", "clock", null, futureShown, futureKey,
        `${t(futureShown ? "hideUpcoming" : "showUpcoming")} · ${area.ahead.length}` + (area.running ? ` · ${t("ofThemRunning", area.running)}` : ""), true);
    this.plus(title, t("addToArea"), async () => ({ area: area.name, project: null, noDate: all }),
      () => [...box.querySelectorAll(":scope > ul.ft-list")].pop() || title);
    this.more(title, (menu) => this.areaMenu(menu, area));
    this.grip(title, { type: "area", area });
    if (!open) return;
    if (area.rows.length) await this.list(box, area.rows, { area, all });
    else if (all) {
      // «Empty» is the first row's placeholder: a click turns it into a new task being typed
      const empty = box.createDiv({ cls: "ft-empty ft-empty-add", text: t("empty"), attr: { "aria-label": t("addTask") } });
      empty.onclick = () => {
        this.draft(empty, { area: area.name, project: null, noDate: true });
        empty.remove();
      };
    }
    if (!all && futureShown && area.ahead.length) await this.ahead(box.createDiv({ cls: "ft-future-block" }), area.ahead, area);
  }

  // The day's closed work, in the block at the bottom of the screen: the tasks checked off today in
  // one area (each row names its project) and the projects closed there today. A box brings its
  // task or project back. Not selectable, not draggable.
  async completed(box, done, projects = []) {
    const ul = box.createEl("ul", { cls: "contains-task-list ft-list" });
    for (const task of done) {
      const li = ul.createEl("li", { cls: "task-list-item ft-task ft-done" });  // no data-task: themes strike the whole row
      const check = li.createSpan({ cls: "ft-box" }).createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
      check.checked = true;
      this.check(li, check, task);
      await this.text(li, task);
      if (task.project) this.projectTag(li, task);
      li.oncontextmenu = (e) => {
        e.preventDefault();
        const menu = new Menu();
        menu.addItem((i) => i.setTitle(t("openInNote")).setIcon("file-text").onClick(() => this.open(task.file)));
        showMenu(menu, e);
      };
    }
    for (const note of projects) {
      const li = ul.createEl("li", { cls: "task-list-item ft-task ft-done ft-project-row" });
      const check = li.createSpan({ cls: "ft-box" }).createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
      check.checked = true;
      const back = (e) => { e.preventDefault(); e.stopPropagation(); this.plugin.setProjectDone(note.file, false); };
      check.onclick = back;
      check.parentElement.onclick = (e) => { if (e.target !== check) back(e); };
      const name = li.createSpan({ cls: "ft-project-name" });
      name.createSpan({ cls: "ft-project-icon", text: "📁" });
      this.link(name.createSpan({ cls: "ft-link", text: note.file.basename }), note.file);
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

  // The project a row belongs to, faint beside its text; a click opens the project's note.
  projectTag(li, task) {
    const tag = li.createSpan({ cls: "ft-project-tag" });
    tag.createSpan({ cls: "ft-icon", text: "📁" });
    tag.createSpan({ text: task.project });
    const note = this.plugin.notes().find((n) => n.project && n.file.basename === task.project);
    if (note) tag.onclick = (e) => { if (picking(e)) return; e.stopPropagation(); this.open(note.file, e); };
  }

  // A click on a row's text: a link inside it is left to itself, a task with a description opens as
  // a note, any other text goes into edit in place.
  textClick(task, text, e) {
    if (e.target.closest("a") || picking(e)) return;
    e.stopPropagation();
    // Only the words themselves are the link. The cell runs to the right edge of the row, and a
    // click in that empty stretch is a click to edit — the caret lands at the end, Enter opens the
    // next row.
    if (task.described && e.target.closest(".ft-text-link")) this.open(task.file, e);
    else this.editInline(task, text, e);
  }

  // The task's text as markdown (links work), without the paragraph around it.
  async text(li, task) {
    const text = li.createSpan({ cls: "ft-text" });
    if (task.text.length > 120) text.setAttr("aria-label", task.text);  // the row clamps long names
    // A task with a description reads as a link, the way any note does in Obsidian: a click on the
    // words opens it. The text is still edited in place — a click beside the words, or the menu.
    if (task.described) text.addClass("ft-text-note");
    await MarkdownRenderer.render(this.plugin.app, task.text, text, task.file.path, this.inner);
    const para = text.querySelector("p");
    if (para) para.replaceWith(...para.childNodes);
    // the link is the words, not the cell: the rendered text is wrapped so a click can tell them apart
    if (task.described) {
      const link = createSpan({ cls: "ft-text-link" });
      link.append(...text.childNodes);
      text.append(link);
    }
    const box = li.querySelector("input.task-list-item-checkbox");
    if (box) {  // the checkbox is named by the text next to it, so a screen reader reads the task
      const id = "ft-" + Math.random().toString(36).slice(2, 9);
      text.id = id;
      box.setAttr("aria-labelledby", id);
    }
    return text;
  }

  // The pile of what is not today, in two groups: what is already running, then what is only
  // planned. One list would put a promise made to somebody else among the «maybe next week» rows.
  async ahead(box, rows, area, extra = {}) {
    const running = (r) => { const s = r.kind === "task" ? r.task : r.steps[0]; return !!s && s.status === STATUS_PROGRESS; };
    const first = rows.filter(running), rest = rows.filter((r) => !running(r));
    if (first.length) await this.list(box, first, { area, pile: "ahead", ...extra });
    if (!rest.length) return;
    if (first.length) box.createDiv({ cls: "ft-ahead-split" });
    await this.list(box, rest, { area, pile: "ahead", ...extra });
  }


  // A counter on a header that folds a part of it: «⏳3» upcoming, «✓2» closed today.
  chip(head, cls, icon, count, open, key, label, closedByDefault = false, unfold = null) {
    const chip = head.createSpan({ cls: `ft-chip ${cls}`, attr: { "aria-label": label } });
    chip.toggleClass("is-off", !open);
    chip.toggleClass("is-quiet", count === null);   // no number: shown under the pointer only
    setIcon(chip.createSpan({ cls: "ft-chip-icon" }), icon);
    if (count !== null) chip.createSpan({ text: String(count) });
    chip.onclick = async (e) => {
      e.stopPropagation();
      // «Show me this» means show it: a folded project would swallow the rows the chip just opened.
      if (!open && unfold) await unfold();
      await this.plugin.toggleShown(key, closedByDefault);
      this.plugin.refresh();
    };
  }

  // Drag by the grip (mouse or finger — pointer events). Areas reorder among areas, projects within
  // their area, tasks move before/after another task (any note) or into a project / area when
  // dropped on its header. A click without moving selects the row (on a finger, or for an area, it
  // opens the menu).
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
    else {
      hit = el.closest(".ft-task[data-ft], .ft-area-title[data-ft]");
      // a project moves as a whole: over the open steps of another project it goes before or after
      // that project's row
      if (item.type === "project" && hit?.closest("li.ft-steps, li.ft-later-steps")) {
        let row = hit.closest("li.ft-steps, li.ft-later-steps");
        while (row && !row.hasClass("ft-project-row")) row = row.previousElementSibling;
        hit = row;
      }
    }
    const target = hit && this.items.get(hit);
    if (!target) return null;
    if (item.type === "area" && target.area.name === item.area.name) return null;
    if (item.type === "project") {
      if (target.type === "project" && target.project.file === item.project.file) return null;
      if (target.type === "task" && target.task.project) return null;   // a step of some project: no seat for a project there
    }
    if (item.type === "task" && (item.tasks || [item.task]).some((x) => target.task && x.uid === target.task.uid)) return null;
    const r = hit.getBoundingClientRect();
    const rel = (y - r.top) / r.height;
    // A header takes the row in. A project's row takes a task in through its middle and lets it
    // pass above and below — a flat list has rows to be dropped between, not only headers.
    const into = target.type === "area-title" || (item.type === "task" && target.type === "project" && rel > 0.25 && rel < 0.75);
    return { el: hit, target, into, after: !into && rel > 0.5 };
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
      if (drop.after && body?.hasClass("ft-steps")) r = { ...r.toJSON(), bottom: body.getBoundingClientRect().bottom };
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
        // A finger gets the menu (a phone has no right click); a mouse click selects the row — the
        // menu is a right click away. An area, or a project with no step, has nothing to select.
        const where = { clientX: ev?.clientX ?? 0, clientY: ev?.clientY ?? 0 };
        if (touch) this.menuTimer = setTimeout(() => this.openMenu(item, where, row), 80);
        else if (item.type !== "area" && item.task) this.pick(item.task, ev);
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
    // ▷ only on a row already sent off: it says so and hands the task back. Sending one off is in the
    // row's menu — an offer on every row, even one shown under the pointer, was one icon too many.
    if (task.status === STATUS_PROGRESS) {
      const run = li.createSpan({ cls: "ft-running" });
      const when = task.date ? this.dateText(task.date) + (task.at ? ` ${task.at}` : "") : null;
      run.setAttr("aria-label", when ? t("waitingSince", when) : t("waitingNoDate"));
      setIcon(run, "play");
      run.onclick = (e) => {
        e.stopPropagation();
        this.plugin.setRunning(this.selected.has(task) && this.selected.size > 1 ? this.chosen() : task, false);
      };
    }
    const level = String(task.priority || "").toLowerCase();
    // Only a high priority is marked: a dot on every row said «normal» a hundred times and nothing
    // else. The rest is set and seen from the menu.
    if (["high", "highest"].includes(level)) {
      const rank = "high";
      const dot = li.createSpan({ cls: `ft-priority is-${rank}` });
      dot.setAttr("aria-label", t(rank === "high" ? "priorityHigh" : rank === "low" ? "priorityLow" : "priorityNormal"));
      dot.onclick = (e) => {
        e.stopPropagation();
        const menu = new Menu();
        this.priorityItems(menu, this.selected.has(task) && this.selected.size > 1 ? this.chosen() : task);
        showMenu(menu, e);
      };
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
  // The same wording the row shows, for a tooltip that has no room for a widget.
  dateText(day) {
    const now = today(), yesterday = moment().subtract(1, "day").format("YYYY-MM-DD");
    return day === now ? t("today") : day === yesterday ? t("yesterday")
      : moment(day).format(this.plugin.settings.dateFormat || "DD.MM.YY");
  }

  dateLabel(el, task) {
    el.empty();
    el.className = "ft-date";
    if (!task.date) {
      el.addClass("is-empty");
      el.setAttr("aria-label", t("setDate"));
      setIcon(el, "calendar-plus");
      return;
    }
    // One way of writing a date everywhere. Today says nothing — a row in the focus is today's by
    // being there — unless it has an hour; a day gone by says how many days late, in red; a day ahead
    // is the full date, «25.09.26», year always: one width, one habit. The full date is in the tooltip.
    const now = today();
    const full = moment(task.date).format(this.plugin.settings.dateFormat || "DD.MM.YY");
    el.setAttr("aria-label", task.at ? `${full} ${task.at}` : full);
    // A task still waiting to come back has a moment, not a due date: in the green of today's work it
    // read as work for today, in a group that is explicitly not today.
    if (waitingBack(task)) el.addClass("is-ahead");
    else el.addClass(task.date === now ? "is-today" : task.date < now ? "is-past" : "is-future");
    if (task.date === now) {
      if (task.at) el.setText(task.at);
      else {
        // Nothing to read, but still the place to click for a new date: a faint calendar on hover.
        el.addClass("is-bare");
        setIcon(el, "calendar");
      }
      return;
    }
    if (task.date < now) {
      // Late is said in words as well as in red: colour alone is not something everyone can read, and
      // the number of days is the ZFG signal that a task is stuck.
      const late = moment(now).diff(moment(task.date), "days");
      el.setText(`${late}${t("daysShort")}`);
      el.setAttr("aria-label", `${full} · ${t("overdueBy", late)}`);
      return;
    }
    el.setText(task.at ? `${full} ${task.at}` : full);
  }

  // Redraw as soon as one of the waiting tasks is due, and not a moment later.
  wake() {
    if (this.editing || this.held) return;   // a card or a drag is open: it would be pulled away
    if ((this.pending || []).some(backDue)) this.render();
  }

  // The nearest moment something is due back, to the second. Nothing within the hour — the sweep
  // will do; the day it names is far enough away that half a minute makes no difference.
  setAlarm() {
    clearTimeout(this.alarm);
    const soon = this.pending
      .map((task) => moment(`${task.date}T${task.at || "00:00"}`).valueOf() - Date.now())
      .filter((ms) => ms > 0 && ms < 3600000)
      .sort((a, b) => a - b)[0];
    if (soon !== undefined) this.alarm = window.setTimeout(() => this.wake(), soon + 500);
  }

  // The row of a task as it stands on screen: what a picker opened from a menu hangs on.
  rowLabel(task) {
    const row = this.rows().find(([, x]) => x === task)?.[0];
    return row?.querySelector(".ft-date") || row || null;
  }

  // Sending a task off is one question — when do I look at it again? The day is not optional: the
  // status is written together with it, so a running task can never be one that silently has no way
  // back. Cancel the card and nothing was changed at all.
  askReturn(tasks, el = null) {
    const list = (Array.isArray(tasks) ? tasks : [tasks]).filter(Boolean);
    const anchor = el || this.rowLabel(list[0]);
    if (!list.length || !anchor || this.editing) return;
    const min = today();
    const one = list.length === 1 ? list[0] : null;
    const was = one && one.status === STATUS_PROGRESS && one.date >= min ? one.date : today();
    this.anchor = list[0];
    this.card(anchor, () => new DatePicker(anchor, was, async (chosen, at) => {
      this.editing = false;
      this.picker = null;
      this.clearSelection();
      if (chosen) await this.plugin.setRunning(list, true, chosen, at);
      this.render();
    }, () => {
      this.editing = false;
      this.picker = null;
      anchor.removeClass("is-active");
      this.render();
    }, {
      title: t("returnWhen"), hint: t("returnHint"), tooEarly: t("returnTooSoon"), min, clear: false,
      // the hour is the one running task's own; several rows start from a blank hour
      time: true, at: one && one.status === STATUS_PROGRESS ? one.at : null,
    }));
  }

  // The picker for the date of the row, or of every selected row when this is one of them.
  editDate(task, el) {
    if (this.editing) return;
    if (!this.selected.has(task)) this.clearSelection();
    const tasks = this.selected.size ? this.chosen() : [task];
    // A running task has no ordinary date: the day on it is the day it comes back, so the same click
    // asks that question again instead of offering «today / no date», which would strand it.
    if (tasks.every((x) => x.status === STATUS_PROGRESS)) return this.askReturn(tasks, el);
    const days = [...new Set(tasks.map((x) => x.date || null))];
    this.anchor = task;
    this.card(el, () => new DatePicker(el, days.length === 1 ? days[0] : null, async (day) => {
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
    }));
  }

  // A card opens over the row: while it is up the list is «editing» (no re-render, no other keys).
  // The flags are set only once the card is there — a card that failed to open left the list frozen
  // for good, every click deaf, the selection stuck.
  card(el, make) {
    let picker;
    try { picker = make(); } catch (e) { console.error("Focus Tasks: the card did not open", e); return; }
    this.picker = picker;
    this.editing = true;
    el.addClass("is-active");
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
    // Wiped and left — a click elsewhere, Enter, ⌘⌫ then away — the task is deleted, with the same
    // «Undo» a delete from the menu gets. Esc brings the text back untouched and selects the row.
    const saveText = async (value) => {
      if (!value) { await this.plugin.remove(task); return null; }
      if (value !== task.text) await this.plugin.rename(task, value);
      return task;
    };
    // The date changes at once and the label on the right follows; the text stays in edit. Unless
    // the new day takes the row out of this list (tomorrow from the focus, today from the pile):
    // then the text is saved, the row goes at once, and the editor moves on to the row that came
    // next — leaving the editor by hand just to see the row go was one step too many.
    const redate = async (day, close) => {
      const li = el.closest("li");
      const pile = this.pileOf(li);
      await this.plugin.setDate(task, day);
      const label = li?.querySelector(".ft-date");
      if (label) this.dateLabel(label, task);
      if (pile === "all" || this.inToday(task) === (pile === "focus")) return;
      const next = this.neighbour(li);
      await close(true, false);
      // the note is written, the cache is a beat behind: a render now would draw the old day (or,
      // mid-parse, no task at all) and the editor that opens next would hold that screen in place
      await this.cached(task, (x) => x.date === (day || null));
      await this.rerendered();
      const row = next && this.rows().find(([, x]) => x.uid === next.uid);
      if (row) this.editInline(row[1], row[0].querySelector(".ft-text"), null);
    };
    const day = (n) => moment().add(n, "days").format("YYYY-MM-DD");
    this.editor(el, Math.min(offset ?? task.text.length, task.text.length), saveText, {
      1: (close) => redate(day(0), close),
      2: (close) => redate(day(1), close),
      4: (close) => redate(null, close),
      // the picker takes the focus, so the text is saved first and the editor closes
      3: async (close) => {
        const label = el.closest("li")?.querySelector(".ft-date");
        await close(true, false);
        if (label) this.editDate(task, label);
      },
    }, (anchor) => this.rowAfter(el.closest("li"), anchor, inFocus(task) ? today() : null), () => this.markSoon(task));
  }

  // Which list a row is in: today's focus, the area's pile of what is not today, or an area of
  // «Other areas», where everything is one list and nothing leaves it.
  pileOf(li) {
    if (!li || li.closest(".ft-area.is-rest")) return "all";
    return li.closest(".ft-future-block, .ft-later-steps") ? "ahead" : "focus";
  }

  // Is the task today's work — the same answer collect() gives when it fills the focus.
  inToday(task) { return !waitingBack(task) && (inFocus(task) || task.status === STATUS_PROGRESS); }

  // The task of the row after this one (a project's row counts by the step it shows), or before it
  // when this is the last: where the editor goes when the row it was in leaves.
  neighbour(li) {
    const rows = this.rows();
    const i = rows.findIndex(([el]) => el === li);
    if (i < 0) return null;
    const mine = rows[i][1].uid;
    const after = rows.slice(i + 1).find(([, x]) => x.uid !== mine);
    if (after) return after[1];
    const before = rows.slice(0, i).reverse().find(([, x]) => x.uid !== mine);
    return before ? before[1] : null;
  }

  // Waits (a moment, not forever) until the metadata cache shows the task the way it was just
  // written: `ok(fresh)` on the re-read task.
  async cached(task, ok, ms = 1500) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      this.plugin.forgetScan();
      const fresh = this.plugin.tasks().find((x) => x.uid === task.uid);
      if (fresh && ok(fresh)) return;
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  // The same for several notes at once: until every one of them is read back, or the time is up.
  async cachedAll(uids, ms = 1500) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      this.plugin.forgetScan();
      const have = new Set(this.plugin.tasks().map((x) => x.uid));
      if (uids.every((u) => have.has(u))) return;
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  // Renders and waits for the screen to be current, however many renders were queued behind it.
  async rerendered() {
    await this.render();
    while (this.busy || this.again) await new Promise((r) => setTimeout(r, 30));
  }

  // An empty task row right under `prev`, written after `anchor`'s line (same indent) on Enter; then
  // the next one, until an empty Enter or Esc.
  // A task being typed has no note yet, so its date lives on the row until it is saved. The keys are
  // the ones a row that already exists answers to — a new task is where a date is set most often,
  // and until now those keys did nothing at all there.
  draftDate(li, start) {
    const state = { day: start };
    const label = li.createSpan();
    const paint = () => this.dateLabel(label, { date: state.day });
    const set = (day) => { state.day = day; paint(); };
    const ahead = (n) => moment().add(n, "days").format("YYYY-MM-DD");
    paint();
    state.keys = { 1: () => set(ahead(0)), 2: () => set(ahead(1)), 4: () => set(null) };
    return state;
  }

  rowAfter(prev, anchor, day) {
    const li = createEl("li", { cls: "task-list-item ft-task ft-draft-row" });
    const level = prev.style.getPropertyValue("--ft-level");
    if (level) li.style.setProperty("--ft-level", level);
    li.createSpan({ cls: "ft-box" }).createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { disabled: "" } });
    const text = li.createSpan({ cls: "ft-text", attr: { "data-placeholder": t("newTask") } });
    prev.after(li);
    const date = this.draftDate(li, day);
    this.editor(text, 0, async (value) => {
      if (!value) { li.remove(); return null; }
      return this.plugin.insertAfter(anchor, value, date.day);
    }, date.keys, (next) => this.rowAfter(li, next, date.day));
  }

  // An empty row under `anchor` for a new task in `target`; Enter saves it and opens the next one.
  draft(anchor, target) {
    if (this.editing) return;
    // After a row it is a row of the same list (one level in under a project row); after a block, a
    // list of its own.
    const inList = anchor.tagName === "LI";
    const holder = inList ? createEl("li", { cls: "task-list-item ft-task ft-draft-row" }) : createEl("ul", { cls: "contains-task-list ft-list ft-draft" });
    const li = inList ? holder : holder.createEl("li", { cls: "task-list-item ft-task" });
    if (inList) {
      const level = anchor.hasClass("ft-project-row") && !anchor.hasClass("ft-draft-row")
        ? String((Number(anchor.style.getPropertyValue("--ft-level")) || 0) + 1) : anchor.style.getPropertyValue("--ft-level");
      if (level) li.style.setProperty("--ft-level", level);
    }
    li.createSpan({ cls: "ft-box" }).createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { disabled: "" } });
    const text = li.createSpan({ cls: "ft-text", attr: { "data-placeholder": target.project ? t("newStep") : t("newTask") } });
    anchor.after(holder);
    const date = this.draftDate(li, "day" in target ? target.day : target.noDate ? null : today());
    this.editor(text, 0, async (value) => {
      if (!value) { holder.remove(); return null; }
      await this.plugin.addLine(target, value, date.day);
      return holder;
    }, date.keys, (prev) => this.draft(prev, { ...target, day: date.day }),   // the next one starts where this one ended
    () => this.render());   // Esc keeps what was typed (an empty row goes)
  }


  // The project's name becomes editable; Enter renames the note (links follow) and opens a row for
  // a new project right below.
  renameProject(head, area, project) {
    const name = head.querySelector(".ft-link");
    if (!name || this.editing) return;
    this.editor(name, project.file.basename.length, async (value) => {
      if (value && value !== project.file.basename) await this.plugin.renameProject(project.file, value);
      return head;
    }, {}, (prev) => this.projectDraft(prev, area, project.file.path));
  }

  // An empty project row after `prev`; Enter creates the project note in this area, seated right
  // after `afterPath`.
  projectDraft(prev, area, afterPath) {
    let spot = prev;
    if (spot.nextElementSibling?.hasClass("ft-steps")) spot = spot.nextElementSibling;
    const row = createEl("li", { cls: "task-list-item ft-task ft-project-row ft-draft-row" });
    row.createSpan({ cls: "ft-box" }).createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { disabled: "" } });
    const name = row.createSpan({ cls: "ft-project-name" });
    name.createSpan({ cls: "ft-project-icon", text: "📁" });
    const text = name.createSpan({ cls: "ft-link ft-text", attr: { "data-placeholder": t("newProject") } });
    spot.after(row);
    this.editor(text, 0, async (value) => {
      if (!value) { row.remove(); return null; }
      const file = await this.plugin.createProject(area, value, afterPath);
      return file && { row, path: file.path };
    }, {}, (made) => this.projectDraft(made.row, area, made.path));
  }


  // contenteditable with note-like keys: Enter or leaving saves, Esc cancels; one line, plain text.
  // `hotkeys`: Mod+<key> handlers; `onEnter(result of save)` continues with a next row;
  // `onEscape(result of save)`: Esc saves too (a wiped row keeps its text) and goes on from there.
  editor(el, offset, save, hotkeys = {}, onEnter = null, onEscape = null) {
    this.editing = true;
    const original = el.textContent;
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
    (this.scopes = this.scopes || new Set()).add(scope);
    const finish = async (keep, rerender = true) => {
      if (done) return;
      done = true;
      this.endEdit = null;
      this.scopes.delete(scope);
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
    // ⌘Z with nothing typed is not the browser's to answer: the editor closes and the list's last
    // change is taken back — the row ⌘2 just sent away, most often. Typed text keeps its own undo.
    scope.register(["Mod"], "z", (ev) => {
      if (done || el.textContent !== original) return true;
      ev.preventDefault();
      finish(true, false).then(() => this.undo());
      return false;
    });
    this.plugin.app.keymap.pushScope(scope);
    this.endEdit = finish;
    el.onkeydown = (ev) => {
      if (ev.key === "Enter" && !ev.isComposing && onEnter) {
        ev.preventDefault();
        finish(true, false).then((r) => (r ? onEnter(r) : this.render()));
      } else if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape") {
        ev.preventDefault();
        if (onEscape) finish(!!el.textContent.trim(), false).then((r) => onEscape(r));
        else finish(false);
      }
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
    // Closing a project is the user's call, never the last box's: an emptied project waits for its
    // next step or for this. Only offered when nothing in it is open.
    if (!(project.tasks || []).length && !(project.later || []).length)
      menu.addItem((i) => i.setTitle(t("projectDone")).setIcon("check-circle").onClick(() => p.setProjectDone(project.file, true)));
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
    // A running task has no ordinary date to set: the only day it has is the day it comes back.
    if (task.status === STATUS_PROGRESS) {
      menu.addItem((i) => i.setTitle(t("returnWhen") + "…").setIcon("calendar-clock").onClick(() => this.askReturn(task)));
    } else {
      menu.addItem((i) => i.setTitle(t("today")).setIcon("calendar-check").onClick(() => p.setDate(task, day(0))));
      menu.addItem((i) => i.setTitle(t("tomorrow")).setIcon("calendar-plus").onClick(() => p.setDate(task, day(1))));
      menu.addItem((i) => i.setTitle(t("noDate")).setIcon("calendar-x").onClick(() => p.setDate(task, null)));
    }
    menu.addSeparator();
    // A drag is not always possible — a finger loses to the scroll, a keyboard has no drag at all.
    menu.addItem((i) => i.setTitle(t("moveUp")).setIcon("arrow-up").onClick(() => this.shift(task, -1)));
    menu.addItem((i) => i.setTitle(t("moveDown")).setIcon("arrow-down").onClick(() => this.shift(task, 1)));
    menu.addSeparator();
    this.priorityItems(menu, task);
    menu.addSeparator();
    this.progressItem(menu, task);
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

  // One line either way: send it off — which asks for the day it comes back — or take it back now.
  progressItem(menu, tasks) {
    const list = Array.isArray(tasks) ? tasks : [tasks];
    const running = list.length && list.every((x) => x.status === STATUS_PROGRESS);
    menu.addItem((i) => i
      .setTitle(running ? t("backToWork") : t("inProgress"))
      .setIcon(running ? "undo-2" : "play")
      .onClick(() => (running ? this.plugin.setRunning(list, false) : this.askReturn(list))));
  }

  // The dot on a row is a mark, and a mark you cannot take off is a nuisance: every level, and
  // «no priority», are one click away — in the row's menu and on the dot itself.
  priorityItems(menu, tasks) {
    const list = Array.isArray(tasks) ? tasks : [tasks];
    const now = new Set(list.map((x) => String(x.priority || "").toLowerCase()));
    const item = (title, icon, value) => menu.addItem((i) => {
      i.setTitle(title).setIcon(icon).onClick(() => this.plugin.setPriority(list, value));
      if (now.size === 1 && now.has(String(value || "")) && i.setChecked) i.setChecked(true);
    });
    item(t("priorityHigh"), "flame", "high");
    item(t("priorityNormal"), "circle", "normal");
    item(t("priorityLow"), "circle-dot", "low");
    item(t("priorityNone"), "circle-slash", null);
  }

  // The menu of a selected row when there are several: one date for all of them.
  selectionMenu(task, e) {
    const day = (n) => moment().add(n, "days").format("YYYY-MM-DD");
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(t("selected", this.selected.size)).setIcon("list-checks").setDisabled(true));
    menu.addSeparator();
    const chosen = this.chosen();
    if (chosen.every((x) => x.status === STATUS_PROGRESS)) {
      menu.addItem((i) => i.setTitle(t("returnWhen") + "…").setIcon("calendar-clock").onClick(() => this.askReturn(chosen)));
    } else {
      menu.addItem((i) => i.setTitle(t("today")).setIcon("calendar-check").onClick(() => this.dateSelection(day(0))));
      menu.addItem((i) => i.setTitle(t("tomorrow")).setIcon("calendar-plus").onClick(() => this.dateSelection(day(1))));
      menu.addItem((i) => i.setTitle(t("pickDate")).setIcon("calendar-days").onClick(() => this.pickDates(task)));
      menu.addItem((i) => i.setTitle(t("noDate")).setIcon("calendar-x").onClick(() => this.dateSelection(null)));
    }
    menu.addSeparator();
    this.priorityItems(menu, this.chosen());
    menu.addSeparator();
    this.progressItem(menu, this.chosen());
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

  // A list of rows, tasks and projects alike, one line each. `opts.all`: «All» is on (nothing is
  // dimmed as «later»); `opts.pile`: "ahead" for the not-today pile; `opts.level`: how deep (a
  // project's steps are one level in).
  async list(parent, rows, opts = {}) {
    const ul = parent.createEl("ul", { cls: "contains-task-list ft-list" });
    for (const row of rows) {
      if (row.kind === "project") await this.projectRow(ul, row, opts);
      else await this.taskRow(ul, row.task, opts);
    }
    return ul;
  }

  async taskRow(ul, task, opts) {
    const li = ul.createEl("li", { cls: "task-list-item ft-task" });
    if (opts.level) li.style.setProperty("--ft-level", String(opts.level));
    if (!opts.all && !inFocus(task) && task.status !== STATUS_PROGRESS) li.addClass("is-later");
    // Sent off and not due back yet: on screen, in its place, but quiet enough to read past.
    if (waitingBack(task)) li.addClass("is-waiting");
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
    text.onclick = (e) => this.textClick(task, text, e);
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

  // A project as one row of the list: «📁 Name › its first step  +N  date». The box, the text, the
  // date, the ▷ and the priority are the step's — doing the project means doing that step; the name
  // is the project's (a click opens its note, a right click its menu); the grip drags the project.
  // +N opens the rest of this pile's steps under the row: then the row is the name alone and every
  // step is a row of its own, to tick, drag or edit. A project with no step left says so and takes
  // one on a click.
  async projectRow(ul, row, opts) {
    const p = this.plugin;
    const { project, steps } = row;
    const area = opts.area;
    const key = "steps:" + project.file.path;
    const open = steps.length > 1 && p.isShown(key, true);
    const step = open ? null : steps[0] || null;
    const li = ul.createEl("li", { cls: "task-list-item ft-task ft-project-row" });
    if (opts.level) li.style.setProperty("--ft-level", String(opts.level));
    li.toggleClass("is-open", open);
    li.toggleClass("is-empty", !steps.length);
    if (step && !opts.all && !inFocus(step) && step.status !== STATUS_PROGRESS) li.addClass("is-later");
    if (step && waitingBack(step)) li.addClass("is-waiting");
    const box = li.createSpan({ cls: "ft-box" }).createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
    if (step) this.check(li, box, step);
    else box.disabled = true;
    const name = li.createSpan({ cls: "ft-project-name" });
    name.createSpan({ cls: "ft-project-icon", text: "📁" });
    this.link(name.createSpan({ cls: "ft-link", text: project.file.basename }), project.file);
    const projectMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const menu = new Menu();
      this.projectMenu(menu, area, project, li);
      showMenu(menu, e);
    };
    name.oncontextmenu = projectMenu;
    const target = () => ({ area: area.name, project: project.file.basename, noDate: opts.pile === "ahead" || !!opts.all });
    // where a new step's row opens: under the last step on screen, or right under this row
    const anchor = () => {
      const body = li.nextElementSibling?.hasClass("ft-steps") ? li.nextElementSibling : null;
      return body?.querySelector(":scope > ul.ft-list > li:last-child") || li;
    };
    let text = null;
    if (step) {
      li.createSpan({ cls: "ft-sep", text: "›" });
      text = await this.text(li, step);
      this.marks(li, step);
    } else if (!open) {
      li.createSpan({ cls: "ft-sep", text: "›" });
      text = li.createSpan({ cls: "ft-text ft-no-step", text: t("noStep") });
      text.onclick = (e) => { e.stopPropagation(); this.draft(anchor(), target()); };
    }
    if (steps.length > 1) {
      const hidden = steps.slice(1);
      const more = li.createSpan({ cls: "ft-steps-more", text: open ? "−" : `+${hidden.length}` });
      more.toggleClass("is-open", open);
      // late steps behind the row must not hide behind it: the number turns red
      if (!open && hidden.some((x) => x.date && x.date < today() && !waitingBack(x))) more.addClass("is-late");
      more.setAttr("aria-label", open ? t("hideSteps") : t("moreSteps", hidden.length));
      more.onclick = async (e) => { e.stopPropagation(); await p.toggleShown(key, true); p.refresh(); };
    }
    // What the project holds beside today's steps hangs off its own row, as off an area's header:
    // the ⏳ opens its pile of what is not today, right under the row. Quiet — under the pointer,
    // lit while open, the count in its tooltip. Not in the area's ⏳ pile, where the row is that pile.
    const laterKey = "later:" + project.file.path;
    const laterShown = !opts.all && opts.pile !== "ahead" && project.later.length > 0 && p.isShown(laterKey, true);
    if (!opts.all && opts.pile !== "ahead" && project.later.length)
      this.chip(li, "ft-later-chip", "clock", null, laterShown, laterKey,
        `${t(laterShown ? "hideUpcoming" : "showUpcoming")} · ${project.later.length}` + (project.running ? ` · ${t("ofThemRunning", project.running)}` : ""), true);
    // «+» adds a step and opens the pile, so the new row is not swallowed by +N the moment it is saved
    this.plus(li, t("addStep"), async () => { if (steps.length > 1 && !open) await p.toggleShown(key, true); return target(); }, anchor);
    // open, the row has no step and no date — but it keeps the date's column, blank, so the «−»
    // stays exactly where the «+N» was and a second click folds the steps without a hunt
    if (!step) li.createSpan({ cls: "ft-date is-blank" });
    if (step) {
      const date = li.createSpan();
      this.dateLabel(date, step);
      date.onclick = (e) => {
        if (picking(e)) return;
        e.stopPropagation();
        this.editDate(step, date);
      };
      text.onclick = (e) => this.textClick(step, text, e);
      li.onclick = (e) => {
        if (e.target.closest("a, input, .ft-box, .ft-grip, .ft-date, .ft-project-name, .ft-steps-more, .ft-plus") || picking(e)) return;
        this.editInline(step, text, null);
      };
      li.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || !picking(e) || e.target.closest("a, input, .ft-grip")) return;
        e.preventDefault();
        this.select(step, e);
      });
      li.oncontextmenu = (e) => { e.preventDefault(); this.taskMenu(step, e); };
    } else li.oncontextmenu = projectMenu;
    this.track(li, { type: "project", area, project, task: step });
    this.grip(li, { type: "project", area, project, task: step });
    if (open) {
      const body = ul.createEl("li", { cls: "ft-steps" });
      await this.list(body, steps.map((task) => ({ kind: "task", task })), { ...opts, level: (opts.level || 0) + 1 });
    }
    // the project's pile of what is not today: its own list under the row (and under the open steps)
    if (laterShown) {
      const pile = ul.createEl("li", { cls: "ft-later-steps" });
      await this.ahead(pile, project.later.map((task) => ({ kind: "task", task })), area, { level: (opts.level || 0) + 1 });
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
    // Filled in as the folder answers; the div keeps the row at the top meanwhile.
    this.buildRow(containerEl.createDiv());
    const text = (name, desc, key, placeholder) => new Setting(containerEl).setName(t(name)).setDesc(t(desc))
      .addText((c) => c.setPlaceholder(placeholder || DEFAULTS[key]).setValue(s[key]).onChange(async (v) => {
        s[key] = v.trim() || DEFAULTS[key];
        await p.saveAll();
        p.refresh();
      }));
    text("sFolder", "sFolderDesc", "folder");
    text("sTasksFolder", "sTasksFolderDesc", "tasksFolder");
    this.companion(containerEl);
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

  // TaskNotes on the same notes: one row that says where it stands, one button that moves it on.
  // Installing it by hand is a trip through the plugin browser, and what people miss afterwards is
  // task identification — set to its default, TaskNotes sees none of these notes and looks broken.
  // «Сборка: Стабильная · 23.09 19:40 · заголовок» and, when a test build is on disk, the two
  // buttons that swap them. Nothing is shown at all when the plugin was installed the ordinary way.
  async buildRow(box) {
    const p = this.plugin;
    const build = await p.readBuild();
    const line = buildText(build);
    if (!line) {
      const row = new Setting(box).setName(t("sWip"));
      row.descEl.createSpan({ text: t("wip") + " " });
      row.descEl.createEl("a", { text: t("wipWho"), href: "https://t.me/zastashkov" });
      return;
    }
    const row = new Setting(box).setName(t("sBuild")).setDesc(line);
    const choices = await p.buildChoices();
    if (choices.same) row.setDesc(`${line}\n${t("buildSame")}`);
    else if (!choices.test.there) row.setDesc(`${line}\n${t("buildOnly")}`);
    else if (build.queue) row.setDesc(`${line}\n${t("buildQueue", build.queue, plural(build.queue, t("buildCommit")))}`);
    for (const mode of ["stable", "test"]) {
      row.addButton((b) => {
        b.setButtonText(t(mode === "test" ? "buildTest" : "buildStable"));
        const current = build.mode === mode;
        if (current) b.setCta();
        // greyed out, not gone: the pair says what the two modes are even when there is one build
        if (current || !choices[mode].offer) b.setDisabled(true);
        else b.onClick(() => p.switchBuild(mode));
      });
    }
  }

  companion(containerEl) {
    const p = this.plugin;
    const id = COMPANION.id;
    const manifest = this.app.plugins.manifests?.[id];
    const live = this.app.plugins.plugins[id];
    const folder = p.settings.tasksFolder || DEFAULTS.tasksFolder;
    const type = TASK_TYPE;
    const row = new Setting(containerEl).setName(t("sCompanion"));
    const again = () => this.display();
    if (!manifest) {
      row.setDesc(t("sCompanionOff"));
      row.addButton((b) => b.setCta().setButtonText(t("sInstall")).onClick(async () => {
        b.setDisabled(true);
        await p.installCompanion();
        again();
      }));
      return;
    }
    if (!live) {
      row.setDesc(t("sCompanionOff"));
      row.addButton((b) => b.setCta().setButtonText(t("sEnable")).onClick(async () => {
        await this.app.plugins.enablePlugin(id);
        again();
      }));
      return;
    }
    const aimed = p.companionAimed(live, type, folder);
    row.setDesc(aimed ? t("sCompanionOn", COMPANION.property, type, folder)
                      : t("sCompanionStale", COMPANION.property, type, folder));
    if (!aimed) row.addButton((b) => b.setCta().setButtonText(t("sTune")).onClick(async () => {
      await p.tuneCompanion();
      again();
    }));
    row.addButton((b) => b.setButtonText(t("sCompanionOpen")).onClick(() => {
      this.app.setting.open();
      this.app.setting.openTabById(id);
    }));
  }
}

// --- the plugin ------------------------------------------------------------------------------

// The tests reach the small pure helpers through this.
if (typeof globalThis !== "undefined") { globalThis.__ftParseDay = parseDay; globalThis.__ftBuildText = buildText; globalThis.__ftPlural = plural; }

// The three files that are the plugin, and where its spare builds wait. They live in the vault
// itself, not beside the plugin: Sync carries a plugin's own files to the other machine but not the
// extras left next to them, and a build you cannot see on your laptop is no build at all.
const BUILD_FILES = ["main.js", "manifest.json", "styles.css"];
const BUILD_NOTE = "build.json";
const BUILD_ROOT = "Internals/FocusTasks";
const FOLD_KEY = "focus-tasks-folds";   // per device: what is folded is not something to share

// Which build this file IS. `tools/deliver.mjs` rewrites this line in the copy it delivers, so the
// answer travels inside the code: it cannot be half-written, lost or left behind by a sync.
const BUILD = { mode: null, commit: null, subject: null, at: null, queue: 0 };

module.exports = class FocusTasks extends Plugin {
  async onload() {
    await this.readBuild();
    const saved = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULTS, saved.settings);
    // Folds come from this device; the first run here inherits whatever the vault still remembers.
    let here = null;
    try { here = JSON.parse(this.app.loadLocalStorage(FOLD_KEY) || "null"); } catch { /* written by hand, ignore */ }
    this.data = { folded: here?.folded || saved.folded || {}, opened: here?.opened || saved.opened || {},
      order: Object.assign({ areas: [], projects: {}, tasks: {} }, saved.order) };
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
    // ⌘Z belongs to the editor everywhere else, so the command only fires while the list's own pane
    // is in front and nothing is being typed in it.
    // No default hotkey here. With ⌘Z on the command, Obsidian handed the key to this plugin
    // everywhere — a note's own undo stopped working, with the list not even open. The key is bound
    // inside the list's own scope instead, which exists only while the list is the active tab.
    this.addCommand({ id: "undo", name: t("cmdUndo"),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType?.(FocusView) || (this.app.workspace.activeLeaf?.view instanceof FocusView ? this.app.workspace.activeLeaf.view : null);
        if (!view || [...this.views].some((v) => v.editing)) return false;
        if (!checking) view.undo();
        return true;
      } });
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
    await this.saveData({ settings: this.settings, order: this.data.order });
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
  doneShown() { return this.app.loadLocalStorage("focus-tasks-done") === "1"; }
  setDoneShown(on) { this.app.saveLocalStorage("focus-tasks-done", on ? "1" : null); this.refresh(); }
  setEverything(on) { this.app.saveLocalStorage("focus-tasks-all", on ? "1" : null); this.refresh(); }

  // The focus: areas and projects open unless folded. «Other areas»: closed unless opened.
  isShown(key, all) { return all ? !!this.data.opened[key] : !this.data.folded[key]; }

  // What is folded is this screen's business, not the vault's: it lives beside «All», per device.
  // In data.json it travelled with Sync, and two machines on one vault kept folding each other's
  // headers back open — a click that undid itself a second later.
  saveFolds() {
    this.app.saveLocalStorage(FOLD_KEY, JSON.stringify({ folded: this.data.folded, opened: this.data.opened }));
  }

  async toggleShown(key, all) {
    const map = all ? this.data.opened : this.data.folded;
    if (map[key]) delete map[key];
    else map[key] = true;
    this.saveFolds();
  }

  // open=false folds every header in `folds` ([key, all]); open=true opens them.
  async foldAll(folds, open) {
    for (const [key, all] of folds || []) {
      if (all) { if (open) this.data.opened[key] = true; else delete this.data.opened[key]; }
      else if (open) delete this.data.folded[key];
      else this.data.folded[key] = true;
    }
    this.saveFolds();
    this.refresh();
  }

  async forget(key) {
    delete this.data.opened[key];
    delete this.data.folded[key];
    this.saveFolds();
  }

  async setOpen(key, open) {
    if (open) this.data.opened[key] = true;
    else delete this.data.opened[key];
    this.saveFolds();
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
    const project = this.isProjectType(fm.type);
    const status = String(fm.status ?? "").trim().toLowerCase();
    // A closed project (`status: done`, by hand) is out of every list but the day's closed block.
    const done = project && (status === STATUS_DONE || status === STATUS_CANCELLED);
    return { file, area: String(fm.area), project, done, doneDate: done ? day(fm.completedDate) : null };
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
    const notes = [], tasks = [], closed = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const task = this.taskOf(file);
      if (task) { tasks.push(task); continue; }
      const note = this.classify(file);
      if (note) (note.done ? closed : notes).push(note);
    }
    this.scan = { notes, tasks, closed };
    return this.scan;
  }

  // What was closed today, by area: the tasks checked off and the projects marked done. For the
  // block at the bottom; nothing here keeps anything else on screen.
  closedToday() {
    const now = today();
    const groups = new Map();
    const of = (name) => { if (!groups.has(name)) groups.set(name, { name, tasks: [], projects: [] }); return groups.get(name); };
    for (const x of this.tasks()) if (x.status === STATUS_DONE && x.doneDate === now && x.area) of(x.area).tasks.push(x);
    for (const n of this.read().closed) if (n.doneDate === now) of(n.area).projects.push(n);
    const cmp = collator();
    const rank = (name) => { const i = this.data.order.areas.indexOf(name); return i < 0 ? 1e9 : i; };
    for (const g of groups.values()) g.tasks.sort((a, b) => cmp(a.project || "", b.project || "") || cmp(a.text, b.text));
    return [...groups.values()].sort((a, b) => rank(a.name) - rank(b.name) || cmp(bare(a.name), bare(b.name)));
  }

  // A project is closed by hand, from its menu; the box in the closed block opens it again.
  async setProjectDone(file, on) {
    return this.track(t("aProjectDone"), [file], async () => {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        if (on) { fm.status = STATUS_DONE; fm.completedDate = today(); }
        else { delete fm.status; delete fm.completedDate; }
      });
      this.forgetScan();
      new Notice(t(on ? "projectDoneNotice" : "projectBack", file.basename));
      this.refresh();
    });
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
    // Archived (the `archived` tag, as TaskNotes marks it): history, not a task — the focus never
    // reads it, whatever folder it lies in.
    if (isArchived(fm.tags)) return null;
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
      status: String(fm.status ?? STATUS_OPEN).trim().toLowerCase(), date: day(fm.scheduled), at: timeOf(fm.scheduled), due: day(fm.due),
      doneDate: day(fm.completedDate), priority: fm.priority || null,
      area: fm.area ? String(fm.area) : null, project, source: link(fm.source), described };
  }

  tasks() { return this.read().tasks; }

  // → [{name, note, rows, ahead, done, projects, focus, later, running}]. Every pile of an area is a
  // list of rows, and a row is a task or a project: a project shows as one row — its name and the
  // first of its steps in that pile — so five steps of one project take one line of the day, not five.
  // `rows`: the focus (open tasks due today or earlier, and projects with such a step); `ahead`: the
  // rest — undated, dated later, sent off, and the projects whose every step is such (or that have
  // none). `done`: checked off today, for the block at the bottom. `all` puts every open task of every
  // area into `rows`. Tasks are notes; areas and projects are their own notes.
  async collect(all) {
    const byArea = new Map();
    const areaOf = (name) => {
      if (!byArea.has(name)) byArea.set(name, { name, note: null, rows: [], ahead: [], done: [], projects: [], focus: 0, later: 0, running: 0 });
      return byArea.get(name);
    };
    const projects = new Map();  // path of a project note → its bucket in its area
    const now = today();
    for (const n of this.notes()) {
      const area = areaOf(n.area);
      if (!n.project) { if (!area.note) area.note = n.file; continue; }
      const bucket = { file: n.file, area, tasks: [], later: [], done: [], running: 0 };
      projects.set(n.file.path, bucket);
      area.projects.push(bucket);
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
        if (task.doneDate === now) { area.done.push(task); if (bucket) bucket.done.push(task); }
        continue;
      }
      // «Not today» is one answer, whoever is holding the task: a day still ahead, no day at all, or
      // somebody else's hands until the day it comes back. They share the pile; the ▷ on the row is
      // the whole difference.
      const waiting = waitingBack(task);
      if (waiting) { area.running++; if (bucket) bucket.running++; }
      const focused = !waiting && (inFocus(task) || task.status === STATUS_PROGRESS);
      area[focused ? "focus" : "later"]++;
      if (bucket) (focused || all ? bucket.tasks : bucket.later).push(task);
      else area[focused || all ? "rows" : "ahead"].push({ kind: "task", task });
    }
    const cmp = collator();
    // The steps of a project: a dragged order wins, the rest follows the nearest date and then the
    // name. What came due sits under the work already in hand today — it asks to be looked at, not
    // to be done; among what is not today the started ones come first: promises already made.
    const cmpTask = this.rowOrder();
    const isRunning = (x) => (x.status === STATUS_PROGRESS ? 1 : 0);
    const cmpRow = (x, y) => isRunning(x) - isRunning(y) || cmpTask(x, y);
    const cmpAhead = (x, y) => isRunning(y) - isRunning(x) || cmpTask(x, y);
    for (const area of byArea.values()) {
      for (const b of area.projects) {
        b.tasks.sort(cmpRow);
        b.later.sort(cmpAhead);
        b.done.sort((x, y) => cmp(x.text, y.text));
        if (all) { area.rows.push({ kind: "project", project: b, steps: b.tasks }); continue; }
        // A project whose last step was checked off today keeps its row in the focus — empty, with
        // nowhere to go but «the next step» or «done». So does one made today from an area that is
        // in the focus (marked on this device, for the day): it was made to be worked on, and its
        // first step is typed into that row. A project that was never in today's work stays where
        // its steps are: behind the area's ⏳, empty or not.
        b.finished = !b.tasks.length && !b.later.length && b.done.some(inFocus);
        b.fresh = !b.tasks.length && !b.later.length && this.data.opened["fresh:" + b.file.path] === now;
        const here = b.tasks.length || b.finished || b.fresh;
        if (here) area.rows.push({ kind: "project", project: b, steps: b.tasks });
        if (b.later.length || !here) area.ahead.push({ kind: "project", project: b, steps: b.later });
      }
      // One order per area, set by hand, projects and tasks alike; what has no seat yet goes after
      // what has — tasks first, by date and name, then projects by name — until a drag seats it.
      const seats = this.areaSeats(area.name);
      const seat = (row) => { const i = seats.indexOf(seatKey(row)); return i < 0 ? 1e9 : i; };
      const tie = (x, y) => (x.kind === "project") - (y.kind === "project")
        || (x.kind === "task" ? cmpTask(x.task, y.task) : cmp(x.project.file.basename, y.project.file.basename));
      const byArea = (x, y) => seat(x) - seat(y) || tie(x, y);
      const stepOf = (row) => (row.kind === "task" ? row.task : row.steps[0]);
      const running = (row) => (stepOf(row) && stepOf(row).status === STATUS_PROGRESS ? 1 : 0);
      area.rows.sort(byArea).sort((x, y) => running(x) - running(y));
      area.ahead.sort(byArea).sort((x, y) => running(y) - running(x));
      area.done.sort((x, y) => cmp(x.project || "", y.project || "") || cmp(x.text, y.text));
    }
    let areas = [...byArea.values()];
    // What puts an area in the focus is today's open work: something due, something overdue, a
    // project emptied today. Nothing closed keeps it there — an open area with no row in it read as
    // «broken», and the day's closed work has its own block at the bottom.
    if (!all) areas = areas.filter((a) => a.rows.length);
    const rank = (list, key) => { const i = (list || []).indexOf(key); return i < 0 ? 1e9 : i; };
    const order = this.data.order;
    return areas.sort((a, b) => rank(order.areas, a.name) - rank(order.areas, b.name) || cmp(bare(a.name), bare(b.name)));
  }

  // The saved order of an area's rows: task ids and «p:<path>» for its projects, one list. Before
  // the projects had a list of their own; the first read of an area folds it in after the tasks, in
  // the order it had — nothing moves on the day the two lists become one.
  areaSeats(name) {
    const list = this.data.order.tasks["area:" + name] || [];
    if (list.some((k) => k.startsWith("p:"))) return list;
    return [...list, ...(this.data.order.projects?.[name] || []).map((p) => "p:" + p)];
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
      return await this.track(t("aDone"), [task.file], () => this.toggleNow(task));
    } finally {
      this.toggling.delete(guard);
    }
  }

  async toggleNow(task) {
    {
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
    }
  }

  // The date the focus goes by; null takes the task back to the someday list.
  // Taking the day off a running task would strand it behind the ▷ counter with nothing to bring it
  // back, so it comes home instead: no day to return on means the task is mine again as of now.
  async setDate(task, day) {
    return this.track(t("aDate"), [task.file], async () => {
      const home = !day && task.status === STATUS_PROGRESS;
      const ok = await this.setFields(task, { scheduled: day || null, ...(home ? { status: STATUS_OPEN } : {}) });
      if (ok) {
        task.date = day || null;
        if (home) task.status = STATUS_OPEN;
      }
      return ok;
    });
  }

  async setDates(tasks, day) {
    return this.track(t("aDate"), tasks.map((x) => x.file), async () => {
      for (const task of tasks) await this.setDate(task, day);
    });
  }

  // New text: the note keeps its uid and is renamed to match (the whole text stays in `title` when it
  // is too long for a file name).
  async rename(task, text) {
    return this.track(t("aRename"), [task.file], () => this.renameNow(task, text));
  }

  async renameNow(task, text) {
    const name = fileName(text).slice(0, 60).trim();
    let file = name && name !== task.file.basename ? await this.freeName(name) : task.file.basename;
    // the file name may be cut or taken: then the whole text lives in `title`
    const ok = await this.setFields(task, { title: !name || file !== text ? text : null });
    if (!ok) return;  // the note is not the one this row was read from: leave its name alone too
    if (file !== task.file.basename) {
      await this.app.fileManager.renameFile(task.file, normalizePath(`${this.tasksFolder}/${file}.md`));
      this.forgetScan();
      // A step named like its project had a link Obsidian resolved to the step itself, and has just
      // rewritten to the step's new path: it is written back to the project, by path if need be.
      const project = task.project ? this.projectFile(task) : null;
      if (project) {
        const link = this.projectLink(project, task.file.path);
        if (link !== `[[${task.project}]]`) await this.setFields(task, { projects: [link] });
      }
    }
    task.text = text;
  }

  // `drop` comes from FocusRenderer.target; `shown` is the order on screen.
  async drop(item, drop, shown) {
    const files = item.type === "task" ? (item.tasks || [item.task]).map((x) => x.file) : [];
    return this.track(t("aMove"), files, () => this.dropNow(item, drop, shown));
  }

  async dropNow(item, drop, shown) {
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
      // A project is a row of its area's list: it takes a seat before or after the row it was dropped
      // on, or the last one when dropped on an area's title. Another area's list means moving house.
      const tg = drop.target, me = "p:" + item.project.file.path;
      const to = tg.area.name;
      const seatIn = async () => {
        const mine = this.notes().filter((n) => n.project && n.area === to).map((n) => "p:" + n.file.path);
        const alive = new Set([...this.tasks().map((x) => x.uid), ...mine]);
        const all = merge(this.areaSeats(to), (shown.tasks || {})["area:" + to] || [], mine).filter((k) => alive.has(k));
        const targetKey = tg.type === "task" ? tg.task.uid : tg.type === "project" ? "p:" + tg.project.file.path : null;
        this.data.order.tasks["area:" + to] = targetKey ? place(all, me, targetKey, drop.after) : [...all.filter((k) => k !== me), me];
        delete this.data.order.projects[to];   // folded into the area's list; the old list is not read again
        await this.saveAll();
        this.refresh();
      };
      if (to === item.area.name) return seatIn();
      return this.track(t("aMove"), [item.project.file, item.area.note, tg.area.note].filter(Boolean), async () => {
        if (await this.moveProject(item.project, item.area, tg.area)) await seatIn();
      });
    } else return this.moveTasks(item.tasks || [item.task], drop, shown.tasks || {});
    await this.saveAll();
    this.refresh();
  }

  // A project goes to live in another area: its note says so, the area notes list it accordingly,
  // its steps follow, and its seat in the old area's order goes.
  async moveProject(project, from, to) {
    const note = to.note || await this.createArea(to.name);
    if (!note) return false;
    const file = project.file;
    const old = from.note ? this.app.metadataCache.fileToLinktext(from.note, file.path) : null;
    const link = this.app.metadataCache.fileToLinktext(note, file.path);
    const isOld = (v) => !!old && typeof v === "string" && v.replace(/^\[\[|\]\]$/g, "").split("|")[0] === old;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.area = to.name;
      if (Array.isArray(fm.parents)) { const i = fm.parents.findIndex(isOld); if (i >= 0) fm.parents[i] = `[[${link}]]`; }
      else if (isOld(fm.parents)) fm.parents = `[[${link}]]`;
    });
    await this.dropLinks(file, from.name);
    await this.app.vault.process(note, (body) => insertBlock(body, [`- 📁 [[${this.app.metadataCache.fileToLinktext(file, note.path)}]]`], this.settings.projectsHeading));
    for (const task of this.tasks().filter((x) => this.samePlace(x, file))) await this.setFields(task, { area: to.name });
    this.data.order.tasks["area:" + from.name] = this.areaSeats(from.name).filter((k) => k !== "p:" + file.path);
    this.forgetScan();
    return true;
  }

  // Where the dragged tasks now sit in their list: the order on screen is kept, so the rows that were
  // not dragged stay where they were.
  async reorder(tasks, drop, shown) {
    const key = listOf(tasks[0]);
    const moved = tasks.map((x) => x.uid);
    const tg = drop.into ? null : drop.target;
    // the row it was dropped by: a task, or a project's row in an area's list
    const targetKey = !tg ? null : tg.type === "task" ? tg.task.uid : tg.type === "project" ? "p:" + tg.project.file.path : null;
    const targetList = !tg ? null : tg.type === "task" ? listOf(tg.task) : "area:" + tg.area.name;
    // Tasks that no longer exist are dropped from the saved order here: the file is merged key by key
    // between devices, so a list that only ever grows would carry dead ids forever.
    const alive = new Set([...this.tasks().map((x) => x.uid), ...this.notes().filter((n) => n.project).map((n) => "p:" + n.file.path)]);
    const saved = key.startsWith("area:") ? this.areaSeats(key.slice(5)) : this.data.order.tasks[key] || [];
    const list = [...new Set([...saved, ...(shown[key] || []), ...moved])]
      .filter((k) => !moved.includes(k) && alive.has(k));
    const at = targetKey && targetList === key ? list.indexOf(targetKey) : -1;
    list.splice(at < 0 ? list.length : at + (drop.after ? 1 : 0), 0, ...moved);
    this.data.order.tasks[key] = list;
    await this.saveAll();
  }

  // Into a header means «into that area or project», onto a task means «where that task lives».
  async moveTasks(tasks, drop, shown = {}) {
    return this.track(t("aMove"), tasks.map((x) => x.file), () => this.moveNow(tasks, drop, shown));
  }

  async moveNow(tasks, drop, shown = {}) {
    const tg = drop.target;
    const area = tg.type === "task" ? tg.task.area : tg.area.name;
    // into a project's row: its step; by a project's row: a task of the area, like the row itself
    const file = drop.into ? (tg.type === "project" ? tg.project.file : null) : (tg.type === "task" && tg.task.project ? this.projectFile(tg.task) : null);
    const project = file ? file.basename : null;
    for (const task of tasks) {
      // the link is written the way Obsidian writes links, so two notes of the same name stay apart
      const link = file ? this.app.metadataCache.fileToLinktext(file, task.file.path) : null;
      const ok = await this.setFields(task, { area, projects: link ? [`[[${link}]]`] : null });
      if (ok) Object.assign(task, { area, project });
    }
    // Dropped into a project, but dated later than today? Its row hides behind the area's ⏳ — open
    // it, or the work you just moved vanishes from the screen.
    if (file && tasks.some((x) => !inFocus(x))) {
      const key = "future:" + area;
      if (!this.isShown(key, true)) await this.toggleShown(key, true);
    }
    await this.reorder(tasks, drop, shown);
    this.refresh();
  }

  // Checkbox lines left in the area and project notes of version 0.1.0. Only asked for when the
  // list has no task notes at all, so this reads a handful of notes on a rare day.
  async checkboxLeftovers() {
    let n = 0;
    for (const note of this.notes()) {
      const text = await this.app.vault.cachedRead(note.file);
      n += (text.match(/^\s*[-*]\s*\[[ xX-]\]\s+\S/gm) || []).length;
      if (n > 200) break;
    }
    return n;
  }

  // One level for one task or for a whole selection. `null` takes the mark off — the dot on a row
  // usually means «an agent put this here», and after a look it should be possible to drop it.
  async setPriority(tasks, value) {
    const list = (Array.isArray(tasks) ? tasks : [tasks]).filter(Boolean);
    if (!list.length) return;
    await this.track(t("aPriority"), list.map((x) => x.file), async () => {
      for (const task of list) {
        const ok = await this.setFields(task, { priority: value });
        if (ok) task.priority = value;
      }
      this.refresh();
    });
  }

  // Off my plate, or back on it. Sending a task off names the day it comes back, and that day is
  // written together with the status — the two can never disagree, and nothing is left running with
  // no way home. Taking it back moves a return day still ahead to today: the task is in my hands as
  // of now, and any other date would only keep it out of the focus I just pulled it into.
  async setRunning(tasks, running, day = null, at = null) {
    const list = (Array.isArray(tasks) ? tasks : [tasks]).filter(Boolean);
    if (!list.length) return;
    await this.track(t("aRunning"), list.map((x) => x.file), async () => {
      for (const task of list) {
        const status = running ? STATUS_PROGRESS : STATUS_OPEN;
        const fields = { status };
        if (running && day) fields.scheduled = at ? `${day}T${at}` : day;
        // Coming back, the task loses the hour with the status: an hour of the day is the review
        // moment, and an ordinary task in this list is planned by the day, not by the clock.
        if (!running) fields.scheduled = !task.date || task.date > today() ? today() : task.date;
        const ok = await this.setFields(task, fields);
        if (ok) {
          task.status = status;
          if ("scheduled" in fields) {
            task.date = fields.scheduled ? String(fields.scheduled).slice(0, 10) : null;
            task.at = timeOf(fields.scheduled);
          }
        }
      }
      this.refresh();
    });
  }

  // --- which build is running -------------------------------------------------------------------

  // Two builds can live side by side in the plugin's own folder: `builds/stable` — the one that was
  // merged, `builds/test` — the one handed over for a look. The files next to them are the copy that
  // actually runs, and `build.json` is the only thing that says which. Installed the ordinary way
  // (BRAT, the store), none of this exists and the plugin never mentions it.
  buildPath(...parts) { return [BUILD_ROOT, ...parts].join("/"); }

  // Nothing to read and nothing to race with: the running build says what it is. A note beside the
  // plugin could not: Sync carries a plugin's own three files to the other machine and leaves the
  // extras behind, so on the laptop the plugin read «no build here» and called itself a stranger.
  async readBuild() {
    this.build = BUILD.mode ? { ...BUILD } : null;
    return this.build;
  }

  // Which of the two are on disk. A mode with a missing file is not offered — half a build is worse
  // than none, and the button would leave the plugin unable to load.
  async buildModes() {
    const modes = [];
    for (const mode of ["stable", "test"]) {
      try {
        const there = await Promise.all(BUILD_FILES.map((f) => this.app.vault.adapter.exists(this.buildPath(mode, f))));
        if (there.every(Boolean)) modes.push(mode);
      } catch { /* no adapter to ask (the test harness) */ }
    }
    return modes;
  }

  // What each button knows about itself. Both are always shown — a row that loses half of itself is
  // harder to read than one with a button greyed out — but a mode is only offered when it is there
  // and is actually somewhere else: a test build equal to the stable one is nothing to switch to.
  async buildChoices() {
    const modes = await this.buildModes();
    const note = async (mode) => {
      try { return JSON.parse(await this.app.vault.adapter.read(this.buildPath(mode, BUILD_NOTE))); } catch { return null; }
    };
    const [stable, test] = [await note("stable"), await note("test")];
    const same = !!stable?.commit && stable.commit === test?.commit;
    return {
      stable: { there: modes.includes("stable"), offer: modes.includes("stable") && !same },
      test: { there: modes.includes("test"), offer: modes.includes("test") && !same },
      same,
    };
  }

  // Copies a build over the running one and restarts the plugin. Obsidian reads main.js and
  // styles.css only when a plugin is enabled, so nothing short of that swap takes effect.
  async switchBuild(mode) {
    const adapter = this.app.vault.adapter;
    for (const file of BUILD_FILES) {
      const from = this.buildPath(mode, file);
      if (!(await adapter.exists(from))) { new Notice(t("changed")); return false; }
      await adapter.write([this.manifest.dir, file].join("/"), await adapter.read(from));
    }
    new Notice(t("buildSwitched", t(mode === "test" ? "buildTest" : "buildStable")));
    // the code being replaced is the code running this line: let the click finish first
    const app = this.app, id = this.manifest.id;
    setTimeout(async () => {
      await app.plugins.disablePlugin(id);
      await app.plugins.enablePlugin(id);
    }, 80);
    return true;
  }

  // --- the companion plugin ------------------------------------------------------------------

  // Obsidian's own installer, the one the plugin browser uses. It is not part of the public API, so
  // everything here is guarded: when it is gone, the user is sent to the browser instead.
  async installCompanion() {
    const plugins = this.app.plugins;
    if (typeof plugins.installPlugin !== "function") {
      this.app.setting.open();
      this.app.setting.openTabById("community-plugins");
      new Notice(t("installFailed", "API"));
      return false;
    }
    new Notice(t("installing"));
    try {
      const manifest = JSON.parse((await requestUrl(`https://raw.githubusercontent.com/${COMPANION.repo}/main/manifest.json`)).text);
      await plugins.installPlugin(COMPANION.repo, manifest.version, manifest);
      await plugins.enablePlugin(COMPANION.id);
    } catch (e) {
      console.error("focus-tasks: TaskNotes did not install", e);
      new Notice(t("installFailed", e?.message || e));
      return false;
    }
    new Notice(t("installed"));
    await this.tuneCompanion(true);
    return true;
  }

  // Does TaskNotes look for tasks where ours are?
  companionAimed(live, type = TASK_TYPE, folder = this.tasksFolder) {
    const s = live?.settings;
    return !!s && s.taskIdentificationMethod === "property" && s.taskPropertyName === COMPANION.property
      && s.taskPropertyValue === type && s.tasksFolder === folder;
  }

  // Point it at our notes: identify a task by `type: задача`, keep them in our folder. Only keys it
  // already has are touched — if it ever renames them, we say so instead of writing nonsense.
  async tuneCompanion(quiet = false) {
    const live = this.app.plugins.plugins[COMPANION.id];
    const folder = this.tasksFolder;
    const want = { taskIdentificationMethod: "property", taskPropertyName: COMPANION.property,
      taskPropertyValue: TASK_TYPE, tasksFolder: folder };
    const known = live?.settings && Object.keys(want).every((k) => k in live.settings);
    if (!known || typeof live.saveSettings !== "function") {
      new Notice(t("tuneFailed", COMPANION.property, TASK_TYPE, folder));
      return false;
    }
    Object.assign(live.settings, want);
    await live.saveSettings();
    if (!quiet) new Notice(t("tuned", COMPANION.property, TASK_TYPE, folder));
    return true;
  }

  // --- undo ---------------------------------------------------------------------------------

  // What deleting touches is written down first: the notes that go to the trash and the ones that
  // are edited on the way (the tasks of a deleted project, the area's own note). Undo writes every
  // one of them back as it was, so nothing is half-restored.
  async snapshot(files) {
    const out = [];
    for (const file of files) {
      if (!file) continue;
      const path = typeof file === "string" ? file : file.path;
      if (out.some((x) => x.path === path)) continue;
      const live = this.app.vault.getAbstractFileByPath(path);
      if (live && live.children) continue;  // a folder, not a note
      // a note that does not exist yet is written down too: undoing what made it means removing it
      out.push({ path, text: live ? await this.app.vault.read(live) : null });
    }
    return out;
  }

  // Every change the list makes goes through here: the notes it is about to touch are written down,
  // the change runs, and what it left behind is written down too. That pair is what ⌘Z needs — it
  // can put the notes back and tell «still as I left it» from «someone has written here since».
  // Nested calls (a move writes several tasks) belong to the outer one.
  async track(label, files, run) {
    if (this.inTrack) return run();
    this.inTrack = true;
    const made = [];
    // A note the change makes — created outright, or left at a new path by a rename — is written
    // down as «did not exist»: undoing the change removes it again.
    const isNote = (file) => !!file && !file.children && file.path?.endsWith(".md");  // folders are not notes
    const refs = [
      this.app.vault.on("create", (file) => { if (isNote(file)) made.push(file.path); }),
      this.app.vault.on("rename", (file) => { if (isNote(file)) made.push(file.path); }),
    ];
    let snap = [];
    try {
      snap = await this.snapshot(files);
      const result = await run();
      for (const path of made) if (!snap.some((x) => x.path === path)) snap.push({ path, text: null });
      for (const item of snap) {
        const live = this.app.vault.getAbstractFileByPath(item.path);
        item.after = live ? await this.app.vault.read(live) : null;
      }
      const changed = snap.filter((x) => x.text !== x.after);
      if (changed.length) this.remember(label, changed);
      return result;
    } finally {
      for (const ref of refs) (this.app.vault.offref ? this.app.vault.offref(ref) : this.app.vault.off(ref.name, ref.fn));
      this.inTrack = false;
    }
  }

  // The last thirty changes, newest last. The order and the fold state travel with them: undoing a
  // drag has to put the order back as well as the notes.
  remember(label, snap, order = this.orderState()) {
    this.history = this.history || [];
    this.history.push({ label, snap, order });
    if (this.history.length > 30) this.history.shift();
  }

  orderState() { return JSON.stringify({ order: this.data.order, folded: this.data.folded, opened: this.data.opened }); }

  // ⌘Z: the last change made from the list, put back.
  async undo() {
    const last = (this.history || []).pop();
    if (!last) { new Notice(t("nothingToUndo")); return 0; }
    const back = await this.restore(last.snap);
    if (last.order && last.order !== this.orderState()) {
      const was = JSON.parse(last.order);
      Object.assign(this.data, { order: was.order, folded: was.folded, opened: was.opened });
      await this.saveAll();
    }
    if (back) new Notice(t("undone", last.label));
    this.refresh();
    return back;
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
    this.remember(message, snap);
    // Every notice holds its own snapshot: two deletes in a row must not undo each other's work.
    const put = async () => {
      this.history = (this.history || []).filter((x) => x.snap !== snap);
      return this.restore(snap);
    };
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
      if (!file) {
        if (text !== null) { await this.app.vault.create(path, text); back++; }
        continue;
      }
      if (text === null) {  // it was made by the change being undone
        if (after === null || (await this.app.vault.read(file)) === after) { await this.trash(file); back++; }
        continue;
      }
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

  // Several at once: one notice and one undo for all of them.
  async removeTasks(tasks) {
    if (tasks.length === 1) return this.removeTask(tasks[0]);
    if (!tasks.length) return null;
    return this.undoable(t("deletedMany", tasks.length), tasks.map((x) => x.file), async () => {
      for (const task of tasks) await this.trash(task.file);
    });
  }

  // A free file name in the tasks folder.
  async freeName(base) {
    let name = base, i = 2;
    while (this.app.vault.getAbstractFileByPath(normalizePath(`${this.tasksFolder}/${name}.md`))) name = `${base} (${i++})`;
    return name;
  }

  // A new task note. `target`: {area, project (basename or null)}; `day` — the focus date.
  async createTask(text, target, day) {
    return this.track(t("aNew"), [], () => this.createNow(text, target, day));
  }

  async createNow(text, target, day) {
    await this.ensureFolder(this.tasksFolder);
    const name = await this.freeName(fileName(text).slice(0, 60) || t("newTask"));
    const front = ["---", `uid: ${newUid()}`, `type: ${TASK_TYPE}`, `status: ${STATUS_OPEN}`];
    if (target.area) front.push(`area: ${JSON.stringify(target.area)}`);
    if (target.project) {
      const path = normalizePath(`${this.tasksFolder}/${name}.md`);
      const note = this.notes().find((n) => n.project && n.file.basename === target.project && (!target.area || n.area === target.area))
        || this.notes().find((n) => n.project && n.file.basename === target.project);
      front.push("projects:", `  - ${JSON.stringify(note ? this.projectLink(note.file, path) : `[[${target.project}]]`)}`);
    }
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
    const area = this.tasks().find((x) => x.uid === task.uid)?.area || task.area;
    const note = this.notes().find((n) => !n.project && n.area === area)?.file;
    return this.track(t("aProject"), [task.file, note].filter(Boolean), () => this.toProjectNow(task));
  }

  async toProjectNow(task) {
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
    const file = await this.createProject(holder, name, undefined, null, false);
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
      await this.setFields(task, { projects: [this.projectLink(file, task.file.path)] });
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
  // The comparator the list is drawn by: a dragged order first, then the nearest date, then the name.
  rowOrder() {
    const seat = (task) => { const list = this.data.order.tasks[listOf(task)] || []; const i = list.indexOf(task.uid); return i < 0 ? 1e9 : i; };
    const cmp = collator();
    return (x, y) => seat(x) - seat(y) || (x.date || "9999").localeCompare(y.date || "9999") || cmp(x.text, y.text);
  }

  async insertAfter(anchor, text, day) {
    const task = await this.createTask(text, { area: anchor.area, project: anchor.project }, day);
    // Enter under a row means «here», not «somewhere below»: without a seat of its own the new task
    // is sorted by date and name and usually lands at the bottom of the list.
    if (task) await this.seatAfter(task, anchor);
    return task;
  }

  // Writes the whole list's order down as it is on screen, with the new task right after its anchor.
  async seatAfter(task, anchor) {
    const key = listOf(task);
    if (key !== listOf(anchor)) return;
    // Everything in the list, ticked ones included: a task that loses its seat when it is checked
    // off would jump somewhere else the moment the box is unchecked. An area's list also seats its
    // projects («p:…»): those keep their places.
    const mine = this.tasks()
      .filter((x) => listOf(x) === key)
      .sort(this.rowOrder())
      .map((x) => x.uid)
      .filter((uid) => uid && uid !== task.uid);
    const saved = key.startsWith("area:") ? this.areaSeats(key.slice(5)) : this.data.order.tasks[key] || [];
    const order = saved.filter((k) => k !== task.uid && (k.startsWith("p:") || mine.includes(k)));
    for (const uid of mine) if (!order.includes(uid)) order.push(uid);
    const i = order.indexOf(anchor.uid);
    order.splice(i < 0 ? order.length : i + 1, 0, task.uid);
    this.data.order.tasks[key] = order;
    await this.saveAll();
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
  // `fresh`: made from the focus, so its empty row goes to the focus for the day; unset, that is
  // decided by whether the area is in the focus right now. A project made out of a task is not:
  // it keeps the task's place.
  async createProject(area, name, afterPath, linkTo = null, fresh = null) {
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
    if (fresh ?? (await this.collect(false)).some((a) => a.name === area.name)) {
      this.data.opened["fresh:" + file.path] = today();   // per device, and only for today
      this.saveFolds();
    }
    // seated at once — right after `afterPath`, or last — so it does not sort itself in by name
    const list = this.areaSeats(area.name).filter((k) => k !== "p:" + file.path);
    const i = afterPath ? list.indexOf("p:" + afterPath) : -1;
    list.splice(i < 0 ? list.length : i + 1, 0, "p:" + file.path);
    this.data.order.tasks["area:" + area.name] = list;
    await this.saveAll();
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
    for (const [key, list] of Object.entries(this.data.order.tasks)) {
      if (!key.startsWith("area:")) continue;
      const i = list.indexOf("p:" + old);
      if (i >= 0) { list[i] = "p:" + path; touched = true; }
    }
    for (const map of [this.data.opened, this.data.folded]) {
      for (const prefix of ["project:", "later:", "done:", "steps:", "fresh:"]) {
        if (map[prefix + old]) { map[prefix + path] = map[prefix + old]; delete map[prefix + old]; touched = true; }
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
    // Its steps, found before the name changes. Obsidian rewrites the links it had resolved to this
    // note; a step named like its project had resolved its own link to itself and would be left
    // pointing at a name that no longer exists — so every step is re-pointed here, by hand.
    const mine = this.tasks().filter((x) => this.samePlace(x, file));
    await this.app.fileManager.renameFile(file, path);
    await this.renamed(path, old);
    const fresh = this.app.vault.getAbstractFileByPath(path) || file;
    for (const task of mine) await this.setFields(task, { projects: [this.projectLink(fresh, task.file.path)] });
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
      await this.forget("steps:" + project.file.path);
      this.data.order.tasks["area:" + area.name] = this.areaSeats(area.name).filter((k) => k !== "p:" + project.file.path);
      await this.saveAll();
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
        await this.forget("steps:" + f.path);
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
    const bare = task.project.replace(/\.md$/, "").split("/").pop();
    const named = list.filter((n) => n.file.basename === task.project || n.file.path.replace(/\.md$/, "") === task.project.replace(/\.md$/, ""))
      // a path that is not a project's — Obsidian rewrote a link that pointed at the step itself — still names one
      .concat(list.filter((n) => n.file.basename === bare));
    if (!named.length) return null;
    return (task.area && named.find((n) => n.area === task.area) || named[0]).file;
  }

  // The link a task keeps to its project, written the way Obsidian writes links: by name, or by path
  // when another note (often the project's own first step) carries that name.
  projectLink(file, fromPath) {
    return `[[${this.app.metadataCache.fileToLinktext(file, fromPath)}]]`;
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
