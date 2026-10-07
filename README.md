# Focus Tasks

A focus list for Obsidian in the spirit of TickTick / Things: **areas → projects → tasks**, built on
plain Markdown notes — one note per task. What is due today (or overdue) is on top; the rest waits one
click away.

*[Русская версия ниже](#focus-tasks-по-русски)*

## How it works

- **A task is a note.** Every task is its own note in the tasks folder (`Задачи` by default), with
  `type: задача` and the rest in the frontmatter: `uid` (its identity, never rewritten), `status`,
  `area`, `projects`, `scheduled`, `due`, `completedDate`, `priority`. The body of the note is the
  task's description — and when a description grows into a plan, «Make it a project» turns the task
  into one.
- **Areas and projects are notes too**, in the folder from the settings (`Tasks` by default). An area
  note has `area: <name>` in its frontmatter; a project note also has `type: project`.
- **Your notes stay yours.** An area or a project can be *linked* to any note of your vault. A click on
  its name opens that note, and the task file is one menu item away («Open task file»). Linked notes
  are never modified.
- **The field names are [TaskNotes](https://github.com/callumalpass/tasknotes)'**, so that plugin can
  be installed on the same notes and bring its recurrence, reminders, time tracking and calendar
  views, while this list stays the daily focus on top. `uid` and `area` are this plugin's own; both
  sides keep keys they do not know. **Settings → Focus Tasks → TaskNotes** installs it and points it
  at these notes in one click — see [TaskNotes, in one click](#tasknotes-in-one-click).

## The view

Open it with the ribbon icon or the command **Focus Tasks: Open Focus**. You can also put it into
any note as a code block:

````markdown
```focus-tasks
```
````

Add `cssclasses: [focus-tasks-note]` to that note's frontmatter to hide its properties and backlinks.

**A project's note is its page.** The same block at the bottom of a project note shows that project
alone: today's steps, the undated and upcoming ones dimmed under them, «+ Step in this project»
(a step typed there starts with no date; **⌘1** while typing makes it today's), and the closed steps
folded under «✓ Done · N». Everything about the project — what it is, links, notes — goes above the
block. New project notes come with the block; an older one gets it the first time it is opened from
the list, and the command **Focus Tasks: Steps block in every project note** adds it everywhere at
once. `project: [[Name]]` inside the block puts a project's steps into any other note.

What you can do in the view:

| | |
|---|---|
| Complete a task | click its checkbox; the closed task stays in its area's Done block for the day; its checkbox reopens it. An area without open focus work leaves Focus and remains available through All and Done |
| See what is ahead in a project | hover the project's count/`+N`; the clock in its popup opens its upcoming and undated steps right under the row, where ⌘1 or a drag brings one into today; the area's ⏳ shows the same steps among everything else that is not today |
| Hand a task off | «Waiting…» in the row's menu, with the day and hour to look at it again: the task leaves the focus for the **▷ Waiting · N** shelf at the bottom (by area, soonest first, never in the pile of what is not today). On its day it comes back among the rows that are due, marked ▷, and that ▷ takes it back |
| A robot's mark | the list shows no priorities; the one dot it draws is `priority: low`, what a script or a bot leaves on a task it added and you have not looked at — a click on the dot (or «Take the robot's mark off» in the menu) removes it |
| A project's own date | select the project's row (its grip) and press **⌘/Ctrl+1…4**, or «Project date…» in its menu: the date goes to the project's note, not to its step. Set, it alone decides whether the project is in the focus (due) or in the area's ⏳ pile with all of its steps; the steps keep their days |
| Finish a project's current steps | check off its last step: within a visible area the empty project row remains for the day, marked «done N», and its «+» adds the next step. This does not automatically close the project |
| Edit a task | click its text: edit in place, **Enter** saves and opens a new row below, **Esc** saves and leaves the row selected (a wiped row keeps its text) |
| Date while editing | **⌘/Ctrl+1** today, **⌘/Ctrl+2** tomorrow, **⌘/Ctrl+3** date picker, **⌘/Ctrl+4** no date, **⌘/Ctrl+5** «Waiting…» (the card asks when to look again), **⌘/Ctrl+Enter** saves and opens the task as a note, **⌘/Ctrl+⌫** deletes the task (Undo in the notice) and moves the editor to the row above; a day that takes the row out of its list sends it off at once and moves the editor to the next row |
| Duplicate | **⌘/Ctrl+D** while editing or selecting inserts a copy above each source and immediately edits the first copy. Each copy has its own UID; one Undo removes the whole group. A copy of Waiting work is open and its new shelf is revealed if hidden |
| Undo | **⌘/Ctrl+Z** in the list takes back the last change (a tick, a date, a move, a delete) and selects the rows it touched; while editing, with nothing typed yet, it does the same — typed text keeps the editor's own undo |
| Date picker | click the date on the right, type `25.12` / `tomorrow` or pick a day, then Save / Enter; the same task card accepts an optional hour, blank means day-only |
| Add a task | **+** on an area or a project header; «Empty» in an empty area. Adding a second project step unfolds the project before typing; the draft stays in the same step list |
| Menu | right-click a row; on a phone, long-press its text |
| Find | **⌘/Ctrl+F** in the list's pane (or the command «Find in the list»): any area, project or open task by part of its name; choosing one opens whatever hides it, scrolls to it and selects it |
| Reorder / move | desktop: drag the grip; phone: long press, choose Reorder, then drag the temporary grip and finish with Done. Areas reorder among areas, projects within their area, tasks anywhere; drop a task on a header to move it into that area or project |
| Select a row | click the grip on the left (again: drops it), or **Esc** while editing. A selected row is a block picked up as a whole, as in Notion: **↑/↓** walk the list, **Shift+↑/↓** extend, **Enter** edits it, **⌫** deletes (Undo in the notice), **⌘/Ctrl+1…4** date it, **⌘/Ctrl+5** hands it off («Waiting…»), **⌘/Ctrl+Enter** opens its note, **⌘/Ctrl+Z** takes back the last change, **Esc** drops the selection |
| Select several | **Shift**-click selects every task from the last clicked one, **⌘/Ctrl**-click adds or drops one; the grip of a selected row drags them all; its date, its menu, the keys above or **⌘/Ctrl+1…4** work on all of them |
| Upcoming | the ⏳ on an area's header opens its undated and future tasks; what is in other hands is not there but on the **▷ Waiting** shelf at the bottom |
| Everything | «All» at the bottom shows every area (also those with nothing due); «Hide» goes back |
| Fold | carets on headers; «Collapse all» / «Expand all» at the bottom |
| Areas | «+ Area», «+ Area from a note» at the bottom; area menu: new project, project from a note, link a note, delete |
| Projects | menu: rename (Enter adds another project), link a note, open task file, delete |

Deleted areas and projects go to the trash (as set in *Files and links → Deleted files*); a deleted
task can be restored from the notice that appears.

## Local pages, phone capture and Calendar reminders

An area's own note can contain a `focus-tasks` block showing all of that area's projects
and tasks. It is added once when the area is opened. Additions inside area/project pages
start undated. A linked custom note can use `area: [[Area note]]` in the block.
Projects and expanded steps align with loose tasks, as on a project's own page.
Creating or moving a project uses this view without adding a separate Projects section.

On a phone, folders align with checkboxes and project names align with task text. The normal list
has no grip column. Long press opens the menu; Reorder temporarily shows drag handles
and Done. Text remains a scrolling surface. Done, leaving the list or backgrounding ends the mode.
Project context sits above its first action; dates and status controls wrap underneath the action. Expanded steps
keep the same columns, with `+N` / `−N` opening and folding the project.
Task previews use the same three-line limit; editing shows the full text. Capture
is local immediately; uploading an offline iPhone note still requires Obsidian Sync.

TaskNotes is optional. The plugin reads and writes task notes independently.
If used, recurring-instance completion is delegated to TaskNotes; undo that occurrence
in TaskNotes. Focus Undo preserves changes owned by the companion.
Apple Calendar notification support uses the optional host bridge in [the integration guide](CALENDAR_INTEGRATION.md).
An explicit scheduled hour automatically creates a one-hour reminder event with one alert
at its start; dates alone do not create events. Change the day without losing the hour;
clear the clock to remove the reminder. The calendar check icon appears only after iCloud
confirms the current task and time. Pending/error icons never claim success. Calendar links
open the task in Focus by its permanent UID: its area, future pile and project steps unfold,
then the task is scrolled into view and selected. Renaming or moving the task does not break
the link. Missing, ambiguous or closed tasks produce a notice; unfinished edits are preserved.
There is no separate reminder menu.
An event notification and a native Apple Reminders checkbox are different integrations.

## Idea lists

An area shows one total count across Focus, Backlog and Ideas. Hovering or focusing the count opens
an anchored category popup; on a phone, tap it. Project counts sit next to the project name, reusing
`+N` to expand additional steps. Their popup omits empty categories. The first project idea can be
added from its context menu. The popup never changes text width or row height.
Each independently shows/hides its tasks. Several categories can be open together. Open categories
use full brightness; closed categories are dimmed, with no border, background or underline.
When an area is folded, all available controls are dimmed. Clicking one unfolds the area and shows
that category, preserving the other saved switches. Expanding with the caret restores them all.
Hiding Focus also hides its projects, unless their Backlog tasks or Ideas are visible. Fold arrows
appear only for actual steps; hidden categories leave no empty project headers or steps blocks.
Counters include hidden task steps, exclude pending Waiting/completed/cancelled records, and stay
unchanged when folded. Pending Waiting keeps its own shelf; on its return date/time it counts in Focus.
Adding a task opens its destination category so the new row stays visible. Category switches clear
task selection; UID links reveal a hidden task. The same controls appear in area/project notes. A project has one header when Focus and Backlog
are both visible. **All** keeps its existing behavior and has no global Ideas entry.
Areas show independent lists and project collections under their project names. Inside a project,
ideas have a warm side line and a lightbulb marker, without an extra list level or redundant heading.
Every area has a virtual **Ideas** row, including when empty. It groups loose ideas and imports from
the area note itself; it creates no container file. Named lists remain separate. Empty real lists
can be completed and reopened like projects. A project can become an idea list through its context
menu or a drop onto Ideas, preserving every note UID and description. Undo restores the whole change.
Empty scopes remain accessible, and merely opening them writes no notes. The project collection is
created on first addition. Existing lists can be linked to a project or kept as area lists.
Rows share checkboxes, inline editing, dates, selection, drag order, duplicate-above and Undo.
A dated idea stays in its list. Explicit **Move to backlog** or **Move to Focus today** preserves UID,
description and the linked project; Undo returns it. Search opens the matching row inside Focus.
Project rename/move preserves the connection by UID. Confirmed project deletion includes its ideas
and is undoable; removing a project while keeping its tasks keeps its ideas as an area list.
Visibility and folds are local to each device. On phones grouped targets remain at least 44px and
wrap below headers without squeezing project names.

Card migration keeps each old idea's UID on its list. Top-level TODO items become independent rows;
nested explanations stay in descriptions, completed history stays completed within the list, and
free context stays in the list note. The explicit migration tool verifies private backups outside
the vault before conversion and refuses sources changed since the approved routing plan.

## Settings

| Setting | Default | |
|---|---|---|
| Folder | `Tasks` | where task files live; created when needed |
| Language | Auto | English / Русский |
| Area note name | `{area}` | file name of a new area note (`{area}` = the name without a leading emoji) |
| Extra frontmatter (areas) | — | YAML lines for every new area note, e.g. `parents: ["[[Projects]]"]` |
| Extra frontmatter (projects) | — | YAML lines for every new project note; `{areaNote}` = its area's note, e.g. `parents: ["[[{areaNote}]]"]` |
| `type` of an area / project | `area` / `project` | `project`/`проект` and `area`/`область` are always recognised |
| Date format | `DD.MM.YY` | any moment.js format |
| TaskNotes | — | install the companion plugin and point it at these tasks (see above) |

Settings and drag order are saved in `data.json`. Folding, opened piles and All are
remembered per device, so a phone cannot unfold the Mac's list through Sync.

## Upgrading from 0.1.0

**0.2.0 changes what a task is.** In 0.1.0 a task was a checkbox line inside an area's note; now every
task is a note of its own in the tasks folder, with its own `uid`. The new version does not read
checkbox lines at all: your areas and projects will still be there, empty, and the list will say how
many lines it found and link back here.

Nothing is lost — the lines are still in your notes. To move them:

1. Back up the vault (or at least the folder with your area notes). The script writes many files.
2. Dry run — nothing is written without `--apply`:
   `node tools/migrate-to-notes.mjs --vault "<your vault>" --folder Tasks --out Задачи`
   It prints how many tasks it would make and where.
3. Run it for real by adding `--apply`. Add `--wishes` to take the «### TODO» blocks of ordinary
   notes too; they become tasks with `status: someday`.
4. Open the list. The tasks folder in *Settings → Focus Tasks* must be the one you passed as `--out`.

Prefer to stay on the old model? Pin 0.1.0: in BRAT, *Choose version* → `0.1.0`, or install that
release by hand.

## TaskNotes, in one click

TaskNotes is optional — this list works on its own. Installed, it reads the very same notes and adds
recurrence, reminders, time tracking, its calendar and its Bases views.

Open **Settings → Focus Tasks**: the *TaskNotes* row says where it stands and gives you the one button
that matters.

- Not installed → **Install**: Focus Tasks downloads it through Obsidian's own plugin installer,
  turns it on, and points it at these tasks.
- Installed but looking elsewhere → **Point it at these tasks**: sets its *task identification* to the
  property `type` = `задача` and its tasks folder to the one in these settings. This is the step
  people miss by hand, and without it TaskNotes finds nothing and looks broken.
- Already aimed → the row says so, and **Its settings** opens TaskNotes.

If Obsidian ever changes its installer, the button says so and sends you to *Community plugins →
Browse → TaskNotes*; the one setting to fix by hand is the identification above.

Its default Bases views filter by the `#task` tag. Delete `TaskNotes/Views/` once and let it write
them again — they will then read `list(note["type"]).contains("задача")` and show these tasks.

## Install with BRAT (from inside Obsidian)

1. *Settings → Community plugins → Browse* → install and enable **BRAT** (Obsidian42 - BRAT).
2. Command palette → **BRAT: Add a beta plugin for testing** → paste `zast4/focus-tasks` →
   pick the latest version → *Add plugin*.
3. *Settings → Community plugins* → enable **Focus Tasks**. BRAT keeps it updated.

## Install (manual, for testing)

1. Unzip `focus-tasks-<version>.zip` into `<your vault>/.obsidian/plugins/` — you get
   `.obsidian/plugins/focus-tasks/` (or copy `main.js`, `manifest.json`, `styles.css` there yourself).
2. Restart Obsidian or reload the plugin list.
3. *Settings → Community plugins* → turn off Restricted mode if needed → enable **Focus Tasks**.
4. Click the ✓≡ ribbon icon, then «+ Area».

Nothing is changed in your vault until you add something: the plugin only reads notes in its folder.

## Manual test checklist

Try these in a new vault (or a copy of yours):

1. The view opens with «No areas yet»; «+ Area» → `💪Sport` → `Tasks/Sport.md` appears.
2. Click «Empty» → type → Enter → type → Enter → Esc: two tasks under `## Inbox`.
3. Grip on the area → «New project» → the project note, listed in the area's `focus-tasks` view.
4. **+** on the project → steps; click a step → ⌘1 → «Today» on the right, the area moves to the top.
5. ⌘2 / ⌘4 / ⌘3 on a task; the date on the right → picker: «Today», a day, «Clear date».
6. Check a task: it moves to the bottom of its area, and the area's title grows a green ✓1;
   its box there brings it back.
7. Drag a task onto an area header; drag a task between two others; drag an area above another.
8. Click a task's grip, Shift-click another two rows down: three rows selected; right-click → «Tomorrow»
   dates all three; ⌘4 / ⌘1 do the same from the keyboard; drag one of them by the grip onto a
   project: all three move, in order.
9. Delete a task from its menu → «Undo» in the notice brings it back.
10. «Hide» / «All»; «Collapse all» / «Expand all» — the screen stays where it was.
11. Rename a project from its menu → links in the area note follow; Enter adds the next project.
12. «Link a note…» on a project → its name opens your note; «Open task file» opens the task file.
13. «+ Area from a note», «Project from a note».
14. Change the folder in the settings → new areas go there.
15. Delete a project, delete an area → files in the trash.

## Automated end-to-end test

`test/e2e.mjs` does all of the above with real mouse and keyboard input in a fresh vault and checks
the files on disk. It needs Obsidian started with a DevTools port:

```sh
open -a Obsidian --args --remote-debugging-port=9222   # macOS; keep a vault open
npm install
npm test                                                # without Tasks
node test/e2e.mjs --with-tasks "<vault>/.obsidian/plugins/obsidian-tasks-plugin"
```

The test opens `test/focus-tasks-e2e/` in a new window and closes and forgets it when everything
passes (`--keep` leaves it).

---

## Focus Tasks по-русски

Список фокуса в духе TickTick: **области → проекты → задачи** на обычных заметках Markdown —
по заметке на задачу.
Сверху — то, что на сегодня и просрочено, остальное — в одном клике.

- **Задача — заметка.** Каждая задача лежит своей заметкой в папке задач (по умолчанию `Задачи`):
  `type: задача`, остальное в свойствах — `uid` (личность, не переписывается), `status`, `area`,
  `projects`, `scheduled`, `due`, `completedDate`, `priority`. Тело заметки — описание; когда описание
  вырастает в план, «Сделать проектом» превращает задачу в проект.
- **Области и проекты — тоже заметки**, в папке из настроек (по умолчанию `Tasks`). У области во
  frontmatter `area: <имя>`, у проекта ещё `type: проект`.
- **Свои заметки остаются своими.** Область или проект можно привязать к любой заметке хранилища:
  клик по имени открывает её, а файл задач — в меню («Открыть файл задач»). Привязанные заметки
  плагин не меняет.
- **Имена полей — как у [TaskNotes](https://github.com/callumalpass/tasknotes)**: его можно поставить
  на те же заметки и получить повторы, напоминания, учёт времени и его виды, а этот список останется
  дневным фокусом сверху. Свои здесь только `uid` и `area`; чужие ключи обе стороны сохраняют.
  Ставится в один клик: **Настройки → Focus Tasks → TaskNotes**.

В фокус область попадает из-за сегодняшней работы: задача на сегодня, просроченная или запущенная.
Область без открытой работы в фокусе уходит из Фокуса. Сделанное доступно через «Сделано»
и «Все»; галочка выполненной задачи возвращает её в работу.

Отмеченная задача до конца дня остаётся там, где живёт: шаг - внутри своего проекта, разовая -
внизу своей области, под тонкой линией (галочка возвращает её в работу). Зелёная ✓N на строке
проекта или области считает сделанное и сворачивает его одним кликом. Будущие и бессрочные шаги
проекта лежат за его же ⏳N: видно, что осталось именно в этом проекте.

Всё, что область держит сверх сегодняшней работы, висит значком ⏳ на её же строке: будущее и
отложка. Отдельной серой строки «Показать будущее» под списком больше нет - она занимала место
вдвое большее и читалась как подвал.

Задачу, которую ты отдал - делегировал, отправил, ждёшь ответа, - отдаёт пункт **«Жду…»** в меню
строки. Он не переключает статус молча, а задаёт один вопрос - когда к ней вернуться.

Карточка «Вернуться к задаче» открывается с сегодняшним днём и курсором в часах. Часы и минуты -
два поля, как в календаре macOS: две цифры, и курсор сам уходит в минуты, ещё две - и Tab закрывает
карточку, момент выставлен. Всё с клавиатуры, мышь не нужна. Закрыть карточку можно и просто кликнув
мимо - выставленное сохранится; отменяет только Esc. День можно перебить в поле слева
(«в пятницу», «+10», «через 5 дней») или выбрать в календаре, курсор на компьютере вернётся к часам. Пустые часы
означают весь день. Прошлое карточка не берёт, а закрыл её - не изменилось ничего: статус без дня
возврата не ставится.

Дальше задача уходит из фокуса на полку **«▷ Жду · N»** внизу панели, кнопка рядом с «Сделано»:
по областям, ближайший день сверху, у каждой строки «до 26.09 19:00». В отложке области её нет -
ждущее и отложенное читаются одинаково, а значат разное, и раньше это путало. На странице проекта
его ждущие шаги свёрнуты под таким же «▷ Жду · N». В заметке статус пишется как `waiting`: TaskNotes
понимает `in-progress` как «делаю сейчас», для ожидания это неправда. Когда названный момент настал -
день, а если указан час, то именно час, - задача сама возвращается в фокус со значком ▷: это
«проверь», а не «делай». Клик по ▷ забирает её в работу совсем («Взять обратно» в меню); чтобы
отложить ещё раз, нажми на дату - откроется та же карточка.

Приоритетов список не показывает. Единственная точка на строке - `priority: low`, метка задачи,
которую добавил скрипт или бот и которую ты ещё не смотрел; клик по точке (или «Снять метку бота»
в меню) убирает её.

У проекта может быть своя дата: выдели его строку ручкой и нажми ⌘1-4, или «Дата проекта…» в его
меню. Она пишется в заметку проекта, шаги свои дни не меняют. Пока она есть, она одна решает, в
фокусе ли проект: наступила - проект в фокусе с тем, что у него есть; впереди - ждёт в ⏳ отложке
области со всеми шагами.

В видимой области проект, в котором сегодня закрыли последнюю задачу, до конца дня стоит
на своём месте с зелёным «сделано N», а «+» рядом заводит следующий шаг.
Последний выполненный шаг не закрывает сам проект автоматически.

Открыть: иконка на ленте или команда **Focus Tasks: Открыть Фокус**, либо блок ` ```focus-tasks``` `
в любой заметке. Клик по тексту — правка на месте (Enter — сохранить и новая строка ниже, Esc —
сохранить и выделить строку; ⌘1 сегодня, ⌘2 завтра, ⌘3 календарь, ⌘4 без даты, ⌘5 «Жду…», ⌘D - копия задачи прямо над ней, сразу в режиме правки, ⌘Enter - открыть задачу заметкой, ⌘⌫ - удалить задачу целиком и перейти на строку выше; ⌘Z, пока ничего не
набрано, отменяет последнее действие списка). Ручка слева — перетаскивание, клик по ней — выделить
строку, правый клик — меню. На телефоне меню открывается долгим нажатием на текст. Выделенная строка — блок целиком, как в Notion:
↑/↓ ходят по списку, Shift+↑/↓ расширяют, Enter — правка, ⌫ — удалить (с «Вернуть»), ⌘1–4 — дата, ⌘5 — «Жду…», ⌘D — копии над выделенными задачами (сразу редактируется первая копия),
⌘Z — отменить последнее действие (строки, которых оно касалось, выделяются), Esc — снять выделение.
Shift+клик выделяет все задачи от последней кликнутой до этой, ⌘/Ctrl+клик добавляет или убирает
одну; ручка выделенных строк тащит их все, а дата, меню и клавиши работают на всех сразу.
Внизу — «Все» / «Скрыть», «+ Область», «+ Область из заметки»,
«Свернуть всё» / «Развернуть всё». Язык интерфейса — в настройках (Auto / English / Русский).

**Обновление с 0.1.0.** В 0.1.0 задача была строкой-чекбоксом внутри заметки области, теперь каждая
задача — отдельная заметка со своим `uid`. Строки-чекбоксы новая версия не читает: области и проекты
останутся на месте, но пустыми, а список сам скажет, сколько таких строк нашёл. Ничего не пропало —
строки лежат в заметках. Перенос: сделай бэкап, прогони
`node tools/migrate-to-notes.mjs --vault "<хранилище>" --folder Tasks --out Задачи` (без `--apply`
ничего не пишется, только отчёт), потом с `--apply`; `--wishes` заберёт ещё и блоки «### TODO» из
обычных заметок как задачи со `status: someday`. Хочется остаться на старой модели — в BRAT
*Choose version* → `0.1.0`.

**TaskNotes в один клик.** Он не обязателен — список работает сам по себе. Но если поставить, он
читает те же заметки и добавляет повторы, напоминания, учёт времени, календарь и свои виды Bases.
В **Настройках → Focus Tasks** строка *TaskNotes* показывает, где он сейчас, и даёт одну нужную
кнопку: «Поставить» (скачает штатным установщиком Obsidian, включит и наведёт на эти задачи),
«Навести на эти задачи» (поставит опознавание задач по свойству `type` = `задача` и папку задач из
этих настроек — именно этот шаг руками все и пропускают, без него TaskNotes не находит ничего и
выглядит сломанным) или «Его настройки». Его готовые виды Bases фильтруют по тегу `#task`: удали
папку `TaskNotes/Views/` один раз и дай ему переписать её — тогда они читают
`list(note["type"]).contains("задача")`.

Установка прямо из Obsidian — через BRAT: *Настройки → Сторонние плагины → Обзор* → поставить и
включить **BRAT**; палитра команд → **BRAT: Add a beta plugin for testing** → `zast4/focus-tasks`
→ последняя версия → *Add plugin*; включить **Focus Tasks**. Обновления BRAT подтягивает сам.

Установка руками: распаковать `focus-tasks-<версия>.zip` в `<хранилище>/.obsidian/plugins/`
(получится папка `focus-tasks`), перезапустить Obsidian и включить плагин в
*Настройки → Сторонние плагины*.

### Замыслы

У области видно одно общее число задач фокуса, отложки и замыслов. Наведение или фокус клавиатуры
на число открывает компактное меню категорий; на телефоне оно открывается касанием. У проекта меню
привязано к счётчику возле имени (`+N` также раскрывает шаги). Пустые категории проекта скрыты.
Первый замысел проекта можно добавить через его контекстное меню. Меню не меняет ширину текста и высоту строки.
Каждый независимо показывает и скрывает свои задачи. Можно открыть несколько категорий одновременно.
Открытые категории обычной яркости, закрытые приглушены. Рамки, фон и подчёркивание отсутствуют.
У свёрнутой области все доступные иконки приглушены. Нажатие раскрывает область и выбранную категорию,
сохраняя остальные переключатели. Раскрытие стрелкой возвращает сохранённое сочетание.
Скрытие фокуса скрывает и проекты, кроме тех, у которых показана отложка или замыслы.
Стрелки сворачивания появляются только у настоящих шагов, пустые строки проектов не остаются.
Считаются задачи, включая скрытые шаги, без выполненных и отменённых; свёртка не меняет числа.
«Жду» до срока остаётся отдельно, после возврата задача учитывается в фокусе.
Добавление открывает нужную категорию, чтобы новая задача оставалась видна. Переключение снимает
выделение задач, а ссылка по UID раскрывает скрытую задачу. В заметках областей и проектов тот же
компонент. Проект с фокусом и отложкой показывается одним
заголовком. Кнопка «Все» сохраняет прежнее поведение, отдельного общего входа в замыслы нет.
В области видны самостоятельные списки и подборки её проектов с названиями проектов.
В проекте замыслы показаны обычными строками. Общего заголовка «Замыслы» над списками нет.
Пустой раздел можно открыть без создания заметок. Подборка проекта создаётся при первом добавлении.
Существующий список можно привязать к проекту или оставить самостоятельным списком области.
Галочки, правка, даты, выделение, перетаскивание, дублирование сверху и Undo общие с задачами.
Дата сохраняет запись внутри замыслов. Явный перенос в отложку/фокус сохраняет UID, описание
и привязанный проект; отмена возвращает запись. Поиск находит и раскрывает нужную строку.
Связь с проектом держится по UID при переименовании и переносе. Удаление проекта включает его
замыслы и отменяется; при удалении проекта с сохранением задач замыслы остаются списком области.
На телефоне сегменты имеют площадь нажатия от 44px и переносятся под заголовок.

При переходе с карточек UID замысла остаётся у списка. Верхние пункты TODO становятся строками,
вложенные пояснения переходят в описания, отмеченная история сохраняется внутри списка.
Перед переносом оператор проверяет оригиналы и резервные копии вне vault. Изменившийся источник
останавливает операцию, повторный запуск сохраняет уже перенесённые списки.

В каждой области есть общий виртуальный список **Замыслы**, даже пустой. Он собирает замыслы без списка
и импорт из самой заметки области; отдельный файл для него не создаётся. Именованные списки остаются отдельно.
Пустой настоящий список можно завершить и вернуть галочкой, как проект. Проект можно сделать списком
замыслов через меню или перетаскиванием в замыслы. UID и описание каждого шага сохраняются; отмена возвращает всю операцию.
Внутри проекта замыслы отмечены тёплой боковой линией и лампочкой у строки.

### Страницы областей, телефон и напоминания

В заметке области блок `focus-tasks` показывает её проекты и задачи. Он добавляется один
раз при открытии области. Новые задачи внутри области или проекта появляются без даты.
Проекты, отдельные задачи и раскрытые шаги в этой заметке стоят без вложенных отступов.
Создание и перенос проекта используют этот view, без отдельного раздела "Проекты".
На телефоне папка стоит в колонке галочек, название проекта - в колонке текста задач.
Обычно ручки скрыты и их колонка отсутствует. Долгое нажатие открывает меню; "Переставить"
временно показывает ручки и "Готово". За ручку можно тянуть, по тексту прокручивать список.
"Готово", переход из списка и уход приложения в фон выключают режим. В настройках он не сохраняется.
Название проекта находится над первым шагом, даты и статусы - под текстом задачи.
Раскрытые шаги сохраняют те же колонки; `+N` / `−N` раскрывают и сворачивают проект.
Превью задач везде ограничено тремя строками; при правке виден полный текст.
Офлайн-задача сохраняется на устройство сразу; доставка через Sync требует запущенного Obsidian.

TaskNotes для работы списка не нужен. Если используются повторы, их выполнение
делегируется TaskNotes; отменять выполнение такого повтора нужно в нём.
Apple Calendar подключается отдельным мостом:
[как устроено подключение](CALENDAR_INTEGRATION.md). У задачи со временем появляется часовое
событие с уведомлением. Обычная дата не создаёт ночных уведомлений. Перенос дня сохраняет
час; удаление часа убирает напоминание. Это событие Calendar, отдельное от задачи Apple Reminders.
Для этих событий дефолтный алерт отключён; уведомление приходит в момент начала.
Значок календаря с галочкой означает подтверждённую запись текущей задачи и времени в iCloud.
До подтверждения виден значок ожидания, при ошибке - значок ошибки. Перенос времени, в том числе
групповой, обновляет существующие события. Ссылка находит задачу в Фокусе по постоянному UID:
раскрывает область, отложку и шаги проекта, прокручивает список и выделяет задачу.
Переименование и перенос задачи ссылку не ломают. Если задача удалена, закрыта или ещё не
синхронизирована, появится сообщение; незавершённая правка сохраняется.

В фокусе, отложке и "Жду" используется одна карточка даты с полями часов и минут. Выбор дня
оставляет карточку открытой; "Сохранить" или Enter применяет дату и время. Пустое время означает
только дату, без подстановки 00:00. "Убрать время" убирает час, в том числе у группы задач.
Разные часы выбранных задач показаны прочерками: при переносе дня каждый час сохраняется;
введённое время применяется ко всем. На телефоне открытие календаря и выбор дня не вызывают
клавиатуру. У задачи без даты карточка предлагает сегодня; отдельного пункта напоминания нет.

## License

MIT
