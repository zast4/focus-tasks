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
 * leaves the row selected; ⌘1 today, ⌘2 tomorrow, ⌘3 date picker, ⌘4 no date, ⌘5 «Waiting…», ⌘⌫ deletes
 * the task and moves up a row, ⌘Enter opens
 * the task's note; ⌘Z with nothing typed
 * takes back the list's last change). The date on the right opens a date picker.
 * The checkbox completes a task (`status: done` + `completedDate`): the row leaves the list at once;
 * «✓ Done · N» at the bottom opens the day's closed work, by area, where a box brings a task back.
 * Nothing closed keeps an area on screen. A project is closed by hand, from its menu, once nothing in
 * it is open; till then an emptied project keeps its row, «no step yet», and takes the next one.
 * A task in somebody else's hands («Waiting…» in its menu, with the day and hour to look again) is on
 * the «▷ Waiting · N» shelf at the bottom, by area, soonest first — never in the pile of what is not
 * today; on its day it comes back among the rows, marked ▷, and that ▷ takes it back.
 * A project's note is its page: the ```focus-tasks``` block at its bottom (there from the start, or
 * added when the note is opened from the list) shows that project's steps alone — today's, the pile
 * of the rest, «+ Step», the closed ones folded — with the same rows as here.
 * The grip on the left drags areas, projects and tasks; a plain click on it selects the row (on a
 * phone it opens the menu; a right click opens it anywhere). Shift-click selects every task from the
 * last clicked one, Cmd/Ctrl-click adds or drops one. With rows selected the keys work on them, as
 * on a selected block in Notion: ↑/↓ walk (Shift extends), Enter edits, ⌫ deletes, ⌘1–4 date them,
 * ⌘Z takes back the last change, Esc drops the selection; the grip drags them all, and their date
 * or menu set the date of all of them.
 */
const {
  Plugin, PluginSettingTab, Setting, ItemView, Modal, SuggestModal, FuzzySuggestModal, Notice, Menu,
  MarkdownRenderChild, MarkdownRenderer, Component, Keymap, moment, setIcon, prepareSimpleSearch, prepareFuzzySearch,
  Platform, Scope, normalizePath, requestUrl, parseLinktext, parseYaml, stringifyYaml,
} = require("obsidian");

const VIEW_TYPE = "focus-tasks-view";
const CALENDAR_STATUS = "Internals/FocusTasks/calendar-status.json";
const CALENDAR_RECEIPT = "Internals/FocusTasks/calendar-status.md";
const CALENDAR_CONTRACT = "focus-view-at-start-v1";
const PROJECT_WORDS = ["project", "проект"];
const TASK_WORDS = ["task", "задача"];
const TASK_TYPE = "задача";   // what a new task note gets; TASK_WORDS is what we also read
const INTENT_TYPE = "замысел";
const INTENT_LIST_TYPE = "список замыслов";
// TaskNotes: the optional companion on the same notes. Its own field names are our contract
// already; the one thing it has to be told is how to recognise a task.
const COMPANION = { id: "tasknotes", repo: "callumalpass/tasknotes", property: "type" };
const STATUS_OPEN = "open", STATUS_DONE = "done", STATUS_CANCELLED = "cancelled", STATUS_SOMEDAY = "someday";
// Started and out of my hands: delegated, sent, waiting on someone. It leaves the focus but not the
// list — its date stops meaning «do it» and starts meaning «look at it again». TaskNotes knows this
// status out of the box, so a task marked here reads the same in both plugins.
// A task in somebody else's hands: it waits on its own shelf until the day (and hour) to look at it
// again. Written as `waiting` — «in-progress» would tell TaskNotes the work is being done right now.
const STATUS_WAITING = "waiting";

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
  todoIdeas: true,
};

// --- strings ----------------------------------------------------------------------------------

const STRINGS = {
  en: {
    viewTitle: "Focus", open: "Open Focus", focusEmpty: "Nothing due today",
    noAreas: "No areas yet — create the first one", restTitle: "Other areas", findPlaceholder: "Find an area, a project or a task…", cmdFind: "Find in the list", findGone: "Not in the list any more", focusTitle: "Focus", focusOnly: "Show the focus alone: its areas open, «All» and the ⏳ piles off", openTasks: "{0} open", all: "All", hide: "Hide",
    newArea: "+ Area", areaFromNote: "+ Area from a note", foldAll: "Collapse all", unfoldAll: "Expand all",
    openCount: "open {0}", inFocus: ", in focus {0}", addToArea: "Task in this area", empty: "Empty",
    addTask: "Add a task", showUpcoming: "Show upcoming", hideUpcoming: "Hide upcoming",
    addStep: "Step in this project", drag: "Drag", collapse: "Collapse", expand: "Expand",
    reorder: "Reorder", reordering: "Reordering", reorderHint: "Drag by a handle", reorderDone: "Done",
    pageNoProject: "This note is not a project of the list: no steps to show", pageMissing: "No project “{0}” in the list", areaPageMissing: "Area “{0}” is not in the list", saveFailed: "Could not save. Your text is kept in the row; try again.",
    cmdStepsBlocks: "Steps block in every project note", stepsBlocksAdded: "Steps block added to {0} notes", stepsBlocksNone: "Every project note already has its steps block",
    noStep: "no step yet", moreSteps: "{0} more — show them", hideSteps: "Hide the other steps", projectDone: "Project done",
    projectDoneNotice: "“{0}” is done", projectBack: "“{0}” is open again", doneButton: "Done", doneEmpty: "Nothing closed today yet", aProjectDone: "closing a project", listDone: "Complete list",
    setDate: "Set a date", todayShort: "today", today: "Today", yesterday: "Yesterday", tomorrow: "Tomorrow",
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
    deleteProjectQ: "Delete project “{0}”?", deleteProjectText: "Its note and its {0} tasks go to the trash (Undo in the notice). A linked note stays.",
    deleteAreaQ: "Delete area {0}?", deleteAreaText: "The area, its {0} projects and its {1} tasks go to the trash. Linked notes stay.",
    deleteAreaIdeasText: "The area, its {0} projects, {1} tasks, {2} idea lists and their {3} entries go to the trash. Linked source notes stay.",
    taskIn: "Task added to “{0}”", where: "Where to: a project or an area (type a new name to create an area)",
    newAreaOption: "+ New area “{0}”", looseTasks: "(loose tasks)", whatToDo: "What to do",
    pickNote: "Pick a note", cmdToggleAll: "Show all / focus only", cmdFoldAll: "Collapse all",
    cmdUnfoldAll: "Expand all", cmdAddTask: "New task", cmdAddArea: "New area", cmdAreaFromNote: "New area from the current note",
    pickerPlaceholder: "DD.MM.YY or “tomorrow”", clearDate: "Clear date", completed: "Completed",
    daysShort: "d", overdueBy: "Overdue by {0} days", described: "This task holds a description — a plan belongs in a project", moveUp: "Move up", moveDown: "Move down",
    repeating: "This task repeats — install TaskNotes to close one occurrence, or remove `recurrence` from the note",
    undoKept: "Put back {0} of {1}: the rest changed in the meantime",
    allDone: "done {0}", undone: "Undone: {0}", nothingToUndo: "Nothing to undo", cmdUndo: "Undo the last change",
    aDate: "the date", aPriority: "the priority", aRunning: "the status", aMove: "the move", aRename: "the new text", aDone: "completing the task", aNew: "the new task", aCopy: "the copy", aProject: "making it a project", focusDone: "Nothing due today — {0} tasks are waiting", showAll: "Show them",
    orphans: "Without an area", orphansHelp: "These tasks are in no area, so the focus cannot show them. Pick a place for each.",
    place: "Put in an area…", toProject: "Make it a project", toProjectDone: "“{0}” is a project now",
    toProjectBusy: "“{0}” cannot become a project: a note with that name already exists",
    dueOn: "Deadline: {0}", priorityLow: "Low priority", priorityNormal: "Normal priority", priorityHigh: "High priority", priorityNone: "No priority",
    botMark: "Added by a robot, not looked at yet — a click takes the mark off", botMarkOff: "Take the robot's mark off",
    projectDate: "Project date…", projectNoDate: "No project date", projectDated: "The project's own date: it decides whether the project is in the focus",
    inProgress: "Waiting…", backToWork: "Take it back",
    waitingSince: "In other hands; look again {0}", waitingNoDate: "In other hands; no day set to look again",
    waitingButton: "Waiting", waitingShelf: "{0} in other hands", waitingEmpty: "Nothing in other hands", until: "by {0}",
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
    reminder: "Remind in Apple Calendar…", reminderCaption: "Remind in Apple Calendar", reminderInfo: "A timed event will remind you after the task syncs.",
    reminderClock: "Choose a time for the reminder", repeatUndo: "Undo this recurring occurrence in TaskNotes.", calendarTitle: "Apple Calendar reminders", calendarOff: "Not connected yet. A date with a time can be prepared in a task.",
    calendarOn: "Connected. Dates with a time appear as reminder events after syncing.", calendarProblem: "Reminders have not synced yet. Check the calendar connection.",
    calendarSynced: "Event confirmed in Apple Calendar. Alert at the event time.", calendarPending: "Waiting for Apple Calendar confirmation.",
    calendarFailed: "Apple Calendar could not confirm this event. It will retry.",
    linkMissing: "Task not found. It may be deleted or not synced to this device yet.",
    linkDuplicate: "Several tasks share this UID. No task was selected.",
    linkInactive: "This task is no longer in the active list.",
    linkBusy: "Finish the current edit, then open the task link again.",
    linkFailed: "Could not show this task in Focus.",
    selected: "Selected: {0}", pickDate: "Date…", clearSelection: "Clear selection",
    pickerSave: "Save", clearTime: "Remove time", mixedTime: "Different times; unchanged hours are preserved",
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
    noAreas: "Областей пока нет — создай первую", restTitle: "Остальные области", findPlaceholder: "Найти область, проект или задачу…", cmdFind: "Найти в списке", findGone: "Этого больше нет в списке", focusTitle: "Фокус", focusOnly: "Показать только фокус: его области развернуть, «Все» и отложку скрыть", openTasks: "открыто: {0}", all: "Все", hide: "Скрыть",
    newArea: "+ Область", areaFromNote: "+ Область из заметки", foldAll: "Свернуть всё", unfoldAll: "Развернуть всё",
    openCount: "открыто {0}", inFocus: ", в фокусе {0}", addToArea: "Задача в область", empty: "Пусто",
    addTask: "Добавить задачу", showUpcoming: "Показать будущее", hideUpcoming: "Скрыть будущее",
    addStep: "Шаг в проект", drag: "Перетащить", collapse: "Свернуть", expand: "Развернуть",
    reorder: "Переставить", reordering: "Перестановка", reorderHint: "Тяни за ручку", reorderDone: "Готово",
    pageNoProject: "Эта заметка - не проект списка: шагов нет", pageMissing: "Проекта «{0}» в списке нет", areaPageMissing: "Области «{0}» в списке нет", saveFailed: "Не удалось сохранить. Текст остался в строке - попробуй ещё раз.",
    cmdStepsBlocks: "Блок шагов во все заметки проектов", stepsBlocksAdded: "Блок шагов добавлен в заметок: {0}", stepsBlocksNone: "Блок шагов уже есть во всех заметках проектов",
    noStep: "пока пусто", moreSteps: "ещё {0} — показать", hideSteps: "Скрыть остальные шаги", projectDone: "Проект выполнен",
    projectDoneNotice: "«{0}» выполнен", projectBack: "«{0}» снова открыт", doneButton: "Сделано", doneEmpty: "Сегодня ещё ничего не закрыто", aProjectDone: "закрытие проекта", listDone: "Завершить список",
    setDate: "Поставить дату", todayShort: "сегодня", today: "Сегодня", yesterday: "Вчера", tomorrow: "Завтра",
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
    deleteProjectQ: "Удалить проект «{0}»?", deleteProjectText: "Заметка проекта и его задачи ({0}) уйдут в корзину (вернуть - в уведомлении). Привязанная заметка останется.",
    deleteAreaQ: "Удалить область {0}?", deleteAreaText: "В корзину уйдут область, её проекты ({0}) и её задачи ({1}). Привязанные заметки останутся.",
    deleteAreaIdeasText: "В корзину уйдут область, её проекты ({0}), задачи ({1}), списки замыслов ({2}) и их записи ({3}). Привязанные заметки-источники останутся.",
    taskIn: "Задача в «{0}»", where: "Куда: проект или область (новое имя — новая область)",
    newAreaOption: "＋ Новая область «{0}»", looseTasks: "(разовые задачи)", whatToDo: "Что сделать",
    pickNote: "Выбери заметку", cmdToggleAll: "Показать всё / только фокус", cmdFoldAll: "Свернуть всё",
    cmdUnfoldAll: "Развернуть всё", cmdAddTask: "Новая задача", cmdAddArea: "Новая область", cmdAreaFromNote: "Новая область из текущей заметки",
    pickerPlaceholder: "ДД.ММ.ГГ или «завтра»", clearDate: "Убрать дату", completed: "Выполненные",
    daysShort: " дн", overdueBy: "Просрочено на {0} дн.", described: "В задаче есть описание — план должен жить в проекте", moveUp: "Выше", moveDown: "Ниже",
    repeating: "Задача повторяется — закрыть одно вхождение может TaskNotes; либо убери `recurrence` из заметки",
    undoKept: "Вернул {0} из {1}: остальные с тех пор изменились",
    allDone: "сделано {0}", undone: "Отменено: {0}", nothingToUndo: "Нечего отменять", cmdUndo: "Отменить последнее действие",
    aDate: "дата", aPriority: "приоритет", aRunning: "статус", aMove: "перенос", aRename: "текст задачи", aDone: "выполнение задачи", aNew: "новая задача", aCopy: "копия", aProject: "превращение в проект", focusDone: "На сегодня ничего — в работе ещё {0}", showAll: "Показать",
    orphans: "Без области", orphansHelp: "Эти задачи ни в одной области, поэтому фокус их не показывает. Разложи их по местам.",
    place: "Положить в область…", toProject: "Сделать проектом", toProjectDone: "«{0}» теперь проект",
    toProjectBusy: "«{0}» не сделать проектом: заметка с таким именем уже есть",
    dueOn: "Дедлайн: {0}", priorityLow: "Низкий приоритет", priorityNormal: "Обычный приоритет", priorityHigh: "Высокий приоритет", priorityNone: "Без приоритета",
    botMark: "Добавил бот, ещё не смотрел - клик снимает метку", botMarkOff: "Снять метку бота",
    projectDate: "Дата проекта…", projectNoDate: "Проект без даты", projectDated: "Своя дата проекта: она решает, в фокусе ли проект",
    inProgress: "Жду…", backToWork: "Взять обратно",
    waitingSince: "Жду; посмотреть {0}", waitingNoDate: "Жду; день не назначен",
    waitingButton: "Жду", waitingShelf: "жду: {0}", waitingEmpty: "Ничего не ждёшь", until: "до {0}",
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
    reminder: "Напомнить в Apple Calendar…", reminderCaption: "Напомнить в Apple Calendar", reminderInfo: "Событие со временем напомнит после синхронизации задачи.",
    reminderClock: "Укажи время напоминания", repeatUndo: "Отмени выполнение этого повтора в TaskNotes.", calendarTitle: "Напоминания Apple Calendar", calendarOff: "Пока не подключён. Дату со временем можно подготовить в задаче.",
    calendarOn: "Подключён. Даты со временем попадают в календарь после синхронизации.", calendarProblem: "Напоминания пока не синхронизированы. Проверь подключение календаря.",
    calendarSynced: "Событие подтверждено в Apple Calendar. Уведомление в момент события.", calendarPending: "Ожидается подтверждение события из Apple Calendar.",
    calendarFailed: "Apple Calendar не подтвердил событие. Запись будет повторена.",
    linkMissing: "Задача не найдена. Возможно, она удалена или ещё не пришла через Sync.",
    linkDuplicate: "У нескольких задач одинаковый UID. Переход отменён.",
    linkInactive: "Эта задача больше не входит в активный список.",
    linkBusy: "Закончи текущую правку, затем открой ссылку на задачу ещё раз.",
    linkFailed: "Не удалось показать задачу в Фокусе.",
    selected: "Выбрано: {0}", pickDate: "Дата…", clearSelection: "Снять выделение",
    pickerSave: "Сохранить", clearTime: "Убрать время", mixedTime: "Разное время; без правки часы сохранятся",
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
Object.assign(STRINGS.en, { listExpand: "Expand list", listCollapse: "Collapse list", newIntentList: "New list", deleteIntentList: "Delete list", deleteIntentListDesc: "Delete this list and all its items? You can undo this.", intentToFocus: "Move to Focus today", intentToBacklog: "Move to backlog", intentToList: "Move to a list", intentEmpty: "Add an item", intentListPlace: "Move list to an area" });
Object.assign(STRINGS.ru, { listExpand: "Развернуть список", listCollapse: "Свернуть список", newIntentList: "Новый список", deleteIntentList: "Удалить список", deleteIntentListDesc: "Удалить список со всеми пунктами? Можно отменить.", intentToFocus: "Перенести в фокус сегодня", intentToBacklog: "Перенести в отложку", intentToList: "Перенести в список", intentEmpty: "Добавить пункт", intentListPlace: "Перенести список в область" });
Object.assign(STRINGS.en, { projectToIntent: "Make an idea list", taskToIntent: "Make an idea" });
Object.assign(STRINGS.ru, { projectToIntent: "Сделать замыслом", taskToIntent: "Сделать замыслом" });
Object.assign(STRINGS.en, { extraViews: "Focus, backlog and ideas", backlog: "Backlog", addProjectIdea: "Add an idea", bindIntentProject: "Link to a project", unbindIntentProject: "Keep as an area list", intentProjectTaken: "This project already has an idea list", deleteProjectIdeas: "Its {0} ideas will also be deleted. You can undo this." });
Object.assign(STRINGS.ru, { extraViews: "Фокус, отложка и замыслы", backlog: "Отложка", addProjectIdea: "Добавить замысел", bindIntentProject: "Привязать к проекту", unbindIntentProject: "Оставить списком области", intentProjectTaken: "У проекта уже есть список замыслов", deleteProjectIdeas: "Также будут удалены его замыслы: {0}. Можно отменить." });
Object.assign(STRINGS.en, {
  intents: "Ideas", addIntent: "Add an idea", editIntent: "Edit idea", intentTitle: "Title",
  intentBody: "Thoughts, possibilities, links…", intentArea: "Area", intentLoose: "Without an area",
  intentSave: "Save", intentTask: "Create a task", intentTaskTitle: "What will you do?",
  intentBacklog: "Backlog", intentFocus: "Focus today", intentSource: "From {0}",
  intentChanged: "The note changed. Your draft is kept; reopen the current card before saving.",
  intentFailed: "Could not save. Your draft is kept.", intentHint: "Possibilities to think about. They do not need to become tasks.",
  intentDeleted: "Idea deleted", intentDeleteQ: "Delete this idea?",
  intentDeleteDesc: "The card goes to the trash. Tasks created from it stay in their lists.",
  intentDeleteTodo: "Remove this TODO block from its source note? Other sections and derived tasks stay in place.",
  intentTodos: "Show TODO sections as ideas", intentTodosDesc: "Reads source notes without moving or completing their items.",
});
Object.assign(STRINGS.ru, {
  intents: "Замыслы", addIntent: "Добавить замысел", editIntent: "Редактировать замысел", intentTitle: "Название",
  intentBody: "Мысли, возможности, ссылки…", intentArea: "Область", intentLoose: "Без области",
  intentSave: "Сохранить", intentTask: "Создать задачу", intentTaskTitle: "Что конкретно сделать?",
  intentBacklog: "Отложка", intentFocus: "Фокус сегодня", intentSource: "Из {0}",
  intentChanged: "Заметка изменилась. Черновик сохранён в редакторе; перед сохранением открой актуальную карточку.",
  intentFailed: "Не удалось сохранить. Черновик остался в редакторе.", intentHint: "Возможности для размышления. Они не обязаны становиться задачами.",
  intentDeleted: "Замысел удалён", intentDeleteQ: "Удалить замысел?",
  intentDeleteDesc: "Карточка попадёт в корзину. Созданные из неё задачи останутся в своих списках.",
  intentDeleteTodo: "Удалить этот TODO-блок из исходной заметки? Другие разделы и созданные задачи останутся на месте.",
  intentTodos: "Показывать TODO-блоки как замыслы", intentTodosDesc: "Читает исходные заметки без переноса и выполнения пунктов.",
});
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
const timeOf = (value) => {
  const text=String(value ?? "");
  if (value instanceof Date || /[T ].*(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    const date=moment(value); return date.isValid() ? date.format("HH:mm") : null;
  }
  return parseTime(text.match(/[T ](\d{2}:\d{2})/)?.[1]);
};
const backDue = (task) => !!task.date && (task.at
  ? `${task.date}T${task.at}` <= moment().format("YYYY-MM-DDTHH:mm")
  : task.date <= today());
// Sent off and still waiting for that moment: it stays where it lives, but the row goes quiet.
const waitingBack = (task) => task.status === STATUS_WAITING && !backDue(task);
// A date as the plugin reads it: «2026-09-22», «2026-09-22T18:30+03:00» and a Date all mean that day.
const day = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const zone = value instanceof Date || /[T ].*(?:Z|[+-]\d{2}:\d{2})$/.test(String(value));
  const text = zone ? moment(value).format("YYYY-MM-DD") : String(value).trim();
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
let uidSequence = 0;
const newUid = () => "ft-" + (globalThis.crypto?.randomUUID?.()
  || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${++uidSequence}`);
// The list a task is dragged within: the steps of its project, or the loose tasks of its area.
const listOf = (task) => task.intent ? "intent:" + (task.listUid || task.project || "area:" + task.area) : (task.project ? "project:" + task.project : "area:" + task.area);
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
  const match = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/.exec(text);
  return match ? [match[0], text.slice(match[0].length).replace(/^\r?\n/, "")] : ["", text];
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
    Object.assign(this, { value, onPick, onCancel, min: opts.min || null, tooEarly: opts.tooEarly || null, timeRequired: !!opts.timeRequired, futureClock: !!opts.futureClock, preserveTime: !!opts.preserveTime });
    this.month = moment(value || opts.min || today()).startOf("month");
    this.el = document.body.createDiv({ cls: "ft-picker" });
    if (opts.title) this.el.createDiv({ cls: "ft-picker-caption", text: opts.title });
    if (opts.info) this.el.createDiv({ cls: "ft-picker-info", text: opts.info });
    const field = this.el.createDiv({ cls: "ft-picker-field" });
    this.input = field.createEl("input", { type: "text", cls: "ft-picker-input", attr: { placeholder: opts.hint || t("pickerPlaceholder") } });
    this.input.value = value ? moment(value).format("DD.MM.YY") : "";
    // The task date and its optional reminder/return hour share one card. Type two digits for the
    // hour and the caret moves to the minutes by itself, two more
    // and Tab closes the card with the time set. Hands stay on the keyboard the whole way.
    if (opts.time) {
      const pair = field.createDiv({ cls: "ft-picker-clock" });
      const cell = (cls, value) => pair.createEl("input", { type: "text", cls: `ft-picker-part ${cls}`,
        attr: { placeholder: t(cls === "is-hh" ? "hourHint" : "minuteHint"), maxlength: "2", inputmode: "numeric", value } });
      this.hh = cell("is-hh", (opts.at || "").slice(0, 2));
      pair.createSpan({ cls: "ft-picker-colon", text: ":" });
      this.mm = cell("is-mm", (opts.at || "").slice(3, 5));
      this.initialClock = `${this.hh.value}:${this.mm.value}`;
      if (opts.mixedTime) {
        this.hh.placeholder = this.mm.placeholder = "-";
        pair.setAttribute("aria-label", t("mixedTime"));
      }
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
      this.hh.oninput = () => { this.hh.removeClass("is-invalid"); fill(this.hh); };
      this.mm.oninput = () => { this.hh.removeClass("is-invalid"); digits(this.mm); };
      for (const el of [this.hh, this.mm]) {
        el.onfocus = () => el.select();
        el.onblur = () => { if (el.value) el.value = el.value.padStart(2, "0"); };
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
    if (opts.time && !opts.timeRequired) this.el.createDiv({ cls: "ft-picker-foot" }).createEl("button", { text: t("clearTime"), cls: "ft-picker-clear-time" }).onclick = () => {
      this.hh.value = this.mm.value = "";
      this.hh.removeClass("is-invalid");
      this.forceClock = true;
    };
    this.el.createDiv({ cls: "ft-picker-actions" }).createEl("button", { text: t("pickerSave"), cls: "ft-picker-save" }).onclick = () => this.submit();
    this.draw();
    this.place(anchor);
    this.viewport = window.visualViewport;
    this.resized = () => this.place(anchor);
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
    // Scrolling another note pane cannot commit this card. Only the card's own anchor moves it.
    this.scrolled = e => {
      // iOS moves the document when its keyboard opens or changes focus between the clock fields.
      // Keep that partial entry open; scrolling the anchor pane still commits as before.
      if (Platform.isMobile && (e.target === document || e.target === window) && this.el.contains(document.activeElement)) { this.resized(); return; }
      if (!(e.target instanceof Node && this.el.contains(e.target)) && (e.target === document || e.target === window || e.target.contains?.(anchor))) this.commit();
    };
    // The click that opened the picker is still travelling, so listening starts a tick later — and
    // only if the picker is still open by then, or the listeners would outlive it.
    setTimeout(() => {
      if (this.closed) return;
      this.listening = true;
      document.addEventListener("pointerdown", this.outside, true);
      document.addEventListener("keydown", this.keys, true);
      document.addEventListener("scroll", this.scrolled, true);
      window.addEventListener("resize", this.resized);
      this.viewport?.addEventListener("resize", this.resized);
      this.viewport?.addEventListener("scroll", this.resized);
    }, 0);
    // The day is already answered (today, unless told otherwise); the hour is what is actually being
    // typed, so that is where the caret starts.
    if (!Platform.isMobile) {
      const input = opts.focusTime === false ? this.input : this.hh || this.input;
      input.focus(); input.select(); // type a replacement for the suggested day; phone keeps its keyboard closed
    }
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
      // Picking a day fills the card. The same Save/Enter gesture confirms it everywhere, leaving
      // time to add an hour. A phone must not summon its keyboard merely for a calendar tap.
      else cell.onclick = () => {
        this.value = iso;
        this.input.value = moment(iso).format("DD.MM.YY");
        this.input.removeClass("is-invalid");
        this.draw();
        if (!Platform.isMobile && this.hh) this.hh.focus();
      };
    }
  }

  // A day the card was told not to accept: drawn, so the month still reads as a month, but dead.
  allowed(iso) { return !this.min || iso >= this.min; }

  place(anchor) {
    const viewport = window.visualViewport;
    const vw = viewport?.width || window.innerWidth, vh = viewport?.height || window.innerHeight;
    const vx = viewport?.offsetLeft || 0, vy = viewport?.offsetTop || 0;
    this.el.style.maxHeight = `${Math.max(80, vh - 16)}px`;
    const r = anchor.getBoundingClientRect();
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    const left = Math.max(vx + 8, Math.min(r.right - w, vx + vw - w - 8));
    let top = r.bottom + 6;
    if (top + h > vy + vh - 8) top = r.top - h - 6;
    top = Math.max(vy + 8, Math.min(top, vy + vh - h - 8));
    Object.assign(this.el.style, { left: `${left}px`, top: `${top}px` });
  }

  // What the fields add up to, whichever key ended the run.
  submit() {
    const day = this.input.value.trim() ? parseDay(this.input.value) : this.value;
    if (!day || !this.allowed(day)) {
      this.input.addClass("is-invalid");
      if (day && this.tooEarly) new Notice(this.tooEarly);
      return;
    }
    this.pick(day);
  }

  // The hour rides along with the day: empty hours simply mean «that whole day», and minutes left
  // empty on a filled hour mean o'clock. Returns false when the fields hold something unreadable.
  async pick(day) {
    if (this.busy || this.closed) return false;
    let at = null;
    if (day && this.hh && (this.timeRequired || this.hh.value.trim() || this.mm.value.trim())) {
      at = parseTime(`${this.hh.value}:${this.mm.value.trim() || "00"}`);
      if (!at) { this.hh.addClass("is-invalid"); return false; }
      if (this.futureClock && moment(`${day}T${at}`).valueOf() <= Date.now()) {
        this.hh.addClass("is-invalid");
        new Notice(this.tooEarly || t("returnTooSoon"));
        return false;
      }
    }
    this.busy = true;
    try {
      // An untouched mixed clock means each selected task keeps its own hour. It also preserves
      // a reminder received through Sync since this card opened; clearing the fields is explicit.
      const keepClock = this.preserveTime && !this.forceClock && `${this.hh.value}:${this.mm.value}` === this.initialClock;
      if (await this.onPick(day, keepClock ? undefined : at) === false) return false;
      this.close(true);
      return true;
    } catch (e) {
      new Notice(t("saveFailed"));
      console.warn("Focus Tasks: cannot save the picked date", e);
      return false;
    } finally { this.busy = false; }
  }

  // Walking away from the card is an answer too: what stands in the fields is applied. Typing a day
  // and an hour and then clicking elsewhere used to throw both away — the one gesture nobody reads
  // as «cancel». Escape is what cancels.
  async commit() {
    if (this.closed) return;
    const day = this.input.value.trim() ? parseDay(this.input.value) : this.value;
    if (!day || !this.allowed(day)) { this.input.addClass("is-invalid"); return; }
    await this.pick(day);
  }

  close(picked) {
    if (this.closed) return;
    this.closed = true;
    if (this.listening) {
      document.removeEventListener("pointerdown", this.outside, true);
      document.removeEventListener("keydown", this.keys, true);
      document.removeEventListener("scroll", this.scrolled, true);
      window.removeEventListener("resize", this.resized);
      this.viewport?.removeEventListener("resize", this.resized);
      this.viewport?.removeEventListener("scroll", this.resized);
    }
    this.el.remove();
    if (!picked) this.onCancel();
  }
}

class TargetModal extends SuggestModal {
  constructor(app, items, onChoose, allowCreate = true) {
    super(app);
    this.items = items;
    this.onChoose = onChoose;
    this.allowCreate = allowCreate;
    this.setPlaceholder(t("where"));
  }
  getSuggestions(query) {
    const q = query.trim();
    if (!q) return this.items;
    const match = prepareSimpleSearch(q);
    const found = this.items.filter((i) => match(i.label));
    const known = this.items.some((i) => !i.project && bare(i.area).toLowerCase() === bare(q).toLowerCase());
    if (!known && this.allowCreate) found.push({ create: q, label: t("newAreaOption", q) });
    return found;
  }
  renderSuggestion(item, el) { el.setText(item.label); }
  onChooseSuggestion(item) { this.onChoose(item); }
}

// ⌘F in the list: every area, project and open task, found by any part of its name (and a task by
// its project and area too). Choosing one shows it in the list — unfolded, scrolled to, selected.
class FindModal extends SuggestModal {
  constructor(app, items, onChoose) {
    super(app);
    this.items = items;
    this.onChoose = onChoose;
    this.setPlaceholder(t("findPlaceholder"));
    this.limit = 60;
  }
  getSuggestions(query) {
    const q = query.trim();
    if (!q) return this.items.slice(0, this.limit);
    const match = prepareFuzzySearch(q);
    const kind = { area: 0, project: 1, task: 2, intent: 3 };
    return this.items
      .map((i) => ({ i, r: match(i.search) }))
      .filter((x) => x.r)
      .sort((a, b) => b.r.score - a.r.score || kind[a.i.kind] - kind[b.i.kind])
      .slice(0, this.limit)
      .map((x) => x.i);
  }
  renderSuggestion(item, el) {
    el.addClass("ft-find-item");
    const icon = el.createSpan({ cls: "ft-find-icon" });
    if (["intent", "intent-task"].includes(item.kind)) icon.setText("📔");
    else setIcon(icon, item.kind === "area" ? "layers" : item.kind === "project" ? "folder" : item.waiting ? "play" : "square");
    const body = el.createDiv({ cls: "ft-find-body" });
    body.createDiv({ cls: "ft-find-title", text: item.title });
    if (item.where) body.createDiv({ cls: "ft-find-where", text: item.where });
    if (item.when) el.createSpan({ cls: "ft-find-when", text: item.when });
  }
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
// TODO sections remain source material. Fenced examples and nested headings are not new cards.
function todoBlocks(text) {
  const headings = [], views = []; let offset = 0, fence = null, front = /^\uFEFF?---\r?\n/.test(text), first = true;
  for (const raw of text.match(/[^\n]*(?:\n|$)/g) || []) {
    const line = raw.replace(/\r?\n$/, "");
    if (front) { if (!first && /^---\s*$/.test(line)) front = false; }
    else {
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (f) { if (!fence) { if (/^ {0,3}(?:`{3,}|~{3,})\s*focus-tasks\b/.test(line)) views.push(offset); fence = f[1]; } else if (f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null; }
      else if (!fence) { const h = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line); if (h) headings.push({ start: offset, bodyStart: offset + raw.length, level: h[1].length, heading: h[2] }); }
    }
    first = false; offset += raw.length;
  }
  return headings.filter(h => /^TODO\b/i.test(h.heading)).map(h => {
    const next = headings.find(n => n.start > h.start && n.level <= h.level);
    const view = views.find(start => start > h.start);
    const end = Math.min(next ? next.start : text.length, view ?? text.length);
    return { ...h, end, body: text.slice(h.bodyStart, end), snapshot: text.slice(h.start, end) };
  }).filter((b, i, all) => !all.some(p => p.start < b.start && p.end >= b.end));
}

const intentProse = text => {
  let fence = null;
  return text.split(/(?<=\n)/).map(line => {
    const mark = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (mark) { if (!fence) fence = mark[1]; else if (mark[1][0] === fence[0] && mark[1].length >= fence.length && !line.slice(mark[0].length).trim()) fence = null; return line; }
    if (fence) return line;
    return line.replace(/^(\s*[-*+]\s+)\[([ xX])\][ \t]*(.*?)(\r?\n)?$/, (_, bullet, checked, body, newline) =>
      bullet + (checked.trim() ? "~~" + body + "~~" : body) + (newline || ""));
  }).join("");
};

class IntentModal extends Modal {
  constructor(plugin, intent, area, onClose, task = false) {
    super(plugin.app); Object.assign(this, { plugin, intent, area, finish: onClose, task });
  }
  onOpen() {
    this.titleEl.setText(t(this.task ? "intentTask" : this.intent ? "editIntent" : "addIntent"));
    this.modalEl.addClass("ft-intent-modal");
    const form = this.contentEl;
    form.createEl("label", { text: t(this.task ? "intentTaskTitle" : "intentTitle") });
    const title = form.createEl("input", { cls: "ft-input ft-intent-title-input", type: "text" });
    title.value = this.task ? "" : this.intent?.title || ""; title.disabled = !!(this.intent?.legacy && !this.task);
    if (this.task) title.placeholder = this.intent?.title || t("intentTaskTitle");
    form.createEl("label", { text: t("intentArea") });
    const area = form.createEl("select", { cls: "ft-intent-area-input" });
    area.createEl("option", { value: "", text: t("intentLoose") });
    for (const name of [...new Set(this.plugin.notes().filter(n => !n.project).map(n => n.area))]) area.createEl("option", { value: name, text: name });
    area.value = this.area || this.intent?.area || "";
    const chosenArea = this.area || this.intent?.area;
    if (chosenArea && ![...area.options].some(o => o.value === chosenArea)) { area.createEl("option", { value: chosenArea, text: chosenArea }); area.value = chosenArea; }
    let body, destination;
    if (this.task) {
      destination = form.createEl("select", { cls: "ft-intent-destination" });
      destination.createEl("option", { value: "", text: t("intentBacklog") });
      destination.createEl("option", { value: "today", text: t("intentFocus") });
    } else {
      body = form.createEl("textarea", { cls: "ft-intent-body-input", attr: { placeholder: t("intentBody") } });
      body.value = this.intent?.body || "";
    }
    const error = form.createDiv({ cls: "ft-intent-error", attr: { role: "alert" } });
    const buttons = form.createDiv({ cls: "modal-button-container" });
    const save = buttons.createEl("button", { cls: "mod-cta ft-intent-save", text: t(this.task ? "create" : "intentSave") });
    save.onclick = async () => {
      if (this.saving || !title.value.trim()) { title.focus(); return; }
      this.saving = true; save.disabled = true; error.setText("");
      try {
        if (this.task) await this.plugin.taskFromIntent(this.intent, title.value.trim(), area.value || null, destination.value ? today() : null);
        else if (this.intent) await this.plugin.saveIntent(this.intent, title.value.trim(), body.value, area.value || null);
        else await this.plugin.createIntent(title.value.trim(), body.value, area.value || null);
        this.close();
      } catch (e) { error.setText(e.message === "intent-conflict" ? t("intentChanged") : t("intentFailed")); }
      finally { this.saving = false; save.disabled = false; }
    };
    if (this.intent && !this.task) buttons.createEl("button", { cls: "ft-intent-delete", text: t("delete") }).onclick = () => {
      if (this.saving) return;
      new ConfirmModal(this.app, t("intentDeleteQ"), t(this.intent.legacy ? "intentDeleteTodo" : "intentDeleteDesc"), t("delete"), async () => {
        this.saving = true; save.disabled = true; error.setText("");
        try { await this.plugin.removeIntent(this.intent); this.close(); }
        catch (e) { error.setText(e.message === "intent-conflict" ? t("intentChanged") : t("intentFailed")); }
        finally { this.saving = false; save.disabled = false; }
      }).open();
    };
    buttons.createEl("button", { text: t("cancel") }).onclick = () => { if (!this.saving) this.close(); };
    setTimeout(() => (title.disabled ? body : title)?.focus(), 0);
  }
  onClose() { this.contentEl.empty(); this.finish?.(); }
}

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
  constructor(plugin, el, sourcePath, leaf = null, blockSrc = null) {
    // `blockSrc`: the text inside a ```focus-tasks``` block (null for the pane). What the block
    // shows is read from it and from the note it sits in on every render: a note that becomes a
    // project after the block was drawn becomes its page without being reopened.
    super(el);
    Object.assign(this, { plugin, sourcePath, leaf, blockSrc, page: null });
    this.selected = new Set();  // tasks of the selected rows
    this.anchor = null;         // the last clicked task: Shift-click selects from it
    this.cursor = null;         // the selected row the arrow keys go on from
    this.mobileReordering = false;
  }

  // Opens a note: Cmd/Ctrl-click in a new tab; from the pane never over the list itself.
  async open(file, e = null, eState = null, project = null) {
    const ws = this.plugin.app.workspace;
    let leaf = ws.getLeaf(e ? Keymap.isModEvent(e) : false);
    if (this.leaf && leaf === this.leaf) leaf = ws.getLeaf("tab");
    // a project's note is its page: the steps block at the bottom is put there the first time the
    // note is opened from the list. `project`: the one whose name was clicked — the note it is
    // linked to gets a block naming that project (two projects may share one note)
    const own = this.plugin.classify(project || file);
    if (!project && own?.project) project = file;
    if (project && own?.project) await this.plugin.ensureStepsBlock(file, project);
    else if (own && !own.project) await this.plugin.ensureAreaBlock(file, project || file);
    return leaf.openFile(file, eState ? { eState } : undefined);
  }

  // A link from a task's text: its note, or — a link to nothing yet — a new note, as Obsidian does.
  async openLink(href, source, e = null) {
    const { path, subpath } = parseLinktext(href);
    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(path, source);
    if (file) return this.open(file, e, subpath ? { subpath } : null);
    return this.plugin.app.workspace.openLinkText(href, source, this.leaf ? "tab" : !!(e && Keymap.isModEvent(e)));
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
    for (const event of ["create", "modify"]) this.registerEvent(this.plugin.app.vault.on(event, file => {
      if (file?.path === CALENDAR_STATUS || file?.path === CALENDAR_RECEIPT) later();
    }));
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
    this.registerEvent(this.plugin.app.workspace.on("active-leaf-change", () => {
      this.cancelMobilePress?.();
      if (this.leafOf() !== this.plugin.app.workspace.activeLeaf) this.setMobileReordering(false);
      this.keys(true);
    }));
    this.controlPressEvents();
    this.mobileGestures();
    this.plugin.views.add(this);
    this.render();
  }
  // Closing the pane (or switching a note out of preview) must take everything this view opened with
  // it: the editor's hotkeys, the picker and its document listeners, a drag left mid-air.
  onunload() {
    this.unloaded = true;
    clearTimeout(this.timer);
    clearTimeout(this.menuTimer);
    clearTimeout(this.mobileClickTimer);
    clearTimeout(this.controlReleaseTimer);
    this.pressFocusHost?.removeClass("ft-press-focus");
    this.keys(false);
    this.endEdit?.(false, false);
    this.dropScopes();
    this.picker?.close();
    this.stopDrag?.();
    this.cancelMobilePress?.();
    this.plugin.views.delete(this);
  }

  // Any editor scope still pushed — its row was rebuilt or the view went away — is taken off.
  dropScopes() {
    for (const scope of this.scopes || []) this.plugin.app.keymap.popScope(scope);
    this.scopes?.clear();
  }

  // ⌘F: the finder over everything the list holds.
  async find() {
    const p = this.plugin;
    const areas = await p.collect(true);
    const items = [];
    const day = (task) => (task.date ? moment(task.date).format("DD.MM") : "");
    for (const a of areas) {
      items.push({ kind: "area", title: a.name, search: a.name, area: a.name });
      for (const b of a.projects) items.push({ kind: "project", title: b.file.basename, where: a.name, search: `${b.file.basename} ${bare(a.name)}`, area: a.name, path: b.file.path });
    }
    for (const x of p.tasks()) {
      if (!x.area || x.status === STATUS_DONE || x.status === STATUS_CANCELLED) continue;
      const where = x.project ? `${x.area} › ${x.project}` : x.area;
      items.push({ kind: "task", title: x.text, where, when: day(x), search: `${x.text} ${x.project || ""} ${bare(x.area)}`, uid: x.uid, waiting: waitingBack(x) });
    }
    for (const x of await p.intentCards()) if(x.isList) {
      items.push({ kind: "intent", title: x.title, where: "📔 " + x.area, search: `${x.title} ${x.body} ${x.area || ""}`, uid: x.uid, area: x.area });
      for(const task of p.intentEntries(x)) if(![STATUS_DONE,STATUS_CANCELLED].includes(task.status)) {
        const body=splitNote(await p.app.vault.cachedRead(task.file))[1];
        items.push({kind:"intent-task",title:task.text,where:`📔 ${x.area} › ${x.title}`,search:`${task.text} ${body} ${x.title} ${x.area}`,uid:task.uid,area:x.area});
      }
    }
    new FindModal(p.app, items, (item) => this.reveal(item)).open();
  }

  // Shows a found item in the list: whatever hides it is opened (the area, «All», the pile, the
  // project's steps, the «Waiting» shelf), then it is scrolled to and selected.
  async reveal(item, openNote = true) {
    if (item.kind === "intent" || item.kind === "intent-task") return this.revealIntent(item);
    const p = this.plugin;
    const focus = (await p.collect(false)).map((a) => a.name);
    const wide = p.everything();
    const openArea = (name) => {
      if (!name) return;
      if (focus.includes(name)) delete p.data.folded["area:" + name];
      else { if (!p.everything()) p.app.saveLocalStorage("focus-tasks-all", "1"); p.data.opened["area:" + name] = true; }
    };
    const task = item.kind === "task" ? p.tasks().find((x) => x.uid === item.uid) : null;
    if (item.kind === "task" && !task) { new Notice(t("findGone")); return false; }
    if (item.kind === "area") openArea(item.area);
    if (item.kind === "project") {
      const b = (await p.collect(true)).flatMap((a) => a.projects).find((x) => x.file.path === item.path);
      openArea(b?.area.name || item.area);
    }
    if (task) {
      if (waitingBack(task)) p.app.saveLocalStorage("focus-tasks-waiting", "1");
      else {
        openArea(task.area);
        const inFocusArea = focus.includes(task.area);
        // The project's own day may put a today's step in the area's future pile, or bring
        // a future step into today's list. Reveal the actual bucket, not the task's day alone.
        const area = (await p.collect(false, true)).find(a => a.name === task.area);
        const ahead = area?.ahead.some(row => row.kind === "task" ? row.task.uid === task.uid : row.steps.some(step => step.uid === task.uid));
        if (inFocusArea && ahead) {   // it is in the area's ⏳ pile
          if (p.everything() || wide) delete p.data.opened["futureoff:" + task.area];
          else p.data.opened["future:" + task.area] = true;
        }
        const pf = task.project ? p.projectFile(task) : null;
        if (!ahead) delete p.data.opened["focusoff:" + task.area];
        else delete p.data.opened["futureoff:" + task.area];
        if (pf) {
          p.data.opened["steps:" + pf.path] = true;
          if (ahead) { p.data.opened["later:" + pf.path] = true; delete p.data.opened["pagefold:" + pf.path]; }
          else { p.data.opened["project-focuson:" + pf.path] = true; delete p.data.opened["project-focusoff:" + pf.path]; }
        }
      }
    }
    p.saveFolds();
    await this.rerendered();
    let row = null;
    if (item.kind === "area") row = [...this.containerEl.querySelectorAll(".ft-area-title[data-ft]")].find((e) => this.items.get(e)?.area?.name === item.area);
    else if (item.kind === "project") row = [...this.containerEl.querySelectorAll("li.ft-project-row[data-ft]")].find((e) => this.items.get(e)?.project?.file?.path === item.path);
    else row = this.rows().find(([, x]) => x.uid === item.uid)?.[0] || null;
    if (!row) { if (task && openNote) this.open(task.file); else if (task) new Notice(t("linkInactive")); return false; }
    row.scrollIntoView({ block: "center" });
    row.addClass("ft-found");
    setTimeout(() => row.removeClass("ft-found"), 1400);
    const handle = item.kind === "area" ? null : this.rows().find(([e]) => e === row)?.[1];
    if (handle) this.mark(handle);
    return true;
  }

  // «Focus» clicked: the focus alone, as «All» turned off does it — the other areas and every ⏳ pile
  // go, the focus areas open; «Done» and «Waiting» close too.
  async focusOnly(areas, rest) {
    this.plugin.setIntentsShown(false);
    const p = this.plugin;
    for (const key of Object.keys(p.data.opened)) if (key.startsWith("intents:") || key.startsWith("project-intents:")) delete p.data.opened[key];
    for (const key of Object.keys(p.data.opened)) if (/^(focusoff:|project-focusoff:|project-focuson:|project-header:|later:)/.test(key)) delete p.data.opened[key];
    for (const a of areas) {
      delete p.data.folded["area:" + a.name];
      delete p.data.opened["future:" + a.name];
    }
    for (const a of rest) delete p.data.opened["area:" + a.name];
    p.saveFolds();
    p.app.saveLocalStorage("focus-tasks-all", null);
    p.app.saveLocalStorage("focus-tasks-done", null);
    p.app.saveLocalStorage("focus-tasks-waiting", null);
    await this.rerendered();
    (this.scroller || this.containerEl).scrollTop = 0;
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
    this.cancelMobilePress?.();
    if (this.busy || this.editing || this.held || this.controlPress) { this.again = true; return; }
    this.busy = true;
    try { await this.build(); } finally { this.busy = false; }
    if (this.again) { this.again = false; this.render(); }
  }

  // Builds off-screen and swaps in one go: emptying the live block first would collapse the page
  // and throw the scroll back to the top on every change.
  async build() {
    this.calendar = await this.plugin.calendarState();
    this.intentNotes = this.plugin.read().intents.filter(x => x.isList);
    this.scopeAreas = await this.plugin.collect(false, true);
    if (this.blockSrc !== null) this.page = this.plugin.blockPage(this.blockSrc, this.sourcePath);
    if (this.page) return this.page.intent ? this.buildIntentPage() : this.page.area ? this.buildAreaPage() : this.buildPage();
    const p = this.plugin;
    const everything = p.everything();
    const areas = this.scopeAreas.filter(a => a.rows.some(r => !(r.kind === "project" && r.project.finished && !r.steps.length)));
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
    // the focus has a title of its own, like «Other areas» below it
    // A click on «Focus» shows the focus and only it: every focus area opens (its ⏳ pile closed),
    // every other area folds, the closed and waiting blocks close.
    if (areas.length) {
      const head = el.createDiv({ cls: "ft-rest-title ft-focus-title", text: t("focusTitle"), attr: { "aria-label": t("focusOnly") } });
      head.onclick = () => this.focusOnly(areas, rest);
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
    // What I am waiting for, from every area, on one shelf: soonest to look at first. It is not the
    // pile of what is not today — those rows read alike, and the shelf is where the difference lives.
    const waiting = p.waitingAll();
    const waitingCount = waiting.reduce((n, g) => n + g.tasks.length, 0);
    if (!none && p.waitingShown()) {
      const block = el.createDiv({ cls: "ft-waiting" });
      if (!waiting.length) block.createDiv({ cls: "ft-empty", text: t("waitingEmpty") });
      for (const g of waiting) {
        const head = block.createDiv({ cls: "ft-done-area" });
        head.createSpan({ cls: "ft-emoji", text: g.name.slice(0, g.name.length - bare(g.name).length).trim() });
        head.createSpan({ text: bare(g.name) || g.name });
        await this.list(block, g.tasks.map((task) => ({ kind: "task", task })), { area: { name: g.name }, pile: "waiting" });
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
      const wait = foot.createEl("button", { cls: "ft-foot-button ft-waiting-toggle" });
      wait.toggleClass("is-on", p.waitingShown());
      setIcon(wait.createSpan(), "play");
      wait.createSpan({ text: t("waitingButton") + (waitingCount ? ` · ${waitingCount}` : "") });
      wait.setAttr("aria-label", t("waitingShelf", waitingCount));
      wait.onclick = () => { pin(".ft-foot"); p.setWaitingShown(!p.waitingShown()); };
    }
    foot.createEl("button", { text: t("newArea"), cls: "ft-foot-button ft-new-area" }).onclick = () => p.newArea();
    // an area from a note of your own: the command «Area from a note» (no button: one «+ Area» is enough)
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
    this.swap(el, old);
  }

  // The built screen goes in. Someone started typing while it was being built: leave the screen as
  // it is and build again when they are done, or the row under the cursor would vanish mid-word.
  swap(el, old) {
    if (this.editing || this.controlPress) {
      this.removeChild(this.inner);
      this.inner = old;
      this.again = true;
      return;
    }
    const active = this.containerEl.getBoundingClientRect().width ? document.activeElement : null;
    const summaryKey=this.containerEl.contains(active)&&active?.matches?.(".ft-category-total,.ft-steps-more")?active.closest(".ft-category-picker")?.getAttribute("data-ft-category-key"):null;
    const hoverHost = this.containerEl.contains(active) ? active?.closest?.(".ft-hover-host") : null;
    const hoverKey = hoverHost?.getAttribute("data-ft-hover-key");
    const pointerFocus = hoverKey && hoverHost.getAttribute("data-ft-pointer-focus");
    const category = this.containerEl.contains(active) && active?.matches?.("button[data-ft-category]")
      ? { key: active.closest(".ft-supplement-switch")?.getAttribute("data-ft-category-key"), kind: active.getAttribute("data-ft-category") } : null;
    if (old) this.removeChild(old);
    // Ticking a box moves its row to «Completed» at the bottom, so everything below it shifts up. The
    // page must not move under the reader: a row that stays on screen is remembered, and after the
    // swap the scroll is nudged so that row keeps the same place in the window.
    const anchor = this.anchorRow();
    this.containerEl.addClass("focus-tasks-view");
    this.cancelMobilePress?.();
    this.containerEl.replaceChildren(...el.childNodes);
    this.items = this.fresh;
    this.paintMobileReordering();
    this.daySeen = today();
    this.keepPlace(anchor);
    // A narrow header expands on focus/hover. Losing its focused button during
    // replacement collapses that row and moves the controls away from the pointer.
    if (category) {
      const group = [...this.containerEl.querySelectorAll(".ft-supplement-switch")].find(g =>
        g.getAttribute("data-ft-category-key") === category.key && g.closest(".ft-category-host")?.getBoundingClientRect().width);
      const button = group && [...group.children].find(b => b.getAttribute("data-ft-category") === category.kind);
      if (button) { group.closest(".ft-category-picker")?.ftShow(); button.focus({ preventScroll: true }); }
    } else if(summaryKey){const picker=[...this.containerEl.querySelectorAll(".ft-category-picker")].find(x=>x.getAttribute("data-ft-category-key")===summaryKey);picker?.ftShow();picker?.querySelector(":scope > .ft-category-total,:scope > .ft-steps-more")?.focus({preventScroll:true});
    } else if (hoverKey) {
      const host=[...this.containerEl.querySelectorAll(".ft-hover-host")].find(x=>x.getAttribute("data-ft-hover-key")===hoverKey);
      if(pointerFocus)host?.setAttribute("data-ft-pointer-focus","1");host?.focus({preventScroll:true});
    }
    if(this.categoryOpen && this.containerEl.getBoundingClientRect().width){const picker=[...this.containerEl.querySelectorAll(".ft-category-picker")].find(x=>x.getAttribute("data-ft-category-key")===this.categoryOpen);
      if(picker)picker.ftShow();else this.categoryOpen=null;}
    this.paint();
    this.hold();
  }

  // A project's own page: the block at the bottom of its note. Every step of the project, the same
  // rows as in the list — today's, then the pile of what is not today (dimmed), then a line that
  // takes the next step, and the closed ones folded under «✓ Done · N». The note above the block is
  // the project's own: what it is about, its links; this is where the work stands.
  async buildIntentPage() {
    const p=this.plugin,list=p.intentOf(this.page.intent);
    if(!list?.isList){this.containerEl.empty();return;}
    const entries=p.intentEntries(list),active=entries.filter(x=>![STATUS_DONE,STATUS_CANCELLED,STATUS_SOMEDAY].includes(x.status)).sort(p.rowOrder());
    this.fresh=new WeakMap();this.pending=[];this.setAlarm();this.folds=[];
    const old=this.inner;this.inner=this.addChild(new Component());
    this.shown={areas:[list.area],tasks:{["intent:"+list.uid]:active.map(x=>x.uid)}};
    const el=createDiv(),body=el.createDiv({cls:"ft-page ft-intent-page"}),head=body.createDiv({cls:"ft-area-title ft-page-head"});
    head.createSpan({cls:"ft-project-icon",text:"📔"});const label=head.createSpan({cls:"ft-page-name ft-link",text:list.title});this.link(label,list.file);
    const area={name:list.area},project={...list,intentList:true,tasks:active,later:[]};
    this.track(head,{type:"project",area,project});
    if(!active.length){const box=head.createSpan({cls:"ft-box"}).createEl("input",{type:"checkbox",cls:"task-list-item-checkbox",attr:{"aria-label":t("listDone")}});
      box.checked=!!list.done;box.onclick=e=>{e.preventDefault();e.stopPropagation();if(head.hasClass("is-toggling"))return;head.addClass("is-toggling");
        (list.done?p.reopenIntentList(list):p.setProjectDone(list.file,true,list.uid)).catch(()=>{head.removeClass("is-toggling");new Notice(t("changed"));});};}
    const target={area:list.area,project:list.file.basename,projectFile:list.file,intentList:true,listUid:list.uid,noDate:true};
    this.plus(head,t("addIntent"),()=>target,()=>body.querySelector("li.ft-task:last-child")||head);
    this.more(head,menu=>this.projectMenu(menu,area,project,head));
    if(active.length)await this.list(body,active.map(task=>({kind:"task",task})),{area,all:true,pile:"intents"});
    const add=body.createDiv({cls:"ft-empty ft-empty-add",text:"+ "+t("addIntent")});add.onclick=()=>this.draft(body.querySelector("li.ft-task:last-child")||head,target);
    const done=entries.filter(x=>x.status===STATUS_DONE);
    if(done.length){const key="intent-done:"+list.uid,open=p.isShown(key,true);this.folds.push([key,true]);
      const shelf=body.createDiv({cls:"ft-page-done",text:t("doneButton")+" · "+done.length});shelf.onclick=async()=>{await p.toggleShown(key,true);p.refresh();};
      if(open)await this.completed(body.createDiv({cls:"ft-done-today"}),done);}
    this.swap(el,old);
  }

  async buildAreaPage() {
    const p = this.plugin;
    const file = this.page.area;
    const name = p.classify(file)?.area;
    const area = (await p.collect(true)).find((a) => a.name === name);
    this.fresh = new WeakMap();
    this.pending = area ? area.waiting : [];
    this.setAlarm();
    this.folds = [];
    const old = this.inner;
    this.inner = this.addChild(new Component());
    const el = createDiv();
    const box = el.createDiv({ cls: "ft-area-page ft-area is-rest" });
    this.shown = { areas: area ? [area.name] : [], tasks: {} };
    if (!area) {
      box.createDiv({ cls: "ft-empty", text: t("areaPageMissing", name || file.basename) });
      return this.swap(el, old);
    }
    this.shown.tasks["area:" + area.name] = area.rows.map(seatKey);
    for (const b of area.projects) this.shown.tasks["project:" + b.file.basename] = b.tasks.map((x) => x.uid);
    this.track(box, { type: "area", area });
    const head = box.createDiv({ cls: "ft-area-title ft-area-page-head" });
    this.track(head, { type: "area-title", area });
    const label = bare(area.name);
    const emoji = area.name.slice(0, area.name.length - label.length).trim();
    if (emoji && label) head.createSpan({ cls: "ft-emoji", text: emoji });
    head.createSpan({ cls: "ft-page-name", text: label || area.name });
    const counts = this.scopeFor(area.name);
    const focus = { key: "focusoff:" + area.name, inverted: true, count: counts.focus.length };
    const later = { key: "area-page-backlogoff:" + file.path, inverted: true, count: counts.backlog.length };
    const focusShown = p.categoryShown(focus), laterShown = p.categoryShown(later);
    const visible = this.scopeRows(area, focusShown, laterShown);
    this.supplements(head, { key: "intents:" + area.name, focus, later, presentation: counts.hasFocus ? "focus-area" : "backlog-area", count: this.ideaCount(p.read().intents.filter(x => x.isList && x.area === area.name), area.name) });
    const target = { area: area.name, project: null, noDate: true };
    const last = () => [...box.querySelectorAll(":scope > ul.ft-list > li")].pop() || head;
    this.plus(head, t("addToArea"), async () => this.creationView(target, "intents:" + area.name, focus, later), last);
    this.more(head, (menu) => this.areaMenu(menu, area));
    if (visible.rows.length) await this.list(box, visible.rows, { area, all: true, pile: "focus", focusVisible: focusShown, backlogDefault: laterShown });
    if (visible.ahead.length) await this.ahead(box.createDiv({ cls: "ft-future-block" }), visible.ahead, area, { all: true, focusVisible: focusShown, backlogDefault: laterShown });
    const add = box.createDiv({ cls: "ft-empty ft-empty-add", text: "+ " + t("addTask") });
    add.onclick = async () => this.draft(last(), await this.creationView(target, "intents:" + area.name, focus, later));
    await this.intentsBlock(box, area.name);
    if (area.waiting.length) {
      const key = "waiting:area:" + file.path, open = p.isShown(key, true);
      const head = box.createDiv({ cls: "ft-page-done ft-page-waiting", text: `${t("waitingButton")} · ${area.waiting.length}` });
      head.setAttr("aria-expanded", String(open));
      head.onclick = async () => { await p.toggleShown(key, true); p.refresh(); };
      if (open) await this.list(box.createDiv({ cls: "ft-waiting" }), area.waiting.map(task => ({ kind: "task", task })), { area, pile: "waiting" });
    }
    const done = p.tasks().filter((x) => x.status === STATUS_DONE && x.area === area.name)
      .sort((x, y) => String(y.doneDate || "").localeCompare(String(x.doneDate || "")) || collator()(x.text, y.text));
    if (done.length) {
      const key = "area-page-done:" + file.path;
      const open = p.isShown(key, true);
      const toggle = box.createDiv({ cls: "ft-page-done", text: `${t("doneButton")} · ${done.length}` });
      toggle.onclick = () => p.toggleShown(key, true);
      if (open) await this.completed(box.createDiv({ cls: "ft-done-today" }), done);
    }
    this.swap(el, old);
  }

  async buildPage() {
    const p = this.plugin;
    const path = this.page.project?.path;
    const areas = path ? await p.collect(false, true) : [];
    const area = areas.find((a) => a.projects.some((b) => b.file.path === path));
    const b = area?.projects.find((x) => x.file.path === path);
    this.fresh = new WeakMap();
    // a step sent off and due back at an hour today comes back on the page too, on the hour
    this.pending = b ? p.tasks().filter((x) => waitingBack(x) && x.project && p.projectFile(x)?.path === path) : [];
    this.setAlarm();
    this.folds = [];
    const old = this.inner;
    this.inner = this.addChild(new Component());
    const el = createDiv();
    const box = el.createDiv({ cls: "ft-page" });
    if (!b) {
      this.shown = { areas: [], tasks: {} };
      box.createDiv({ cls: "ft-empty", text: this.page.kind === "area" ? t("areaPageMissing", this.page.missing || "")
        : this.page.missing ? t("pageMissing", this.page.missing) : t("pageNoProject") });
      return this.swap(el, old);
    }
    this.shown = { areas: [area.name], tasks: { ["project:" + b.file.basename]: [...b.tasks, ...b.later].map((x) => x.uid) } };
    // a step made here starts with no date (⌘1 while typing makes it today's): the page is where a
    // project is planned
    const target = { area: area.name, project: b.file.basename, projectFile: b.file, projectUid: b.uid, noDate: true };
    const lastRow = () => [...box.querySelectorAll(":scope > ul.ft-list > li.ft-task, :scope > .ft-future-block ul.ft-list > li.ft-task")].pop();
    // The block's own heading, so the steps stand apart from the note above: the project's row as
    // it is in the list — 📁 name, the ⏳ that folds its pile (open here by default), the «+».
    const head = box.createDiv({ cls: "ft-area-title ft-page-head" });
    head.createSpan({ cls: "ft-project-icon", text: "📁" });
    head.createSpan({ cls: "ft-page-name", text: b.file.basename });
    const intentKey = "project-intents:" + path;
    const counts = this.scopeFor(area.name, path);
    const focus = { key: "project-focusoff:" + path, onKey: "project-focuson:" + path, defaultOpen: true, count: counts.focus.length, available: counts.hasFocus };
    const later = { key: "later:" + path, projectPath: path, defaultOpen: true, count: counts.backlog.length };
    const ideasShown = p.isShown(intentKey, true);
    const pileShown = p.categoryShown(later);
    this.supplements(head, { key: intentKey, focus, later, count: this.ideaCount(p.projectIntentLists(b)) });
    this.plus(head, t("addStep"), async () => this.creationView(target, intentKey, focus, later), () => lastRow() || head);
    if (counts.focus.length && p.categoryShown(focus)) await this.list(box, counts.focus.map((task) => ({ kind: "task", task })), { area, pile: "focus" });
    if (counts.backlog.length && pileShown) await this.ahead(box.createDiv({ cls: "ft-future-block" }), counts.backlog.map((task) => ({ kind: "task", task })), area);
    if (ideasShown) await this.projectIntentsBlock(box, area.name, b);
    // «+ Step in this project»: a row typed in place under the last one
    const add = box.createDiv({ cls: "ft-empty ft-empty-add ft-page-add", text: "+ " + t("addStep"), attr: { "aria-label": t("addStep") } });
    add.onclick = async () => {
      await this.creationView(target, intentKey, focus, later);
      const last = lastRow();
      this.draft(last || add, target);
      if (!last) add.remove();
    };
    // what the project waits for, folded (per device) under «▷ Waiting · N»
    if (b.waiting.length) {
      const key = "waiting:" + path;
      const open = p.isShown(key, true);
      const head = box.createDiv({ cls: "ft-page-done ft-page-waiting" });
      head.toggleClass("is-on", open);
      setIcon(head.createSpan({ cls: "ft-page-done-icon" }), open ? "chevron-down" : "play");
      head.createSpan({ text: `${t("waitingButton")} · ${b.waiting.length}` });
      head.onclick = async () => { await p.toggleShown(key, true); p.refresh(); };
      if (open) await this.list(box.createDiv({ cls: "ft-waiting" }), b.waiting.map((task) => ({ kind: "task", task })), { area, pile: "waiting" });
    }
    // the closed steps, all of them, newest first; folded (per device) under «✓ Done · N»
    const done = p.tasks().filter((x) => x.status === STATUS_DONE && x.project && p.projectFile(x)?.path === path)
      .sort((x, y) => String(y.doneDate || "").localeCompare(String(x.doneDate || "")) || collator()(x.text, y.text));
    if (done.length) {
      const key = "done:" + path;
      const open = p.isShown(key, true);
      const head = box.createDiv({ cls: "ft-page-done" });
      head.toggleClass("is-on", open);
      setIcon(head.createSpan({ cls: "ft-page-done-icon" }), open ? "chevron-down" : "check");
      head.createSpan({ text: `${t("doneButton")} · ${done.length}` });
      head.onclick = async () => { await p.toggleShown(key, true); p.refresh(); };
      if (open) await this.completed(box.createDiv({ cls: "ft-done-today" }), done);
    }
    this.swap(el, old);
  }

  // Phone progress follows the next visible action, including a step becoming a project's first
  // action. Desktop browsing keeps the first visible row in place, even when a lower row is ticked.
  anchorRow() {
    const scroller = this.scroller;
    if (!scroller) return null;
    const top = scroller.getBoundingClientRect().top;
    const rows = this.rows();
    const toggling = Platform.isMobile ? rows.findIndex(([el]) => el.hasClass("is-toggling")) : -1;
    const candidates = toggling < 0 ? rows : [...rows.slice(toggling + 1), ...rows.slice(0, toggling)];
    for (const [el, task] of candidates) {
      if (el.hasClass("is-toggling")) continue;
      const box = el.querySelector(":scope > .ft-box");
      const y = (box?.offsetWidth ? box : el).getBoundingClientRect().top;
      const uid = this.items?.get(el)?.task?.uid || task.uid;
      if (y >= top - 1 && y <= top + scroller.clientHeight) return { uid, offset: y - top, scrollTop: scroller.scrollTop };
    }
    return { uid: null, offset: 0, scrollTop: scroller.scrollTop };
  }

  // Puts the remembered row back where it was; with nothing to steer by, at least the raw position
  // is kept (emptying the container alone would clamp it to the top).
  keepPlace(anchor) {
    const scroller = this.scroller;
    if (!anchor || !scroller) return;
    if (anchor.uid) {
      const row = this.rows().find(([el, task]) => task.uid === anchor.uid || this.items?.get(el)?.task?.uid === anchor.uid);
      if (row) {
        const box = row[0].querySelector(":scope > .ft-box");
        const point = box?.offsetWidth ? box : row[0];
        const drift = point.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
        if (Math.abs(drift) > 1) scroller.scrollTop += drift;
        return;
      }
    }
    if (Math.abs(scroller.scrollTop - anchor.scrollTop) > 1) scroller.scrollTop = anchor.scrollTop;
  }

  // The task rows on screen, top down: [row, task].
  // A task row stands for its task; a project's row stands for the project — a handle with the
  // project's own identity and date, so that selecting the row and giving it a day dates the
  // project, not its first step.
  rows() {
    return [...this.containerEl.querySelectorAll("li.ft-task[data-ft]")].map((el) => [el, this.handleOf(this.items?.get(el))]).filter(([, x]) => x);
  }

  handleOf(item) {
    if (!item) return null;
    if (item.type !== "project") return item.task || null;
    const b = item.project;
    if (b.intentList) return item.task || null;
    return (b.handle ||= { uid: "p:" + b.file.path, isProject: true, project: b, area: item.area, file: b.file, text: b.file.basename, date: b.date || null, at: null, status: STATUS_OPEN });
  }

  // The selected tasks alone, without project handles.
  tasksChosen() { return this.chosen().filter((x) => !x.isProject); }

  // The selected tasks in screen order.
  // (a project's later step can be on screen twice — under its row and in the area's pile — and is one task)
  chosen() {
    const seen = new Set();
    return this.rows().map(([, x]) => x).filter((x) => this.selected.has(x) && !seen.has(x.uid) && seen.add(x.uid));
  }

  // Shift-click: every row from the anchor to this one (with Cmd/Ctrl too: added to the selection);
  // Cmd/Ctrl-click (or Shift with nothing clicked before): this row in or out.
  select(task, e) {
    this.touch = (this.touch || 0) + 1;
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
      const was = this.selectedOf(task);
      if (was) this.selected.delete(was);
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
    this.touch = (this.touch || 0) + 1;
    if (picking(e)) return this.select(task, e);
    if (this.selected.size === 1 && this.selectedOf(task)) return this.clearSelection();
    this.mark(task);
  }

  // The selected object for this task, whatever render it came from: a row rebuilt between two
  // clicks carries a new object for the same note, and the selection is about the note.
  selectedOf(task) {
    for (const x of this.selected) if (keyOf(x) === keyOf(task)) return x;
    return null;
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
  // A project's row: its step's text, or the project's name when the row has no step.
  editSelected() {
    const chosen = this.chosen();
    const x = chosen.find((y) => this.cursor && keyOf(y) === keyOf(this.cursor)) || chosen[0];
    const row = x && this.rows().find(([, y]) => y === x)?.[0];
    if (!row) return;
    const text = row.querySelector(":scope > .ft-text, :scope > .ft-line > .ft-text");
    if (!x.isProject) { if (text) this.editInline(x, text, null); return; }
    const item = this.items.get(row);
    if (item?.task && text) this.editInline(item.task, text, null);
    else this.renameProject(row, x.area, x.project);
  }

  // ⌘Enter: the note of the row under the cursor opens — a task's own, or the project's.
  openSelected() {
    const chosen = this.chosen();
    const x = chosen.find((y) => this.cursor && keyOf(y) === keyOf(this.cursor)) || chosen[0];
    if (!x) return;
    this.clearSelection();
    this.open(x.file, null, null, x.isProject ? x.file : null);
  }

  // ⌫: the selected rows go to the trash; the notice (or ⌘Z) puts them back.
  // A selected project's row goes with its tasks, as its menu's «Delete» does — with «Undo», no question.
  async deleteSelected() {
    const chosen = this.chosen();
    const projects = chosen.filter((x) => x.isProject);
    const inside = new Set(projects.map((h) => h.file.path));
    const tasks = chosen.filter((x) => !x.isProject && !(x.project && inside.has(this.plugin.projectFile(x)?.path)));
    this.clearSelection();
    for (const h of projects) await this.plugin.removeProject(h.area, h.project, true);
    if (tasks.length) await this.plugin.removeTasks(tasks);
  }

  // ⌘Z: the last change taken back, and the rows it touched selected, so the keys go on from there
  // — the row ⌘2 just sent away is back under the cursor.
  async undo() {
    const last = (this.plugin.history || []).at(-1);
    const uids = last ? last.snap.map((x) => /^uid:\s*(\S+)/m.exec(x.text || "")?.[1]).filter(Boolean) : [];
    if (!(await this.plugin.undo()) || !uids.length) return;
    // the rows come back a beat later; a selection made by hand in the meantime is newer and wins
    const touch = this.touch || 0;
    await this.cachedAll(uids);
    await this.rerendered();
    if ((this.touch || 0) !== touch) return;
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
  // Mod+4 no date, Mod+5 «Waiting…», Mod+D a copy (as in the editor); with nothing selected they switch tabs. Esc drops the
  // selection. A menu, a
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
    // A handler bound to a key ends Obsidian's search whatever it returns, so a key that is not ours
    // is handed on by hand: ⌘1…9 then switch tabs, ⌘F searches the note, as everywhere else.
    const pass = (ev, ctx) => this.plugin.app.scope.handleKey(ev, ctx);
    const day = (n) => moment().add(n, "days").format("YYYY-MM-DD");
    const run = { 1: () => this.dateSelection(day(0)), 2: () => this.dateSelection(day(1)), 3: () => this.pickDates(), 4: () => this.dateSelection(null),
      5: () => this.askReturn(this.tasksChosen()), d: () => this.duplicateSelected() };
    for (const [key, fn] of Object.entries(run)) {
      this.scope.register(["Mod"], key, (ev, ctx) => {
        if (this.editing || !this.selected.size) return pass(ev, ctx);   // nothing of ours: the app's key
        fn();
        return false;
      });
    }
    // ⌘Z belongs to whatever is in front. Here it undoes the last change to the list; anywhere else
    // — a note, another pane — this scope is not pushed at all and the key never reaches us.
    this.scope.register(["Mod"], "z", (ev, ctx) => {
      // in a note the key is the note's own unless rows are selected: the block is a guest there
      if (this.editing || (!this.leaf && !this.selected.size)) return pass(ev, ctx);
      this.undo();
      return false;
    });
    this.scope.register([], "Escape", (ev, ctx) => {
      if (this.editing || !this.selected.size) return pass(ev, ctx);  // the picker's own Esc, or nothing to clear
      this.clearSelection();
      return false;
    });
    // With rows selected the keys work on them, as on a selected block in Notion: ↑/↓ walk (Shift
    // extends), Enter edits, ⌫ deletes. Not while something is typed in — the picker's field, say.
    const typing = () => { const a = document.activeElement; return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName)); };
    const own = (fn) => (ev, ctx) => {
      if (this.editing || !this.selected.size || typing()) return pass(ev, ctx);
      fn();
      return false;
    };
    this.scope.register([], "ArrowDown", own(() => this.walk(1, false)));
    this.scope.register([], "ArrowUp", own(() => this.walk(-1, false)));
    this.scope.register(["Shift"], "ArrowDown", own(() => this.walk(1, true)));
    this.scope.register(["Shift"], "ArrowUp", own(() => this.walk(-1, true)));
    this.scope.register([], "Enter", own(() => this.editSelected()));
    this.scope.register(["Mod"], "Enter", own(() => this.openSelected()));
    // ⌘F in the pane finds in the list; in a note with a block it stays the note's own search
    this.scope.register(["Mod"], "f", (ev, ctx) => {
      if (!this.leaf || this.editing || typing()) return pass(ev, ctx);
      this.find();
      return false;
    });
    for (const key of ["Backspace", "Delete"]) {
      this.scope.register([], key, own(() => this.deleteSelected()));
      this.scope.register(["Mod"], key, own(() => this.deleteSelected()));
    }
    keymap.pushScope(this.scope);
  }

  // ⌘D: a copy above each selected task; start editing the first copy in screen order.
  async duplicateSelected() {
    const touch = this.touch || 0;
    const copies = await this.plugin.duplicateTasks(this.tasksChosen());
    await this.editCopies(copies, touch);
  }

  async editCopies(copies, touch = this.touch || 0) {
    if (!copies?.length) return;
    const uids = copies.map((x) => x.uid);
    await this.cachedAll(uids);
    await this.rerendered();
    if ((this.touch || 0) !== touch || this.editing || this.held || this.unloaded) return;
    const findRow = () => this.rows().find(([el, x]) => x.uid === uids[0] || this.items.get(el)?.task?.uid === uids[0]);
    let row = findRow();
    // A Waiting copy is open work: its new shelf may be hidden even though its source was visible.
    if (!row) {
      await this.reveal({ kind: copies[0].intent ? "intent-task" : "task", uid: uids[0] }, false);
      if (this.editing || this.held || this.unloaded) return;
      row = findRow();
    }
    const task = row && (row[1].isProject ? this.items.get(row[0])?.task : row[1]);
    const text = row?.[0].querySelector(":scope > .ft-text, :scope > .ft-line > .ft-text");
    if (task && text) this.editInline(task, text, null);
  }

  // One date for the selected rows; the selection is done then. A selected project's row dates the
  // project itself, not a step of it.
  async dateSelection(day) {
    const chosen = this.chosen();
    this.clearSelection();
    if (chosen.length) await this.plugin.setDates(chosen, day);
  }

  // The picker for the selected rows, at the date of `task` (the top one by default).
  pickDates(task = this.chosen()[0]) {
    const row = this.rows().find(([, x]) => x === task)?.[0];
    const label = row?.querySelector(".ft-date");
    if (!label) return;
    row.scrollIntoView({ block: "nearest" });
    if (task.isProject) this.editProjectDate(task.project, label);
    else this.editDate(task, label);
  }

  // The picker for a project's own date. Set, it decides whether the project is in the focus; the
  // steps keep their days.
  editProjectDate(project, el) {
    if (this.editing) return;
    this.clearSelection();
    this.card(el, () => new DatePicker(el, project.date || null, async (day) => {
      await this.plugin.setProjectDate(project.file, day);
      this.editing = false;
      this.picker = null;
      this.render();
    }, () => {
      this.editing = false;
      this.picker = null;
      el.removeClass("is-active");
      this.render();
    }));
  }

  clearSelection() {
    this.touch = (this.touch || 0) + 1;
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
    this.releasePin?.();
    if (!this.pin) return;
    const { selector, y } = this.pin;
    this.pin = null;
    this.clearScrollReserve();
    const target = this.containerEl.querySelector(selector);
    const scroller = this.scroller;
    if (!target || !scroller || !this.containerEl.getBoundingClientRect().width) return;
    const fix = () => {
      if(!target.isConnected||!target.getBoundingClientRect().width){release();return;}
      const drift = target.getBoundingClientRect().top - y;
      if (Math.abs(drift) > 1) {
        const desired=scroller.scrollTop+drift,missing=desired-(scroller.scrollHeight-scroller.clientHeight);
        if(missing>1)this.reserveScroll(Math.ceil(missing)+1);
        scroller.scrollTop=desired;
      }
    };
    const release = () => {
      scroller.removeEventListener("scroll", fix);
      scroller.removeEventListener("wheel", release);
      scroller.removeEventListener("touchstart", release);
    };
    this.releasePin=release;
    fix();
    scroller.addEventListener("scroll", fix);
    scroller.addEventListener("wheel", release, { passive: true });
    scroller.addEventListener("touchstart", release, { passive: true });
    setTimeout(release, 1200);
  }

  clearScrollReserve() {
    if(!this.scrollReserve)return;
    this.containerEl.style.paddingBottom=this.scrollReserve.original;
    this.scrollReserve=null;
  }

  reserveScroll(extra) {
    const root=this.containerEl;
    if(!this.scrollReserve)this.scrollReserve={original:root.style.paddingBottom};
    root.style.paddingBottom=((parseFloat(getComputedStyle(root).paddingBottom)||0)+extra)+"px";
    if(!this.scrollReserveListeners){
      this.scrollReserveListeners=true;
      for(const event of ["wheel","touchmove"])this.registerDomEvent(this.scroller,event,()=>this.clearScrollReserve(),{passive:true});
      this.register(()=>this.clearScrollReserve());
    }
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
    const counts = this.scopeFor(area.name);
    const focus = { key: "focusoff:" + area.name, inverted: true, count: counts.focus.length };
    const later = { key: ((all || wide) ? "futureoff:" : "future:") + area.name, inverted: all || wide, count: counts.backlog.length };
    const intentKey = "intents:" + area.name;
    const focusShown = p.categoryShown(focus), futureShown = p.categoryShown(later);
    const visible = this.scopeRows(area, focusShown, futureShown);
    this.supplements(title, { key: intentKey, count: this.ideaCount(p.read().intents.filter(x => x.isList && x.area === area.name), area.name),
      focus, later, presentation: all ? "backlog-area" : "focus-area", expanded: open, unfold: async () => { if (!open) await p.toggleShown(key, all); } });
    this.plus(title, t("addToArea"), async () => this.creationView({ area: area.name, project: null, noDate: all }, intentKey, focus, later),
      () => [...box.querySelectorAll(":scope > ul.ft-list")].pop() || title);
    this.more(title, (menu) => this.areaMenu(menu, area));
    this.grip(title, { type: "area", area });
    if (!open) return;
    if (visible.rows.length) await this.list(box, visible.rows, { area, all, pile: "focus", focusVisible: focusShown, backlogDefault: futureShown });
    else if (all) {
      // «Empty» is the first row's placeholder: a click turns it into a new task being typed
      const empty = box.createDiv({ cls: "ft-empty ft-empty-add", text: t("empty"), attr: { "aria-label": t("addTask") } });
      empty.onclick = async () => {
        const draft = await this.draft(empty, { area: area.name, project: null, noDate: true });
        if (draft) empty.remove();
      };
    }
    if (visible.ahead.length) await this.ahead(box.createDiv({ cls: "ft-future-block" }), visible.ahead, area, { all, focusVisible: focusShown, backlogDefault: futureShown });
    await this.intentsBlock(box, area.name);
  }

  openIntent(intent = null, area = null, task = false) {
    if (this.editing || this.held) return;
    this.clearSelection(); this.editing = true;
    const modal = new IntentModal(this.plugin, intent, area, () => {
      this.editing = false; this.plugin.setIntentsShown(true); this.render();
    }, task);
    try { modal.open(); } catch (e) { this.editing = false; throw e; }
  }

  async intentsBlock(el, area) {
    const p = this.plugin, key = "intents:" + area;
    if (!p.isShown(key, true)) return;
    const block = el.createDiv({ cls: "ft-intents ft-future-block", attr: { "data-intent-area": area } });
    this.track(block, { type: "area-title", area: { name: area } });
    const defaults=p.areaDefaultIntentLists(area),defaultUids=new Set(defaults.map(x=>x.uid));
    const loose = p.read().intentTasks.filter(x => x.area === area && (p.unboundIntent(x) || defaultUids.has(x.listUid)));
    const activeLoose = loose.filter(x => ![STATUS_DONE, STATUS_CANCELLED, STATUS_SOMEDAY].includes(x.status)).sort(p.rowOrder());
    this.shown.tasks["intent:area:" + area] = activeLoose.map(x => x.uid);
    const renderLoose = async () => {
      const note=p.notes().find(n=>!n.project&&n.area===area)?.file;
      if(note) {
        const ul=block.createEl("ul",{cls:"contains-task-list ft-list"});
        await this.projectRow(ul,{kind:"project",project:{file:note,uid:"loose:"+area,title:t("intents"),intentList:true,looseIdeas:true,date:null},steps:activeLoose},{area:{name:area},pile:"intents",all:true});
        const body=ul.querySelector("li.ft-steps")||(!activeLoose.length?block:null);
        if(body)for(const list of defaults){const description=splitNote(await p.app.vault.cachedRead(list.file))[1];if(description.trim()){const context=body.createDiv({cls:"ft-intent-description"});await MarkdownRenderer.render(p.app,description,context,list.file.path,this.inner);this.bindMarkdownLinks(context,list.file.path);}}
      }
      const looseDone = loose.filter(x => x.status === STATUS_DONE);
      if (looseDone.length) await this.completed(block.createDiv({ cls: "ft-done-today" }), looseDone);
    };
    if (activeLoose.length) await renderLoose();
    const scoped = this.intentNotes.filter(x => x.area === area), closed = scoped.filter(x => p.closedIntentList(x));
    const lists = scoped.filter(x => !defaultUids.has(x.uid) && !p.closedIntentList(x)), order = p.data.order.tasks["intent-lists:" + area] || [];
    lists.sort((a, b) => { const ai=order.indexOf(a.uid), bi=order.indexOf(b.uid); return (ai<0?1e9:ai)-(bi<0?1e9:bi) || collator()(a.title,b.title); });
    this.shown.tasks["intent-lists:" + area] = lists.map(x => x.uid);
    const ul = block.createEl("ul", { cls: "contains-task-list ft-list" });
    for (const list of lists) {
      const entries = p.intentEntries(list), saved = p.data.order.tasks["intent:" + list.uid] || [];
      const rank = x => { const i=saved.indexOf(x.uid); return i<0?1e9:i; };
      entries.sort((a,b)=>rank(a)-rank(b)||collator()(a.text,b.text));
      const tasks = entries.filter(x=>![STATUS_DONE,STATUS_CANCELLED,STATUS_SOMEDAY].includes(x.status));
      const linkedProject = p.intentProjectFile(list);
      const project = { ...list, displayTitle: linkedProject ? linkedProject.basename + (list.projectDefault ? "" : " · " + list.title) : null, intentList: true, date: null, tasks, later: [] };
      this.shown.tasks["intent:" + list.uid] = tasks.map(x=>x.uid);
      await this.projectRow(ul, { kind: "project", project, steps: tasks }, { area: { name: area }, all: true, pile: "intents" });
      const row = [...ul.children].find(x=>x.getAttribute("data-intent-id")===list.uid), body = row?.nextElementSibling;
      if (body?.hasClass("ft-steps")) {
        const raw = await p.app.vault.cachedRead(list.file), description = splitNote(raw)[1];
        if (description.trim()) {
          const context=body.createDiv({ cls:"ft-intent-description" }); body.prepend(context);
          await MarkdownRenderer.render(p.app,description,context,list.file.path,this.inner); this.bindMarkdownLinks(context,list.file.path);
        }
        const done=entries.filter(x=>x.status===STATUS_DONE);
        if (done.length) {
          const doneKey="intent-done:"+list.uid, opened=p.isShown(doneKey,true);
          const toggle=body.createDiv({ cls:"ft-page-done",text:t("doneButton")+" · "+done.length });
          toggle.onclick=async()=>{ await p.toggleShown(doneKey,true);p.refresh(); };
          if(opened)await this.completed(body.createDiv({ cls:"ft-done-today" }),done);
        }
        if(!tasks.length) { const empty=body.createDiv({ cls:"ft-empty ft-empty-add",text:"+ "+t("intentEmpty") }); empty.onclick=()=>this.draft(row,{area,project:list.file.basename,projectFile:list.file,intentList:true,listUid:list.uid,noDate:true}); }
      }
    }
    await this.completedIntentLists(block, closed, "intent-lists-done:" + area);
    if (!activeLoose.length) await renderLoose();
    const add = block.createDiv({ cls: "ft-empty ft-empty-add ft-intents-add", text: "+ " + t("newIntentList") });
    add.onclick = () => p.newIntentList({ name: area });
  }

  async projectIntentsBlock(el, area, project) {
    const p = this.plugin, key = "project-intents:" + project.file.path;
    const lists = p.projectIntentLists(project);
    const block = el.createDiv({ cls: "ft-intents ft-project-intents", attr: { "data-intent-project": project.file.path } });
    const addEntry = async anchor => {
      if (this.editing || this.held) return;
      let list; this.editing = true;
      try { list = lists[0] || await p.ensureProjectIntentList(project); }
      finally { this.editing = false; }
      this.draft(anchor, { area, project: list.file.basename, projectFile: list.file, intentList: true, listUid: list.uid, noDate: true });
    };
    for (const list of lists.filter(x => !p.closedIntentList(x))) {
      this.track(block, { type: "project", area: { name: area }, project: { ...list, intentList: true } });
      const entries = p.intentEntries(list), order = p.data.order.tasks["intent:" + list.uid] || [];
      const rank = x => { const i = order.indexOf(x.uid); return i < 0 ? 1e9 : i; };
      const tasks = entries.filter(x => ![STATUS_DONE, STATUS_CANCELLED, STATUS_SOMEDAY].includes(x.status)).sort((a,b) => rank(a)-rank(b) || collator()(a.text,b.text));
      this.shown.tasks["intent:" + list.uid] = tasks.map(x => x.uid);
      const description = splitNote(await p.app.vault.cachedRead(list.file))[1];
      if (description.trim()) {
        const context = block.createDiv({ cls: "ft-intent-description" });
        await MarkdownRenderer.render(p.app, description, context, list.file.path, this.inner); this.bindMarkdownLinks(context, list.file.path);
      }
      if (tasks.length) await this.list(block, tasks.map(task => ({ kind: "task", task })), { area: { name: area }, pile: "intents", all: true });
      else {
        const ul = block.createEl("ul", { cls: "contains-task-list ft-list" });
        await this.projectRow(ul, { kind: "project", project: { ...list, intentList: true, date: null }, steps: [] }, { area: { name: area }, all: true, pile: "intents" });
      }
      const done = entries.filter(x => x.status === STATUS_DONE);
      if (done.length) {
        const doneKey = "intent-done:" + list.uid, opened = p.isShown(doneKey, true);
        const shelf = block.createDiv({ cls: "ft-page-done", text: t("doneButton") + " · " + done.length });
        shelf.onclick = async () => { await p.toggleShown(doneKey, true); p.refresh(); };
        if (opened) await this.completed(block.createDiv({ cls: "ft-done-today" }), done);
      }
    }
    await this.completedIntentLists(block, lists.filter(x => p.closedIntentList(x)), "project-intent-lists-done:" + project.file.path);
    const add = block.createDiv({ cls: "ft-empty ft-empty-add ft-intents-add", text: "+ " + t("addProjectIdea") });
    add.onclick = () => addEntry([...block.querySelectorAll('li.ft-task')].pop() || add);
  }

  async completedIntentLists(block, lists, key) {
    if (!lists.length) return;
    const p = this.plugin, opened = p.isShown(key, true);
    const shelf = block.createDiv({ cls: "ft-page-done ft-intent-lists-done", text: t("doneButton") + " · " + lists.length });
    shelf.onclick = async () => { await p.toggleShown(key, true); p.refresh(); };
    if (opened) await this.completed(block.createDiv({ cls: "ft-done-today" }), [], lists);
  }

  async revealIntent(item) {
    const p=this.plugin, task=item.kind==="intent-task" ? p.read().intentTasks.find(x=>x.uid===item.uid) : null;
    if (task && (p.unboundIntent(task) || p.areaDefaultIntentLists(task.area).some(x=>x.uid===task.listUid))) {
      if (this.page && (!this.page.area || p.classify(this.page.area)?.area !== task.area)) { const leaf=await p.openView();return leaf.view.renderer.revealIntent(item); }
      if (!(await p.collect(false)).some(a=>a.name===task.area)) {p.app.saveLocalStorage("focus-tasks-all","1");p.data.opened["area:"+task.area]=true;}
      delete p.data.folded["area:"+task.area];p.data.opened["intents:"+task.area]=true;p.data.opened["intent-loose-steps:"+task.area]=true;await p.saveFolds();await this.rerendered();
      const row=this.rows().find(([,x])=>x.uid===task.uid)?.[0];if(!row)return false;row.scrollIntoView({block:"center"});row.addClass("ft-found");setTimeout(()=>row.removeClass("ft-found"),1400);return true;
    }
    const list=p.read().intents.find(x=>x.isList && x.uid===(task?.listUid||item.uid));
    if(!list) {new Notice(t("findGone"));return false;}
    if(this.page && (!this.page.area || p.classify(this.page.area)?.area!==list.area)) {const leaf=await p.openView();return leaf.view.renderer.revealIntent(item);}
    const focused=(await p.collect(false)).some(a=>a.name===list.area);
    if(focused)delete p.data.folded["area:"+list.area];
    else {p.app.saveLocalStorage("focus-tasks-all","1");p.data.opened["area:"+list.area]=true;}
    p.data.opened["intents:"+list.area]=true;p.closeRelatedIntentScopes("intents:"+list.area);delete p.data.folded["steps:"+list.file.path];
    if(p.closedIntentList(list))p.data.opened["intent-lists-done:"+list.area]=true;
    p.saveFolds();
    await this.rerendered();
    const row=task ? this.rows().find(([,x])=>x.uid===task.uid)?.[0] : [...this.containerEl.querySelectorAll(".ft-intent-list-row")].find(e=>e.getAttribute("data-intent-id")===list.uid);
    if(!row)return false;
    row.scrollIntoView({block:"center"});row.addClass("ft-found");setTimeout(()=>row.removeClass("ft-found"),1400);return true;
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
      this.mobileMeta(li);
      li.oncontextmenu = (e) => {
        e.preventDefault();
        if (!li.isConnected) return;
        const menu = new Menu();
        menu.addItem((i) => i.setTitle(t("openInNote")).setIcon("file-text").onClick(() => this.open(task.file)));
        showMenu(menu, e);
      };
    }
    for (const note of projects) {
      const li = ul.createEl("li", { cls: "task-list-item ft-task ft-done ft-project-row" + (note.isList ? " ft-intent-list-row" : "") });
      if(note.isList)li.setAttr("data-intent-id",note.uid);
      const check = li.createSpan({ cls: "ft-box" }).createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
      check.checked = true;
      const back = (e) => { e.preventDefault(); e.stopPropagation(); this.plugin.setProjectDone(note.file, false, note.uid); };
      check.onclick = back;
      check.parentElement.onclick = (e) => { if (e.target !== check) back(e); };
      const name = li.createSpan({ cls: "ft-project-name" });
      name.createSpan({ cls: "ft-project-icon", text: note.isList ? "📔" : "📁" });
      this.link(name.createSpan({ cls: "ft-link", text: note.title || note.file.basename }), note.file);
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
      this.mobileMeta(li);
    }
  }

  // The project a row belongs to, faint beside its text; a click opens the project's note.
  projectTag(li, task) {
    const tag = li.createSpan({ cls: "ft-project-tag" });
    tag.createSpan({ cls: "ft-icon", text: task.intent ? "📔" : "📁" });
    const intent = task.intent && this.plugin.read().intents.find(x=>x.uid===task.listUid);
    tag.createSpan({ text: intent ? intent.title : task.project });
    const note = intent || this.plugin.notes().find((n) => n.project && n.file.basename === task.project);
    if (note) tag.onclick = (e) => { if (picking(e)) return; e.stopPropagation(); this.open(note.file, e); };
  }

  bindMarkdownLinks(text, source, pickRows = false) {
    for (const a of text.querySelectorAll("a.internal-link")) {
      const href = a.getAttr("data-href") || a.getAttr("href");
      if (!href) continue;
      a.addEventListener("click", e => {
        e.preventDefault();
        if (pickRows && picking(e)) return;
        e.stopPropagation(); this.openLink(href, source, e);
      });
      a.addEventListener("mouseover", e => this.plugin.app.workspace.trigger("hover-link", {
        event: e, source: "preview", hoverParent: this.inner, targetEl: a, linktext: href, sourcePath: source }));
    }
  }

  // A click on a row's text: a link inside it is left to itself, a task with a description opens as
  // a note, any other text goes into edit in place.
  textClick(task, text, e) {
    if (this.unloaded || !text.isConnected) return;
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
    // A [[link]] in the text opens its note. In a note's reading view Obsidian answers that click
    // itself; in the pane nobody does, and the link was dead. Opened the way a task's note is (never
    // over the pane itself), with the page preview on hover as anywhere else.
    this.bindMarkdownLinks(text, task.file.path, true);
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

  // The pile of what is not today. What is in other hands is not here: that has a shelf of its own
  // at the bottom — the two read alike and are nothing alike.
  async ahead(box, rows, area, extra = {}) {
    return this.list(box, rows, { area, pile: "ahead", ...extra });
  }


  // A counter on a header that folds a part of it: «⏳3» upcoming, «✓2» closed today.
  ideaCount(lists, area = null) {
    const loose = area ? this.plugin.read().intentTasks.filter(x => this.plugin.unboundIntent(x) && x.area === area && ![STATUS_DONE, STATUS_CANCELLED, STATUS_SOMEDAY].includes(x.status)).length : 0;
    return loose + lists.reduce((n, list) => n + this.plugin.intentEntries(list).filter(x => ![STATUS_DONE, STATUS_CANCELLED, STATUS_SOMEDAY].includes(x.status)).length, 0);
  }

  scopeFor(area, path = null) {
    return this.plugin.scopeTasks(this.scopeAreas?.find(x => x.name === area), path);
  }

  async creationView(target, key, focus, later) {
    if (target.intentList || target.intentLoose) return target;
    const projectDay = target.projectFile && this.plugin.classify(target.projectFile)?.date;
    const backlog = projectDay ? projectDay > today() : target.noDate;
    if (!this.plugin.categoryShown(backlog ? later : focus))
      await this.plugin.toggleSupplement(key, backlog ? "backlog" : "focus", later, focus);
    return target;
  }

  scopeRows(area, focus, backlog) {
    const scope = this.scopeAreas.find(x => x.name === area.name) || area;
    const projectVisible = (row, ahead = false) => {
      const path = row.project.file.path, counts = this.scopeFor(area.name, path);
      const focusShown = this.plugin.categoryShown({ key: "project-focusoff:" + path, onKey: "project-focuson:" + path, defaultOpen: focus });
      const backlogShown = this.plugin.categoryShown({ key: "later:" + path, projectPath: path, defaultOpen: backlog });
      return (!ahead && (focus || focusShown)) || ((backlog || backlogShown) && (counts.backlog.length > 0 || (ahead && !counts.focus.length)))
        || this.plugin.isShown("project-intents:" + path, true)
        || this.plugin.isShown("project-header:" + path, true);
    };
    const rows = scope.rows.filter(r => r.kind === "project" ? projectVisible(r) : focus);
    const paths = new Set(rows.filter(r => r.kind === "project").map(r => r.project.file.path));
    // A project has one header, even when both of its task categories are visible.
    const ahead = scope.ahead.filter(r => r.kind === "task" ? backlog : !paths.has(r.project.file.path)
      && projectVisible(r, true));
    return { rows, ahead };
  }

  controlPressEvents() {
    if (!this.controlPressListeners) {
      this.controlPressListeners = true;
      const release = (event) => {
        const pressed = this.controlPress;
        const frozen = this.pressFocusHost;
        if (!pressed && !frozen) return;
        clearTimeout(this.controlReleaseTimer);
        this.controlReleaseTimer = setTimeout(() => {
          if (this.controlPress !== pressed) return;
          this.controlPress = null;
          frozen?.removeClass("ft-press-focus");
          if (this.pressFocusHost === frozen) this.pressFocusHost = null;
          if (this.again && !this.unloaded) this.render();
        // Pointerup can precede the compatibility mouseup/click by another
        // browser task. Keep the pressed DOM node until click has been handled;
        // cancellation/outside release has a bounded fallback.
        }, event?.type === "pointerup" ? 600 : 0);
      };
      for (const event of ["pointerup", "pointercancel", "blur"]) this.registerDomEvent(window, event, release);
      this.registerDomEvent(window, "click", release, true);
      this.registerDomEvent(this.containerEl, "pointerdown", (event) => {
        clearTimeout(this.controlReleaseTimer);
        // Keep every pressed target through click, including span controls and
        // links. render() still cancels a pending mobile gesture before queuing
        // a redraw, so this does not let an obsolete long press fire.
        this.controlPress = event.target;
        this.pressFocusHost?.removeClass("ft-press-focus");
        const active = document.activeElement;
        this.pressFocusHost = this.containerEl.contains(active) && active?.matches?.("button[data-ft-category]")
          ? active.closest(".ft-category-host") : null;
        // Default focus moves during pointerdown. Keep the former header's
        // height until click, so controls below it cannot move under the pointer.
        this.pressFocusHost?.addClass("ft-press-focus");
      }, true);
    }
  }

  supplements(head, { key, count = 0, later = null, focus = null, presentation = "project", expanded = true, unfold = null, onChoose = null, trigger = null, totalText = null, expandSteps = null }) {
    const p = this.plugin, ideas = p.isShown(key, true);
    const options = p.categoryChoices({count, later, focus, presentation});
    if(presentation==="project"&&!options.length)return;
    const total = (focus?.count || 0) + (later?.count || 0) + count;
    const picker = head.createSpan({cls:"ft-category-picker",attr:{"data-ft-category-key":key}});
    head.addClass("ft-category-host");
    if(presentation!=="project"){
      const label=head.querySelector(":scope > .ft-page-name")||head.querySelector(":scope > .ft-emoji + span:not(.ft-category-picker)");
      if(label){const caption=head.createSpan({cls:"ft-area-caption"});label.before(caption);caption.append(label,picker);}
    }
    const summary = trigger || picker.createEl("button",{cls:"ft-category-total"});
    if(trigger)picker.appendChild(trigger);
    if(totalText !== null || !trigger)summary.setText(totalText ?? (presentation === "project" ? "+" + total : String(total)));
    summary.setAttr("tabindex","0");summary.setAttr("role","button");
    const accessibleName=(element,label)=>{element.removeAttribute("aria-label");const id="ft-category-name-"+Math.random().toString(36).slice(2,11);picker.createSpan({cls:"ft-accessible-label",text:label,attr:{id}});element.setAttr("aria-labelledby",id);};
    accessibleName(summary,t("extraViews") + " · " + total);
    summary.setAttr("aria-expanded","false");
    const group=picker.createSpan({cls:"ft-supplement-switch ft-supplement-"+presentation,
      attr:{role:"group","data-ft-category-key":key}});
    let line = null, lines = null, host = null, caption = null, size = null, nameLink = null, row = null, tightHost = null;
    const place=()=>{
      // Categories replace the counter in the header's own flow.
      // A compact project's preview keeps its existing number of lines.
      if(line && lines){line.style.webkitLineClamp=String(lines);
        row=line.closest("li.ft-project-row");const margins=getComputedStyle(picker);row?.style.setProperty("--ft-category-width",(group.getBoundingClientRect().width+(parseFloat(margins.marginLeft)||0)+(parseFloat(margins.marginRight)||0)+2)+"px");
        nameLink=line.querySelector(":scope > .ft-project-name > .ft-link");const icon=line.querySelector(":scope > .ft-project-name > .ft-project-icon"),c=getComputedStyle(picker),i=icon&&getComputedStyle(icon);
        const reserved=(icon?.getBoundingClientRect().width||0)+(parseFloat(i?.marginRight)||0)+(parseFloat(c.marginLeft)||0)+(parseFloat(c.marginRight)||0)+parseFloat(getComputedStyle(line).fontSize);
        if(nameLink)nameLink.style.maxWidth=Math.max(0,line.clientWidth-group.getBoundingClientRect().width-reserved)+"px";
      }
      caption=picker.closest(".ft-area-caption");if(caption){const c=getComputedStyle(picker);const minimum=group.getBoundingClientRect().width+parseFloat(c.marginLeft)+parseFloat(c.marginRight);caption.style.minWidth=minimum+"px";
        tightHost=caption.closest(".ft-area-title");if(tightHost){tightHost.removeClass("ft-categories-tight");const h=getComputedStyle(tightHost),others=[...tightHost.children].filter(e=>e!==caption&&!['absolute','fixed'].includes(getComputedStyle(e).position));const used=others.reduce((n,e)=>{const s=getComputedStyle(e);return n+e.getBoundingClientRect().width+(parseFloat(s.marginLeft)||0)+(parseFloat(s.marginRight)||0);},0);tightHost.toggleClass("ft-categories-tight",tightHost.clientWidth-parseFloat(h.paddingLeft)-parseFloat(h.paddingRight)-used<minimum);}
      }
    };
    const show=()=>{
      if(!picker.isConnected || !picker.getBoundingClientRect().width || this.editing || this.held || !options.length)return;
      this.closeCategoryPicker?.();clearTimeout(this.categoryCloseTimer);
      if(!picker.hasClass("is-open")){
        host=picker.closest("li.ft-task,.ft-mobile-project-caption,.ft-area-title")||head;head.addClass("ft-category-measure");const style=getComputedStyle(host),signature=[host.getBoundingClientRect().width,style.fontSize].join(":");if(!size||size.signature!==signature)size={signature,height:host.getBoundingClientRect().height};const padding=style.boxSizing==="border-box"?0:[style.paddingTop,style.paddingBottom,style.borderTopWidth,style.borderBottomWidth].reduce((n,x)=>n+(parseFloat(x)||0),0);host.style.height=Math.max(0,size.height-padding)+"px";
        head.removeClass("ft-category-measure");line=picker.closest(".ft-line");
        if(line){const r=line.getBoundingClientRect(),h=parseFloat(getComputedStyle(line).lineHeight);lines=Math.max(1,Math.round(r.height/h));line.style.height=r.height+"px";line.style.overflow="hidden";}
      }
      picker.addClass("is-open");summary.setAttr("aria-expanded","true");this.categoryOpen=key;
      this.closeCategoryPicker=()=>{this.releasePin?.();picker.removeClass("is-open");host?.style.removeProperty("height");tightHost?.removeClass("ft-categories-tight");caption?.style.removeProperty("min-width");nameLink?.style.removeProperty("max-width");row?.style.removeProperty("--ft-category-width");line?.style.removeProperty("-webkit-line-clamp");line?.style.removeProperty("height");line?.style.removeProperty("overflow");summary.setAttr("aria-expanded","false");if(this.categoryOpen===key)this.categoryOpen=null;};
      place();
    };
    const companion=()=>picker.closest("li.ft-project-row")?.querySelector(".ft-category-expand")?.matches(":hover,:focus");
    const leave=()=>{clearTimeout(this.categoryCloseTimer);this.categoryCloseTimer=setTimeout(()=>{
      if(picker.isConnected&&!picker.contains(document.activeElement)&&!companion()&&this.categoryOpen===key)this.closeCategoryPicker?.();
    },180);};
    summary.addEventListener("mouseenter",()=>{if(!Platform.isMobile)show();});
    picker.addEventListener("mouseleave",leave);group.addEventListener("mouseenter",()=>clearTimeout(this.categoryCloseTimer));
    let pointerOpen=null;
    summary.addEventListener("pointerdown",()=>{pointerOpen=picker.hasClass("is-open");clearTimeout(this.controlReleaseTimer);this.controlPress=summary;});
    summary.addEventListener("focus",()=>{if(pointerOpen===null)show();});
    const oldClick=summary.onclick;
    summary.onclick=e=>{e.stopPropagation();const wasOpen=pointerOpen??picker.hasClass("is-open");pointerOpen=null;if(!Platform.isMobile&&oldClick)return oldClick(e);if(wasOpen)this.closeCategoryPicker?.();else show();};
    picker.addEventListener("mousedown",e=>e.stopPropagation());
    summary.addEventListener("keydown",e=>{if(summary.tagName!=="BUTTON" && (e.key==="Enter"||e.key===" ")){e.preventDefault();summary.onclick(e);}
      else if(e.key==="ArrowDown"){e.preventDefault();e.stopPropagation();show();group.querySelector("button")?.focus();}
      else if(e.key==="Escape"){e.preventDefault();e.stopPropagation();this.closeCategoryPicker?.();}});
    picker.addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();summary.focus();this.closeCategoryPicker?.();}});
    picker.addEventListener("focusout",()=>setTimeout(()=>{if(picker.isConnected&&!picker.contains(document.activeElement)&&!picker.matches(":hover")&&!companion()&&this.categoryOpen===key)this.closeCategoryPicker?.();},0));
    if(!this.categoryPickerListeners){
      this.categoryPickerListeners=true;
      this.registerDomEvent(document,"pointerdown",e=>{if(!e.target.closest?.(".ft-category-picker,.ft-category-expand"))this.closeCategoryPicker?.();},true);
      this.registerDomEvent(window,"resize",()=>this.closeCategoryPicker?.());
      this.registerDomEvent(this.scroller||this.containerEl,"scroll",()=>{const picker=[...this.containerEl.querySelectorAll(".ft-category-picker")].find(x=>x.getAttribute("data-ft-category-key")===this.categoryOpen);picker?.ftPlace();});
    }
    for(const {kind,n} of options){
      const enabled=kind==="intents"?ideas:p.categoryShown(kind==="focus"?focus:later),active=expanded&&enabled;
      const label=kind==="intents"?t("intents"):kind==="focus"?t("focusTitle"):t("backlog");
      const button=group.createEl("button",{cls:"ft-chip "+(kind==="intents"?"ft-intents-chip":kind==="focus"?"ft-focus-chip":"ft-later-chip"),
        attr:{"aria-pressed":String(!!active),title:label+" · "+n,"data-ft-category":kind}});
      accessibleName(button,label+" · "+n);
      button.toggleClass("is-on",!!active);button.toggleClass("is-off",!active);
      setIcon(button.createSpan({cls:"ft-chip-icon"}),kind==="intents"?"lightbulb":kind==="focus"?"crosshair":"clock");
      button.createSpan({cls:"ft-supplement-count",text:String(n)});
      button.addEventListener("pointerdown",()=>{clearTimeout(this.controlReleaseTimer);this.controlPress=button;});
      button.onclick=async e=>{e.stopPropagation();if(this.editing||this.held)return;this.clearSelection();
        this.pin={selector:'.ft-category-picker[data-ft-category-key="'+CSS.escape(key)+'"] button[data-ft-category="'+kind+'"]',y:button.getBoundingClientRect().top};
        const on=await p.toggleSupplement(key,kind,later,focus,!expanded);if(onChoose)onChoose(kind,on);if(on&&unfold)await unfold();p.refresh();};
    }
    if(expandSteps){const target=Platform.isMobile?group:(picker.closest("li.ft-project-row")||group);const more=target.createEl("button",{cls:"ft-category-expand",text:(expandSteps.open?"−":"+")+expandSteps.count,attr:{"aria-label":expandSteps.open?t("hideSteps"):t("moreSteps",expandSteps.count),title:expandSteps.open?t("hideSteps"):t("moreSteps",expandSteps.count)}});
      // Keep category buttons at the caption edge when the fold control disappears.
      if(Platform.isMobile)group.prepend(more);
      more.onclick=e=>{e.stopPropagation();expandSteps.run();};}
    picker.ftShow=show;picker.ftPlace=place;
    if(!options.length){summary.setAttr("aria-disabled","true");summary.removeAttribute("aria-haspopup");}
    return group;
  }

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

  // A mode belongs to this visible list, never to Sync or the next visit to the note.
  setMobileReordering(on) {
    if (!Platform.isMobile || (on && this.editing)) return;
    if (!!on === this.mobileReordering) return;
    if (!on) this.stopDrag?.();
    const anchor = this.anchorRow();
    this.mobileReordering = !!on;
    if (on) this.clearSelection();
    this.paintMobileReordering();
    this.keepPlace(anchor);
  }

  paintMobileReordering() {
    const on = Platform.isMobile && this.mobileReordering;
    this.containerEl.toggleClass("ft-reordering", on);
    this.containerEl.querySelector(":scope > .ft-reorder-bar")?.remove();
    if (!on) return;
    const bar = createDiv({ cls: "ft-reorder-bar", attr: { role: "toolbar", "aria-label": t("reordering") } });
    const label = bar.createDiv({ cls: "ft-reorder-label" });
    label.createSpan({ cls: "ft-reorder-title", text: t("reordering") });
    label.createSpan({ cls: "ft-reorder-hint", text: t("reorderHint") });
    bar.createEl("button", { cls: "ft-reorder-done", text: t("reorderDone"), attr: { type: "button" } }).onclick = () => this.setMobileReordering(false);
    this.containerEl.prepend(bar);
  }

  mobileReorderItem(menu) {
    if (!Platform.isMobile || this.editing) return;
    menu.addItem(i => i.setTitle(t(this.mobileReordering ? "reorderDone" : "reorder"))
      .setIcon(this.mobileReordering ? "check" : "grip-vertical")
      .onClick(() => this.setMobileReordering(!this.mobileReordering)));
    menu.addSeparator();
  }

  mobileGestures() {
    if (!Platform.isMobile) return;
    this.registerDomEvent(window, "pointerdown", e => {
      if (this.mobilePress && e.pointerId !== this.mobilePress.pointerId) this.cancelMobilePress?.();
    }, true);
    this.registerDomEvent(this.containerEl, "pointerdown", e => {
      this.cancelMobilePress?.();
      clearTimeout(this.mobileClickTimer);
      this.mobileSuppressClick = null;
      if (e.pointerType !== "touch" || !e.isPrimary || this.editing ||
          e.target.closest("a, button, input, textarea, [contenteditable=true], .ft-box, .ft-grip, .ft-date, .ft-running, .ft-priority, .ft-plus, .ft-more, .ft-chip, .ft-steps-more, .ft-category-picker, .ft-project-tag, .ft-place")) return;
      const row = e.target.closest("li.ft-task[data-ft], .ft-area-title[data-ft]");
      let item = row && this.items?.get(row);
      if (!item) return;
      if (item.type === "area-title") item = { ...item, type: "area" };
      if (item.type === "project" && item.task && e.target.closest(".ft-text")) item = { type: "task", task: item.task };
      const press = { row, pointerId: e.pointerId, x: e.clientX, y: e.clientY, fired: false };
      const fire = () => {
        if (press.fired || !row.isConnected || this.editing) return;
        press.fired = true;
        clearTimeout(timer);
        this.mobileSuppressClick = { row, until: Infinity };
        this.openMenu(item, { clientX: press.x, clientY: press.y }, row);
      };
      const move = ev => { if (ev.pointerId === press.pointerId && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 10) cancel(false); };
      const end = ev => { if (ev.pointerId === press.pointerId) cancel(false); };
      const cancel = (suppress = true) => {
        // Refresh/navigation can replace the row before release; ignore that gesture's click too.
        if (suppress && !press.fired) this.mobileSuppressClick = { row, until: Infinity, cancelled: true };
        clearTimeout(timer);
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", end, true);
        window.removeEventListener("pointercancel", end, true);
        if (this.mobilePress === press) this.mobilePress = null;
        if (this.cancelMobilePress === cancel) this.cancelMobilePress = null;
      };
      const timer = setTimeout(fire, 550);
      Object.assign(press, { fire });
      this.mobilePress = press;
      this.cancelMobilePress = cancel;
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", end, true);
      window.addEventListener("pointercancel", end, true);
    }, true);
    this.registerDomEvent(this.containerEl, "contextmenu", e => {
      if (this.held) { e.preventDefault(); e.stopPropagation(); return; }
      const skip = this.mobileSuppressClick;
      if (skip && Date.now() < skip.until && (skip.cancelled || skip.row.contains(e.target))) { e.preventDefault(); e.stopPropagation(); return; }
      if (!this.mobilePress) return;
      e.preventDefault(); e.stopPropagation();
      this.mobilePress.fire();
    }, true);
    this.registerDomEvent(this.containerEl, "click", e => {
      const skip = this.mobileSuppressClick;
      if (skip && Date.now() < skip.until && (skip.cancelled || skip.row.contains(e.target))) {
        e.preventDefault(); e.stopImmediatePropagation(); this.mobileSuppressClick = null;
      }
    }, true);
    const touchEnd = e => {
      const skip = this.mobileSuppressClick;
      if (skip && Date.now() < skip.until && (skip.cancelled || skip.row.contains(e.target))) {
        if (e.type === "touchend") { e.preventDefault(); e.stopPropagation(); }
        skip.until = Date.now() + 800;
        clearTimeout(this.mobileClickTimer);
        this.mobileClickTimer = setTimeout(() => { if (this.mobileSuppressClick === skip) this.mobileSuppressClick = null; }, 800);
      }
    };
    this.registerDomEvent(document, "touchend", touchEnd, { capture: true, passive: false });
    this.registerDomEvent(document, "touchcancel", touchEnd, true);
    this.registerDomEvent(document, "keydown", e => {
      if (e.key === "Escape" && this.mobileReordering && !document.querySelector(".menu, .modal, .ft-picker")) {
        this.setMobileReordering(false); e.preventDefault(); e.stopPropagation();
      }
    }, true);
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.hidden) { this.cancelMobilePress?.(); this.setMobileReordering(false); }
    });
  }

  target(item, x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || !this.containerEl.contains(el)) return null;
    let hit;
    if (item.type === "area") hit = el.closest(".ft-area[data-ft]");
    else {
      hit = el.closest(".ft-task[data-ft], .ft-area-title[data-ft], .ft-intents[data-ft]");
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
    // which list the row lands in: a drop into the pile or into today's list says the day too
    const pile = hit.matches(".ft-area-title") ? null : this.pileOf(hit);
    return { el: hit, target, into, after: !into && rel > 0.5, pile };
  }

  drag(e, item, grip) {
    if (e.button !== 0 || e.isPrimary === false || this.held || item.project?.looseIdeas) return;
    if (Platform.isMobile && !this.mobileReordering) return;
    e.preventDefault();
    e.stopPropagation();
    const row = item.type === "area" ? grip.closest(".ft-area") : grip.closest(".ft-project, .ft-task");
    // the grip of a selected row carries the whole selection
    const group = item.type === "task" && this.selected.has(item.task) && this.tasksChosen().length > 1;
    if (group) item = { ...item, tasks: this.tasksChosen() };
    const moving = group ? this.rows().filter(([, x]) => !x.isProject && this.selected.has(x)).map(([el]) => el) : [row];
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
        else if (item.type !== "area" && this.handleOf(item)) this.pick(this.handleOf(item), ev);
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
    if (task.status === STATUS_WAITING) {
      const run = li.createSpan({ cls: "ft-running" });
      const when = task.date ? this.dateText(task.date) + (task.at ? ` ${task.at}` : "") : null;
      run.setAttr("aria-label", when ? t("waitingSince", when) : t("waitingNoDate"));
      setIcon(run, "play");
      run.onclick = (e) => {
        e.stopPropagation();
        this.plugin.setWaiting(this.selected.has(task) && this.selected.size > 1 ? this.chosen() : task, false);
      };
    }
    // Priority is not a thing this list shows or sets. One mark only: `priority: low` is what a
    // robot leaves on a task it added — «not looked at yet». A click takes the mark off.
    if (String(task.priority || "").toLowerCase() === "low") {
      const dot = li.createSpan({ cls: "ft-priority is-low ft-bot" });
      dot.setAttr("aria-label", t("botMark"));
      dot.onclick = (e) => {
        e.stopPropagation();
        this.plugin.setPriority(this.selected.has(task) && this.selected.size > 1 ? this.tasksChosen() : task, null);
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

  dateLabel(el, task, prefix = null) {
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
    let hint = task.at ? `${full} ${task.at}` : full;
    let text;
    // A task still waiting to come back has a moment, not a due date: in the green of today's work it
    // read as work for today, in a group that is explicitly not today.
    if (waitingBack(task)) el.addClass("is-ahead");
    else el.addClass(task.date === now ? "is-today" : task.date < now ? "is-past" : "is-future");
    // Today says so, short and green: a row with nothing on the right read as a task with no date.
    if (task.date === now) {
      text = task.at ? `${t("todayShort")} ${task.at}` : t("todayShort");
    } else if (task.date < now) {
      // Late is said in words as well as in red: colour alone is not something everyone can read, and
      // the number of days is the ZFG signal that a task is stuck.
      const late = moment(now).diff(moment(task.date), "days");
      text = `${late}${t("daysShort")}${task.at ? ` ${task.at}` : ""}`;
      hint += ` · ${t("overdueBy", late)}`;
    } else text = task.at ? `${full} ${task.at}` : full;
    const state = this.plugin.calendarStatus(task, this.calendar);
    if (state) {
      const message = t(state === "synced" ? "calendarSynced" : state === "error" ? "calendarFailed" : state === "off" ? "calendarOff" : "calendarPending");
      const icon = el.createSpan({ cls: `ft-calendar-status is-${state}`, attr: { "aria-hidden": "true" } });
      setIcon(icon, state === "synced" ? "calendar-check" : state === "error" || state === "off" ? "calendar-x" : "calendar-clock");
      hint += ` · ${message}`;
    }
    el.createSpan({ cls: "ft-date-text", text: prefix ? t(prefix, text) : text });
    el.setAttr("aria-label", hint);
  }

  // Redraw as soon as one of the waiting tasks is due, and not a moment later.
  wake() {
    if (this.editing || this.held) { this.again = true; return; }
    if (this.daySeen !== today() || (this.pending || []).some(backDue)) this.render();
    else this.setAlarm(); // a distant return has entered the next hour since the last render
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
    // the row of the task itself, or the project's row that shows it as its step
    const row = this.rows().find(([el, x]) => x === task || this.items?.get(el)?.task === task)?.[0];
    return row?.querySelector(".ft-date") || row || null;
  }

  // Sending a task off is one question — when do I look at it again? The day is not optional: the
  // status is written together with it, so a running task can never be one that silently has no way
  // back. Cancel the card and nothing was changed at all.
  async askReturn(tasks, el = null) {
    const list = (Array.isArray(tasks) ? tasks : [tasks]).filter((x) => x && !x.isProject);
    // asked from the row's menu while its text is being edited: the editor closes (and saves) first
    if (this.editing) { if (!this.endEdit) return; await this.endEdit(true, false); }
    const anchor = el || this.rowLabel(list[0]);
    if (!list.length || !anchor || this.editing) return;
    const min = today();
    const returning = list.every(x => x.status === STATUS_WAITING);
    const days = [...new Set(list.map(x => x.date || null))];
    const clocks = [...new Set(list.map(x => x.at || null))];
    const was = returning ? (days.length === 1 && days[0] >= min ? days[0] : null) : today();
    const at = returning && clocks.length === 1 ? clocks[0] : null;
    this.anchor = list[0];
    this.card(anchor, () => new DatePicker(anchor, was, async (chosen, at) => {
      const change = returning && at === undefined ? list.filter(x => x.date !== chosen) : list;
      if (chosen && change.length && await (returning
        ? this.plugin.setDates(change, chosen, at)
        : this.plugin.setWaiting(change, true, chosen, at)) === false) return false;
      this.editing = false;
      this.picker = null;
      this.clearSelection();
      this.render();
    }, () => {
      this.editing = false;
      this.picker = null;
      anchor.removeClass("is-active");
      this.render();
    }, {
      title: t("returnWhen"), hint: t("returnHint"), tooEarly: t("returnTooSoon"), min, clear: false,
      // Editing an existing return preserves each hour, including a newer value received by Sync.
      // Sending open tasks off asks for a new return moment instead.
      time: true, futureClock: true, at, preserveTime: returning, mixedTime: returning && clocks.length > 1,
    }));
  }

  // The picker for the date of the row, or of every selected row when this is one of them.
  async editDate(task, el) {
    if (this.editing) { if (!this.endEdit) return; await this.endEdit(true, false); }
    if (this.editing) return;
    if (!this.selected.has(task)) this.clearSelection();
    const tasks = this.selected.size ? this.chosen() : [task];
    // A running task has no ordinary date: the day on it is the day it comes back, so the same click
    // asks that question again instead of offering «today / no date», which would strand it.
    if (tasks.every((x) => x.status === STATUS_WAITING)) return this.askReturn(tasks, el);
    const days = [...new Set(tasks.map((x) => x.date || null))];
    this.anchor = task;
    const clockTasks = tasks.filter(x => !x.isProject);
    const clocks = [...new Set(clockTasks.map(x => x.at || null))];
    const at = clocks.length === 1 ? clocks[0] : null;
    this.card(el, () => new DatePicker(el, days.length === 1 ? days[0] || today() : null, async (day, at) => {
      // An explicit clock edit must reach disk even when Sync changed the hour after this card
      // opened. Only an untouched clock can use the row's cached day to skip an unchanged gesture.
      const change = at !== undefined ? tasks : tasks.filter(x => (x.date || null) !== day);
      if (change.length && await this.plugin.setDates(change, day, at) === false) return false;
      this.editing = false;
      this.picker = null;
      this.clearSelection();
      this.render();
    }, () => {
      this.editing = false;
      this.picker = null;
      el.removeClass("is-active");
      this.render();
    }, { time: clockTasks.length > 0, at, mixedTime: clocks.length > 1, preserveTime: true, focusTime: !!at }));
  }

  // A card opens over the row: while it is up the list is «editing» (no re-render, no other keys).
  // The flags are set only once the card is there — a card that failed to open left the list frozen
  // for good, every click deaf, the selection stuck.
  card(el, make) {
    if (Platform.isMobile && this.mobileReordering) this.setMobileReordering(false);
    let picker;
    try { picker = make(); } catch (e) { console.error("Focus Tasks: the card did not open", e); return; }
    this.picker = picker;
    this.editing = true;
    el.addClass("is-active");
  }

  // Turns the text of a row into an editor: the raw markdown of the task, caret at the clicked
  // character (proportional when links render shorter than their source).
  editInline(task, el, e) {
    if (this.unloaded || !el.isConnected) return;
    if (Platform.isMobile && this.mobileReordering) this.setMobileReordering(false);
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
    const marker=el.querySelector(":scope > .ft-idea-mark");
    let editTarget=el;
    if(marker){el.replaceChildren(marker);editTarget=el.createSpan({cls:"ft-idea-editor",text:task.text});}
    else el.textContent = task.text;
    // Wiped and left — a click elsewhere, Enter, ⌘⌫ then away — the task is deleted, with the same
    // «Undo» a delete from the menu gets. Esc brings the text back untouched and selects the row.
    const saveText = async (value) => {
      if (!value) { await this.plugin.remove(task); return null; }
      if (value !== task.text && !await this.plugin.rename(task, value)) throw new Error(t("changed"));
      return task;
    };
    // The date changes at once and the label on the right follows; the text stays in edit. Unless
    // the new day takes the row out of this list (tomorrow from the focus, today from the pile):
    // then the text is saved, the row goes at once, and the editor moves on to the row that came
    // next — leaving the editor by hand just to see the row go was one step too many.
    const redate = async (day, close) => {
      const li = el.closest("li");
      const pile = this.pileOf(li);
      if (!await this.plugin.setDate(task, day)) return;
      const label = li?.querySelector(".ft-date");
      if (label) this.dateLabel(label, task);
      if (pile === "all" || pile === "intents" || this.inToday(task) === (pile === "focus")) return;
      const next = this.neighbour(li);
      await close(true, false);
      // the note is written, the cache is a beat behind: a render now would draw the old day (or,
      // mid-parse, no task at all) and the editor that opens next would hold that screen in place
      await this.cached(task, (x) => x.date === (day || null));
      await this.rerendered();
      // the task's own row, or the project's row that shows it as its step — fresh from the render
      const row = next && this.rows().find(([el, x]) => x.uid === next.uid || this.items.get(el)?.task?.uid === next.uid);
      const task2 = row && (row[1].isProject ? this.items.get(row[0])?.task : row[1]);
      const text2 = row?.[0].querySelector(":scope > .ft-text, :scope > .ft-line > .ft-text");
      if (task2 && text2) this.editInline(task2, text2, null);
    };
    const day = (n) => moment().add(n, "days").format("YYYY-MM-DD");
    this.editor(editTarget, Math.min(offset ?? task.text.length, task.text.length), saveText, {
      1: (close) => redate(day(0), close),
      2: (close) => redate(day(1), close),
      4: (close) => redate(null, close),
      // the picker takes the focus, so the text is saved first and the editor closes
      3: async (close) => {
        const label = el.closest("li")?.querySelector(".ft-date");
        await close(true, false);
        if (label) this.editDate(task, label);
      },
      // ⌘⌫: the whole task goes (to the trash, with «Undo»), not just its text; the editor moves up
      // to the row before it — the one after when this was the first
      Backspace: async (close) => {
        const li = el.closest("li");
        const prev = this.previous(li) || this.neighbour(li);
        await close(false, false);
        await this.plugin.remove(task);
        await this.cachedGone(task.uid);
        await this.rerendered();
        const row = prev && this.rows().find(([e, x]) => x.uid === prev.uid || this.items.get(e)?.task?.uid === prev.uid);
        const t2 = row && (row[1].isProject ? this.items.get(row[0])?.task : row[1]);
        const text2 = row?.[0].querySelector(":scope > .ft-text, :scope > .ft-line > .ft-text");
        if (t2 && text2) this.editInline(t2, text2, null);
      },
      // ⌘Enter: the text is saved and the task's note opens
      Enter: async (close) => {
        const saved = await close(true, false);
        const now = this.plugin.allTasks().find((x) => x.uid === task.uid) || saved || task;
        this.open(now.file);
      },
      // ⌘D: save the text, insert a copy above the row and move the editor into it.
      d: async (close) => {
        await close(true, false);
        const touch = this.touch || 0;
        const now = this.plugin.allTasks().find((x) => x.uid === task.uid) || task;
        const [copy] = await this.plugin.duplicateTasks([now]);
        await this.editCopies(copy ? [copy] : [], touch);
      },
      // ⌘5: hand the task off — the card asks when to look at it again
      5: async (close) => {
        const label = el.closest("li")?.querySelector(".ft-date");
        await close(true, false);
        this.askReturn(task, label);
      },
    // Enter on the «Waiting» shelf saves and stops: a new row there would be nobody's to wait for,
    // and it went straight to the focus
    }, this.pileOf(el.closest("li")) === "waiting" ? null : (anchor) => this.rowAfter(el.closest("li"), anchor, inFocus(task) ? today() : null), () => this.markSoon(task));
  }

  // Which list a row is in: today's focus, the area's pile of what is not today, or an area of
  // «Other areas», where everything is one list and nothing leaves it.
  pileOf(li) {
    if (li?.closest(".ft-intents")) return "intents";
    if (!li || li.closest(".ft-area.is-rest")) return "all";
    if (li.closest(".ft-waiting")) return "waiting";
    return li.closest(".ft-future-block, .ft-later-steps") ? "ahead" : "focus";
  }

  // Is the task today's work — the same answer collect() gives when it fills the focus.
  inToday(task) { return !waitingBack(task) && (inFocus(task) || task.status === STATUS_WAITING); }

  // The task of the row after this one (a project's row counts by the step it shows), or before it
  // when this is the last: where the editor goes when the row it was in leaves.
  neighbour(li) {
    const rows = this.rows();
    const i = rows.findIndex(([el]) => el === li);
    if (i < 0) return null;
    const mine = rows[i][1].uid;
    // the task whose text the row edits: its own, or the step a project's row shows (an open
    // project's row is the name alone — nothing to put a caret in)
    const editable = ([el, x]) => (x.isProject ? this.items?.get(el)?.task : x) || null;
    const ok = (pair) => pair[1].uid !== mine && !!editable(pair);
    const after = rows.slice(i + 1).find(ok);
    if (after) return editable(after);
    const before = rows.slice(0, i).reverse().find(ok);
    return before ? editable(before) : null;
  }

  // Waits (a moment, not forever) until the metadata cache shows the task the way it was just
  // written: `ok(fresh)` on the re-read task.
  async cached(task, ok, ms = 1500) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      this.plugin.forgetScan();
      const fresh = this.plugin.allTasks().find((x) => x.uid === task.uid);
      if (fresh && ok(fresh)) return;
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  // Until the task is gone from what the list reads (a deleted note), or the time is up.
  async cachedGone(uid, ms = 1500) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      this.plugin.forgetScan();
      if (!this.plugin.allTasks().some((x) => x.uid === uid)) return;
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  // The task whose text the row before `li` edits (a project's row counts by its step), or null.
  previous(li) {
    const rows = this.rows();
    const i = rows.findIndex(([el]) => el === li);
    if (i <= 0) return null;
    const mine = rows[i][1].uid;
    for (const [el, x] of rows.slice(0, i).reverse()) {
      const task = x.isProject ? this.items?.get(el)?.task : x;
      if (task && x.uid !== mine && el.querySelector(":scope > .ft-text, :scope > .ft-line > .ft-text")) return task;
    }
    return null;
  }

  // The same for several notes at once: until every one of them is read back, or the time is up.
  async cachedAll(uids, ms = 1500) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      this.plugin.forgetScan();
      const have = new Set(this.plugin.allTasks().map((x) => x.uid));
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
    this.mobileMeta(li);
    state.keys = { 1: () => set(ahead(0)), 2: () => set(ahead(1)), 4: () => set(null) };
    return state;
  }

  async rowAfter(prev, anchor, day) {
    prev=await this.projectDraftAnchor(prev,{projectFile:this.plugin.projectFile(anchor),area:anchor.area},anchor.uid);
    if(this.unloaded||this.editing||!prev?.isConnected)return;
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
  async projectDraftAnchor(anchor,target,afterUid=null) {
    const find=()=>[...this.containerEl.querySelectorAll("li.ft-project-row")].find(e=>{
      const item=this.items?.get(e);return target.intentLoose?item?.project?.looseIdeas&&item.area.name===target.area
        :target.projectFile&&item?.project?.file===target.projectFile;
    });
    const row=find(),item=row&&this.items?.get(row);
    if(!row||row.hasClass("is-open"))return anchor;
    if(row.hasClass("is-empty")){
      const tasks=item.project.looseIdeas?this.plugin.read().intentTasks.filter(t=>this.plugin.unboundIntent(t)&&t.area===item.area.name)
        :item.project.intentList?this.plugin.intentEntries(item.project):this.plugin.tasks().filter(t=>this.plugin.samePlace(t,item.project.file));
      if(!tasks.some(t=>![STATUS_DONE,STATUS_CANCELLED,STATUS_SOMEDAY].includes(t.status)&&!waitingBack(t)))return anchor;
    }
    const key=item.project.looseIdeas?"intent-loose-steps:"+item.area.name:"steps:"+item.project.file.path;
    await this.plugin.setOpen(key,true);
    await this.rerendered();
    const live=find(),body=live?.nextElementSibling?.hasClass("ft-steps")?live.nextElementSibling:null;
    const children=body&&[...body.querySelectorAll(":scope > ul.ft-list > li.ft-task")];
    return children?.find(e=>this.items?.get(e)?.task?.uid===afterUid)||children?.at(-1)||(anchor?.isConnected?anchor:live);
  }

  async draft(anchor, target) {
    if (this.editing||this.drafting) return;
    this.drafting=true;
    try{
      anchor=await this.projectDraftAnchor(anchor,target);
      if(this.unloaded||this.editing||!anchor?.isConnected)return;
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
        const saved=await this.plugin.addLine(target, value, date.day);
        if(!saved)throw Error(t("changed"));
        if(saved?.uid)await this.cachedAll([saved.uid]);
        return li;
      }, date.keys, (prev) => this.draft(prev, { ...target, day: date.day }),   // the next one starts where this one ended
      () => this.render());   // Esc keeps what was typed (an empty row goes)
      return holder;
    }finally{this.drafting=false;}
  }


  // The project's name becomes editable; Enter renames the note (links follow) and opens a row for
  // a new project right below.
  renameProject(head, area, project) {
    const name = head.querySelector(".ft-link");
    if (!name || this.editing) return;
    this.editor(name, (project.title || project.file.basename).length, async (value) => {
      if (value && value !== (project.title || project.file.basename)) {
        if(project.intentList)await this.plugin.renameIntentList(project,value);
        else await this.plugin.renameProject(project.file,value);
      }
      return head;
    }, {}, (prev) => project.intentList ? this.plugin.newIntentList(area) : this.projectDraft(prev, area, project.file.path));
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
    if (Platform.isMobile && this.mobileReordering) this.setMobileReordering(false);
    this.editing = true;
    let typed = false;   // any input at all — typed and erased again is still the browser's to undo
    el.addEventListener("input", () => { typed = true; });
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
      try {
        if (keep) result = await save(value);
        else el.closest(".ft-draft, .ft-draft-row")?.remove();
      } catch (e) {
        new Notice(t("saveFailed"));
        console.warn("Focus Tasks: editor save failed", e);
        if (!this.unloaded && el.isConnected) {
          done = false;
          this.endEdit = finish;
          this.scopes.add(scope);
          this.plugin.app.keymap.pushScope(scope);
          el.contentEditable = "true";
          el.addClass("is-editing");
          el.focus();
          return null;
        }
      }
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
      if (done || typed) return true;
      ev.preventDefault();
      finish(true, false).then(() => this.undo());
      return false;
    });
    this.plugin.app.keymap.pushScope(scope);
    this.endEdit = finish;
    el.onkeydown = (ev) => {
      // ⌘Enter belongs to the scope (Obsidian binds it app-wide and answers first): not a plain Enter
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); return; }
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
      if (!parent.isConnected) return;
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
    this.mobileReorderItem(menu);
    menu.addItem(i => i.setTitle("📔 " + t("intents")).onClick(async () => {
      const wide = p.everything();
      await p.toggleSupplement("intents:" + area.name, "intents", this.page?.area ? null : { key: (wide ? "futureoff:" : "future:") + area.name, inverted: wide });
      if(p.isShown("intents:"+area.name,true)) {delete p.data.folded["area:"+area.name];p.data.opened["area:"+area.name]=true;p.saveFolds();}
      p.refresh();
    }));
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
    if (project.looseIdeas) {
      menu.addItem(i=>i.setTitle(t("addIntent")).setIcon("plus").onClick(()=>p.addTask(null,{area:area.name,intentLoose:true,noDate:true})));
      return;
    }
    if (project.intentList) {
      this.mobileReorderItem(menu);
      menu.addItem(i => i.setTitle(t("addTask")).setIcon("plus").onClick(() => p.addTask(null, { area: area.name, project: project.file.basename, projectFile: project.file, intentList: true, listUid: project.uid })));
      if (head) menu.addItem(i => i.setTitle(t("rename")).setIcon("pencil").onClick(() => this.renameProject(head, area, project)));
      menu.addItem(i => i.setTitle(t("intentListPlace")).setIcon("folder-input").onClick(() => new TargetModal(p.app, p.notes().filter(n => !n.project).map(n => ({ label: n.area, area: n.area })), tg => p.moveIntentList(project, tg.area),false).open()));
      menu.addItem(i => i.setTitle(t("bindIntentProject")).setIcon("folder").onClick(() => new TargetModal(p.app,
        p.notes().filter(n => n.project).map(n => ({ label: `${n.area} › ${n.file.basename}`, project: n })),
        tg => p.bindIntentList(project, tg.project).catch(e => new Notice(e.message)), false).open()));
      if (project.projectUid || project.projectLink) menu.addItem(i => i.setTitle(t("unbindIntentProject")).setIcon("unlink").onClick(() => p.bindIntentList(project, null)));
      menu.addItem(i => i.setTitle(t("openInNote")).setIcon("file-text").onClick(() => this.open(project.file)));
      menu.addSeparator();
      menu.addItem(i => i.setTitle(t("deleteIntentList")).setIcon("trash-2").onClick(() => p.deleteIntentList(project)));
      return;
    }
    this.mobileReorderItem(menu);
    menu.addItem((i) => i.setTitle(t("addStep")).setIcon("plus").onClick(() => p.addTask(null, { area: area.name, project: project.file.basename })));
    menu.addItem(i=>i.setTitle(t("addIntent")).setIcon("lightbulb").onClick(async()=>{try{const list=await p.ensureProjectIntentList(project);p.addTask(null,{area:list.area,project:list.file.basename,projectFile:list.file,intentList:true,listUid:list.uid,noDate:true});}catch(e){new Notice(e.message);}}));
    menu.addItem(i => i.setTitle(t("projectToIntent")).setIcon("lightbulb").onClick(() => p.projectToIntentList(project, area.name).catch(e => new Notice(e.message))));
    if (head) menu.addItem((i) => i.setTitle(t("rename")).setIcon("pencil").onClick(() => this.renameProject(head, area, project)));
    if (head) menu.addItem((i) => i.setTitle(t("projectDate")).setIcon("calendar-days").onClick(() => {
      const label = head.querySelector(":scope > .ft-date") || head;
      this.editProjectDate(project, label);
    }));
    if (project.date) menu.addItem((i) => i.setTitle(t("projectNoDate")).setIcon("calendar-x").onClick(() => p.setProjectDate(project.file, null)));
    // Closing a project is the user's call, never the last box's: an emptied project waits for its
    // next step or for this. Only offered when nothing in it is open.
    if (!(project.tasks || []).length && !(project.later || []).length)
      menu.addItem((i) => i.setTitle(t("projectDone")).setIcon("check-circle").onClick(() => p.setProjectDone(project.file, true, project.uid)));
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
    // Obsidian's iOS hold timer can dispatch onto an old, detached row after a refresh.
    if (e.target && (!e.target.isConnected || !this.containerEl.contains(e.target))) return;
    if (this.selected.has(task) && this.selected.size > 1) return this.selectionMenu(task, e);
    const p = this.plugin;
    const day = (n) => moment().add(n, "days").format("YYYY-MM-DD");
    const menu = new Menu();
    this.mobileReorderItem(menu);
    // A running task has no ordinary date to set: the only day it has is the day it comes back.
    if (task.status === STATUS_WAITING) {
      menu.addItem((i) => i.setTitle(t("returnWhen") + "…").setIcon("calendar-clock").onClick(() => this.askReturn(task)));
    } else {
      menu.addItem((i) => i.setTitle(t("today")).setIcon("calendar-check").onClick(() => p.setDate(task, day(0))));
      menu.addItem((i) => i.setTitle(t("tomorrow")).setIcon("calendar-plus").onClick(() => p.setDate(task, day(1))));
      menu.addItem((i) => i.setTitle(t("noDate")).setIcon("calendar-x").onClick(() => p.setDate(task, null)));
    }
    menu.addSeparator();
    // A drag is not always possible — a finger loses to the scroll, a keyboard has no drag at all.
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t("moveUp")).setIcon("arrow-up").onClick(() => this.shift(task, -1)));
    menu.addItem((i) => i.setTitle(t("moveDown")).setIcon("arrow-down").onClick(() => this.shift(task, 1)));
    menu.addSeparator();
    this.priorityItems(menu, task);
    menu.addSeparator();
    this.progressItem(menu, task);
    menu.addItem((i) => i.setTitle(task.intent ? t("intentToList") : t("place")).setIcon("folder-input").onClick(() => p.placeTask(task)));
    if (task.intent) {
      menu.addItem(i => i.setTitle(t("intentToFocus")).setIcon("calendar-check").onClick(() => p.promoteIntentTask(task, today())));
      menu.addItem(i => i.setTitle(t("intentToBacklog")).setIcon("archive").onClick(() => p.promoteIntentTask(task, null)));
    } else {
      menu.addItem(i => i.setTitle(t("taskToIntent")).setIcon("lightbulb").onClick(() => p.moveTasks([task], { into: true, pile: "intents", target: { type: "area-title", area: { name: task.area } } })));
      menu.addItem((i) => i.setTitle(t("toProject")).setIcon("folder-plus").onClick(() => p.toProject(task)));
    }
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
    const running = list.length && list.every((x) => x.status === STATUS_WAITING);
    menu.addItem((i) => i
      .setTitle(running ? t("backToWork") : t("inProgress"))
      .setIcon(running ? "undo-2" : "play")
      .onClick(() => (running ? this.plugin.setWaiting(list, false) : this.askReturn(list))));
  }

  // The dot on a row is a mark, and a mark you cannot take off is a nuisance: every level, and
  // «no priority», are one click away — in the row's menu and on the dot itself.
  // The robot's mark comes off from the menu too — only offered while one of the rows carries it.
  priorityItems(menu, tasks) {
    const list = (Array.isArray(tasks) ? tasks : [tasks]).filter((x) => x && !x.isProject);
    if (!list.some((x) => String(x.priority || "").toLowerCase() === "low")) return;
    menu.addItem((i) => i.setTitle(t("botMarkOff")).setIcon("circle-slash").onClick(() => this.plugin.setPriority(list, null)));
  }

  // The menu of a selected row when there are several: one date for all of them.
  selectionMenu(task, e) {
    const day = (n) => moment().add(n, "days").format("YYYY-MM-DD");
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(t("selected", this.selected.size)).setIcon("list-checks").setDisabled(true));
    menu.addSeparator();
    const chosen = this.tasksChosen();
    if (chosen.length && chosen.every((x) => x.status === STATUS_WAITING)) {
      menu.addItem((i) => i.setTitle(t("returnWhen") + "…").setIcon("calendar-clock").onClick(() => this.askReturn(chosen)));
    } else {
      menu.addItem((i) => i.setTitle(t("today")).setIcon("calendar-check").onClick(() => this.dateSelection(day(0))));
      menu.addItem((i) => i.setTitle(t("tomorrow")).setIcon("calendar-plus").onClick(() => this.dateSelection(day(1))));
      menu.addItem((i) => i.setTitle(t("pickDate")).setIcon("calendar-days").onClick(() => this.pickDates(task)));
      menu.addItem((i) => i.setTitle(t("noDate")).setIcon("calendar-x").onClick(() => this.dateSelection(null)));
    }
    menu.addSeparator();
    this.priorityItems(menu, chosen);
    if(chosen.length && chosen.every(x=>x.intent)) {
      menu.addItem(i=>i.setTitle(t("intentToFocus")).setIcon("calendar-check").onClick(()=>this.plugin.promoteIntentTasks(chosen,today())));
      menu.addItem(i=>i.setTitle(t("intentToBacklog")).setIcon("archive").onClick(()=>this.plugin.promoteIntentTasks(chosen,null)));
    }
    if (chosen.length) { menu.addSeparator(); this.progressItem(menu, chosen); }
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t("clearSelection")).setIcon("x").onClick(() => this.clearSelection()));
    showMenu(menu, e);
  }

  // One step up or down among the rows it shares a list with (the steps of its project, or the loose
  // tasks of its area) — the same order a drag would write.
  async shift(task, by) {
    const list = this.rows().map(([, x]) => x).filter((x) => !x.isProject && listOf(x) === listOf(task));
    const i = list.findIndex((x) => x.uid === task.uid);
    const to = i + by;
    if (i < 0 || to < 0 || to >= list.length) return;
    const target = list[to];
    await this.plugin.track(t("aMove"), [task.file], () => this.plugin.reorder([task], { into: false, after: by > 0, target: { type: "task", task: target } }, this.shown?.tasks || {}));
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
    el.onclick = (e) => { if (!el.isContentEditable) this.open(this.plugin.linked(file) || file, e, null, this.plugin.classify(file) ? file : null); };
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
    if (task.intent) li.addClass("ft-idea-task");
    if (opts.level) li.style.setProperty("--ft-level", String(opts.level));
    if (!opts.all && !inFocus(task) && task.status !== STATUS_WAITING) li.addClass("is-later");
    // Sent off and not due back yet, seen in «All»: in its place, but quiet enough to read past. On
    // its own shelf it is the point of the list, and read like any row.
    if (waitingBack(task) && opts.pile !== "waiting") li.addClass("is-waiting");
    const box = li.createSpan({ cls: "ft-box" }).createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
    this.check(li, box, task);
    const text = await this.text(li, task);
    if (task.intent) {const marker=text.createSpan({cls:"ft-idea-mark",attr:{"aria-label":t("intents")}});setIcon(marker,"lightbulb");text.prepend(marker);}
    this.marks(li, task);
    const date = li.createSpan();
    this.dateLabel(date, task, opts.pile === "waiting" ? "until" : null);
    // on the shelf a step stands among loose tasks of other areas: its project is named, as in «Done»
    if (opts.pile === "waiting" && task.project) { this.projectTag(li, task); li.appendChild(date); }
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
    this.mobileMeta(li);
    this.hoverTools(li);
  }

  hoverTools(li) {
    if (Platform.isMobile) return;
    const controls=[...li.children].filter(e=>e.matches(".ft-plus,.ft-chip.is-quiet.is-off,.ft-date.is-empty,.ft-category-expand"));
    if (!controls.length) return;
    li.setAttr("tabindex","0");li.addClass("ft-hover-host");
    const item=this.items?.get(li)||this.fresh?.get(li);
    li.setAttr("data-ft-hover-key",item?.type==="project"?item.project.file.path:item?.task?.uid||"");
    controls.sort((a,b)=>Number(a.matches(".ft-category-expand"))-Number(b.matches(".ft-category-expand")));
    const tools=li.createSpan({cls:"ft-hover-tools"});for(const control of controls)tools.appendChild(control);
    tools.addEventListener("mouseenter",()=>{if(!this.editing&&!this.held){li.setAttr("data-ft-pointer-focus","1");li.focus({preventScroll:true});}});
    li.addEventListener("mouseleave",()=>{if(li.hasAttribute("data-ft-pointer-focus")){li.removeAttribute("data-ft-pointer-focus");if(document.activeElement===li)li.blur();}});
    tools.addEventListener("click",e=>e.stopPropagation());
  }

  // Mobile metadata gets its own wrapping row. Moving the actual controls preserves their actions,
  // selection and date-picker anchors; task text never competes with a time or a project tag.
  mobileMeta(li) {
    if (!Platform.isMobile) return;
    const controls = [...li.children].filter((el) => el.matches(".ft-date, .ft-running, .ft-priority, .ft-due, .ft-project-tag, .ft-place"));
    if (!controls.length) return;
    const meta = li.createSpan({ cls: "ft-mobile-meta" });
    for (const el of controls) meta.appendChild(el);
  }

  // A project as one row of the list: «📁 Name › its first step  +N  date». The box, the text, the
  // date, the ▷ and the priority are the step's — doing the project means doing that step; the name
  // is the project's (a click opens its note, a right click its menu); the grip drags the project.
  // +N opens the rest of this pile's steps under the row: then the row is the name alone and every
  // step is a row of its own, to tick, drag or edit. A project with no step left says so and takes
  // one on a click.
  async projectRow(ul, row, opts) {
    const p = this.plugin;
    const { project } = row;
    const area = opts.area;
    const key = project.looseIdeas ? "intent-loose-steps:" + area.name : "steps:" + project.file.path;
    const isList = !!project.intentList;
    const foldMode = project.looseIdeas || !isList;
    if (isList && row.steps.length) this.folds.push([key, !!foldMode]);
    const counts = isList ? null : this.scopeFor(area.name, project.file.path);
    const focus = { key: "project-focusoff:" + project.file.path, onKey: "project-focuson:" + project.file.path, defaultOpen: opts.focusVisible !== false, count: counts?.focus.length || 0, available: counts?.hasFocus };
    const later = { key: "later:" + project.file.path, projectPath: project.file.path, defaultOpen: opts.backlogDefault ?? (!!opts.all || opts.pile === "ahead"), count: counts?.backlog.length || 0 };
    const focusShown = p.categoryShown(focus), laterShown = p.categoryShown(later);
    const inBacklog = !isList && !counts.focus.length && opts.pile === "ahead";
    const steps = isList ? row.steps : inBacklog ? (laterShown ? counts.backlog : []) : (focusShown ? counts.focus : []);
    const headerOnly = !isList && !steps.length && (counts.focus.length > 0 || counts.backlog.length > 0 || (inBacklog ? !laterShown : !focusShown));
    const open = steps.length > 0 && p.isShown(key, foldMode);
    const step = open ? null : steps[0] || null;
    const li = ul.createEl("li", { cls: "task-list-item ft-task ft-project-row" });
    if (isList) { li.addClass("ft-intent-list-row"); li.setAttr("data-intent-id", project.uid); }
    if(project.looseIdeas)li.addClass("ft-loose-ideas-row");
    if (opts.level) li.style.setProperty("--ft-level", String(opts.level));
    li.toggleClass("is-open", open);
    li.toggleClass("is-empty", !steps.length);
    // The project's own date controls its focus membership and displayed date, before the step's.
    if (step && !opts.all && !inFocus(project.date ? project : step) && step.status !== STATUS_WAITING) li.addClass("is-later");
    if (step && waitingBack(step)) li.addClass("is-waiting");
    // Open, the row is a heading over its steps: no box to tick, and in the box's column a chevron
    // that folds them — the name stays where it was, so nothing jumps and «−N» sits by it as «+N» did.
    let box = null;
    if (open) {
      const fold = li.createSpan({ cls: "ft-box ft-fold", attr: { "aria-label": t("hideSteps") } });
      setIcon(fold, open ? "chevron-down" : "chevron-right");
      fold.onclick = async (e) => { e.stopPropagation(); await p.toggleShown(key, foldMode); p.refresh(); };
    } else if (headerOnly) {
      li.createSpan({ cls: "ft-box" });
    } else if (!step && project.looseIdeas) {
      li.createSpan({cls:"ft-box"});
    } else if (!step) {
      // No step to tick: the box closes the project itself — «Project done», one click, with Undo.
      // The row keeps the task rows' column, not one step in as if it were inside the task above.
      const cell = li.createSpan({ cls: "ft-box" });
      box = cell.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { "aria-label": t(isList ? "listDone" : "projectDone") } });
      const close = (e) => { e.preventDefault(); e.stopPropagation(); if(li.hasClass("is-toggling"))return;li.addClass("is-toggling");p.setProjectDone(project.file, true, project.uid).catch(error=>{li.removeClass("is-toggling");new Notice(t("changed"));console.warn("Focus Tasks: completion refused",error);}); };
      box.onclick = close;
      cell.onclick = (e) => { if (e.target !== box) close(e); };
    } else {
      box = li.createSpan({ cls: "ft-box" }).createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
      this.check(li, box, step);
    }
    // Name, «+N», «›» and the step are one line of text: a long one wraps back to the name's column,
    // not into a hanging column under the step (which read as a big indent inside the task).
    const line = li.createSpan({ cls: "ft-line" });
    const name = line.createSpan({ cls: "ft-project-name" });
    name.createSpan({ cls: "ft-project-icon", text: isList ? "📔" : "📁" });
    const label=name.createSpan({ cls: "ft-link", text: project.displayTitle || project.title || project.file.basename });
    if(project.looseIdeas)label.onclick=async e=>{e.stopPropagation();if(!steps.length)this.draft(li,{area:area.name,intentLoose:true,noDate:true});else{await p.toggleShown(key,foldMode);p.refresh();}};
    else this.link(label, project.file);
    const projectMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!li.isConnected) return;
      const menu = new Menu();
      this.projectMenu(menu, area, project, li);
      showMenu(menu, e);
    };
    name.oncontextmenu = projectMenu;
    const target = () => project.looseIdeas ? {area:area.name,project:null,intentLoose:true,noDate:true} : ({ area: area.name, project: project.file.basename, projectFile: project.file, projectUid: project.uid, noDate: opts.pile === "ahead" || !!opts.all, ...(isList ? { intentList: true, listUid: project.uid } : {}) });
    // where a new step's row opens: under the last step on screen, or right under this row
    const anchor = () => {
      const body = li.nextElementSibling?.hasClass("ft-steps") ? li.nextElementSibling : null;
      return body?.querySelector(":scope > ul.ft-list > li:last-child") || li;
    };
    // «+N» (or «−» when the steps are open) sits by the name: it is part of what the row says, and
    // it does not move when the row opens. The quiet controls — the ⏳ of the project's pile and the
    // «+» for a step, both under the pointer only — sit after the step, before the date, where their
    // hidden width is whitespace anyway.
    if (steps.length > 1 || (isList && steps.length > 0)) {
      const hidden = steps.slice(1);
      const extra = hidden.length || 1;
      const more = line.createSpan({ cls: "ft-steps-more",attr:{"data-ft-fold":"true"} });
      more.setText((open ? "−" : "+") + extra);
      more.toggleClass("is-open", open);
      // late steps behind the row must not hide behind it: the number turns red
      if (!open && hidden.some((x) => x.date && x.date < today() && !waitingBack(x))) more.addClass("is-late");
      more.setAttr("aria-label", isList ? t(open ? "listCollapse" : "listExpand") : open ? t("hideSteps") : t("moreSteps", hidden.length));
      more.onclick = async (e) => { e.stopPropagation(); await p.toggleShown(key, foldMode); p.refresh(); };
    }
    let text = null;
    if (step) {
      line.createSpan({ cls: "ft-sep", text: "›" });
      text = await this.text(line, step);
      this.marks(li, step);
    } else if (!open && !headerOnly) {
      line.createSpan({ cls: "ft-sep", text: "›" });
      text = line.createSpan({ cls: "ft-text ft-no-step", text: t(isList ? "addIntent" : "noStep") });
      text.onclick = (e) => { e.stopPropagation(); this.draft(anchor(), target()); };
    }
    // A project with a day of its own shows that day, not its step's: it is what keeps the project
    // in the focus or out of it. A click asks for another; the steps keep their days.
    const own = () => {
      const date = li.createSpan();
      this.dateLabel(date, { date: project.date, at: null, status: STATUS_OPEN });
      date.addClass("is-project");   // after dateLabel: it sets the classes afresh
      date.setAttr("aria-label", t("projectDated"));
      date.onclick = (e) => { if (picking(e)) return; e.stopPropagation(); this.editProjectDate(project, date); };
    };
    // What the project holds beside today's steps hangs off its own row, as off an area's header:
    // the ⏳ opens its pile of what is not today, right under the row. Quiet — under the pointer,
    // lit while open, the count in its tooltip. Not in the area's ⏳ pile, where the row is that pile.
    const intentKey = "project-intents:" + project.file.path;
    const ideasShown = !isList && p.isShown(intentKey, true);
    if (!isList) {
      const total=counts.focus.length+counts.backlog.length+this.ideaCount(p.projectIntentLists(project));
      let trigger=line.querySelector(".ft-steps-more");
      if(!trigger){trigger=name.parentElement.createSpan({cls:total>1?"ft-steps-more":"ft-category-total",text:total>1?"+"+Math.max(0,total-(step?1:0)):String(total)});name.after(trigger);}
      const parent=trigger.parentElement,before=trigger.nextSibling;
      const group=this.supplements(parent,{key:intentKey,count:this.ideaCount(p.projectIntentLists(project)),focus,later,trigger,
        expandSteps:steps.length>1?{open,count:steps.length-1,run:async()=>{await p.toggleShown(key,foldMode);p.refresh();}}:null});
      if(group){const picker=group.parentElement;if(before)parent.insertBefore(picker,before);}
      else trigger.remove();
    }
    // «+» adds a step and opens the pile, so the new row is not swallowed by +N the moment it is saved
    this.plus(li, t("addStep"), async () => this.creationView(target(), intentKey, focus, later), anchor);
    if (step) {
      if (project.date && !step.at) own();
      else {
        const date = li.createSpan();
        this.dateLabel(date, step);
        date.onclick = (e) => {
          if (picking(e)) return;
          e.stopPropagation();
          this.editDate(step, date);
        };
      }
      text.onclick = (e) => this.textClick(step, text, e);
      li.onclick = (e) => {
        if (e.target.closest("a, button, input, .ft-box, .ft-grip, .ft-date, .ft-project-name, .ft-steps-more, .ft-plus") || picking(e)) return;
        this.editInline(step, text, null);
      };
      li.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || !picking(e) || e.target.closest("a, button, input, .ft-grip")) return;
        e.preventDefault();
        this.select(step, e);
      });
      li.oncontextmenu = (e) => { e.preventDefault(); this.taskMenu(step, e); };
    } else {
      if (project.date) own();
      li.oncontextmenu = projectMenu;
    }
    this.track(li, { type: "project", area, project, task: step });
    if(!project.looseIdeas)this.grip(li, { type: "project", area, project, task: step });
    if (open) {
      const body = ul.createEl("li", { cls: "ft-steps" });
      await this.list(body, steps.map((task) => ({ kind: "task", task })), { ...opts, level: (opts.level || 0) + 1 });
    }
    // the project's pile of what is not today: its own list under the row (and under the open steps)
    if (!isList && !inBacklog && laterShown && counts.backlog.length) {
      const pile = ul.createEl("li", { cls: "ft-later-steps ft-future-block" });
      await this.ahead(pile, counts.backlog.map((task) => ({ kind: "task", task })), area, { level: (opts.level || 0) + 1 });
    }
    if (ideasShown) await this.projectIntentsBlock(ul.createEl("li", { cls: "ft-project-ideas-slot" }), area.name, project);
    if (Platform.isMobile) {
      // A collapsed project's context starts at the checkbox column; its action has the same text
      // column as every other task. Expanded headers reuse the same project caption.
      li.addClass(open || headerOnly ? "ft-mobile-project-header" : "ft-mobile-project");
      const caption = li.createSpan({ cls: "ft-mobile-project-caption" });
      caption.appendChild(name);
      const more = line.querySelector(".ft-category-picker,.ft-steps-more");
      if (more) caption.appendChild(more);
      line.querySelector(".ft-sep")?.remove();
      for (const control of li.querySelectorAll(":scope > .ft-plus, :scope > .ft-later-chip, :scope > .ft-category-picker")) caption.appendChild(control);
      if (open || headerOnly) line.remove();
    }
    this.mobileMeta(li);
    this.hoverTools(li);
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
    this.renderer = this.addChild(new FocusRenderer(this.plugin, this.contentEl.createDiv(), "", this.leaf));
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
    const calendar = new Setting(containerEl).setName(t("calendarTitle")).setDesc(t("calendarOff"));
    p.calendarState().then(state => {
      if (!state?.enabled) return;
      calendar.setDesc(t(p.calendarHasProblem(state) ? "calendarProblem" : "calendarOn"));
    });
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
    const ensureArea = file => {
      if (file && this.classify(file) && !this.classify(file).project)
        this.ensureAreaBlock(file).catch(e=>console.warn("Focus Tasks: cannot add the area's view",e));
    };
    this.registerEvent(this.app.metadataCache.on("changed", file => {
      this.forgetScan();
      if (file && file===this.app.workspace.getActiveFile?.()) ensureArea(file);
    }));
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      ensureArea(file);
    }));
    this.app.workspace.onLayoutReady?.(()=>ensureArea(this.app.workspace.getActiveFile?.()));
    this.registerView(VIEW_TYPE, (leaf) => new FocusView(leaf, this));
    this.registerObsidianProtocolHandler("focus-tasks", (params) =>
      (params?.uid ? this.openTask(params.uid) : this.openView()).catch(() => { new Notice(t("linkFailed")); }));
    this.registerMarkdownCodeBlockProcessor("focus-tasks", (src, el, ctx) => {
      // Converted projects retain their original code block. A description inside
      // our own view must never instantiate another copy of that view recursively.
      if(el.closest(".focus-tasks-view,.ft-intent-description,.ft-text"))return;
      ctx.addChild(new FocusRenderer(this,el,ctx.sourcePath,null,src||""));
    });
    this.addCommand({ id: "steps-blocks", name: t("cmdStepsBlocks"), callback: () => this.stepsBlocksEverywhere() });
    this.addRibbonIcon("list-checks", t("open"), () => this.openView());
    this.addSettingTab(new FocusSettingTab(this.app, this));
    this.addCommand({ id: "open", name: t("open"), callback: () => this.openView() });
    this.addCommand({ id: "toggle-all", name: t("cmdToggleAll"), callback: () => this.setEverything(!this.everything()) });
    const folds = () => [...this.views].find((v) => v.containerEl.isConnected && v.containerEl.offsetParent)?.folds;
    this.addCommand({ id: "fold-all", name: t("cmdFoldAll"), callback: () => this.foldAll(folds(), false) });
    this.addCommand({ id: "unfold-all", name: t("cmdUnfoldAll"), callback: () => this.foldAll(folds(), true) });
    this.addCommand({ id: "add-task", name: t("cmdAddTask"), callback: () => this.addTask(today()) });
    this.addCommand({ id: "add-intent", name: t("newIntentList"), callback: async () => {
      await this.openView();
      new TargetModal(this.app,this.notes().filter(n=>!n.project).map(n=>({label:n.area,area:n.area})),tg=>this.newIntentList({name:tg.area}),false).open();
    } });
    this.addCommand({ id: "add-area", name: t("cmdAddArea"), callback: () => this.newArea() });
    this.addCommand({ id: "find", name: t("cmdFind"), callback: async () => {
      await this.openView();
      const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
      view?.renderer?.find();
    } });
    // ⌘Z belongs to the editor everywhere else, so the command only fires while the list's own pane
    // is in front and nothing is being typed in it.
    // No default hotkey here. With ⌘Z on the command, Obsidian handed the key to this plugin
    // everywhere — a note's own undo stopped working, with the list not even open. The key is bound
    // inside the list's own scope instead, which exists only while the list is the active tab.
    this.addCommand({ id: "undo", name: t("cmdUndo"),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType?.(FocusView) || (this.app.workspace.activeLeaf?.view instanceof FocusView ? this.app.workspace.activeLeaf.view : null);
        if (!view || [...this.views].some((v) => v.editing)) return false;
        if (!checking) (view.renderer || this).undo();
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
    // revealLeaf selects the tab but can leave activeLeaf on the note that a Calendar URI opened.
    // Activate explicitly so keyboard actions belong to the visible Focus view.
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  // Calendar links identify a note by its permanent UID, independent of its name and location.
  // Serialize jumps so the last of several incoming links ends up selected.
  openTask(uid) {
    return this.taskNavigation = Promise.resolve(this.taskNavigation).catch(() => {}).then(async () => {
      if (this.app.workspace.onLayoutReady) await new Promise(resolve => this.app.workspace.onLayoutReady(resolve));
      // Activating another leaf can blur and save an inline editor. Check before changing focus,
      // including editors in embedded project/area views, not only the destination pane.
      if ([...this.views].some(view => view.editing || view.held)) { new Notice(t("linkBusy")); return false; }
      const leaf = await this.openView();
      let matches = await this.uidMatches(uid);
      if (matches.length !== 1) { new Notice(t(matches.length ? "linkDuplicate" : "linkMissing")); return false; }
      if (!await this.taskIndexed(matches[0])) { new Notice(t("linkMissing")); return false; }
      matches = await this.uidMatches(uid);
      if (matches.length !== 1) { new Notice(t(matches.length ? "linkDuplicate" : "linkMissing")); return false; }
      const task = matches[0];
      if ([STATUS_DONE, STATUS_CANCELLED, STATUS_SOMEDAY].includes(task.status)) { new Notice(t("linkInactive")); return false; }
      const renderer = leaf?.view?.renderer;
      if (!renderer) throw new Error("Focus renderer not ready");
      if (renderer.editing || renderer.held) { new Notice(t("linkBusy")); return false; }
      return renderer.reveal({ kind: "task", uid }, false);
    });
  }

  // Obsidian can temporarily omit frontmatter while reindexing a just-saved note. A missing
  // cache entry is not evidence that the note was deleted; give the index a bounded chance.
  async uidMatches(uid) {
    const until = Date.now() + 2000;
    do {
      this.forgetScan();
      const matches = this.tasks().filter(task => task.uid === uid);
      if (matches.length) return matches;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < until);
    return [];
  }

  // A saved note can be ahead of Obsidian's metadata index, especially on phones. Revealing an
  // old status would open the wrong shelf, then lose the row when the index catches up mid-render.
  async taskIndexed(task) {
    const signature = x => JSON.stringify(x && [x.uid, x.text, x.status, x.area, x.project, x.date, x.at]);
    const until = Date.now() + 2000;
    do {
      const [front] = splitNote(await this.app.vault.read(task.file));
      if (!front) return false;
      const fields = parseYaml(front.replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, ""));
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) return false;
      const actual = this.taskOf(task.file, fields);
      if (!actual || actual.uid !== task.uid) return false;
      if (signature(actual) === signature(this.taskOf(task.file))) return true;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < until);
    return false;
  }

  refresh() { for (const v of this.views) v.render(); }

  // «All» is per device (a phone may stay on the focus while a laptop shows everything).
  everything() { return this.app.loadLocalStorage("focus-tasks-all") === "1"; }
  doneShown() { return this.app.loadLocalStorage("focus-tasks-done") === "1"; }
  setDoneShown(on) { this.app.saveLocalStorage("focus-tasks-done", on ? "1" : null); this.refresh(); }
  waitingShown() { return this.app.loadLocalStorage("focus-tasks-waiting") === "1"; }
  setWaitingShown(on) { this.app.saveLocalStorage("focus-tasks-waiting", on ? "1" : null); this.refresh(); }
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
    if (open) this.closeRelatedIntentScopes(key);
    this.saveFolds();
  }

  closeRelatedIntentScopes(key) {
    if (key.startsWith("intents:")) {
      const area = key.slice("intents:".length);
      for (const project of this.notes().filter(x => x.project && x.area === area)) delete this.data.opened["project-intents:" + project.file.path];
    } else if (key.startsWith("project-intents:")) {
      const file = this.app.vault.getAbstractFileByPath(key.slice("project-intents:".length)), own = file && this.classify(file);
      if (own) delete this.data.opened["intents:" + own.area];
    }
  }

  categoryShown(view) {
    if (!view) return false;
    if (view.onKey) {
      if (this.isShown(view.onKey, true)) return true;
      if (this.isShown(view.key, true)) return false;
      return !!view.defaultOpen;
    }
    if (view.projectPath) {
      if (this.isShown("later:" + view.projectPath, true)) return true;
      if (this.isShown("pagefold:" + view.projectPath, true)) return false;
      return !!view.defaultOpen;
    }
    return view.inverted ? !this.isShown(view.key, true) : this.isShown(view.key, true);
  }

  // Each category owns its visibility. Opening ideas never changes focus/backlog or All.
  categoryChoices({count=0,later=null,focus=null,presentation="project"}={}) {
    return [["focus",focus?.count||0],["backlog",later?.count||0],["intents",count]].filter(([kind,n])=>
      (kind!=="focus" || (presentation!=="backlog-area" && focus?.available!==false)) && (presentation!=="project" || n>0)
    ).map(([kind,n])=>({kind,n}));
  }

  async toggleSupplement(intentKey, kind, later = null, focus = null, reveal = false) {
    const view = kind === "focus" ? focus : kind === "backlog" ? later : { key: intentKey };
    if (!view) return false;
    // A local choice hides tasks, not the header needed to reverse that choice.
    if (intentKey.startsWith("project-intents:")) this.data.opened["project-header:" + intentKey.slice("project-intents:".length)] = true;
    // A collapsed ancestor hides the category without clearing its saved preference.
    // Its dim control must reveal that category, never toggle an already enabled one off.
    const on = reveal || !this.categoryShown(view);
    if (view.onKey) {
      if (on) { this.data.opened[view.onKey] = true; delete this.data.opened[view.key]; }
      else { this.data.opened[view.key] = true; delete this.data.opened[view.onKey]; }
    } else if (kind === "backlog" && view.projectPath) {
      const path = view.projectPath;
      if (on) { this.data.opened["later:" + path] = true; delete this.data.opened["pagefold:" + path]; }
      else { delete this.data.opened["later:" + path]; this.data.opened["pagefold:" + path] = true; }
    } else {
      if (on !== !!view.inverted) this.data.opened[view.key] = true;
      else delete this.data.opened[view.key];
      if (kind === "backlog" && intentKey.startsWith("project-intents:")) {
        const path = intentKey.slice("project-intents:".length);
        if (on) { this.data.opened["later:" + path] = true; delete this.data.opened["pagefold:" + path]; }
        else { delete this.data.opened["later:" + path]; this.data.opened["pagefold:" + path] = true; }
      }
    }
    // Area choices reset local header retention and matching task-category overrides.
    if (intentKey.startsWith("intents:")) {
      const area = intentKey.slice("intents:".length);
      for (const project of this.notes().filter(x => x.project && x.area === area)) {
        const path = project.file.path;
        delete this.data.opened["project-header:" + path];
        if (kind !== "focus" && kind !== "backlog") continue;
        const yes = (kind === "focus" ? "project-focuson:" : "later:") + path;
        const no = (kind === "focus" ? "project-focusoff:" : "pagefold:") + path;
        if (on) { this.data.opened[yes] = true; delete this.data.opened[no]; }
        else { this.data.opened[no] = true; delete this.data.opened[yes]; }
      }
    }
    if (kind === "intents" && on) this.closeRelatedIntentScopes(intentKey);
    this.saveFolds();
    return on;
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

  // A task file: a note with `area:` in its frontmatter; `type: <project word>` makes it a project,
  // anything else an area. In the folder any such note counts; outside it only a note that says it
  // is an area — an area is one of your own notes (a hub in Base/, say), not a copy of it.
  classify(file, fields = null) {
    const fm = fields || this.app.metadataCache.getFileCache(file)?.frontmatter;
    if ([INTENT_TYPE, INTENT_LIST_TYPE].includes(String(fm?.type || "").toLowerCase())) return null;
    if (!fm || !fm.area) return null;
    if (!this.inFolder(file) && !this.isAreaType(fm.type)) return null;
    if (this.isTaskType(fm.type)) return null;  // a task note carries `area:` too
    const project = this.isProjectType(fm.type);
    const status = String(fm.status ?? "").trim().toLowerCase();
    // A closed project (`status: done`, by hand) is out of every list but the day's closed block.
    const done = project && (status === STATUS_DONE || status === STATUS_CANCELLED);
    return { file, uid: fm.uid ? String(fm.uid) : null, area: String(fm.area), project, done, doneDate: done ? day(fm.completedDate) : null, date: project ? day(fm.scheduled) : null };
  }

  isAreaType(type) {
    const s = String(type ?? "").trim().toLowerCase();
    return ["area", "область"].includes(s) || s === String(this.settings.typeArea ?? "").trim().toLowerCase();
  }

  isTaskType(type) {
    const s = String(type ?? "").trim().toLowerCase();
    return !!s && (TASK_WORDS.includes(s) || s === String(this.settings.typeTask ?? "").trim().toLowerCase());
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
    const notes = [], tasks = [], closed = [], intents = [], intentTasks = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file), fields = cache?.frontmatter || {};
      const intent = this.intentOf(file, fields);
      if (intent) { intents.push(intent); continue; }
      const task = this.taskOf(file, fields, cache);
      if (task) { (task.intent ? intentTasks : tasks).push(task); continue; }
      const note = this.classify(file, fields);
      if (note) (note.done ? closed : notes).push(note);
    }
    // Project identity is authoritative even after an external rename or area edit.
    for (const list of intents) {
      const project = this.intentProjectFile(list), own = project && this.classify(project);
      if (own) list.area = own.area;
    }
    const listAreas = new Map(intents.filter(x => x.isList).map(x => [x.uid, x.area]));
    for (const task of intentTasks) if (listAreas.has(task.listUid)) task.area = listAreas.get(task.listUid);
    this.scan = { notes, tasks, closed, intents, intentTasks };
    return this.scan;
  }

  // What was closed today, by area: the tasks checked off and the projects marked done. For the
  // block at the bottom; nothing here keeps anything else on screen.
  // What I am waiting for, area by area, the nearest day to look again first.
  waitingAll() {
    const groups = new Map();
    const of = (name) => { if (!groups.has(name)) groups.set(name, { name, tasks: [] }); return groups.get(name); };
    for (const x of this.tasks()) if (waitingBack(x) && x.area) of(x.area).tasks.push(x);
    const cmp = collator();
    const rank = (name) => { const i = this.data.order.areas.indexOf(name); return i < 0 ? 1e9 : i; };
    const byReturn = (x, y) => (x.date || "9999").localeCompare(y.date || "9999") || (x.at || "").localeCompare(y.at || "") || cmp(x.text, y.text);
    for (const g of groups.values()) g.tasks.sort(byReturn);
    return [...groups.values()].sort((a, b) => rank(a.name) - rank(b.name) || cmp(bare(a.name), bare(b.name)));
  }

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
  async setProjectDone(file, on, expectedUid = null, parentTx = null) {
    return this.track(t("aProjectDone"), [file], async tx => {
      const list = this.intentOf(file);
      if (list?.isList && on) {
        for (const entry of this.intentEntries(list)) {
          const live = await this.liveTask(entry);
          if (!live || ![STATUS_DONE, STATUS_CANCELLED, STATUS_SOMEDAY].includes(live.task.status)) throw new Error(t("changed"));
        }
      }
      await this.frontOwned(file, (fm) => {
        if(expectedUid && String(fm.uid || "") !== String(expectedUid))throw new Error(t("changed"));
        const current = this.intentOf(file, fm);
        if (list?.isList ? !current?.isList || current.uid !== list.uid : !this.classify(file, fm)?.project) throw new Error(t("changed"));
        if (on) { fm.status = STATUS_DONE; fm.completedDate = today(); }
        else { delete fm.status; delete fm.completedDate; }
      }, tx);
      this.forgetScan();
      new Notice(t(on ? "projectDoneNotice" : "projectBack", file.basename));
      this.refresh();
    },parentTx);
  }

  forgetScan() { this.scan = null; }

  notes() { return this.read().notes; }

  get tasksFolder() { return normalizePath(this.settings.tasksFolder || DEFAULTS.tasksFolder); }

  async calendarState() {
    try {
      if (await this.app.vault.adapter?.exists(CALENDAR_RECEIPT)) {
        const raw = await this.app.vault.adapter.read(CALENDAR_RECEIPT);
        const body = raw.match(/```json\s*\n([\s\S]*?)\n```/);
        return body ? JSON.parse(body[1]) : null;
      }
      if (!await this.app.vault.adapter?.exists(CALENDAR_STATUS)) return null;
      return JSON.parse(await this.app.vault.adapter.read(CALENDAR_STATUS));
    } catch { return null; }
  }

  calendarStatus(task, state) {
    if (!task?.file || !task.uid || !task.date || !task.at || task.isProject || task.intent
      || [STATUS_DONE, STATUS_CANCELLED, STATUS_SOMEDAY].includes(task.status)) return null;
    if (!state?.enabled) return "off";
    if (state.contract !== CALENDAR_CONTRACT) return "pending";
    if (state.connected === false) return "error";
    const receipt = state.tasks?.[task.uid];
    if (receipt?.error) return "error";
    const same = (a, b) => typeof a === "string" && typeof b === "string" && a.normalize("NFC") === b.normalize("NFC");
    return receipt?.status === "synced" && same(receipt.file, task.file.path) && same(receipt.title, task.text)
      && receipt.scheduled === `${task.date}T${task.at}` && receipt.waiting === (task.status === STATUS_WAITING)
      && Number.isFinite(Date.parse(receipt.checkedAt)) ? "synced" : "pending";
  }

  // The phone receipt changes only when acknowledgement changes, without a host heartbeat.
  calendarHasProblem(state) {
    return !!(state?.enabled && (state.contract !== CALENDAR_CONTRACT || state.connected === false
      || state.errors?.length || Object.values(state.tasks || {}).some(x => x.error || x.status === "missed")));
  }

  // A task = its own note in the tasks folder: `type: задача`, the rest in the frontmatter. `uid` is
  // its identity and never changes; the file name is only a readable label.
  taskOf(file, fields = null, cached = null) {
    const folder = this.tasksFolder;
    const cache = cached || this.app.metadataCache.getFileCache(file);
    const fm = fields || cache?.frontmatter;
    const intent = this.isIntentEntry(fm);
    if (!fm || (!intent && !this.isTaskType(fm.type))) return null;
    if (!intent && folder && folder !== "/" && !file.path.startsWith(folder + "/")) return null;
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
    const project = link(intent ? fm.intentList : fm.projects);
    return { file, uid: fm.uid ? String(fm.uid) : file.path, text: String(fm.title ?? "").trim() || file.basename,
      status: String(fm.status ?? STATUS_OPEN).trim().toLowerCase(), date: day(fm.scheduled), at: timeOf(fm.scheduled), due: day(fm.due),
      doneDate: day(fm.completedDate), priority: fm.priority || null,
      area: (intent ? fm.intentArea : fm.area) ? String(intent ? fm.intentArea : fm.area) : null, project, source: link(fm.source), described,
      ...(intent ? { intent: true, listUid: fm.intentListUid || null, loose: fm.intentLoose === true } : {}) };
  }

  tasks() { return this.read().tasks; }
  allTasks() { return [...this.tasks(), ...this.read().intentTasks]; }
  isIntentEntry(fm) { return String(fm?.type || "").toLowerCase() === INTENT_TYPE && ((typeof fm.intentList === "string" && !!fm.intentList.match(/^\[\[[^\]]+\]\]$/)) || (fm.intentLoose === true && typeof fm.intentArea === "string" && !!fm.intentArea.trim())); }

  intentOf(file, fields = null) {
    const fm = fields || this.app.metadataCache.getFileCache(file)?.frontmatter;
    const type = String(fm?.type || "").trim().toLowerCase();
    if (![INTENT_TYPE, INTENT_LIST_TYPE].includes(type) || this.isIntentEntry(fm)) return null;
    const source = typeof fm.source === "string" && fm.source.match(/^\[\[([^\]|#]+)/)?.[1];
    return { file, uid: String(fm.uid || file.path), title: String(fm.title || file.basename), area: typeof fm.intentArea === "string" ? fm.intentArea : null, boundArea: JSON.stringify(fm.intentArea || null),
      sourceFile: source ? this.app.metadataCache.getFirstLinkpathDest(source, file.path) : null, isList: type === INTENT_LIST_TYPE,
      projectUid: typeof fm.intentProjectUid === "string" ? fm.intentProjectUid : null, projectLink: typeof fm.intentProject === "string" ? fm.intentProject : null, projectDefault: fm.intentProjectDefault === true,
      done: [STATUS_DONE, STATUS_CANCELLED].includes(String(fm.status || "").toLowerCase()), doneDate: day(fm.completedDate) };
  }

  todoEligible(file, fm = {}) {
    return !this.intentOf(file, fm) && !this.isTaskType(fm.type) && !file.path.startsWith("Internals/") && !isArchived(fm.tags);
  }

  intentArea(file, fm = {}) {
    if (typeof fm.intentArea === "string") return fm.intentArea;
    const own = this.classify(file, fm);
    if (own) return own.area;
    const possible = new Set(this.notes().filter(n => this.linked(n.file)?.path === file.path).map(n => n.area));
    for (const link of [fm.area, ...[fm.areas].flat(), ...[fm.parents].flat()]) {
      if (typeof link !== "string") continue;
      const name = link.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
      const target = this.app.metadataCache.getFirstLinkpathDest(name, file.path), area = target && this.classify(target);
      if (area) possible.add(area.area);
    }
    return possible.size === 1 ? [...possible][0] : null;
  }

  intentsShown() { return this.app.loadLocalStorage("focus-tasks-intents") === "1"; }
  setIntentsShown(on) { this.app.saveLocalStorage("focus-tasks-intents", on ? "1" : null); this.refresh(); }

  async intentCards() {
    const cards = [];
    const read = async file => {
      if (this.app.vault.getAbstractFileByPath(file.path) !== file) return null;
      try { return await this.app.vault.cachedRead(file); }
      catch (e) { if (this.app.vault.getAbstractFileByPath(file.path) !== file) return null; throw e; }
    };
    for (const intent of this.read().intents) {
      const raw = await read(intent.file); if (raw === null) continue;
      cards.push({ ...intent, raw, body: splitNote(raw)[1] });
    }
    if (this.settings.todoIdeas !== false) for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file), fm = cache?.frontmatter || {};
      if (!this.todoEligible(file, fm) || !cache?.headings?.some(h => /^TODO\b/i.test(h.heading))) continue;
      const raw = await read(file); if (raw === null) continue;
      const area = this.intentArea(file, fm);
      for (const [i, block] of todoBlocks(raw).entries()) if (block.body.trim()) {
        const suffix = block.heading.replace(/^TODO\s*/i, "").trim();
        const ownArea = fm.intentAreas && Object.prototype.hasOwnProperty.call(fm.intentAreas, block.heading);
        const binding = JSON.stringify({ inherited: fm.intentArea || null, own: ownArea ? fm.intentAreas[block.heading] : undefined });
        cards.push({ file, uid: "todo:" + file.path + ":" + i, title: file.basename + (suffix ? " · " + suffix : ""),
          area: ownArea ? (typeof fm.intentAreas[block.heading] === "string" ? fm.intentAreas[block.heading] : null) : area, boundArea: binding, body: block.body, legacy: block });
      }
    }
    return cards.sort((a, b) => collator()(a.title, b.title));
  }

  async createIntent(title, body = "", area = null, tx = null, origin = null) {
    if (typeof title !== "string" || !title.trim() || typeof body !== "string") throw Error("intent-invalid");
    title = title.trim();
    return this.track(t("addIntent"), [], async tx => {
      await this.ensureFolder(this.folder);
      const base = fileName(title).slice(0, 60) || t("intents"); let name = base, n = 2;
      while (this.app.vault.getAbstractFileByPath(normalizePath(this.folder + "/" + name + ".md"))) name = base + " (" + n++ + ")";
      const fields = { uid: newUid(), type: INTENT_TYPE, title };
      if (origin) Object.assign(fields, { source: origin.source, sourceHeading: origin.heading, intentImportKey: origin.key });
      if (area) { fields.intentArea = area; const note = this.notes().find(a => !a.project && a.area === area); if (note) fields.parents = ["[[" + note.file.path.replace(/\.md$/, "") + "]]"]; }
      const raw = "---\n" + stringifyYaml(fields) + "---\n" + body;
      const file = await this.createOwned(normalizePath(this.folder + "/" + name + ".md"), raw, tx);
      return { ...this.intentOf(file, fields), body, raw };
    }, tx);
  }

  async migrateTodoFile(file, expected = null) {
    return this.track(t("intents"), [file], async tx => {
      if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw Error("intent-conflict");
      const raw = await this.app.vault.read(file), [front] = splitNote(raw);
      const fm = front ? parseYaml(front.replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, "")) : {};
      if (expected !== null && raw !== expected) throw Error("intent-conflict");
      if (!this.todoEligible(file, fm)) throw Error("intent-ineligible");
      const blocks = todoBlocks(raw), moved = [];
      this.intentCopies ||= new Map();
      for (const block of blocks) {
        if (!block.body.trim()) { moved.push({ heading: block.heading, empty: true }); continue; }
        const suffix = block.heading.replace(/^TODO\s*/i, "").trim(), title = file.basename + (suffix ? " · " + suffix : "");
        const own = fm.intentAreas && Object.prototype.hasOwnProperty.call(fm.intentAreas, block.heading);
        const area = own ? (typeof fm.intentAreas[block.heading] === "string" ? fm.intentAreas[block.heading] : null) : this.intentArea(file, fm);
        const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(file.path + "\0" + block.start + "\0" + block.snapshot));
        const key = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
        const body = intentProse(block.body), candidates = new Set(this.app.vault.getMarkdownFiles().filter(f => this.app.metadataCache.getFileCache(f)?.frontmatter?.intentImportKey === key));
        const recovery = this.intentCopies.get(key);
        if (recovery && this.app.vault.getAbstractFileByPath(recovery.path) === recovery) candidates.add(recovery);
        const matches = [];
        for (const candidate of candidates) {
          const text = await this.app.vault.read(candidate), [head, content] = splitNote(text);
          const fields = head ? parseYaml(head.replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, "")) : {};
          if (fields?.intentImportKey === key) matches.push({ file: candidate, text, content, fields });
        }
        if (matches.length > 1 || matches.some(m => m.content !== body || m.fields.title !== title || m.fields.type !== INTENT_TYPE)) throw Error("intent-conflict");
        const intent = matches.length ? { ...this.intentOf(matches[0].file, matches[0].fields), body } :
          await this.createIntent(title, body, area, tx, { source: "[[" + file.path.replace(/\.md$/, "") + "]]", heading: block.heading, key });
        this.intentCopies.set(key, intent.file);
        const text = await this.app.vault.read(intent.file);
        if (splitNote(text)[1] !== body || !text.includes(key)) throw Error("intent-copy-failed");
        moved.push({ heading: block.heading, title, area: intent.area, path: intent.file.path, uid: intent.uid });
      }
      // Copies survive a failed source write and are reused on retry, never silently deleted.
      let after = raw;
      for (const block of [...blocks].reverse()) after = after.slice(0, block.start) + after.slice(block.end);
      await this.processOwned(file, live => { if (live !== raw) throw Error("intent-conflict"); return after; }, tx);
      this.forgetScan(); this.refresh();
      return { source: file.path, before: raw, after, moved };
    });
  }

  async saveIntent(intent, title, body, area = null) {
    return this.track(t("editIntent"), [intent.file], async tx => {
      if (this.app.vault.getAbstractFileByPath(intent.file.path) !== intent.file) throw Error("intent-conflict");
      await this.processOwned(intent.file, raw => {
        let next = raw; const [front, oldBody] = splitNote(raw);
        const fm = front ? parseYaml(front.replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, "")) : {};
        if (!fm || typeof fm !== "object" || Array.isArray(fm)) throw Error("intent-conflict");
        const ownArea = intent.legacy && fm.intentAreas && Object.prototype.hasOwnProperty.call(fm.intentAreas, intent.legacy.heading);
        const binding = intent.legacy ? JSON.stringify({ inherited: fm.intentArea || null, own: ownArea ? fm.intentAreas[intent.legacy.heading] : undefined }) : JSON.stringify(fm.intentArea || null);
        if (binding !== intent.boundArea) throw Error("intent-conflict");
        const newline = raw.includes("\r\n") ? "\r\n" : "\n";
        if (intent.legacy) {
          if (!this.todoEligible(intent.file, fm)) throw Error("intent-conflict");
        const matches = todoBlocks(raw).filter(b => b.snapshot === intent.legacy.snapshot);
          if (matches.length !== 1) throw Error("intent-conflict");
          const b = matches[0]; let text = body.replace(/\r?\n/g, newline);
          if (b.end < raw.length && !text.endsWith(newline)) text += newline;
          next = raw.slice(0, b.bodyStart) + text + raw.slice(b.end);
          if (area === intent.area) return next;
          if (todoBlocks(raw).filter(x => x.heading === b.heading).length !== 1) throw Error("intent-conflict");
          if (fm.intentAreas && (typeof fm.intentAreas !== "object" || Array.isArray(fm.intentAreas))) throw Error("intent-conflict");
          fm.intentAreas = { ...(fm.intentAreas || {}), [intent.legacy.heading]: area };
        } else {
          const actual = this.intentOf(intent.file, fm);
          if (!actual || actual.uid !== intent.uid || actual.title !== intent.title || oldBody !== intent.body) throw Error("intent-conflict");
          fm.title = title; next = front + "\n" + body;
          if (area !== intent.area) {
            const old = this.notes().find(n => !n.project && n.area === intent.area), to = this.notes().find(n => !n.project && n.area === area);
            const owned = old ? ["[[" + old.file.basename + "]]", "[[" + old.file.path.replace(/\.md$/, "") + "]]"] : [];
            if (Array.isArray(fm.parents)) fm.parents = fm.parents.filter(v => !owned.includes(v));
            if (to) fm.parents = [...new Set([...(Array.isArray(fm.parents) ? fm.parents : []), "[[" + to.file.path.replace(/\.md$/, "") + "]]"])];
          }
        }
        if (!intent.legacy) { if (area) fm.intentArea = area; else delete fm.intentArea; }
        const bodyNext = splitNote(next)[1];
        return (raw.startsWith("\uFEFF") ? "\uFEFF" : "") + "---" + newline + stringifyYaml(fm).replace(/\r?\n/g, newline) + "---" + newline + bodyNext;
      }, tx);
      return true;
    });
  }

  async removeIntent(intent) {
    return this.undoable(t("intentDeleted"), [intent.file], async tx => {
      if (this.app.vault.getAbstractFileByPath(intent.file.path) !== intent.file) throw Error("intent-conflict");
      if (intent.legacy) await this.processOwned(intent.file, raw => {
        const [front] = splitNote(raw), fm = front ? parseYaml(front.replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, "")) : {};
        if (!this.todoEligible(intent.file, fm)) throw Error("intent-conflict");
        const matches = todoBlocks(raw).filter(b => b.snapshot === intent.legacy.snapshot);
        if (matches.length !== 1) throw Error("intent-conflict");
        return raw.slice(0, matches[0].start) + raw.slice(matches[0].end);
      }, tx);
      else {
        if (typeof intent.raw !== "string") throw Error("intent-conflict");
        const [front] = splitNote(intent.raw), fm = front ? parseYaml(front.replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, "")) : {};
        if (this.intentOf(intent.file, fm)?.uid !== intent.uid) throw Error("intent-conflict");
        await this.trashOwned(intent.file, tx, intent.raw);
      }
      this.forgetScan(); this.refresh();
    });
  }

  async taskFromIntent(intent, title, area = null, day = null) {
    if (typeof title !== "string" || !title.trim()) throw Error("intent-invalid");
    return this.track(t("intentTask"), [], async tx => {
      if (this.app.vault.getAbstractFileByPath(intent.file.path) !== intent.file) throw Error("intent-conflict");
      if (!intent.legacy) {
        const [front] = splitNote(await this.app.vault.read(intent.file));
        const actual = this.intentOf(intent.file, parseYaml(front.replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, "")));
        if (!actual || actual.uid !== intent.uid) throw Error("intent-conflict");
      }
      const task = await this.createTask(title, { area }, day, tx);
      await this.frontOwned(task.file, fm => { fm.source = "[[" + intent.file.path.replace(/\.md$/, "") + "]]"; }, tx);
      return task;
    });
  }

  // → [{name, note, rows, ahead, done, projects, focus, later, running}]. Every pile of an area is a
  // list of rows, and a row is a task or a project: a project shows as one row — its name and the
  // first of its steps in that pile — so five steps of one project take one line of the day, not five.
  // `rows`: the focus (open tasks due today or earlier, and projects with such a step); `ahead`: the
  // rest — undated, dated later, sent off, and the projects whose every step is such (or that have
  // none). `done`: checked off today, for the block at the bottom. `all` puts every open task of every
  // area into `rows`. Tasks are notes; areas and projects are their own notes.
  // Count/render the same effective membership, including project dates and returned Waiting.
  // A project/list header is not a task. Hidden steps still count; pending Waiting does not.
  scopeTasks(area, path = null) {
    const tasks = rows => {
      const found = new Map();
      for (const row of rows || []) {
        if (path && (row.kind !== "project" || row.project.file.path !== path)) continue;
        for (const task of row.kind === "task" ? [row.task] : row.steps || []) {
          if ([STATUS_DONE, STATUS_CANCELLED, STATUS_SOMEDAY].includes(task.status) || waitingBack(task)) continue;
          found.set(task.uid || task.file.path, task);
        }
      }
      return found;
    };
    const focused = tasks(area?.rows), later = tasks(area?.ahead);
    for (const uid of focused.keys()) later.delete(uid);
    // Empty projects created for today's work are still actionable Focus rows;
    // finished projects and pending Waiting alone do not put an area in Focus.
    const hasFocus = focused.size > 0 || (area?.rows || []).some(row => row.kind === "project"
      && (!path || row.project.file.path === path) && !row.project.finished);
    return { focus: [...focused.values()], backlog: [...later.values()], hasFocus };
  }

  async collect(all, every = false) {
    const byArea = new Map();
    const areaOf = (name) => {
      if (!byArea.has(name)) byArea.set(name, { name, note: null, rows: [], ahead: [], done: [], waiting: [], projects: [], focus: 0, later: 0, running: 0 });
      return byArea.get(name);
    };
    const projects = new Map();  // path of a project note → its bucket in its area
    const now = today();
    for (const n of this.notes()) {
      const area = areaOf(n.area);
      if (!n.project) { if (!area.note) area.note = n.file; continue; }
      const bucket = { file: n.file, uid: n.uid, area, date: n.date || null, tasks: [], later: [], done: [], waiting: [], running: 0 };
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
      // In somebody else's hands until the day it comes back: on the shelf of what I am waiting for,
      // not in the pile of what is not today — the two read alike and are nothing alike. «All» still
      // lists it with its area, so the complete view stays complete.
      const waiting = waitingBack(task);
      if (waiting) {
        area.running++;
        area.waiting.push(task);
        if (bucket) { bucket.running++; bucket.waiting.push(task); }
        if (!all) continue;
      }
      const focused = !waiting && (inFocus(task) || task.status === STATUS_WAITING);
      area[focused ? "focus" : "later"]++;
      if (bucket) (focused || all ? bucket.tasks : bucket.later).push(task);
      else area[focused || all ? "rows" : "ahead"].push({ kind: "task", task });
    }
    const cmp = collator();
    const byReturn = (x, y) => (x.date || "9999").localeCompare(y.date || "9999") || (x.at || "").localeCompare(y.at || "") || cmp(x.text, y.text);
    for (const area of byArea.values()) {
      area.waiting.sort(byReturn);
      for (const b of area.projects) b.waiting.sort(byReturn);
    }
    // The steps of a project: a dragged order wins, the rest follows the nearest date and then the
    // name. What came due sits under the work already in hand today — it asks to be looked at, not
    // to be done; among what is not today the started ones come first: promises already made.
    const cmpTask = this.rowOrder();
    const isRunning = (x) => (x.status === STATUS_WAITING ? 1 : 0);
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
        // A project with a day of its own goes by that day alone: due, it is in the focus with
        // whatever steps it has; still ahead, it waits in the pile with all of them. Without one,
        // its steps decide.
        const here = b.date ? b.date <= now : b.tasks.length || b.finished || b.fresh;
        if (here) area.rows.push({ kind: "project", project: b, steps: b.tasks.length || !b.date ? b.tasks : b.later });
        if (!here) area.ahead.push({ kind: "project", project: b, steps: b.date ? [...b.tasks, ...b.later] : b.later });
        else if (b.later.length && (b.tasks.length || !b.date)) area.ahead.push({ kind: "project", project: b, steps: b.later });
      }
      // One order per area, set by hand, projects and tasks alike; what has no seat yet goes after
      // what has — tasks first, by date and name, then projects by name — until a drag seats it.
      const seats = this.areaSeats(area.name);
      const seat = (row) => { const i = seats.indexOf(seatKey(row)); return i < 0 ? 1e9 : i; };
      const tie = (x, y) => (x.kind === "project") - (y.kind === "project")
        || (x.kind === "task" ? cmpTask(x.task, y.task) : cmp(x.project.file.basename, y.project.file.basename));
      const byArea = (x, y) => seat(x) - seat(y) || tie(x, y);
      const stepOf = (row) => (row.kind === "task" ? row.task : row.steps[0]);
      const running = (row) => (stepOf(row) && stepOf(row).status === STATUS_WAITING ? 1 : 0);
      // a project with no step to show sinks below everything else in its list: it asks nothing of
      // today but its next step. The hand-set order holds within each group.
      const empty = (row) => (row.kind === "project" && !row.steps.length ? 1 : 0);
      area.rows.sort(byArea).sort((x, y) => running(x) - running(y)).sort((x, y) => empty(x) - empty(y));
      area.ahead.sort(byArea).sort((x, y) => running(y) - running(x)).sort((x, y) => empty(x) - empty(y));
      area.done.sort((x, y) => cmp(x.project || "", y.project || "") || cmp(x.text, y.text));
    }
    let areas = [...byArea.values()];
    // What puts an area in the focus is today's open work: something due, something overdue, a
    // project emptied today. Nothing closed keeps it there — an open area with no row in it read as
    // «broken», and the day's closed work has its own block at the bottom.
    // A project finished today keeps its empty row among the area's work — but it does not hold an
    // area in the focus by itself: with nothing else open there, the area had nothing to do today.
    const holds = (r) => !(r.kind === "project" && r.project.finished && !r.steps.length);
    if (!all && !every) areas = areas.filter((a) => a.rows.some(holds));
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

  // Intent lists share task rows and mutations. Their entries stay outside the actionable queue.
  parseIntentListBody(body) {
    const lines = body.replace(/\r\n/g, "\n").split("\n"), candidates = [];
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
      const f = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (f) {
        if (!fence) fence = { char: f[1][0], length: f[1].length };
        else if (f[1][0] === fence.char && f[1].length >= fence.length && !f[2].trim()) fence = null;
        continue;
      }
      const bullet = lines[i].match(/^( {0,3})(?:[-+*]|\d+[.)])\s+\S/);
      if (!fence && bullet) candidates.push({ index: i, indent: bullet[1].length });
    }
    const indent = Math.min(...candidates.map(x=>x.indent)), starts = candidates.filter(x=>x.indent===indent).map(x=>x.index);
    if (!starts.length) {
      const first = lines.findIndex(s => s.trim());
      if (first < 0) return { description: "", items: [] };
      return { description: "", items: [{ text: lines[first].trim(), body: lines.slice(first + 1).join("\n").trim(), done: false }] };
    }
    const items = starts.map((start, i) => {
      let text = lines[start].replace(/^ {0,3}(?:[-+*]|\d+[.)])\s+/, ""), done = false;
      const box = text.match(/^\[([ xX])\]\s+/);
      if (box) { done = box[1].toLowerCase() === "x"; text = text.slice(box[0].length); }
      else if (/^~~[^\n]+~~\s*$/.test(text)) { done = true; text = text.trim().slice(2, -2); }
      return { text, body: lines.slice(start + 1, starts[i + 1] ?? lines.length).join("\n").trim(), done };
    });
    return { description: lines.slice(0, starts[0]).join("\n").trim(), items };
  }

  intentEntries(list) {
    return this.read().intentTasks.filter(x => x.listUid === list.uid || (!x.listUid && this.projectFile(x)?.path === list.file.path));
  }

  closedIntentList(list) {
    return !!list.done && !this.intentEntries(list).some(x => ![STATUS_DONE, STATUS_CANCELLED, STATUS_SOMEDAY].includes(x.status));
  }

  async reopenIntentList(list, tx = this.tx) {
    await this.frontOwned(list.file, fm => {
      const current = this.intentOf(list.file, fm);
      if (!current?.isList || current.uid !== list.uid) throw Error("intent-conflict");
      if (!current.done) return false;
      delete fm.status; delete fm.completedDate;
    }, tx);
    this.forgetScan();
  }

  intentProjectFile(list) {
    if (list.projectUid) {
      const candidates = this.scan ? [...this.scan.notes, ...this.scan.closed].filter(x => x.project).map(x => x.file) : this.app.vault.getMarkdownFiles();
      return candidates.find(file => {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        return fm?.uid === list.projectUid && this.classify(file, fm)?.project;
      }) || null;
    }
    const link = list.projectLink?.match(/^\[\[([^\]|#]+)/)?.[1];
    const file = link && this.app.metadataCache.getFirstLinkpathDest(link, list.file.path);
    return file && this.classify(file)?.project ? file : null;
  }

  projectIntentLists(project) {
    const path = (project.file || project).path;
    return this.read().intents.filter(list => list.isList && this.intentProjectFile(list)?.path === path);
  }

  unboundIntent(task) {
    return !!task?.intent && (task.loose || !this.read().intents.some(x=>x.isList&&x.uid===task.listUid));
  }

  areaDefaultIntentLists(area) {
    const note=this.notes().find(x=>!x.project&&x.area===area)?.file;
    const linked=note&&this.linked(note);
    return this.read().intents.filter(x=>x.isList&&x.area===area&&!x.projectUid&&!x.projectLink&&x.sourceFile&&(x.sourceFile===note||x.sourceFile===linked));
  }

  async bindIntentList(list, project, tx = null) {
    const file = project?.file || project;
    return this.track(t("aMove"), [list.file, ...(file ? [file] : [])], async active => {
      if (file) {
        const own = this.classify(file);
        if (!own?.project || own.done) throw Error("intent-invalid");
        if (this.projectIntentLists(file).some(other => other.uid !== list.uid)) throw Error(t("intentProjectTaken"));
        if (list.area !== own.area && !await this.moveIntentList(list, own.area, null, {}, active, true)) throw Error("intent-invalid");
        let uid;
        await this.frontOwned(file, fm => { const live = this.classify(file, fm); if (!live?.project || live.done || live.area !== own.area) throw Error("intent-conflict"); uid = fm.uid ||= newUid(); }, active);
        await this.frontOwned(list.file, fm => {
          if (fm.type !== INTENT_LIST_TYPE || fm.uid !== list.uid || String(fm.intentProjectUid || "") !== String(list.projectUid || "")) throw Error("intent-conflict");
          fm.intentProjectUid = uid; fm.intentProject = "[[" + file.path.replace(/\.md$/, "") + "]]";
        }, active);
      } else await this.frontOwned(list.file, fm => {
        if (fm.type !== INTENT_LIST_TYPE || fm.uid !== list.uid || String(fm.intentProjectUid || "") !== String(list.projectUid || "")) throw Error("intent-conflict");
        delete fm.intentProjectUid; delete fm.intentProject;
      }, active);
      this.forgetScan(); this.refresh();
      const [head] = splitNote(await this.app.vault.read(list.file));
      return this.intentOf(list.file, parseYaml(head.replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, "")));
    }, tx);
  }

  async ensureProjectIntentList(project, tx = null) {
    const file = project.file || project;
    return this.track(t("aNew"), [file], async active => {
      const existing = this.projectIntentLists(file)[0];
      if (existing) return existing;
      const own = this.classify(file);
      if (!own?.project || own.done) throw Error("intent-invalid");
      const list = await this.createIntentList(file.basename + " - " + t("intents"), own.area, active);
      await this.frontOwned(list.file, fm => { fm.intentProjectDefault = true; }, active);
      return this.bindIntentList(list, file, active);
    }, tx);
  }

  async createIntentList(title, area, tx = null) {
    if (!this.notes().some(n => !n.project && n.area === area)) throw Error("intent-invalid");
    return this.track(t("aNew"), [], async active => {
      const card = await this.createIntent(title, "", area, active);
      await this.frontOwned(card.file, fm => { fm.type = INTENT_LIST_TYPE; fm.intentListVersion = 1; }, active);
      this.forgetScan();
      return { ...card, isList: true };
    }, tx);
  }

  newIntentList(area) {
    new NameModal(this.app, t("newIntentList"), t("intentTitle"), async title => {
      await this.createIntentList(title, area.name);
      await this.setOpen("intents:" + area.name, true); this.refresh();
    }).open();
  }

  async convertIntentCard(card, area) {
    if (!this.notes().some(n => !n.project && n.area === area)) throw Error("intent-invalid");
    return this.track(t("aMove"), [card.file], async tx => {
      const raw = await this.app.vault.read(card.file), [front, body] = splitNote(raw);
      const fm = parseYaml(front.replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, ""));
      if (fm.type === INTENT_LIST_TYPE && fm.uid === card.uid && fm.intentListVersion === 1) return { list: this.intentOf(card.file, fm), entries: this.intentEntries(card), reused: true };
      if (raw !== card.raw || fm.type !== INTENT_TYPE || fm.uid !== card.uid || fm.intentList) throw Error("intent-conflict");
      const parsed = this.parseIntentListBody(body), entries = [];
      for (let i = 0; i < parsed.items.length; i++) {
        const item = parsed.items[i], key = card.uid + ":" + i;
        const matches = this.read().intentTasks.filter(x => this.app.metadataCache.getFileCache(x.file)?.frontmatter?.intentItemImportKey === key);
        if (matches.length > 1) throw Error("intent-conflict");
        let entry = matches[0];
        if (entry) {
          if (entry.text !== item.text || splitNote(await this.app.vault.read(entry.file))[1].trim() !== item.body || entry.listUid !== card.uid) throw Error("intent-conflict");
        } else {
          entry = await this.createTask(item.text, { area, project: card.file.basename, projectFile: card.file, intentList: true, listUid: card.uid, importing: true }, null, tx);
          await this.frontOwned(entry.file, fields => {
            fields.intentItemImportKey = key;
            if (item.done) fields.status = STATUS_DONE;
            else fields.priority = "low";
          }, tx);
          await this.processOwned(entry.file, text => splitNote(text)[0] + "\n" + item.body, tx);
          const check = await this.app.vault.read(entry.file);
          const fields = parseYaml(splitNote(check)[0].replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, ""));
          if (fields.uid !== entry.uid || fields.intentListUid !== card.uid || fields.title !== item.text || splitNote(check)[1] !== item.body) throw Error("intent-conflict");
        }
        entries.push(entry); this.forgetScan();
      }
      await this.processOwned(card.file, current => {
        if (current !== raw) throw Error("intent-conflict");
        const next = { ...fm, type: INTENT_LIST_TYPE, intentArea: area, intentListVersion: 1 };
        const old = this.notes().find(n => !n.project && n.area === card.area)?.file;
        const target = this.notes().find(n => !n.project && n.area === area).file;
        next.parents = [...new Set([...(Array.isArray(fm.parents) ? fm.parents : []).filter(link => !old || this.app.metadataCache.getFirstLinkpathDest(String(link).replace(/^\[\[|\]\]$/g, ""), card.file.path)?.path !== old.path), "[[" + target.path.replace(/\.md$/, "") + "]]"])];
        return "---\n" + stringifyYaml(next) + "---\n" + parsed.description;
      }, tx);
      this.data.order.tasks["intent:" + card.uid] = entries.map(x => x.uid);
      await this.saveAll(); this.forgetScan();
      return { list: { ...card, area, isList: true }, entries };
    });
  }

  async renameIntentList(list, title) {
    return this.track(t("aRename"), [list.file], async tx => {
      await this.frontOwned(list.file, fm => {
        if (fm.type !== INTENT_LIST_TYPE || fm.uid !== list.uid) throw Error("intent-conflict");
        fm.title = title;
        delete fm.intentProjectDefault;
      }, tx);
      this.forgetScan(); this.refresh(); return true;
    });
  }

  async moveIntentList(list, area, drop = null, shown = {}, tx = null, preserveProject = false) {
    const entries = this.intentEntries(list), target = this.notes().find(n => !n.project && n.area === area)?.file;
    if (!target) return false;
    return this.track(t("aMove"), [list.file, ...entries.map(x => x.file)], async tx => {
      for (const entry of entries) {
        const live = await this.liveTask(entry);
        if (!live || live.task.listUid !== list.uid) throw Error("intent-conflict");
      }
      await this.frontOwned(list.file, fm => {
        if (fm.type !== INTENT_LIST_TYPE || fm.uid !== list.uid) throw Error("intent-conflict");
        const old = this.notes().find(n => !n.project && n.area === fm.intentArea)?.file;
        fm.parents = [...new Set([...(Array.isArray(fm.parents) ? fm.parents : []).filter(link => !old || this.app.metadataCache.getFirstLinkpathDest(String(link).replace(/^\[\[|\]\]$/g, ""), list.file.path)?.path !== old.path), "[[" + target.path.replace(/\.md$/, "") + "]]"])];
        fm.intentArea = area;
        if (list.area !== area && !preserveProject) { delete fm.intentProject; delete fm.intentProjectUid; }
      }, tx);
      for (const entry of entries) await this.frontOwned(entry.file, fm => {
        if (!this.isIntentEntry(fm) || fm.uid !== entry.uid || fm.intentListUid !== list.uid) throw Error("intent-conflict");
        fm.intentArea = area;
      }, tx);
      const key = "intent-lists:" + area, alive = this.read().intents.filter(x => x.isList && x.area === area).map(x => x.uid);
      const order = [...new Set([...(this.data.order.tasks[key] || []), ...(shown[key] || []), ...alive, list.uid])].filter(uid => uid !== list.uid && (alive.includes(uid)));
      const targetUid = drop?.target?.project?.intentList ? drop.target.project.uid : null;
      const at = targetUid ? order.indexOf(targetUid) : -1;
      order.splice(at < 0 ? order.length : at + (drop.after ? 1 : 0), 0, list.uid);
      this.data.order.tasks[key] = order;
      await this.setOpen("intents:" + area, true); await this.saveAll(); this.forgetScan(); this.refresh(); return true;
    }, tx);
  }

  async promoteIntentTasks(tasks, day = null) {
    return this.track(t("aMove"), tasks.map(x=>x.file), async tx => {
      for(const task of tasks)if(!await this.promoteIntentTask(task,day,tx))return false;
      return true;
    });
  }

  async promoteIntentTask(task, day = null, tx = null) {
    if (!task.intent) return false;
    return this.track(t("aMove"), [task.file], async active => {
      const live=await this.liveTask(task);if(!live)return false;
      if(!task.file.path.startsWith(this.tasksFolder+"/")) {
        await this.ensureFolder(this.tasksFolder);
        const name=await this.freeName(fileName(task.text).slice(0,60)||t("newTask"));
        await this.renameOwned(task.file,normalizePath(this.tasksFolder+"/"+name+".md"),active);
      }
      const list = this.read().intents.find(x => x.uid === live.task.listUid), project = list && this.intentProjectFile(list);
      const own = project && this.classify(project), targetProject = own?.done ? null : project;
      const fields = { type: TASK_TYPE, area: own?.area || live.task.area, projects: targetProject ? [this.projectLink(targetProject, task.file.path)] : null, intentList: null, intentListUid: null, intentLoose: null, intentArea: null, intentItemImportKey: null,
        status: STATUS_OPEN, completedDate: null, scheduled: day ? day + (live.task.at ? "T" + live.task.at : "") : null, ...(live.task.project ? {source: "[[" + live.task.project + "]]"} : {}) };
      const ok = await this.setFields(task, fields);
      if (ok) { delete task.intent; delete task.listUid; delete task.loose; Object.assign(task, { area: fields.area, project: targetProject?.basename || null, date: day, at: day ? live.task.at : null, status: STATUS_OPEN }); }
      this.refresh(); return ok;
    }, tx);
  }

  async deleteIntentList(list) {
    const entries = this.intentEntries(list), snapshots = new Map();
    for (const file of [list.file, ...entries.map(x => x.file)]) snapshots.set(file, await this.app.vault.read(file));
    const fields=raw=>parseYaml(splitNote(raw)[0].replace(/^\uFEFF?---\r?\n/,"").replace(/\r?\n---$/,""));
    const own=fields(snapshots.get(list.file));
    if(this.app.vault.getAbstractFileByPath(list.file.path)!==list.file || own.type!==INTENT_LIST_TYPE || own.uid!==list.uid)throw Error("intent-conflict");
    for(const entry of entries) {
      const fm=fields(snapshots.get(entry.file));
      if(!this.isIntentEntry(fm)||fm.uid!==entry.uid||fm.intentListUid!==list.uid)throw Error("intent-conflict");
    }
    new ConfirmModal(this.app, t("deleteIntentList"), t("deleteIntentListDesc"), t("deleteIntentList"), async () => {
      try {
        await this.undoable(t("deleted", list.title), [...snapshots.keys()], async tx => {
          const current = this.intentEntries(list);
          if (current.map(x => x.uid).sort().join() !== entries.map(x => x.uid).sort().join()) throw Error("intent-conflict");
          for (const [file, raw] of snapshots) if (this.app.vault.getAbstractFileByPath(file.path) !== file || await this.app.vault.read(file) !== raw) throw Error("intent-conflict");
          for (const entry of entries) await this.trashOwned(entry.file, tx, snapshots.get(entry.file));
          await this.trashOwned(list.file, tx, snapshots.get(list.file));
          this.forgetScan(); this.refresh();
        });
      } catch (e) { new Notice(t("intentChanged")); }
    }).open();
  }

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

  // Capture the exact bytes inside the atomic vault callback. A read after the gesture could
  // already contain another writer's work, which must never become this gesture's Undo target.
  async processOwned(file, change, tx = null) {
    await this.app.vault.process(file, before => {
      const after = change(before);
      if (tx && before !== after) tx.record(file.path, before, after);
      return after;
    });
  }

  async frontOwned(file, change, tx = null) {
    return this.processOwned(file, text => {
      const [front, body] = splitNote(text);
      const raw = front.replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, "");
      const fm = front ? parseYaml(raw) : {};
      if (!fm || typeof fm !== "object" || Array.isArray(fm)) throw new Error("Invalid frontmatter");
      if (change(fm) === false) return text;
      const newline = front.includes("\r\n") ? "\r\n" : "\n";
      const yaml = stringifyYaml(fm).replace(/\r?\n/g, newline);
      return (text.startsWith("\uFEFF") ? "\uFEFF" : "") + "---" + newline + yaml + "---" + newline + body;
    }, tx);
  }

  // The one place a task note is written. `change(fm)` gets the frontmatter as it is on disk right
  // now — a decision made from what the screen showed a second ago (another device may have finished
  // the task since) must be taken inside it, not before.
  async update(task, change) {
    const file = this.app.vault.getAbstractFileByPath(task.file.path) || task.file;
    if (!file || file.deleted) { new Notice(t("changed")); return false; }
    let uid = null, wrong = false;
    try {
      await this.frontOwned(file, (fm) => {
        // The row was read a moment ago; another note may have taken this path since (Sync, a script,
        // the user). Writing into it would change the wrong task — or turn an ordinary note into one.
        if ((task.intent ? !this.isIntentEntry(fm) : !this.isTaskType(fm.type))) { wrong = true; return false; }
        if (fm.uid && task.uid && String(fm.uid) !== task.uid) { wrong = true; return false; }
        if (!fm.uid && task.uid && task.uid !== task.file.path) { wrong = true; return false; }
        if (!fm.uid) fm.uid = uid = newUid();  // a note written by another plugin gets its identity here
        return change(fm);
      }, this.tx);
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
        if (this.tx) this.tx.delegated = true;
        await api.toggleCompleteInstance(task.file.path, task.date || today());
        this.forgetScan();
        return true;
      }
      let done = null, doneDate = null;
      const ok = await this.update(task, (fm) => {
        const current = String(fm.status ?? STATUS_OPEN).trim().toLowerCase();
        done = task.status !== STATUS_DONE;
        doneDate = done ? (current === STATUS_DONE ? day(fm.completedDate) : today()) : null;
        // The box is an intent (check or uncheck), rather than toggling a state the user never saw.
        if (current === (done ? STATUS_DONE : STATUS_OPEN)) return false;
        if (current !== task.status || fm.recurrence) throw new Error(t("changed"));
        fm.status = done ? STATUS_DONE : STATUS_OPEN;
        if (done) fm.completedDate = today();
        else delete fm.completedDate;
      });
      if (ok) Object.assign(task, { status: done ? STATUS_DONE : STATUS_OPEN, doneDate });
      return ok;
    }
  }

  // The date the focus goes by; null takes the task back to the someday list.
  // Taking the day off a running task would strand it behind the ▷ counter with nothing to bring it
  // back, so it comes home instead: no day to return on means the task is mine again as of now.
  async setDate(task, day, tx = null) {
    return this.track(t("aDate"), [task.file], async () => {
      return this.scheduleNow(task, day, undefined);
    }, tx);
  }

  async setScheduled(task, day, at = null, tx = null) {
    if (at && !parseTime(at)) throw new Error(t("reminderClock"));
    return this.track(t("aDate"), [task.file], () => this.scheduleNow(task, day, at), tx);
  }

  async scheduleNow(task, day, at) {
    let scheduled = null, status = task.status;
    const ok = await this.update(task, fm => {
      // A day-only gesture preserves an existing reminder hour; removing the day removes it all.
      const clock = at === undefined ? timeOf(fm.scheduled) : at && parseTime(at);
      scheduled = day ? day + (clock ? "T" + clock : "") : null;
      if (scheduled) fm.scheduled = scheduled; else delete fm.scheduled;
      if (!day && fm.status === STATUS_WAITING) fm.status = STATUS_OPEN;
      status = String(fm.status ?? STATUS_OPEN).trim().toLowerCase();
    });
    if (ok) Object.assign(task, { date: day || null, at: timeOf(scheduled), status });
    return ok;
  }

  async setDates(tasks, day, at = undefined) {
    return this.track(t("aDate"), tasks.map((x) => x.file), async (tx) => {
      for (const task of tasks) if (!await (task.isProject ? this.setProjectDate(task.file, day, tx)
        : at === undefined ? this.setDate(task, day, tx) : this.setScheduled(task, day, at, tx))) return false;
      return true;
    });
  }

  // New text: the note keeps its uid and is renamed to match (the whole text stays in `title` when it
  // is too long for a file name).
  async rename(task, text) {
    return this.track(t("aRename"), [task.file], (tx) => this.renameNow(task, text, tx));
  }

  async renameNow(task, text, tx = null) {
    const live = await this.liveTask(task);
    if (!live) return false;
    // Membership belongs to the current file, not to the stale row that began editing.
    const project = !live.task.intent && live.task.project ? this.projectFile(live.task) : null;
    const originalProject = live.task.project;
    const name = fileName(text).slice(0, 60).trim();
    const base = this.taskName(text, name);
    let file = base && base !== task.file.basename ? await this.freeName(base, task.file.parent?.path || this.tasksFolder) : task.file.basename;
    // the file name may be cut or taken: then the whole text lives in `title`
    // Keep the full text on disk before renaming: a failed rename must not discard what was typed.
    const ok = await this.setFields(task, { title: text });
    if (!ok) return false;  // the note is not the one this row was read from: leave its name alone too
    if (file !== task.file.basename) {
      const path = normalizePath(`${task.file.parent?.path || this.tasksFolder}/${file}.md`);
      await this.renameOwned(task.file, path, tx);
      this.forgetScan();
      // A step named like its project had a link Obsidian resolved to the step itself, and has just
      // rewritten to the step's new path: it is written back to the project, by path if need be.
      // Private entries store a full list path; renaming cannot turn it into a self-link.
      // Leave current membership untouched if another device moved the entry meanwhile.
      if (project) {
        const link = this.projectLink(project, task.file.path);
        if (link !== `[[${originalProject}]]`) await this.update(task, fm => {
          const current = this.taskOf(task.file, fm);
          // A rename may rewrite a self-link. A concurrent move to a different
          // project must remain untouched, even if it happens during the rename.
          const self = task.file.path.replace(/\.md$/, "");
          if (current.project !== originalProject && current.project !== self && current.project !== task.file.basename) return false;
          fm.projects = [link];
        });
      }
    }
    if (file === text) await this.setFields(task, { title: null });
    const renamed = await this.liveTask(task);
    if (renamed) Object.assign(task, renamed.task);
    return true;
  }

  // `drop` comes from FocusRenderer.target; `shown` is the order on screen.
  async drop(item, drop, shown) {
    const files = item.type === "task" ? (item.tasks || [item.task]).map((x) => x.file) : [];
    return this.track(t("aMove"), files, (tx) => this.dropNow(item, drop, shown, tx));
  }

  async dropNow(item, drop, shown, tx = null) {
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
      if(item.project.intentList) {
        const tg=drop.target, area=tg.task?.area||tg.area?.name;
        if (drop.into && tg.type === "project" && !tg.project.intentList) return this.bindIntentList(item.project, tg.project, tx);
        return this.moveIntentList(item.project,area,drop,shown.tasks||{},tx);
      }
      if(drop.pile === "intents" || drop.target.project?.intentList || drop.target.task?.intent) {
        const area = drop.target.task?.area || drop.target.area?.name;
        const list = await this.projectToIntentList(item.project, area, tx);
        if (list) return this.moveIntentList(list, area, drop, shown.tasks || {}, tx);
        return false;
      }
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
        if (await this.moveProject(item.project, item.area, tg.area, tx)) await seatIn();
      }, tx);
    } else return this.moveTasks(item.tasks || [item.task], drop, shown.tasks || {}, tx);
    await this.saveAll();
    this.refresh();
  }

  // A project goes to live in another area: its note says so, the area's local view lists it,
  // its steps follow, and its seat in the old area's order goes.
  async moveProject(project, from, to, tx = null) {
    const mine = this.tasks().filter((x) => this.samePlace(x, project.file));
    const ideas = this.projectIntentLists(project);
    await tx?.add(mine.map((x) => x.file));
    const note = to.note || await this.createArea(to.name, null, tx);
    if (!note) return false;
    const file = project.file;
    const old = from.note ? this.app.metadataCache.fileToLinktext(from.note, file.path) : null;
    const link = this.app.metadataCache.fileToLinktext(note, file.path);
    const isOld = (v) => !!old && typeof v === "string" && v.replace(/^\[\[|\]\]$/g, "").split("|")[0] === old;
    await this.frontOwned(file, (fm) => {
      const own = this.classify(file, fm);
      if (!own?.project || own.area !== from.name || (project.uid && own.uid !== project.uid)) throw new Error(t("changed"));
      fm.area = to.name;
      if (Array.isArray(fm.parents)) { const i = fm.parents.findIndex(isOld); if (i >= 0) fm.parents[i] = `[[${link}]]`; }
      else if (isOld(fm.parents)) fm.parents = `[[${link}]]`;
    }, tx);
    await this.dropLinks(file, from.name, tx);
    await this.ensureAreaBlock(note, note, tx);
    for (const task of mine) await this.update(task, fm => {
      const current = this.taskOf(task.file, fm);
      if (current.project !== task.project || (fm.area && String(fm.area) !== task.area)) return false;
      fm.area = to.name;
    });
    for (const list of ideas) await this.moveIntentList(list, to.name, null, {}, tx, true);
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
    const alive = new Set([...this.allTasks().map((x) => x.uid), ...this.notes().filter((n) => n.project).map((n) => "p:" + n.file.path)]);
    const saved = key.startsWith("area:") ? this.areaSeats(key.slice(5)) : this.data.order.tasks[key] || [];
    const list = [...new Set([...saved, ...(shown[key] || []), ...moved])]
      .filter((k) => !moved.includes(k) && alive.has(k));
    const at = targetKey && targetList === key ? list.indexOf(targetKey) : -1;
    list.splice(at < 0 ? list.length : at + (drop.after ? 1 : 0), 0, ...moved);
    this.data.order.tasks[key] = list;
    await this.saveAll();
  }

  // Into a header means «into that area or project», onto a task means «where that task lives».
  // Changing the container's kind keeps every note's identity and description.
  // Existing linked idea lists stay independent; their binding is removed.
  async projectToIntentList(project, area = null, tx = null) {
    const own = this.classify(project.file);
    if (!own?.project || own.done) throw Error("intent-conflict");
    area ||= own.area;
    const destination = this.notes().find(n => !n.project && n.area === area);
    if (!destination) throw Error("intent-invalid");
    const steps = this.tasks().filter(task => this.samePlace(task, project.file));
    const bound = this.projectIntentLists(project);
    return this.track(t("projectToIntent"), [project.file, ...steps.map(x => x.file), ...bound.map(x => x.file)], async active => {
      await this.liveContainer(project, true, own.area);
      await this.liveContainer(destination, false, area);
      const current = new Map();
      for (const step of steps) {
        const live = await this.liveTask(step);
        if (!live || live.task.intent || !this.samePlace(live.task, project.file)) continue;
        current.set(step.uid, live.task);
      }
      let fields;
      await this.frontOwned(project.file, fm => {
        const live = this.classify(project.file, fm);
        if (!live?.project || live.done || live.area !== own.area || (project.uid && live.uid !== project.uid)) throw Error("intent-conflict");
        fm.uid ||= newUid(); fm.type = INTENT_LIST_TYPE; fm.intentArea = area; fm.intentListVersion = 1;
        delete fm.area; delete fm.projects;
        const oldArea=this.notes().find(n=>!n.project&&n.area===own.area)?.file;
        fm.parents = [...new Set([...(Array.isArray(fm.parents)?fm.parents:[]).filter(x=>!oldArea||this.app.metadataCache.getFirstLinkpathDest(String(x).replace(/^\[\[|\]\]$/g,""),project.file.path)!==oldArea),"[[" + destination.file.path.replace(/\.md$/, "") + "]]"])];
        fields = { ...fm };
      }, active);
      for (const step of current.values()) {
        await this.update(step, fm => {
          const live = this.taskOf(step.file, fm);
          if (live.project !== step.project || live.area !== step.area) throw Error("intent-conflict");
          fm.type = INTENT_TYPE; fm.intentArea = area; fm.intentList = "[[" + project.file.path.replace(/\.md$/, "") + "]]"; fm.intentListUid = fields.uid;
          delete fm.area; delete fm.projects; delete fm.intentLoose;
        });
      }
      for (const list of bound) await this.bindIntentList(list, null, active);
      this.forgetScan(); await this.setOpen("intents:" + area, true); this.refresh();
      return this.intentOf(project.file, fields);
    }, tx);
  }

  async moveTasks(tasks, drop, shown = {}, tx = null) {
    return this.track(t("aMove"), tasks.map((x) => x.file), () => this.moveNow(tasks, drop, shown), tx);
  }

  async moveNow(tasks, drop, shown = {}) {
    let tg = drop.target;
    if (tg.type === "task") {
      const live = await this.liveTask(tg.task);
      if (!live) return false;
      tg = { ...tg, task: live.task };
      drop = { ...drop, target: tg };
    }
    let area = tg.type === "task" ? tg.task.area : tg.area.name;
    if (tg.area?.note) {
      try { await this.liveContainer({ file: tg.area.note, uid: tg.area.uid }, false, area); }
      catch { new Notice(t("changed")); return false; }
    }
    // into a project's row: its step; by a project's row: a task of the area, like the row itself
    const file = drop.into ? (tg.type === "project" && !tg.project.looseIdeas ? tg.project.file : null) : (tg.type === "task" && tg.task.project ? this.projectFile(tg.task) : null);
    let intentList = null;
    if (file) {
      // The rendered destination may have disappeared, changed type or moved
      // since the gesture began. Read its current bytes before changing tasks.
      if (this.app.vault.getAbstractFileByPath(file.path) !== file) { new Notice(t("changed")); return false; }
      try {
        const [front] = splitNote(await this.app.vault.read(file));
        const fm = front && parseYaml(front.replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, ""));
        const container = fm && this.intentOf(file, fm), project = fm && this.classify(file, fm);
        intentList = container?.isList ? container : null;
        if ((!intentList && (!project?.project || project.done))
          || (tg.type === "project" && (!!tg.project.intentList !== !!intentList
            || (tg.project.uid && String(fm.uid || "") !== String(tg.project.uid))))) {
          new Notice(t("changed")); return false;
        }
        const bound = intentList && this.intentProjectFile(intentList);
        area = intentList ? (bound && this.classify(bound)?.area) || intentList.area : project.area;
        if (!area) { new Notice(t("changed")); return false; }
        drop = { ...drop, target: { ...tg, area: { ...tg.area, name: area },
          ...(tg.type === "task" ? { task: { ...tg.task, area } } : {}) } };
      } catch { new Notice(t("changed")); return false; }
    }
    const privateTarget = !!intentList || drop.pile === "intents" || !!tg.task?.intent;
    const project = intentList ? file.path.replace(/\.md$/, "") : file ? file.basename : null;
    const moved = [];
    for (const task of tasks) {
      // the link is written the way Obsidian writes links, so two notes of the same name stay apart
      const link = file ? this.app.metadataCache.fileToLinktext(file, task.file.path) : null;
      const fields = privateTarget ? {type:INTENT_TYPE,intentArea:area,intentList:intentList?"[["+project+"]]":null,intentListUid:intentList?.uid||null,intentLoose:intentList?null:true,area:null,projects:null}
        : {area,projects:link?[`[[${link}]]`]:null,...(task.intent?{type:TASK_TYPE,intentArea:null,intentList:null,intentListUid:null,intentLoose:null,intentItemImportKey:null}: {})};
      // Dropped into the pile, a task of today's list loses its day (it was today's by a date you
      // cannot see); dropped among today's rows, a task from the pile gets today. A day still ahead
      // moved within the pile is kept, and what waits in other hands keeps its day to come back.
      let fresh = null;
      const ok = await this.update(task, fm => {
        // Decide from the same version that is being written, including a
        // synced clock or Waiting change arriving immediately before this call.
        const current = this.taskOf(task.file, fm);
        const promoting = !privateTarget && current.intent;
        if (promoting) {
          fields.status = STATUS_OPEN; fields.completedDate = null;
          if (current.project) fields.source = "[[" + current.project + "]]";
        }
        if (!privateTarget && (promoting || current.status !== STATUS_WAITING)) {
          if (drop.pile === "ahead" && inFocus(current)) fields.scheduled = null;
          if (drop.pile === "focus" && (promoting || !inFocus(current))) fields.scheduled = today() + (current.at ? "T" + current.at : "");
        }
        for (const [key, value] of Object.entries(fields)) {
          if (value === null || value === undefined) delete fm[key]; else fm[key] = value;
        }
        fresh = this.taskOf(task.file, fm);
      });
      if (ok && fresh) {
        Object.assign(task, fresh);
        if (!privateTarget) { delete task.intent; delete task.listUid; delete task.loose; }
        moved.push(task);
      }
    }
    if (!moved.length) return false;
    if (intentList) await this.reopenIntentList(intentList);
    // Dropped into a project, but dated later than today? Its row hides behind the area's ⏳ — open
    // it, or the work you just moved vanishes from the screen.
    if (file && !privateTarget && moved.some((x) => !inFocus(x))) {
      const key = "future:" + area;
      if (!this.isShown(key, true)) await this.toggleShown(key, true);
    }
    if(privateTarget)await this.setOpen("intents:"+area,true);
    await this.reorder(moved, drop, shown);
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
  // Sends a task off (`waiting` + the day, and hour, to look at it again) or takes it back.
  async setWaiting(tasks, running, day = null, at = null) {
    const list = (Array.isArray(tasks) ? tasks : [tasks]).filter(Boolean);
    if (!list.length) return;
    return this.track(t("aRunning"), list.map((x) => x.file), async () => {
      for (const task of list) {
        const status = running ? STATUS_WAITING : STATUS_OPEN;
        const fields = { status };
        if (running && day) fields.scheduled = at ? `${day}T${at}` : day;
        // Coming back, the task loses the hour with the status: an hour of the day is the review
        // moment, and an ordinary task in this list is planned by the day, not by the clock.
        if (!running) fields.scheduled = !task.date || task.date > today() ? today() : task.date;
        const ok = await this.setFields(task, fields);
        if (!ok) return false;
        if (ok) {
          task.status = status;
          if ("scheduled" in fields) {
            task.date = fields.scheduled ? String(fields.scheduled).slice(0, 10) : null;
            task.at = timeOf(fields.scheduled);
          }
        }
      }
      this.refresh();
      return true;
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
  // Changes run one at a time: a gesture that lands while another change is still writing waits
  // its turn, so the notes it makes never end up in the first one's record (and its undo). A call
  // from inside a running change (a group date sets each date) joins it, and says so with `tx`.
  // Only an explicit transaction token joins a change. A slow disk never joins unrelated gestures.
  async serialize(run) {
    const before = this.txTail || Promise.resolve();
    let release;
    this.txTail = new Promise((r) => (release = r));
    await before;
    try { return await run(); } finally { release(); }
  }

  async track(label, files, run, tx = null) {
    if (tx && tx === this.tx) { await tx.add(files); return run(tx); }
    return this.serialize(async () => {
    // Writers register their own output paths before creating or renaming. Vault-wide events
    // also include other devices and plugins, whose notes must never enter this change's Undo.
    const snap = [];
    const cur = { renames: [], created: new Set(),
      record: (path, before, after) => {
        let item = snap.find(x => x.path === path);
        if (!item) { item={path,text:before}; snap.push(item); }
        if (item.recorded && item.after !== before) item.conflict = true;
        if (!item.recorded && item.text !== null) item.text = before;
        Object.assign(item, { after, recorded: true });
      },
      add: async (more) => { for (const item of await this.snapshot(more)) if (!snap.some((x) => x.path === item.path)) snap.push(item); } };
    this.tx = cur;
    const order = this.orderState();   // before: what undo puts back
    try {
      await cur.add(files);
      try { return await run(cur); }
      finally {
        // A failed second write still leaves the first write undoable.
        for (const item of snap) {
          if (item.recorded) continue;
          const live = this.app.vault.getAbstractFileByPath(item.path);
          item.after = live ? await this.app.vault.read(live) : null;
        }
        const changed = snap.filter(x => x.text !== x.after && (x.recorded || cur.created.has(x.path) || cur.renames.some(r=>r.to===x.path || r.from===x.path)));
        if (changed.length || order !== this.orderState()) cur.entry = this.remember(label, changed, order, cur.renames);
        // A companion can mutate occurrence files outside this transaction. Keep a
        // barrier so Cmd+Z never silently undoes an earlier, unrelated action instead.
        if (cur.delegated && !cur.entry) cur.entry = this.remember(label, [], order);
        if (cur.entry && cur.delegated) cur.entry.delegated = true;
      }
    } finally {
      this.tx = null;
    }
    });
  }

  // The last thirty changes, newest last. The order as it was before the change travels with each:
  // undoing a drag has to put the order back as well as the notes. What is folded does not travel:
  // that is the screen's business, not the change's.
  remember(label, snap, order, renames = []) {
    this.history = this.history || [];
    const entry = { label, snap, order, afterOrder: this.orderState(), renames };
    this.history.push(entry);
    if (this.history.length > 30) this.history.shift();
    return entry;
  }

  orderState() { return JSON.stringify(this.data.order); }

  // ⌘Z: the last change made from the list, put back.
  async undo() {
    return this.serialize(() => this.undoNow());
  }

  async undoNow() {
    const last = (this.history || []).pop();
    if (!last) { new Notice(t("nothingToUndo")); return 0; }
    if (last.delegated) { new Notice(t("repeatUndo")); return 0; }
    const restoreOrder = !last.afterOrder || last.afterOrder === this.orderState();
    let back = await this.restore(last.snap, last.renames);
    if (back === last.snap.length && last.order && last.order !== this.orderState() && restoreOrder) {
      this.data.order = JSON.parse(last.order);
      await this.saveAll();
      back++;
    }
    if (back) new Notice(t("undone", last.label));
    this.refresh();
    return back;
  }

  // Runs `action` and keeps what it destroyed; the notice puts it back within its ten seconds. What
  // the action left behind is kept too, so undo can tell «still as I left it» from «someone has
  // written here since» and never overwrite the second.
  async undoable(message, files, action) {
    // A delete that fails halfway (Sync, a file gone under it) has still deleted what came before
    // the failure: the record and the «Undo» are made for whatever actually changed, then the
    // error goes on up.
    let failed = null;
    const tx = await this.track(message, files, async active => {
      try { await action(active); } catch(e) { failed=e; }
      return active;
    });
    const entry = tx.entry;
    if (failed && !entry) throw failed;
    if (!entry) return async () => 0;
    const snap = entry.snap;
    this.undoStack = snap;
    // Every notice holds its own snapshot: two deletes in a row must not undo each other's work.
    const put = async () => {
      return this.serialize(async () => {
        this.history = (this.history || []).filter((x) => x !== entry);
        const canOrder=entry.afterOrder===this.orderState();
        const back=await this.restore(snap,entry.renames);
        if(back===snap.length && canOrder) { this.data.order=JSON.parse(entry.order); await this.saveAll(); }
        return back;
      });
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
    if (failed) { console.error("Focus Tasks:", failed); new Notice(String(failed?.message || failed)); }
    return put;
  }

  // Puts the last deleted notes back exactly as they were, uid and all — unless something has been
  // written at that path since (Sync, a script, the user): that is left alone and reported.
  async undoLast() {
    return this.serialize(async () => {
      const snap = this.undoStack || [];
      this.undoStack = null;
      this.history = (this.history || []).filter(x=>x.snap!==snap);
      return this.restore(snap);
    });
  }

  // Writes a snapshot back, skipping anything that has changed at that path since.
  async restore(snap, renames = []) {
    let back = 0;
    const handled = new Set();
    for (const { from, to } of [...(renames || [])].reverse()) {
      const before = snap.find((x) => x.path === from), after = snap.find((x) => x.path === to);
      if (!before || !after) continue;
      handled.add(from); handled.add(to);
      if (before.conflict || after.conflict) continue;
      const file = this.app.vault.getAbstractFileByPath(to);
      // The two paths form one rename: a conflict at either end refuses both halves.
      if (!file || this.app.vault.getAbstractFileByPath(from) || await this.app.vault.read(file) !== after.after) continue;
      try {
        await this.app.fileManager.renameFile(file, from);  // Obsidian also repairs incoming links
        let same = false;
        await this.app.vault.process(file, now => { same = now === after.after; return same ? before.text : now; });
        if (!same) continue;
        back += 2;
      } catch (e) { console.warn("Focus Tasks: cannot undo a rename", e); }
    }
    for (const { path, text, after, conflict } of snap) {
      if (handled.has(path)) continue;
      if (conflict) continue;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) {
        if (text !== null && after === null) { await this.app.vault.create(path, text); back++; }
        continue;
      }
      if (text === null) {  // it was made by the change being undone
        if (after === null || (await this.app.vault.read(file)) === after) { await this.trash(file); back++; }
        continue;
      }
      let same = false;
      await this.app.vault.process(file, (now) => { same = now === after || now === text; return same ? text : now; });
      if (same) back++;
    }
    this.forgetScan();
    if (back < snap.length) new Notice(t("undoKept", back, snap.length));
    this.refresh();
    return back;
  }

  // The note goes to the trash; the notice puts it back with the same uid.
  async liveTask(task) {
    const file = this.app.vault.getAbstractFileByPath(task.file?.path);
    if (!file || file.children) { new Notice(t("changed")); return null; }
    try {
      const text = await this.app.vault.read(file);
      const [front] = splitNote(text);
      const fm = front ? parseYaml(front.replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, "")) : null;
      const fresh = fm && this.taskOf(file, fm);
      if (!fresh || fresh.uid !== task.uid || !!fresh.intent !== !!task.intent) { new Notice(t("changed")); return null; }
      return { file, task: fresh, text };
    } catch (e) {
      new Notice(t("changed"));
      console.warn("Focus Tasks: cannot read the selected task", e);
      return null;
    }
  }

  async remove(task) { return this.removeTask(task); }

  // → the function that puts this very task back.
  async removeTask(task) {
    return this.undoable(t("deleted", task.text), [task.file], async tx => {
      const live = await this.liveTask(task);
      if (live) await this.trashOwned(live.file, tx, live.text);
    });
  }

  // The project's own day, in its note (`scheduled`); null takes it off.
  async setProjectDate(file, day, tx = null) {
    return this.track(t("aDate"), [file], async active => {
      await this.frontOwned(file, (fm) => {
        if (!this.classify(file, fm)?.project) throw new Error(t("changed"));
        if (day) fm.scheduled = day; else delete fm.scheduled;
      }, active);
      this.forgetScan();
      this.refresh();
      return true;
    }, tx);
  }

  // Several at once: one notice and one undo for all of them.
  async removeTasks(tasks) {
    const seen = new Set();
    const list = tasks.filter((x) => x.file && !seen.has(x.file.path) && seen.add(x.file.path));  // a row on screen twice is one note
    if (list.length === 1) return this.removeTask(list[0]);
    if (!list.length) return null;
    return this.undoable(t("deletedMany", list.length), list.map((x) => x.file), async tx => {
      for (const task of list) {
        const live = await this.liveTask(task);
        if (live) await this.trashOwned(live.file, tx, live.text);
      }
    });
  }

  // ⌘D: each task again, right above itself - the same note with a uid of its own, open whatever
  // the original was (a copy of a done task is one to do again). One undo takes all the copies back.
  async duplicateTasks(tasks) {
    const seen = new Set();
    const list = tasks.filter((x) => x.file && !seen.has(x.file.path) && seen.add(x.file.path));
    if (!list.length) return [];
    return this.track(t("aCopy"), [], async (tx) => {
      const copies = [];
      for (const stale of list) {
        const live = await this.liveTask(stale);
        if (!live) continue;
        const task = live.task;
        const name = await this.freeName(live.file.basename, live.file.parent?.path || this.tasksFolder);
        const path = normalizePath(`${live.file.parent?.path || this.tasksFolder}/${name}.md`);
        const file = await this.createOwned(path, live.text, tx);
        const uid = newUid();
        await this.frontOwned(file, (fm) => {
          fm.uid = uid;
          fm.status = STATUS_OPEN;
          delete fm.completedDate;
          delete fm.timeEntries;
          delete fm.time_entries;
          delete fm.completeInstances;
          delete fm.complete_instances;
          delete fm.skippedInstances;
          delete fm.skipped_instances;
          delete fm.intentItemImportKey;
          if (name !== task.text) fm.title = task.text;   // «X (2)» on disk, «X» on the row
        }, tx);
        const copy = { ...task, file, uid, status: STATUS_OPEN };
        if(task.intent){const parent=this.read().intents.find(x=>x.isList&&x.uid===task.listUid);if(parent?.done)await this.reopenIntentList(parent,tx);}
        else{const parent=this.projectFile(task,[...this.notes(),...this.read().closed].filter(x=>x.project)),own=parent&&this.classify(parent);if(own?.done)await this.setProjectDone(parent,false,own.uid,tx);}
        await this.seatTask(copy, task, { before: true });
        copies.push(copy);
      }
      return copies;
    });
  }

  // A free file name in the tasks folder.
  async freeName(base, folder = this.tasksFolder) {
    let name = base, i = 2;
    while (this.app.vault.getAbstractFileByPath(normalizePath(`${folder}/${name}.md`))) name = `${base} (${i++})`;
    return name;
  }

  // A row named only by a wiki link must not create the link's own destination file.
  taskName(text, base) {
    const links = [...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1].split("#")[0].replace(/\.md$/, "").split("/").pop());
    return links.includes(base) ? base + " (2)" : base;
  }

  // A new task note. `target`: {area, project (basename or null)}; `day` — the focus date.
  async createTask(text, target, day, tx = null) {
    return this.track(t("aNew"), [], (active) => this.createNow(text, target, day, active), tx);
  }

  async createNow(text, target, day, tx = null) {
    await this.ensureFolder(this.tasksFolder);
    const base = fileName(text).slice(0, 60) || t("newTask");
    const name = await this.freeName(this.taskName(text, base));
    if(target.intentList) {
      if(!target.projectFile || this.app.vault.getAbstractFileByPath(target.projectFile.path)!==target.projectFile)throw Error("intent-conflict");
      const raw=await this.app.vault.read(target.projectFile),fm=parseYaml(splitNote(raw)[0].replace(/^\uFEFF?---\r?\n/,"").replace(/\r?\n---$/,""));
      if(!fm || ![INTENT_LIST_TYPE,...(target.importing?[INTENT_TYPE]:[])].includes(fm.type) || fm.uid!==target.listUid || (!target.importing && fm.intentArea!==target.area))throw Error("intent-conflict");
    }
    else if(target.projectFile){const destination=await this.liveContainer({file:target.projectFile,uid:target.projectUid},true,target.area);if(destination.done)throw Error("intent-conflict");}
    const privateTarget = target.intentList || target.intentLoose;
    if (target.intentLoose && !this.notes().some(n => !n.project && n.area === target.area)) throw Error("intent-invalid");
    const front = ["---", `uid: ${newUid()}`, `type: ${privateTarget ? INTENT_TYPE : TASK_TYPE}`, `status: ${STATUS_OPEN}`];
    if (target.area) front.push(`${privateTarget ? "intentArea" : "area"}: ${JSON.stringify(target.area)}`);
    if (target.intentLoose) front.push("intentLoose: true");
    if(target.intentList) {
      front.push(`intentList: ${JSON.stringify("[[" + target.projectFile.path.replace(/\.md$/, "") + "]]")}`,`intentListUid: ${JSON.stringify(target.listUid)}`);
    } else if (target.project && !privateTarget) {
      // the page and the rows know which note their project is; a name alone is looked up
      const path = normalizePath(`${this.tasksFolder}/${name}.md`);
      const note = (target.projectFile && { file: target.projectFile })
        || this.notes().find((n) => n.project && n.file.basename === target.project && (!target.area || n.area === target.area))
        || this.notes().find((n) => n.project && n.file.basename === target.project);
      front.push("projects:", `  - ${JSON.stringify(note ? this.projectLink(note.file, path) : `[[${target.project}]]`)}`);
    }
    if (day) front.push(`scheduled: ${day}`);
    if (privateTarget || name !== text) front.push(`title: ${JSON.stringify(text)}`);
    front.push("---", "");
    const path = normalizePath(`${this.tasksFolder}/${name}.md`);
    const file = await this.createOwned(path, front.join("\n"), tx);
    if (target.intentList) {
      const list = this.intentOf(target.projectFile);
      if (list?.isList) await this.reopenIntentList(list, tx);
    }
    this.lastTarget = target;
    const fields = parseYaml(front.slice(1, -2).join("\n"));
    return this.taskOf(file, fields);
  }

  // Puts a task where the user picks: an area, or a project inside it.
  placeTask(task) {
    if(task.intent) {
      const lists=this.read().intents.filter(x=>x.isList);
      const areas=this.notes().filter(x=>!x.project).map(x=>({label:`${x.area} · ${t("looseTasks")}`,area:x.area}));
      return new TargetModal(this.app,[...areas,...lists.map(x=>({label:`📔 ${x.area} › ${x.title}`,list:x}))],tg=>this.moveTasks([task],tg.list?{into:true,pile:"intents",target:{type:"project",area:{name:tg.list.area},project:{...tg.list,intentList:true}}}:{into:true,pile:"intents",target:{type:"area-title",area:{name:tg.area}}}),false).open();
    }
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
    return this.track(t("aProject"), [task.file, note].filter(Boolean), (tx) => this.toProjectNow(task, tx));
  }

  async toProjectNow(task, tx = null) {
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
    const file = await this.createProject(holder, name, undefined, null, false, tx);
    if (!file) return null;
    const text = keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text) await this.processOwned(file, (t0) => t0.includes(FocusTasks.STEPS_BLOCK)
      ? t0.replace(FocusTasks.STEPS_BLOCK, text + "\n\n" + FocusTasks.STEPS_BLOCK)   // the note above, the steps below
      : t0.replace(/\s*$/, "\n\n") + text + "\n", tx);
    await this.frontOwned(file, (fm) => { if (task.uid && !fm.uid) fm.uid = task.uid; }, tx);
    if (steps.length) {
      let day = task.date;
      for (const step of steps) {
        await this.createTask(step, { area, project: name, projectFile: file }, day, tx);
        day = null;  // the date the task carried goes to the first step only
      }
      await this.trash(task.file);
    } else if (task.date) {
      // It was in the focus today: it stays there as the project's first step, or the day would
      // quietly lose it. The row reads the same as the project — one click renames it.
      await this.setFields(task, { projects: [this.projectLink(file, task.file.path)] });
      if (rest.trim()) await this.processOwned(task.file, (t0) => splitNote(t0)[0] + "\n", tx);
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
    const task = await this.createTask(text, { area: anchor.area, project: anchor.project, ...(anchor.intent ? { intentList: true, listUid: anchor.listUid, projectFile: this.projectFile(anchor) } : {}) }, day);
    // Enter under a row means «here», not «somewhere below»: without a seat of its own the new task
    // is sorted by date and name and usually lands at the bottom of the list.
    if (task) await this.seatTask(task, anchor);
    return task;
  }

  // Preserve the visible order and insert a task beside its anchor.
  async seatTask(task, anchor, { before = false } = {}) {
    const key = listOf(task);
    if (key !== listOf(anchor)) return;
    // Everything in the list, ticked ones included: a task that loses its seat when it is checked
    // off would jump somewhere else the moment the box is unchecked. An area's list also seats its
    // projects («p:…»): those keep their places.
    const mine = this.allTasks()
      .filter((x) => listOf(x) === key)
      .sort(this.rowOrder())
      .map((x) => x.uid)
      .filter((uid) => uid && uid !== task.uid);
    const saved = key.startsWith("area:") ? this.areaSeats(key.slice(5)) : this.data.order.tasks[key] || [];
    const order = saved.filter((k) => k !== task.uid && (k.startsWith("p:") || mine.includes(k)));
    for (const uid of mine) if (!order.includes(uid)) order.push(uid);
    const i = order.indexOf(anchor.uid);
    order.splice(i < 0 ? order.length : i + (before ? 0 : 1), 0, task.uid);
    this.data.order.tasks[key] = order;
    await this.saveAll();
  }

  async addLine(target, text, day) {
    return this.createTask(text, { ...target, area: target.area ?? target.file?.parent?.name }, day);
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

  // `note`: an existing note that becomes the area itself — its frontmatter gets `area` and `type`,
  // nothing else of it changes. Without one, a new note named after the area.
  async createArea(name, note = null, tx = null) {
    return this.track(t("aNew"), note ? [note] : [], active => this.createAreaNow(name, note, active), tx);
  }

  async createAreaNow(name, note = null, tx = null) {
    if (note) {
      await tx?.add([note]);
      await this.frontOwned(note, (fm) => { fm.area = name; fm.type = this.settings.typeArea; }, tx);
      await this.ensureAreaBlock(note,note,tx);
      this.forgetScan();
      return note;
    }
    await this.ensureFolder();
    const base = fileName((this.settings.areaNoteName || "{area}").replace("{area}", bare(name) || name));
    const path = normalizePath(`${this.folder}/${base}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) { new Notice(t("noteExists", path)); return null; }
    const extra = (this.settings.areaFrontmatter || "").trim();
    const file = await this.createOwned(path, ["---", ...(extra ? extra.split("\n") : []), `area: ${JSON.stringify(name)}`,
      `type: ${this.settings.typeArea}`, "---", "", FocusTasks.STEPS_BLOCK, ""].join("\n"), tx);
    return file;
  }

  areaTaken(name) {
    return this.notes().some((n) => bare(n.area).toLowerCase() === bare(name).toLowerCase());
  }

  // `note`: an existing note that becomes the area (its name is offered as the area's name).
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
  async setLinked(file, note, quiet = false, tx = null) {
    return this.track(t("aMove"), [file], async active => {
    await this.frontOwned(file, (fm) => {
      if (note) fm.note = `[[${this.app.metadataCache.fileToLinktext(note, file.path)}]]`;
      else delete fm.note;
    }, active);
    if (!quiet) new Notice(note ? t("linked", note.basename) : t("unlinked"));
    this.forgetScan(); this.refresh();
    }, tx);
  }

  // Any note of the vault except the task files; recently edited first.
  pickNote(onChoose) {
    const files = this.app.vault.getMarkdownFiles().filter((f) => !this.classify(f)).sort((a, b) => b.stat.mtime - a.stat.mtime);
    new NotePicker(this.app, files, onChoose).open();
  }

  // Drops the 📁 lines pointing at a project file (by name or by path) from its area's files.
  async dropLinks(file, areaName, tx = null) {
    const names = [file.basename, file.path.replace(/\.md$/, "")].map(escapeRe).join("|");
    const link = new RegExp(`^\\s*[-*] 📁 \\[\\[(${names})(\\|[^\\]]*)?\\]\\]\\s*$`);
    for (const n of this.notes()) {
      if (n.project || n.area !== areaName) continue;
      await this.processOwned(n.file, (body) => body.split("\n").filter((l) => !link.test(l)).join("\n"), tx);
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
  // What a ```focus-tasks``` block shows: `project: [[Name]]` in its text names a project; with no
  // text, a block in a project's own note shows that project. Anywhere else it is the whole list.
  blockPage(src, sourcePath) {
    const a = /^\s*area:\s*(.+?)\s*$/m.exec(src || "");
    if (a) {
      const link = a[1].replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
      const file = this.app.metadataCache.getFirstLinkpathDest(link, sourcePath || "");
      const own = file && this.classify(file);
      return { area: own && !own.project ? file : null, kind: "area", missing: own && !own.project ? null : link };
    }
    const m = /^\s*project:\s*(.+?)\s*$/m.exec(src || "");
    if (m) {
      const link = m[1].replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
      const file = this.app.metadataCache.getFirstLinkpathDest(link, sourcePath || "")
        || this.notes().find((n) => n.project && n.file.basename === link)?.file;
      // named and not found is not «the whole list»: the block says so instead
      if(file&&this.intentOf(file)?.isList)return {intent:file};
      return { project: file && this.classify(file)?.project ? file : null, missing: file ? null : link };
    }
    const file = sourcePath ? this.app.vault.getAbstractFileByPath(sourcePath) : null;
    if(file&&this.intentOf(file)?.isList)return {intent:file};
    const own = file && this.classify(file);
    return own ? own.project ? { project: file } : { area: file, kind: "area" } : null;
  }

  async ensureAreaBlock(note, area = note, tx = null) {
    let added = false;
    const hasBlock = text => [...text.matchAll(/^```focus-tasks[^\n]*\n([\s\S]*?)^```/gm)]
      .some(m => note===area && !m[1].trim() || this.blockPage(m[1], note.path)?.area?.path === area.path);
    if (hasBlock(await this.app.vault.cachedRead(note))) return false;
    await this.processOwned(note, (text) => {
      if (hasBlock(text)) return text;
      added = true;
      const block = note === area ? FocusTasks.STEPS_BLOCK
        : "```focus-tasks\narea: [[" + this.app.metadataCache.fileToLinktext(area, note.path) + "]]\n```";
      return text.replace(/\s*$/, "") + "\n\n" + block + "\n";
    }, tx);
    return added;
  }

  // The block at the end of a project's note, once: the note is the project's page, the block is
  // where its steps are. A note the project is linked to (not the project's own) names it.
  static STEPS_BLOCK = "```focus-tasks\n```";
  async ensureStepsBlock(note, project = note) {
    // a block of this very project: a bare one in the project's own note, or one that names it
    const has = (text) => [...text.matchAll(/^```focus-tasks[^\n]*\n([\s\S]*?)^```/gm)]
      .some((m) => this.blockPage(m[1], note.path)?.project === project);
    let added = false;
    await this.app.vault.process(note, (text) => {
      if (has(text)) return text;
      added = true;
      const body = note === project ? FocusTasks.STEPS_BLOCK : "```focus-tasks\nproject: [[" + this.app.metadataCache.fileToLinktext(project, note.path) + "]]\n```";
      return text.replace(/\s*$/, "") + "\n\n" + body + "\n";
    });
    return added;
  }

  async stepsBlocksEverywhere() {
    let n = 0;
    for (const note of this.notes().filter((x) => x.project)) if (await this.ensureStepsBlock(note.file)) n++;
    new Notice(n ? t("stepsBlocksAdded", n) : t("stepsBlocksNone"));
    return n;
  }

  async createProject(area, name, afterPath, linkTo = null, fresh = null, tx = null) {
    return this.track(t("aNew"), [], active => this.createProjectNow(area, name, afterPath, linkTo, fresh, active), tx);
  }

  async createProjectNow(area, name, afterPath, linkTo = null, fresh = null, tx = null) {
    await this.ensureFolder();
    const path = normalizePath(`${this.folder}/${fileName(name)}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) { new Notice(t("noteExists", path)); return null; }
    const note = area.note || await this.createArea(area.name, null, tx);
    if (!note) return null;
    const extra = (this.settings.projectFrontmatter || "").trim().replaceAll("{areaNote}", this.app.metadataCache.fileToLinktext(note, path));
    await tx?.add([path, note]);
    const file = await this.createOwned(path, ["---", ...(extra ? extra.split("\n") : []), `area: ${JSON.stringify(area.name)}`,
      `type: ${this.settings.typeProject}`, "---", "", FocusTasks.STEPS_BLOCK, ""].join("\n"), tx);
    if (linkTo) await this.setLinked(file, linkTo, true, tx);
    await this.ensureAreaBlock(note, note, tx);
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
      for (const prefix of ["project:", "later:", "done:", "waiting:", "pagefold:", "steps:", "fresh:", "project-intents:", "project-header:", "project-focusoff:", "project-focuson:", "area-page-backlogoff:"]) {
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
    const mine = this.tasks().filter(x => this.samePlace(x, file));
    const ideas = this.projectIntentLists(file);
    return this.track(t("aRename"), [file, ...mine.map(x=>x.file), ...ideas.map(x=>x.file)], tx=>this.renameProjectNow(file,name,mine,tx,ideas));
  }

  async renameProjectNow(file, name, mine, tx, ideas = []) {
    const path = normalizePath(`${file.parent?.path && file.parent.path !== "/" ? file.parent.path + "/" : ""}${fileName(name)}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) { new Notice(t("noteExists", path)); return; }
    const old = file.path;
    // Its steps, found before the name changes. Obsidian rewrites the links it had resolved to this
    // note; a step named like its project had resolved its own link to itself and would be left
    // pointing at a name that no longer exists — so every step is re-pointed here, by hand.
    await this.renameOwned(file, path, tx);
    await this.renamed(path, old);
    const fresh = this.app.vault.getAbstractFileByPath(path) || file;
    for (const task of mine) await this.update(task, fm => {
      const current = this.taskOf(task.file, fm);
      if (!this.samePlace(current, fresh) && current.project !== old.replace(/\.md$/, "") && current.project !== old.split("/").pop().replace(/\.md$/, "")) return false;
      fm.projects = [this.projectLink(fresh, task.file.path)];
    });
    for (const list of ideas) await this.frontOwned(list.file, fm => {
      if (fm.uid !== list.uid || fm.type !== INTENT_LIST_TYPE || fm.intentProjectUid !== list.projectUid) throw Error("intent-conflict");
      fm.intentProject = "[[" + fresh.path.replace(/\.md$/, "") + "]]";
    }, tx);
  }

  trash(file) {
    return this.app.fileManager.trashFile ? this.app.fileManager.trashFile(file) : this.app.vault.trash(file, true);
  }

  async createOwned(path, text, tx) {
    await tx?.add([path]);
    const file = await this.app.vault.create(path, text);
    tx?.created.add(path);
    tx?.record(path, null, text);
    return file;
  }

  async renameOwned(file, path, tx) {
    const from = file.path;
    await tx?.add([path]);
    const before = await this.app.vault.read(file);
    await this.app.fileManager.renameFile(file, path);
    if (tx) {
      tx.renames.push({ from, to: path });
      tx.record(from, before, null);
      // Record the bytes that the rename moves, not a later read that may already
      // contain another device's edit. Unexpected self-link changes refuse Undo too.
      tx.record(path, null, before);
    }
  }

  async trashOwned(file, tx, expected = null) {
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw Error("intent-conflict");
    const before = await this.app.vault.read(file);
    if (expected !== null && before !== expected) throw Error("intent-conflict");
    await this.trash(file);
    tx?.record(file.path, before, null);
  }

  async liveContainer(note, project, area) {
    const file = note.file;
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw Error("intent-conflict");
    const text = await this.app.vault.read(file), front = splitNote(text)[0];
    const fm = front && parseYaml(front.replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, ""));
    const live = fm && this.classify(file, fm);
    if (!live || !!live.project !== project || live.area !== area || (note.uid && live.uid !== note.uid)) throw Error("intent-conflict");
    return { ...live, text };
  }

  // The project's note goes to the trash; its tasks stay in the area as loose ones. Undo brings back
  // the note and the links its tasks had to it.
  // `withTasks`: its tasks go to the trash with it (all of them, done ones too), in the same undo.
  async removeProject(area, project, withTasks = false) {
    const name = project.file.basename;
    const mine = this.tasks().filter((x) => this.samePlace(x, project.file));
    const lists = this.projectIntentLists(project), entries = lists.flatMap(list => this.intentEntries(list));
    const touched = this.notes().filter((n) => !n.project && n.area === area.name).map((n) => n.file);
    await this.undoable(t("projectDeleted", name), [project.file, ...mine.map((x) => x.file), ...lists.map(x => x.file), ...entries.map(x => x.file), ...touched], async tx => {
      const liveProject = await this.liveContainer(project, true, area.name);
      const sources = new Map();
      for (const list of lists) {
        const raw = await this.app.vault.read(list.file), fm = parseYaml(splitNote(raw)[0].replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, ""));
        if (fm.type !== INTENT_LIST_TYPE || fm.uid !== list.uid || fm.intentProjectUid !== list.projectUid) throw Error("intent-conflict");
        sources.set(list.file, raw);
      }
      // a task that only knew where it was through this project keeps the area it was shown in
      for (const task of mine) {
        const live = await this.liveTask(task);
        if (!live || !this.samePlace(live.task, project.file)) continue;
        if (withTasks) await this.trashOwned(live.file, tx, live.text);
        else await this.setFields(live.task, { projects: null, area: live.task.area || area.name });
      }
      if (withTasks) {
        for (const entry of entries) {
          const live = await this.liveTask(entry);
          if (live && live.task.listUid === entry.listUid) await this.trashOwned(live.file, tx, live.text);
        }
        for (const list of lists) {
          if (await this.app.vault.read(list.file) !== sources.get(list.file)) throw Error("intent-conflict");
          await this.trashOwned(list.file, tx);
          await this.forget("steps:" + list.file.path); await this.forget("intent-done:" + list.uid);
          delete this.data.order.tasks["intent:" + list.uid];
        }
      } else for (const list of lists) await this.bindIntentList(list, null, tx);
      await this.dropLinks(project.file, area.name, tx);
      await this.trashOwned(project.file, tx, liveProject.text);
      await this.forget("steps:" + project.file.path);
      await this.forget("project-intents:" + project.file.path);
      await this.forget("project-header:" + project.file.path);
      this.data.order.tasks["area:" + area.name] = this.areaSeats(area.name).filter((k) => k !== "p:" + project.file.path);
      await this.saveAll();
    });
  }

  deleteProject(area, project) {
    const mine = this.tasks().filter((x) => this.samePlace(x, project.file));
    const ideas = this.projectIntentLists(project).reduce((n,list) => n + this.intentEntries(list).length, 0);
    new ConfirmModal(this.app, t("deleteProjectQ", project.file.basename), t("deleteProjectText", mine.length) + (ideas ? " " + t("deleteProjectIdeas", ideas) : ""), t("delete"),
      () => this.removeProject(area, project, true)).open();
  }

  // The area, its projects and its tasks all go to the trash; undo brings all of them back.
  async removeArea(area) {
    const containers = this.notes().filter((n) => n.area === area.name);
    const files = containers.map(n => n.file);
    const intents = this.read().intents.filter(x => x.isList && x.area === area.name);
    const mine = this.allTasks().filter((x) => x.area === area.name);
    await this.undoable(t("areaDeleted", area.name), [...mine.map((x) => x.file), ...intents.map(x=>x.file), ...files], async tx => {
      const containerSources = new Map();
      for (const n of containers) containerSources.set(n.file, (await this.liveContainer(n, !!n.project, area.name)).text);
      const sources = new Map();
      for (const list of intents) {
        const raw = await this.app.vault.read(list.file), front = splitNote(raw)[0];
        const fm = parseYaml(front.replace(/^\uFEFF?---\r?\n/, "").replace(/\r?\n---$/, ""));
        if (this.app.vault.getAbstractFileByPath(list.file.path)!==list.file || fm?.uid!==list.uid || fm.type!==(list.isList ? INTENT_LIST_TYPE : INTENT_TYPE) || fm.intentArea!==area.name) throw Error("intent-conflict");
        sources.set(list.file,raw);
      }
      for (const task of mine) {
        const live = await this.liveTask(task);
        if (live?.task.area === area.name) await this.trashOwned(live.file, tx, live.text);
      }
      // Do this before removing the area itself: a conflicting source leaves the area accessible.
      for (const list of intents) {
        await this.trashOwned(list.file,tx,sources.get(list.file));
        await this.forget("steps:"+list.file.path);
        await this.forget("intent-done:"+list.uid);
        delete this.data.order.tasks["intent:"+list.uid];
      }
      for (const f of files) {
        if (this.classify(f)?.area !== area.name) continue;
        await this.trashOwned(f, tx, containerSources.get(f));
        await this.forget("project:" + f.path);
        await this.forget("steps:" + f.path);
        await this.forget("project-header:" + f.path);
      }
      await this.forget("area:" + area.name);
      await this.forget("intents:" + area.name);
      delete this.data.order.tasks["intent-lists:"+area.name];
      await this.saveAll();
    });
  }

  deleteArea(area) {
    const mine = this.tasks().filter((x) => x.area === area.name);
    const lists=this.read().intents.filter(x=>x.isList&&x.area===area.name), entries=this.read().intentTasks.filter(x=>x.area===area.name);
    const text=lists.length||entries.length ? t("deleteAreaIdeasText",area.projects.length,mine.length,lists.length,entries.length) : t("deleteAreaText",area.projects.length,mine.length);
    new ConfirmModal(this.app, t("deleteAreaQ", area.name), text, t("delete"),
      () => this.removeArea(area)).open();
  }

  // The project note a task points at. The link may be a name, a path or an alias; two notes may
  // share a name, so Obsidian resolves it from the task's own note first, and an area of its own
  // decides the rest.
  projectFile(task, candidates = null) {
    if(task.intent) {
      const lists=this.read().intents;
      const byUid=lists.find(x=>x.uid===task.listUid);
      if(byUid)return byUid.file;
      const file=this.app.metadataCache.getFirstLinkpathDest(task.project||"",task.file.path);
      return file && this.intentOf(file)?.isList ? file : null;
    }
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
