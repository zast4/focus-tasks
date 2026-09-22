// Model tests: the plugin's data layer against a fake vault (test/harness.mjs). No Obsidian, no UI —
// these run in milliseconds and cover what e2e cannot reach cheaply: junk frontmatter, duplicate
// identities, renames that collide, order after a move, and how it all behaves at scale.
//
//   node test/model.mjs            every test
//   node test/model.mjs <filter>   only the tests whose name contains <filter>
import { createRequire } from "node:module";
import { FakeApp, loadPlugin, areaNote, projectNote, taskNote, writeNote, frontmatter, bodyOf, paths } from "./harness.mjs";

const moment = createRequire(import.meta.url)("moment");
const TODAY = moment().format("YYYY-MM-DD");
const DAY = (n) => moment().add(n, "days").format("YYYY-MM-DD");

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// --- assertions ---------------------------------------------------------------------------------

class Failed extends Error {}
const fail = (what, got, want) => { throw new Failed(`${what}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); };
const eq = (got, want, what = "value") => { if (JSON.stringify(got) !== JSON.stringify(want)) fail(what, got, want); };
const ok = (cond, what) => { if (!cond) throw new Failed(what); };
const has = (list, item, what = "list") => ok(list.includes(item), `${what} is missing ${JSON.stringify(item)}: ${JSON.stringify(list)}`);

// A plugin on an empty vault; `setup(app)` fills it before the plugin reads anything.
async function stand(setup, settings) {
  const app = new FakeApp();
  if (setup) setup(app);
  const plugin = await loadPlugin(app, settings);
  return { app, plugin };
}

const names = (tasks) => tasks.map((t) => t.text);
const areaNames = (areas) => areas.map((a) => a.name);
const areaOf = (areas, name) => areas.find((a) => a.name === name);
const projectOf = (area, name) => area.projects.find((p) => p.file.basename === name);

// --- what belongs where ------------------------------------------------------------------------

test("a dated task of an area is in the focus, an undated one is not", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    taskNote(app, "Run 5k", { area: "Sport", scheduled: TODAY });
    taskNote(app, "Buy shoes", { area: "Sport" });
    taskNote(app, "Race", { area: "Sport", scheduled: DAY(5) });
  });
  const areas = await plugin.collect(false);
  eq(names(areaOf(areas, "Sport").loose), ["Run 5k"], "focus");
  eq(names(areaOf(areas, "Sport").future.loose), ["Race", "Buy shoes"], "upcoming: the nearest date first, undated last");
});

test("a task dated in the past is in the focus", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    taskNote(app, "Old", { area: "Sport", scheduled: DAY(-30) });
  });
  eq(names((await plugin.collect(false))[0].loose), ["Old"]);
});

test("a task takes its area from its project when it has none of its own", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    projectNote(app, "Sport", "Marathon");
    taskNote(app, "Foreign", { scheduled: TODAY, project: "Marathon" });
  });
  const areas = await plugin.collect(false);
  eq(areaNames(areas), ["Sport"]);
  eq(names(projectOf(areas[0], "Marathon").tasks), ["Foreign"]);
});

test("a task with neither an area nor a project is not lost silently", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    taskNote(app, "Foreign", { scheduled: TODAY });
    taskNote(app, "Also foreign", {});
  });
  eq(names(plugin.orphans()), ["Also foreign", "Foreign"], "orphans are listed for the view");
});

test("cancelled and someday tasks stay out of the list", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    taskNote(app, "Dropped", { area: "Sport", scheduled: TODAY, status: "cancelled" });
    taskNote(app, "Maybe", { area: "Sport", scheduled: TODAY, status: "someday" });
    taskNote(app, "Real", { area: "Sport", scheduled: TODAY });
  });
  eq(names((await plugin.collect(true))[0].loose), ["Real"]);
});

test("an unknown status counts as open (TaskNotes writes in-progress)", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    taskNote(app, "Running", { area: "Sport", scheduled: TODAY, status: "in-progress" });
  });
  eq(names((await plugin.collect(false))[0].loose), ["Running"]);
});

test("what was checked off today stays in its area, what was checked off before is gone", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    taskNote(app, "Done today", { area: "Sport", scheduled: TODAY, status: "done", completedDate: TODAY });
    taskNote(app, "Done before", { area: "Sport", scheduled: DAY(-3), status: "done", completedDate: DAY(-1) });
    taskNote(app, "Open", { area: "Sport", scheduled: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  eq(names(area.done), ["Done today"]);
  eq(names(area.loose), ["Open"]);
});

test("a step of a project checked off today keeps its area in the focus", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    projectNote(app, "Sport", "Marathon");
    taskNote(app, "Laced", { area: "Sport", project: "Marathon", status: "done", completedDate: TODAY });
  });
  const areas = await plugin.collect(false);
  eq(areaNames(areas), ["Sport"], "the area with only a completed step");
  eq(names(areas[0].done), ["Laced"], "the done step shows in the area's Completed");
});

test("a completed task remembers which project it came from", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    projectNote(app, "Sport", "Marathon");
    taskNote(app, "Laced", { area: "Sport", project: "Marathon", status: "done", completedDate: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  eq(area.done[0].project, "Marathon");
});

test("an area with nothing due today is out of the focus and in «All»", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    areaNote(app, "Home");
    taskNote(app, "Run", { area: "Sport", scheduled: TODAY });
    taskNote(app, "Dishes", { area: "Home" });
  });
  eq(areaNames(await plugin.collect(false)), ["Sport"]);
  eq(areaNames(await plugin.collect(true)).sort(), ["Home", "Sport"]);
});

test("a project with only future steps goes to the upcoming block", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    projectNote(app, "Sport", "Marathon");
    taskNote(app, "Later step", { area: "Sport", project: "Marathon", scheduled: DAY(3) });
    taskNote(app, "Today", { area: "Sport", scheduled: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  eq(area.projects.length, 0, "no project in the focus");
  eq(area.future.projects.map((p) => p.file.basename), ["Marathon"], "in upcoming");
});

// --- identity and writes -------------------------------------------------------------------------

test("the checkbox writes status and completedDate, and takes them back", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Run", { area: "Sport", scheduled: TODAY });
  });
  const task = plugin.tasks()[0];
  await plugin.toggle(task);
  eq(frontmatter(app, "Tasks/Run.md").status, "done");
  eq(frontmatter(app, "Tasks/Run.md").completedDate, TODAY);
  await plugin.toggle(plugin.tasks()[0]);
  eq(frontmatter(app, "Tasks/Run.md").status, "open");
  eq(frontmatter(app, "Tasks/Run.md").completedDate, undefined, "the date is removed");
});

test("writing a field keeps everything else in the note, lists included", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    writeNote(a, "Tasks/Tracked.md", {
      uid: "ft-keep", type: "задача", status: "open", area: "Sport", scheduled: TODAY,
      recurrence: "FREQ=WEEKLY", complete_instances: ["2026-09-28"], timeEntries: ["startTime: x"],
    }, "описание");
  });
  await plugin.setDate(plugin.tasks()[0], DAY(1));
  const fm = frontmatter(app, "Tasks/Tracked.md");
  eq(fm.uid, "ft-keep");
  eq(fm.recurrence, "FREQ=WEEKLY");
  eq(fm.complete_instances, ["2026-09-28"]);
  ok(bodyOf(app, "Tasks/Tracked.md").includes("описание"), "the body survived");
});

test("a note without a uid gets one on the first write", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    writeNote(a, "Tasks/Foreign.md", { type: "задача", status: "open", area: "Sport", scheduled: TODAY });
  });
  await plugin.setDate(plugin.tasks()[0], TODAY);
  ok(/^ft-/.test(String(frontmatter(app, "Tasks/Foreign.md").uid)), "uid written");
});

test("renaming a task into a name that is taken keeps the text right", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Run", { area: "Sport", scheduled: TODAY });
    taskNote(a, "Walk", { area: "Sport", scheduled: TODAY });
  });
  const walk = plugin.tasks().find((t) => t.text === "Walk");
  await plugin.rename(walk, "Run");
  const file = paths(app).find((p) => p.startsWith("Tasks/Run (2)"));
  ok(file, `the note went to a free name: ${JSON.stringify(paths(app))}`);
  const shown = plugin.tasks().find((t) => t.uid === walk.uid).text;
  eq(shown, "Run", "the task still reads as the user typed it");
});

test("a long text is cut in the file name and kept whole in title", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Short", { area: "Sport", scheduled: TODAY });
  });
  const long = "Разобраться со всем тем, что накопилось за последние несколько месяцев работы над ботом";
  await plugin.rename(plugin.tasks()[0], long);
  const task = plugin.tasks()[0];
  eq(task.text, long, "the whole text");
  ok(task.file.basename.length <= 60, "the file name is cut");
});

test("a text with characters a file name cannot hold still works", async () => {
  const { app, plugin } = await stand((a) => areaNote(a, "Sport"));
  const text = 'Купить [молоко] / 2 л: "домик в деревне"?';
  await plugin.createTask(text, { area: "Sport", project: null }, TODAY);
  const task = plugin.tasks()[0];
  eq(task.text, text, "the text is kept in title");
  ok(!/[\\/:"]/.test(task.file.basename), "the file name is safe: " + task.file.basename);
});

test("two tasks with the same text get their own notes", async () => {
  const { app, plugin } = await stand((a) => areaNote(a, "Sport"));
  await plugin.createTask("Купить сметану", { area: "Sport", project: null }, TODAY);
  await plugin.createTask("Купить сметану", { area: "Sport", project: null }, TODAY);
  eq(plugin.tasks().length, 2, "two notes");
  eq(names(plugin.tasks()).sort(), ["Купить сметану", "Купить сметану"], "both read the same");
  eq(new Set(plugin.tasks().map((t) => t.uid)).size, 2, "different uids");
});

test("moving a task into a project and back writes the link", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    projectNote(a, "Sport", "Marathon");
    taskNote(a, "Run", { area: "Sport", scheduled: TODAY });
  });
  const task = plugin.tasks()[0];
  await plugin.moveTasks([task], { into: true, target: { type: "project", area: { name: "Sport" }, project: { file: { basename: "Marathon" } } } });
  eq(frontmatter(app, "Tasks/Run.md").projects, ["[[Marathon]]"]);
  await plugin.moveTasks([plugin.tasks()[0]], { into: true, target: { type: "area", area: { name: "Sport" } } });
  eq(frontmatter(app, "Tasks/Run.md").projects, undefined, "the link is gone");
});

test("a deleted task comes back with the same uid", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Run", { area: "Sport", scheduled: TODAY });
  });
  const task = plugin.tasks()[0];
  const uid = task.uid;
  await plugin.remove(task);
  eq(plugin.tasks().length, 0, "gone");
  await plugin.undoLast();
  eq(plugin.tasks().length, 1, "back");
  eq(plugin.tasks()[0].uid, uid, "same identity");
});

test("deleting a project frees its tasks into the area", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    projectNote(a, "Sport", "Marathon");
    taskNote(a, "Step", { area: "Sport", project: "Marathon", scheduled: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  await plugin.removeProject(area, projectOf(area, "Marathon"));
  eq(frontmatter(app, "Tasks/Step.md").projects, undefined, "the link is dropped");
  eq(frontmatter(app, "Tasks/Step.md").area, "Sport", "the area stays");
  eq(app.vault.files.has("Areas/Marathon.md"), false, "the note is trashed");
});

test("deleting an area takes its tasks, and undo brings everything back", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    projectNote(a, "Sport", "Marathon");
    taskNote(a, "Step", { area: "Sport", project: "Marathon", scheduled: TODAY });
    taskNote(a, "Loose", { area: "Sport", scheduled: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  await plugin.removeArea(area);
  eq(plugin.tasks().length, 0, "tasks went with it");
  eq(plugin.notes().length, 0, "notes went with it");
  await plugin.undoLast();
  eq(plugin.tasks().length, 2, "tasks are back");
  eq(plugin.notes().length, 2, "area and project are back");
});

// --- a task becomes a project ---------------------------------------------------------------------

test("a task with a description becomes a project and stays in the focus as its first step", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Run a marathon", { area: "Sport", scheduled: TODAY }, "Нужен план на 16 недель.");
  });
  const file = await plugin.toProject(plugin.tasks()[0]);
  ok(file, "the project note was made");
  eq(file.path, "Areas/Run a marathon.md");
  ok(bodyOf(app, file.path).includes("Нужен план"), "the description moved to the project");
  const areas = await plugin.collect(false);
  const project = projectOf(areaOf(areas, "Sport"), "Run a marathon");
  ok(project, "the project is in the focus");
  eq(names(project.tasks), ["Run a marathon"], "the task became its first step");
  eq(bodyOf(app, "Tasks/Run a marathon.md").trim(), "", "the step has no description any more");
});

test("a task whose description was a checklist becomes a project with those steps", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Get ready", { area: "Sport", scheduled: TODAY },
      "Что нужно:\n- [ ] Купить кроссовки\n- [ ] Составить план\nостальное потом");
  });
  await plugin.toProject(plugin.tasks()[0]);
  const all = projectOf(areaOf(await plugin.collect(true), "Sport"), "Get ready");
  eq(names(all.tasks), ["Купить кроссовки", "Составить план"], "the checklist became the steps");
  eq(all.tasks.filter((x) => x.date === TODAY).map((x) => x.text), ["Купить кроссовки"], "the date went to the first step");
  const focus = projectOf(areaOf(await plugin.collect(false), "Sport"), "Get ready");
  eq(names(focus.tasks), ["Купить кроссовки"], "only the dated step is in the focus");
  ok(bodyOf(app, "Areas/Get ready.md").includes("остальное потом"), "the rest of the text stayed in the project note");
  eq(app.vault.files.has("Tasks/Get ready.md"), false, "the container task is gone");
  eq(frontmatter(app, "Areas/Get ready.md").uid?.startsWith("ft-"), true, "the project kept the task's identity");
});

test("a task cannot become a project when a note of that name exists", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    projectNote(a, "Sport", "Marathon");
    taskNote(a, "Marathon", { area: "Sport", scheduled: TODAY });
  });
  const file = await plugin.toProject(plugin.tasks()[0]);
  eq(file, null, "refused");
  eq(app.vault.files.has("Tasks/Marathon.md"), true, "the task is untouched");
});

test("the project a task becomes is listed in its area's note", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Big thing", { area: "Sport", scheduled: TODAY });
  });
  await plugin.toProject(plugin.tasks()[0]);
  ok(bodyOf(app, "Areas/Sport.md").includes("[[Big thing]]"), "the 📁 line is in the area note");
});

test("a task without an area can be placed into one", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    writeNote(a, "Tasks/Foreign.md", { uid: "ft-f", type: "задача", status: "open", scheduled: TODAY });
  });
  eq(names(plugin.orphans()), ["Foreign"]);
  await plugin.setFields(plugin.orphans()[0], { area: "Sport" });
  eq(plugin.orphans().length, 0, "not an orphan any more");
  eq(names((await plugin.collect(false))[0].loose), ["Foreign"]);
});

test("a task pointing at a project that does not exist is treated as lost, not hidden", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Sport");
    writeNote(a, "Tasks/Ghost step.md", { uid: "ft-g", type: "задача", status: "open", projects: ["[[Gone]]"], scheduled: TODAY });
  });
  eq(names(plugin.orphans()), ["Ghost step"]);
});

test("a completed task is not called lost", async () => {
  const { plugin } = await stand((a) => {
    writeNote(a, "Tasks/Old.md", { uid: "ft-o", type: "задача", status: "done", completedDate: DAY(-5) });
  });
  eq(plugin.orphans().length, 0);
});

// --- junk in, no crash out -----------------------------------------------------------------------

test("a note with broken frontmatter is skipped, not fatal", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    a.vault.files.set("Tasks/Broken.md", "---\nuid: ft-x\ntype: задача\n  bad: [unclosed\n---\nтекст\n");
    taskNote(a, "Fine", { area: "Sport", scheduled: TODAY });
  });
  const areas = await plugin.collect(true);
  eq(names(areaOf(areas, "Sport").loose), ["Fine"]);
});

test("a project written as a plain link instead of a list still binds", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Sport");
    projectNote(a, "Sport", "Marathon");
    writeNote(a, "Tasks/Step.md", { uid: "ft-s", type: "задача", status: "open", area: "Sport", projects: "[[Marathon]]", scheduled: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  eq(names(projectOf(area, "Marathon").tasks), ["Step"]);
});

test("a project link written with its full path still binds", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Sport");
    projectNote(a, "Sport", "Marathon");
    writeNote(a, "Tasks/Step.md", { uid: "ft-s", type: "задача", status: "open", area: "Sport", projects: ["[[Areas/Marathon]]"], scheduled: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  ok(projectOf(area, "Marathon"), "the project is found by path link");
  eq(names(projectOf(area, "Marathon").tasks), ["Step"]);
});

test("a project link with an alias still binds", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Sport");
    projectNote(a, "Sport", "Marathon");
    writeNote(a, "Tasks/Step.md", { uid: "ft-s", type: "задача", status: "open", area: "Sport", projects: ["[[Marathon|Забег]]"], scheduled: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  eq(names(projectOf(area, "Marathon").tasks), ["Step"]);
});

test("a task note in the areas folder is not mistaken for an area", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Sport");
    writeNote(a, "Areas/Strange.md", { uid: "ft-n", type: "задача", status: "open", area: "Sport", scheduled: TODAY });
  });
  eq(plugin.notes().map((n) => n.file.basename), ["Sport"], "only the area note counts as a note");
});

test("two tasks sharing a uid do not shadow each other", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    writeNote(a, "Tasks/One.md", { uid: "ft-same", type: "задача", status: "open", area: "Sport", scheduled: TODAY });
    writeNote(a, "Tasks/Two.md", { uid: "ft-same", type: "задача", status: "open", area: "Sport", scheduled: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  eq(names(area.loose).sort(), ["One", "Two"], "both are on screen");
  await plugin.toggle(area.loose.find((t) => t.text === "One"));
  eq(frontmatter(app, "Tasks/One.md").status, "done");
  eq(frontmatter(app, "Tasks/Two.md").status, "open", "the twin is untouched");
});

test("an area whose note is missing still shows its tasks", async () => {
  const { plugin } = await stand((a) => {
    taskNote(a, "Orphan work", { area: "Ghost", scheduled: TODAY });
  });
  const areas = await plugin.collect(false);
  eq(areaNames(areas), ["Ghost"]);
  eq(names(areas[0].loose), ["Orphan work"]);
});

test("areas differing only by emoji are different areas", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "💪Sport");
    taskNote(a, "Run", { area: "💪Sport", scheduled: TODAY });
    taskNote(a, "Other", { area: "Sport", scheduled: TODAY });
  });
  eq(areaNames(await plugin.collect(false)).sort(), ["Sport", "💪Sport"]);
});

// --- order ----------------------------------------------------------------------------------------

test("a dragged order is kept by uid and survives a rename", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "A", { area: "Sport", scheduled: TODAY });
    taskNote(a, "B", { area: "Sport", scheduled: TODAY });
    taskNote(a, "C", { area: "Sport", scheduled: TODAY });
  });
  const tasks = Object.fromEntries(plugin.tasks().map((t) => [t.text, t]));
  await plugin.reorder([tasks.C], { into: false, after: false, target: { type: "task", task: tasks.A } }, {});
  eq(names((await plugin.collect(false))[0].loose), ["C", "A", "B"], "C went first");
  await plugin.rename(plugin.tasks().find((t) => t.text === "C"), "C renamed");
  eq(names((await plugin.collect(false))[0].loose), ["C renamed", "A", "B"], "the order held through the rename");
});

test("the saved order does not grow duplicates", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "A", { area: "Sport", scheduled: TODAY });
    taskNote(a, "B", { area: "Sport", scheduled: TODAY });
  });
  const t = Object.fromEntries(plugin.tasks().map((x) => [x.text, x]));
  for (let i = 0; i < 5; i++) await plugin.reorder([t.B], { into: false, after: false, target: { type: "task", task: t.A } }, {});
  const list = plugin.data.order.tasks["area:Sport"];
  eq(list.length, new Set(list).size, "no duplicates in " + JSON.stringify(list));
});

test("moving a task to another area puts it in that area's order", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Sport");
    areaNote(a, "Home");
    taskNote(a, "Run", { area: "Sport", scheduled: TODAY });
  });
  const task = plugin.tasks()[0];
  await plugin.moveTasks([task], { into: true, target: { type: "area", area: { name: "Home" } } }, {});
  const areas = await plugin.collect(false);
  eq(areaNames(areas), ["Home"]);
  has(plugin.data.order.tasks["area:Home"] || [], task.uid, "the order of the new area");
});

// --- scale -------------------------------------------------------------------------------------

test("a thousand tasks collect fast enough for a keystroke", async () => {
  const { plugin } = await stand((a) => {
    for (let i = 0; i < 20; i++) areaNote(a, "Area " + i);
    for (let i = 0; i < 1000; i++) {
      taskNote(a, "Task " + i, { area: "Area " + (i % 20), scheduled: i % 3 ? TODAY : DAY(4) });
    }
  });
  const started = Date.now();
  const areas = await plugin.collect(false);
  const ms = Date.now() - started;
  eq(areas.length, 20, "every area");
  ok(ms < 400, `collect took ${ms}ms`);
});

// --- run ------------------------------------------------------------------------------------------

const filter = process.argv[2];
let failed = 0;
for (const { name, fn } of tests) {
  if (filter && !name.includes(filter)) continue;
  try {
    await fn();
    console.log("  ✓ " + name);
  } catch (e) {
    failed++;
    console.log("  ✗ " + name + "\n      " + (e instanceof Failed ? e.message : e.stack));
  }
}
console.log(failed ? `\n${failed} failed of ${tests.length}` : `\nall ${tests.length} model tests passed`);
process.exit(failed ? 1 : 0);
