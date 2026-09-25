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
| Complete a task | click its checkbox; for the rest of the day it stays where it lives — a step inside its project, a loose task at the bottom of its area — under a hairline, and the green ✓N on that row folds it away (its box brings it back) |
| See what is ahead in a project | the ⏳N on the project's row opens its upcoming and undated steps, in the project itself |
| Hand a task off | «In progress» in the row's menu: it leaves the focus and waits behind the ▷N of its project or area. Its date now means «look at it again»: on that day the task comes back among the rows that are due, marked ▷, and that ▷ hands it back to you |
| Priority | the dot on a row opens the levels — high, normal, low, or none at all; the same is in the row's menu, and in the menu of a selection it sets them all |
| Finish a project | check off its last step: the project keeps its row until the day is out, marked «done N», and its «+» adds the next step |
| Edit a task | click its text: edit in place, **Enter** saves and opens a new row below, **Esc** saves and leaves the row selected (a wiped row keeps its text) |
| Date while editing | **⌘/Ctrl+1** today, **⌘/Ctrl+2** tomorrow, **⌘/Ctrl+3** date picker, **⌘/Ctrl+4** no date; a day that takes the row out of its list sends it off at once and moves the editor to the next row |
| Undo | **⌘/Ctrl+Z** in the list takes back the last change (a tick, a date, a move, a delete) and selects the rows it touched; while editing, with nothing typed yet, it does the same — typed text keeps the editor's own undo |
| Date picker | click the date on the right (type `25.12`, `tomorrow`, or pick a day) |
| Add a task | **+** on an area or a project header; «Empty» in an empty area |
| Menu | right-click a row (on a phone: tap the grip) |
| Reorder / move | drag the grip: areas among areas, projects within their area, tasks anywhere; drop a task on a header to move it into that area or project |
| Select a row | click the grip on the left (again: drops it), or **Esc** while editing. A selected row is a block picked up as a whole, as in Notion: **↑/↓** walk the list, **Shift+↑/↓** extend, **Enter** edits it, **⌫** deletes (Undo in the notice), **⌘/Ctrl+1…4** date it, **⌘/Ctrl+Z** takes back the last change, **Esc** drops the selection |
| Select several | **Shift**-click selects every task from the last clicked one, **⌘/Ctrl**-click adds or drops one; the grip of a selected row drags them all; its date, its menu, the keys above or **⌘/Ctrl+1…4** work on all of them |
| Upcoming | the ⏳N on an area's header opens its undated and future tasks, next to ▷N running and ✓N done |
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
Галочка держит область на месте до конца дня только если отмечена была работа из фокуса - задача
из отложки, закрытая походя, свою область в сегодняшний список не затаскивает (её видно в «Все»).

Отмеченная задача до конца дня остаётся там, где живёт: шаг - внутри своего проекта, разовая -
внизу своей области, под тонкой линией (галочка возвращает её в работу). Зелёная ✓N на строке
проекта или области считает сделанное и сворачивает его одним кликом. Будущие и бессрочные шаги
проекта лежат за его же ⏳N: видно, что осталось именно в этом проекте.

Всё, что область держит сверх сегодняшней работы, висит двумя значками на её же строке: ⏳N - всё
«не сегодня» (будущее, отложка и запущенное), ✓N - закрытое сегодня. Отдельной серой строки
«Показать будущее» под списком больше нет - она занимала место вдвое большее и читалась как подвал.

Задачу, которую ты уже запустил - делегировал, отправил, ждёшь ответа, - отдаёт значок **▷**: он
есть на каждой строке и проявляется при наведении (в меню строки тот же пункт «В работу…»). Он не
переключает статус молча, а задаёт один вопрос - когда к ней вернуться.

Карточка «Вернуться к задаче» открывается с сегодняшним днём и курсором в часах. Часы и минуты -
два поля, как в календаре macOS: две цифры, и курсор сам уходит в минуты, ещё две - и Tab закрывает
карточку, момент выставлен. Всё с клавиатуры, мышь не нужна. Закрыть карточку можно и просто кликнув
мимо - выставленное сохранится; отменяет только Esc. День можно перебить в поле слева
(«в пятницу», «+10», «через 5 дней») или выбрать в календаре, курсор вернётся к часам. Пустые часы
означают весь день. Прошлое карточка не берёт, а закрыл её - не изменилось ничего: статус без дня
возврата не ставится.

Дальше задача уходит из фокуса и ждёт там же, где всё остальное «не сегодня»: за счётчиком ⏳N
своей области или своего проекта, вперемешку с будущими задачами и отложкой, по своей дате.
Отдельного списка для запущенного нет - вопрос у них один и тот же, «не сейчас, вернусь позже»,
а разницу видно по значку ▷ на строке; подсказка на счётчике говорит, сколько из них запущено.
Область, в которой только запущенные задачи, из фокуса не исчезает: иначе исчез бы и счётчик,
а с ним единственная дорога к ним. Когда названный момент настал - день, а если указан час, то
именно час, - задача сама возвращается в фокус со значком ▷: это «проверь», а не «делай». Клик по ▷
забирает её в работу совсем; чтобы отложить ещё раз, нажми на дату - откроется та же карточка.

Точка на строке - приоритет задачи (`priority` в заметке). Клик по ней открывает уровни:
высокий, обычный, низкий и «без приоритета» - последний убирает метку совсем. То же есть в меню
строки и в меню выделения, где уровень ставится сразу всем выбранным.

Проект, в котором сегодня закрыли последнюю задачу, тоже не исчезает: до конца дня он стоит
на своём месте, вместо счётчика — зелёное «сделано N», а «+» рядом заводит следующий шаг.
Одна новая задача — и это снова обычный проект.

Открыть: иконка на ленте или команда **Focus Tasks: Открыть Фокус**, либо блок ` ```focus-tasks``` `
в любой заметке. Клик по тексту — правка на месте (Enter — сохранить и новая строка ниже, Esc —
сохранить и выделить строку; ⌘1 сегодня, ⌘2 завтра, ⌘3 календарь, ⌘4 без даты; ⌘Z, пока ничего не
набрано, отменяет последнее действие списка). Ручка слева — перетаскивание, клик по ней — выделить
строку (на телефоне — меню), правый клик — меню. Выделенная строка — блок целиком, как в Notion:
↑/↓ ходят по списку, Shift+↑/↓ расширяют, Enter — правка, ⌫ — удалить (с «Вернуть»), ⌘1–4 — дата,
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

## License

MIT
