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

What you can do in the view:

| | |
|---|---|
| Complete a task | click its checkbox; for the rest of the day it stays at the bottom of its area under «Completed» (its box brings it back) |
| Finish a project | check off its last step: the project keeps its row until the day is out, marked «done N», and its «+» adds the next step |
| Edit a task | click its text: edit in place, **Enter** saves and opens a new row below, **Esc** cancels |
| Date while editing | **⌘/Ctrl+1** today, **⌘/Ctrl+2** tomorrow, **⌘/Ctrl+3** date picker, **⌘/Ctrl+4** no date |
| Date picker | click the date on the right (type `25.12`, `tomorrow`, or pick a day) |
| Add a task | **+** on an area or a project header; «Empty» in an empty area |
| Menu | click the grip on the left, or right-click a row |
| Reorder / move | drag the grip: areas among areas, projects within their area, tasks anywhere; drop a task on a header to move it into that area or project |
| Select several | **Shift**-click selects every task from the last clicked one, **⌘/Ctrl**-click adds or drops one, **Esc** clears; the grip of a selected row drags them all; its date, its menu or **⌘/Ctrl+1…4** (as while editing) set the date of all of them |
| Upcoming | «Show upcoming» under an area opens its undated and future tasks |
| Everything | «All» at the bottom shows every area (also those with nothing due); «Hide» goes back |
| Fold | carets on headers; «Collapse all» / «Expand all» at the bottom |
| Areas | «+ Area», «+ Area from a note» at the bottom; area menu: new project, project from a note, link a note, delete |
| Projects | menu: rename (Enter adds another project), link a note, open task file, delete |

Deleted areas and projects go to the trash (as set in *Files and links → Deleted files*); a deleted
task can be restored from the notice that appears.

## Settings

| Setting | Default | |
|---|---|---|
| Folder | `Tasks` | where task files live; created when needed |
| Language | Auto | English / Русский |
| Area note name | `{area}` | file name of a new area note (`{area}` = the name without a leading emoji) |
| Extra frontmatter (areas) | — | YAML lines for every new area note, e.g. `parents: ["[[Projects]]"]` |
| Extra frontmatter (projects) | — | YAML lines for every new project note; `{areaNote}` = its area's note, e.g. `parents: ["[[{areaNote}]]"]` |
| `type` of an area / project | `area` / `project` | `project`/`проект` and `area`/`область` are always recognised |
| Steps / Inbox / Projects headings | `Steps` / `Inbox` / `Projects` | sections new lines go to |
| Date format | `DD.MM.YY` | any moment.js format |
| TaskNotes | — | install the companion plugin and point it at these tasks (see above) |

Folded state, «opened» areas and the drag order are saved in the plugin's `data.json` (synced with
the vault); «All» is remembered per device.

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
3. Grip on the area → «New project» → the project note, and `- 📁 [[…]]` in the area note.
4. **+** on the project → steps; click a step → ⌘1 → «Today» on the right, the area moves to the top.
5. ⌘2 / ⌘4 / ⌘3 on a task; the date on the right → picker: «Today», a day, «Clear date».
6. Check a task: `[x] … ✅ <today>` in the note; it moves to «Completed» at the bottom of its area;
   its box there brings it back.
7. Drag a task onto an area header; drag a task between two others; drag an area above another.
8. Click a task, Shift-click another two rows down: three rows selected; the grip menu → «Tomorrow»
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

Отмеченная задача до конца дня остаётся внизу своей области в блоке «Выполненные» (галочка там
возвращает её в работу): видно, что сделано за день.

Проект, в котором сегодня закрыли последнюю задачу, тоже не исчезает: до конца дня он стоит
на своём месте, вместо счётчика — зелёное «сделано N», а «+» рядом заводит следующий шаг.
Одна новая задача — и это снова обычный проект.

Открыть: иконка на ленте или команда **Focus Tasks: Открыть Фокус**, либо блок ` ```focus-tasks``` `
в любой заметке. Клик по тексту — правка на месте (Enter — сохранить и новая строка ниже, Esc —
отмена; ⌘1 сегодня, ⌘2 завтра, ⌘3 календарь, ⌘4 без даты). Ручка слева — перетаскивание, клик по ней
или правый клик — меню. Shift+клик выделяет все задачи от последней кликнутой до этой, ⌘/Ctrl+клик
добавляет или убирает одну, Esc снимает выделение; ручка выделенной строки тащит их все, а её дата,
меню или ⌘1–4 (как при правке) ставят дату всем сразу. Внизу — «Все» / «Скрыть», «+ Область», «+ Область из заметки»,
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

## License

MIT
