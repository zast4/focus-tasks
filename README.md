# Focus Tasks

A focus list for Obsidian in the spirit of TickTick / Things: **areas → projects → tasks**, built on
plain Markdown checkboxes. What is due today (or overdue) is on top; the rest waits one click away.

*[Русская версия ниже](#focus-tasks-по-русски)*

## How it works

- **Task files.** Every area and every project is a note in one folder (`Tasks` by default, change it
  in the settings). An area note has `area: <name>` in its frontmatter; a project note also has
  `type: project`. Tasks are ordinary lines: `- [ ] Buy shoes ⏳ 2026-09-22`.
- **Your notes stay yours.** An area or a project can be *linked* to any note of your vault. A click on
  its name opens that note, and the task file is one menu item away («Open task file»). Linked notes
  are never modified.
- **Dates** use the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) emoji format
  (⏳ scheduled, 📅 due, 🛫 start, ✅ done), so both plugins read the same lines. Tasks is optional:
  with it, the checkbox goes through Tasks (recurrence, its done date) and its edit dialog is in the
  menu; without it, Focus Tasks marks `[x]` and adds `✅ <today>` itself.

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
| Complete a task | click its checkbox |
| Edit a task | click its text: edit in place, **Enter** saves and opens a new row below, **Esc** cancels |
| Date while editing | **⌘/Ctrl+1** today, **⌘/Ctrl+2** tomorrow, **⌘/Ctrl+3** date picker, **⌘/Ctrl+4** no date |
| Date picker | click the date on the right (type `25.12`, `tomorrow`, or pick a day) |
| Add a task | **+** on an area or a project header; «Empty» in an empty area |
| Menu | click the grip on the left, or right-click a row |
| Reorder / move | drag the grip: areas among areas, projects within their area, tasks anywhere; drop a task on a header to move it into that area or project |
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
| Use the Tasks plugin | on | when Tasks is installed |

Folded state, «opened» areas and the drag order are saved in the plugin's `data.json` (synced with
the vault); «All» is remembered per device.

## Install with BRAT (from inside Obsidian)

1. *Settings → Community plugins → Browse* → install and enable **BRAT** (Obsidian42 - BRAT).
2. Command palette → **BRAT: Add a beta plugin for testing** → paste `zast4/obsidian-focus-tasks` →
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
6. Check a task: `[x] … ✅ <today>` in the note; it leaves the list.
7. Drag a task onto an area header; drag a task between two others; drag an area above another.
8. Delete a task from its menu → «Undo» in the notice brings it back.
9. «Hide» / «All»; «Collapse all» / «Expand all» — the screen stays where it was.
10. Rename a project from its menu → links in the area note follow; Enter adds the next project.
11. «Link a note…» on a project → its name opens your note; «Open task file» opens the task file.
12. «+ Area from a note», «Project from a note».
13. Change the folder in the settings → new areas go there.
14. Delete a project, delete an area → files in the trash.

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

Список фокуса в духе TickTick: **области → проекты → задачи** на обычных чекбоксах Markdown.
Сверху — то, что на сегодня и просрочено, остальное — в одном клике.

- **Файлы задач.** Каждая область и каждый проект — заметка в одной папке (по умолчанию `Tasks`,
  меняется в настройках). У области во frontmatter `area: <имя>`, у проекта ещё `type: project`
  (или `проект`). Задачи — обычные строки `- [ ] Купить кроссовки ⏳ 2026-09-22`.
- **Свои заметки остаются своими.** Область или проект можно привязать к любой заметке хранилища:
  клик по имени открывает её, а файл задач — в меню («Открыть файл задач»). Привязанные заметки
  плагин не меняет.
- **Даты** — в формате плагина Tasks (⏳ 📅 🛫 ✅). Tasks не обязателен: без него галочка ставит `[x]`
  и `✅ <сегодня>` сама.

Открыть: иконка на ленте или команда **Focus Tasks: Открыть Фокус**, либо блок ` ```focus-tasks``` `
в любой заметке. Клик по тексту — правка на месте (Enter — сохранить и новая строка ниже, Esc —
отмена; ⌘1 сегодня, ⌘2 завтра, ⌘3 календарь, ⌘4 без даты). Ручка слева — перетаскивание, клик по ней
или правый клик — меню. Внизу — «Все» / «Скрыть», «+ Область», «+ Область из заметки»,
«Свернуть всё» / «Развернуть всё». Язык интерфейса — в настройках (Auto / English / Русский).

Установка прямо из Obsidian — через BRAT: *Настройки → Сторонние плагины → Обзор* → поставить и
включить **BRAT**; палитра команд → **BRAT: Add a beta plugin for testing** → `zast4/obsidian-focus-tasks`
→ последняя версия → *Add plugin*; включить **Focus Tasks**. Обновления BRAT подтягивает сам.

Установка руками: распаковать `focus-tasks-<версия>.zip` в `<хранилище>/.obsidian/plugins/`
(получится папка `focus-tasks`), перезапустить Obsidian и включить плагин в
*Настройки → Сторонние плагины*.

## License

MIT
