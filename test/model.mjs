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

test("a task that holds a description is marked as one", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Plain", { area: "Work", scheduled: TODAY });
    taskNote(a, "With a plan", { area: "Work", scheduled: TODAY }, "сначала одно, потом другое");
  });
  const tasks = Object.fromEntries(plugin.tasks().map((x) => [x.text, x]));
  eq(tasks["Plain"].described, false, "a service note is not marked");
  eq(tasks["With a plan"].described, true, "one with a plan is");
});

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

test("an undated task that becomes a project leaves no twin row behind", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Someday thing", { area: "Sport" }, "мысли на будущее");
  });
  await plugin.toProject(plugin.tasks()[0]);
  eq(app.vault.files.has("Tasks/Someday thing.md"), false, "the task note is gone");
  ok(bodyOf(app, "Areas/Someday thing.md").includes("мысли на будущее"), "its text is in the project");
  const area = areaOf(await plugin.collect(true), "Sport");
  eq(area.projects.map((p) => p.file.basename), ["Someday thing"], "the project is there, empty");
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

// --- the ZFG day ------------------------------------------------------------------------------

test("morning: only the areas with something due today are in the focus", async () => {
  const { plugin } = await stand((a) => {
    for (const name of ["Work", "Home", "Sport", "Money", "Health"]) areaNote(a, name);
    taskNote(a, "Ship it", { area: "Work", scheduled: TODAY });
    taskNote(a, "Run", { area: "Sport", scheduled: DAY(-2) });
    taskNote(a, "Dishes", { area: "Home" });
    taskNote(a, "Bills", { area: "Money", scheduled: DAY(7) });
    taskNote(a, "Doctor", { area: "Health", scheduled: DAY(1) });
  });
  eq(areaNames(await plugin.collect(false)).sort(), ["Sport", "Work"], "four or five areas is the norm; today it is two");
});

test("moving a task to tomorrow takes it out of today", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Ship it", { area: "Work", scheduled: TODAY });
  });
  await plugin.setDate(plugin.tasks()[0], DAY(1));
  eq(areaNames(await plugin.collect(false)), [], "nothing is due today any more");
  const area = areaOf(await plugin.collect(true), "Work");
  eq(names(area.future.loose.concat(area.loose)), ["Ship it"], "it is in the upcoming work");
});

test("sending a task to someday clears its date and keeps it in the area", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Later thing", { area: "Work", scheduled: TODAY });
  });
  await plugin.setDate(plugin.tasks()[0], null);
  eq(frontmatter(app, "Tasks/Later thing.md").scheduled, undefined, "no date");
  eq(names(areaOf(await plugin.collect(true), "Work").loose), ["Later thing"], "«All» shows it in the area");
});

test("a task stuck for two weeks is still in the focus, dated in the past", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Stuck", { area: "Work", scheduled: DAY(-14) });
  });
  const area = (await plugin.collect(false))[0];
  eq(names(area.loose), ["Stuck"]);
  ok(area.loose[0].date < TODAY, "the view paints it red by this");
});

test("evening: everything checked off today is counted in its area, and gone tomorrow", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Launch");
    taskNote(a, "One", { area: "Work", status: "done", completedDate: TODAY });
    taskNote(a, "Two", { area: "Work", project: "Launch", status: "done", completedDate: TODAY });
    taskNote(a, "Three", { area: "Work", status: "done", completedDate: DAY(-1) });
  });
  const area = (await plugin.collect(false))[0];
  eq(names(area.done), ["One", "Two"], "today's two, the project's step included");
  eq(area.done.map((x) => x.project || ""), ["", "Launch"], "each row knows where it came from");
});

test("a project whose steps are all done today leaves the focus but its area stays", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Launch");
    taskNote(a, "Last step", { area: "Work", project: "Launch", status: "done", completedDate: TODAY });
  });
  const areas = await plugin.collect(false);
  eq(areaNames(areas), ["Work"]);
  eq(areas[0].projects.length, 0, "no empty project row in the focus");
  eq(names(areas[0].done), ["Last step"]);
});

// --- dates and statuses as people (and other plugins) write them -------------------------------

test("a date written with a time still counts as that day", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Timed", { area: "Work", scheduled: TODAY + "T10:00:00" });
    taskNote(a, "Timed done", { area: "Work", status: "done", completedDate: TODAY + "T18:30:00+03:00" });
  });
  const area = (await plugin.collect(false))[0];
  eq(names(area.loose), ["Timed"], "in the focus, not in some far future");
  eq(names(area.done), ["Timed done"], "counted as done today");
});

test("a status in capitals is still a status", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Shouted", { area: "Work", scheduled: TODAY, status: "DONE", completedDate: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  eq(names(area.done), ["Shouted"]);
  eq(area.loose.length, 0, "not open at the same time");
});

test("a nonsense date does not throw the task out of sight", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Broken date", { area: "Work", scheduled: "не дата" });
  });
  const area = areaOf(await plugin.collect(true), "Work");
  eq(names(area.loose.concat(area.future.loose)), ["Broken date"]);
});

test("a number or a date object in a field does not break the row", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "42");
    taskNote(a, "Numbered", { area: 42, scheduled: TODAY, title: 7 });
  });
  const area = (await plugin.collect(false))[0];
  eq(area.name, "42");
  eq(names(area.loose), ["7"]);
});

// --- the note changes under the plugin ----------------------------------------------------------

test("a write to a task that has just been deleted fails quietly", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Doomed", { area: "Work", scheduled: TODAY });
  });
  const task = plugin.tasks()[0];
  app.vault.files.delete(task.file.path);
  const ok1 = await plugin.setDate(task, DAY(1));
  eq(ok1, false, "the write is refused");
  ok(app.notices.length > 0, "the user is told");
});

test("a task renamed by another device is still written to", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Old name", { area: "Work", scheduled: TODAY });
  });
  const task = plugin.tasks()[0];
  await app.vault.rename(app.vault.getAbstractFileByPath("Tasks/Old name.md"), "Tasks/New name.md");
  eq(await plugin.setDate(task, DAY(1)), true, "the write went through");
  eq(frontmatter(app, "Tasks/New name.md").scheduled, DAY(1));
});

test("two boxes ticked at once do not overwrite each other", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "A", { area: "Work", scheduled: TODAY });
    taskNote(a, "B", { area: "Work", scheduled: TODAY });
  });
  const [a1, b1] = plugin.tasks();
  await Promise.all([plugin.toggle(a1), plugin.toggle(b1)]);
  eq(frontmatter(app, "Tasks/A.md").status, "done");
  eq(frontmatter(app, "Tasks/B.md").status, "done");
});

test("the same task ticked twice at once is done once", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "A", { area: "Work", scheduled: TODAY });
  });
  const task = plugin.tasks()[0];
  const [first, second] = await Promise.all([plugin.toggle(task), plugin.toggle(task)]);
  eq([first, second], [true, false], "the second click is refused while the first is in flight");
  eq(frontmatter(app, "Tasks/A.md").status, "done");
});

test("a task moved out of the tasks folder stops being a task", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Wanderer", { area: "Work", scheduled: TODAY });
  });
  await app.vault.rename(app.vault.getAbstractFileByPath("Tasks/Wanderer.md"), "Notes/Wanderer.md");
  eq(plugin.tasks().length, 0, "not a task any more");
  eq(plugin.orphans().length, 0, "and not reported as lost either");
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

test("the saved order forgets tasks that no longer exist", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "A", { area: "Work", scheduled: TODAY });
    taskNote(a, "B", { area: "Work", scheduled: TODAY });
  });
  const t = Object.fromEntries(plugin.tasks().map((x) => [x.text, x]));
  plugin.data.order.tasks["area:Work"] = ["ft-long-gone", t.A.uid, t.B.uid];
  await plugin.reorder([t.B], { into: false, after: false, target: { type: "task", task: t.A } }, {});
  eq(plugin.data.order.tasks["area:Work"].includes("ft-long-gone"), false, "the dead id is gone");
  eq(plugin.data.order.tasks["area:Work"].length, 2, "only the two that exist");
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

// --- what the research round found --------------------------------------------------------------

test("a task linked to its project by path is not called lost", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Sport");
    projectNote(a, "Sport", "Marathon");
    writeNote(a, "Tasks/Step.md", { uid: "ft-p", type: "задача", status: "open", projects: ["[[Areas/Marathon]]"], scheduled: TODAY });
  });
  eq(names(plugin.orphans()), [], "it has a home: the project names its area");
});

test("the checkbox decides from the note on disk, not from what the screen remembers", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Run", { area: "Sport", scheduled: TODAY });
  });
  const stale = plugin.tasks()[0];            // read while the task was open
  await plugin.setFields(stale, { status: "done", completedDate: TODAY });  // another device finished it
  await plugin.toggle(stale);                  // the user taps the box they saw as empty
  eq(frontmatter(app, "Tasks/Run.md").status, "open", "the tap takes the note as it is now: done → open");
});

test("a repeating task is not finished as a whole when nothing can complete the occurrence", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    writeNote(a, "Tasks/Weekly.md", { uid: "ft-r", type: "задача", status: "open", area: "Sport", scheduled: TODAY, recurrence: "FREQ=WEEKLY" });
  });
  const okDone = await plugin.toggle(plugin.tasks()[0]);
  eq(okDone, false, "the tick is refused");
  eq(frontmatter(app, "Tasks/Weekly.md").status, "open", "the series is untouched");
  ok(app.notices.some((n) => n.length), "the user is told why");
});

test("undo does not wipe what was written in the meantime", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Run", { area: "Sport", scheduled: TODAY });
  });
  const task = plugin.tasks()[0];
  await plugin.remove(task);
  await app.vault.create("Tasks/Run.md", "---\nuid: ft-other\ntype: задача\nstatus: open\narea: Sport\n---\n\nсовсем другая заметка\n");
  await plugin.undoLast();
  ok(bodyOf(app, "Tasks/Run.md").includes("совсем другая"), "the note that exists now is kept, undo does not overwrite it");
});

test("renaming a project note from outside keeps its place and its fold", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    projectNote(a, "Sport", "Marathon");
    projectNote(a, "Sport", "Gym");
    taskNote(a, "Step", { area: "Sport", project: "Marathon", scheduled: TODAY });
  });
  plugin.data.order.projects.Sport = ["Areas/Marathon.md", "Areas/Gym.md"];
  plugin.data.folded["project:Areas/Marathon.md"] = true;
  await app.vault.rename(app.vault.getAbstractFileByPath("Areas/Marathon.md"), "Areas/Marathon 2027.md");
  await plugin.renamed("Areas/Marathon 2027.md", "Areas/Marathon.md");
  eq(plugin.data.order.projects.Sport, ["Areas/Marathon 2027.md", "Areas/Gym.md"], "the order followed the file");
  eq(plugin.data.folded["project:Areas/Marathon 2027.md"], true, "the fold followed the file");
});

test("reading the list twice does not read the vault twice as many times", async () => {
  const { app, plugin } = await stand((a) => {
    for (let i = 0; i < 10; i++) areaNote(a, "Area " + i);
    for (let i = 0; i < 300; i++) taskNote(a, "Task " + i, { area: "Area " + (i % 10), scheduled: TODAY });
  });
  let reads = 0;
  const real = app.metadataCache.getFileCache.bind(app.metadataCache);
  app.metadataCache.getFileCache = (f) => { reads++; return real(f); };
  await plugin.collect(false);
  const perCollect = reads;
  reads = 0;
  await plugin.collect(false);
  await plugin.collect(true);
  plugin.orphans();
  ok(reads <= perCollect * 1.2, `three reads of the same vault cost ${reads} lookups against ${perCollect} for one`);
});

// --- the date field -------------------------------------------------------------------------------

test("the date field understands how people write dates", async () => {
  const { plugin } = await stand((a) => areaNote(a, "Work"));
  const parse = plugin.constructor.parseDay || globalThis.__ftParseDay;
  ok(parse, "parseDay is reachable for tests");
  eq(parse("сегодня"), TODAY, "сегодня");
  eq(parse("завтра"), DAY(1), "завтра");
  eq(parse("послезавтра"), DAY(2), "послезавтра");
  eq(parse("+3"), DAY(3), "+3");
  eq(parse("через 5 дней"), DAY(5), "через 5 дней");
  eq(parse("25.12"), moment("25.12", "DD.MM").format("YYYY-MM-DD"), "25.12");
  eq(parse("25.12.27"), "2027-12-25", "25.12.27");
  eq(parse("ерунда"), null, "nonsense stays nonsense");
  const monday = parse("пн");
  eq(moment(monday).isoWeekday(), 1, "пн is a Monday");
  ok(monday > TODAY, "and it is in the future, never today");
});

test("an empty focus still knows how much work is waiting", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Later one", { area: "Work" });
    taskNote(a, "Later two", { area: "Work", scheduled: DAY(4) });
    taskNote(a, "Old done", { area: "Work", status: "done", completedDate: DAY(-2) });
  });
  eq(areaNames(await plugin.collect(false)), [], "nothing is due today");
  const waiting = plugin.tasks().filter((x) => !["done", "cancelled", "someday"].includes(x.status)).length;
  eq(waiting, 2, "and the view can say how much is waiting");
});

// --- what the code review found -------------------------------------------------------------------

test("a write refuses to go into a different task that took the same file name", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Foo", { area: "Work", scheduled: TODAY });
  });
  const stale = plugin.tasks()[0];                      // the row on screen
  app.vault.files.delete("Tasks/Foo.md");               // another device deleted it
  await app.vault.create("Tasks/Foo.md", "---\nuid: ft-someone-else\ntype: задача\nstatus: open\narea: Work\n---\n");
  const ok1 = await plugin.setDate(stale, DAY(3));
  eq(ok1, false, "the write is refused");
  eq(frontmatter(app, "Tasks/Foo.md").scheduled, undefined, "the other task is untouched");
});

test("a write refuses to go into a note that is no longer a task", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Foo", { area: "Work", scheduled: TODAY });
  });
  const stale = plugin.tasks()[0];
  app.vault.files.set("Tasks/Foo.md", "---\ntype: note\narea: Work\n---\n\nобычная заметка\n");
  eq(await plugin.setDate(stale, DAY(7)), false, "the write is refused");
  const fm = frontmatter(app, "Tasks/Foo.md");
  eq(fm.scheduled, undefined, "the note was not given a date");
  eq(fm.uid, undefined, "and not given an identity either");
});

test("two projects with the same name do not mix their tasks", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    areaNote(a, "Home");
    writeNote(a, "Areas/Work Plan.md", { area: "Work", type: "project" });
    writeNote(a, "Areas/Home Plan.md", { area: "Home", type: "project" });
    // both notes are called «Plan» to Obsidian once renamed; here the link says which one by path
    writeNote(a, "Tasks/Work step.md", { uid: "ft-w", type: "задача", status: "open", area: "Work", projects: ["[[Areas/Work Plan]]"], scheduled: TODAY });
    writeNote(a, "Tasks/Home step.md", { uid: "ft-h", type: "задача", status: "open", area: "Home", projects: ["[[Areas/Home Plan]]"], scheduled: TODAY });
  });
  const areas = await plugin.collect(false);
  eq(names(projectOf(areaOf(areas, "Work"), "Work Plan").tasks), ["Work step"]);
  eq(names(projectOf(areaOf(areas, "Home"), "Home Plan").tasks), ["Home step"]);
});

test("two project notes with the same name keep their own tasks", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    areaNote(a, "Home");
    writeNote(a, "Areas/work/Plan.md", { area: "Work", type: "project" });
    writeNote(a, "Areas/home/Plan.md", { area: "Home", type: "project" });
    writeNote(a, "Tasks/Work step.md", { uid: "ft-w", type: "задача", status: "open", area: "Work", projects: ["[[Areas/work/Plan]]"], scheduled: TODAY });
    writeNote(a, "Tasks/Home step.md", { uid: "ft-h", type: "задача", status: "open", area: "Home", projects: ["[[Plan]]"], scheduled: TODAY });
  });
  const areas = await plugin.collect(false);
  eq(names(projectOf(areaOf(areas, "Work"), "Plan").tasks), ["Work step"], "the link by path went to its own project");
  eq(names(projectOf(areaOf(areas, "Home"), "Plan").tasks), ["Home step"], "the link by name went to the project of its own area");
});

test("deleting one of two projects of the same name leaves the other one alone", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    areaNote(a, "Home");
    writeNote(a, "Areas/work/Plan.md", { area: "Work", type: "project" });
    writeNote(a, "Areas/home/Plan.md", { area: "Home", type: "project" });
    writeNote(a, "Tasks/Work step.md", { uid: "ft-w", type: "задача", status: "open", area: "Work", projects: ["[[Areas/work/Plan]]"], scheduled: TODAY });
    writeNote(a, "Tasks/Home step.md", { uid: "ft-h", type: "задача", status: "open", area: "Home", projects: ["[[Areas/home/Plan]]"], scheduled: TODAY });
  });
  const home = areaOf(await plugin.collect(false), "Home");
  await plugin.removeProject(home, projectOf(home, "Plan"));
  eq(frontmatter(app, "Tasks/Home step.md").projects, undefined, "its own task was freed");
  eq(frontmatter(app, "Tasks/Work step.md").projects, ["[[Areas/work/Plan]]"], "the other project's task kept its link");
});

test("a task dropped into a project is linked to that very note", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    writeNote(a, "Areas/Plan.md", { area: "Work", type: "project" });
    taskNote(a, "Step", { area: "Work", scheduled: TODAY });
  });
  const project = projectOf(areaOf(await plugin.collect(true), "Work"), "Plan");
  await plugin.moveTasks([plugin.tasks()[0]], { into: true, target: { type: "project", area: { name: "Work" }, project } }, {});
  const link = frontmatter(app, "Tasks/Step.md").projects[0];
  ok(link.includes("Plan"), "the link names the project: " + link);
  eq(names(projectOf(areaOf(await plugin.collect(false), "Work"), "Plan").tasks), ["Step"], "and it reads back into that project");
});

test("deleting a project keeps its tasks in the area, even the ones that had no area", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Plan");
    taskNote(a, "Mine", { area: "Work", project: "Plan", scheduled: TODAY });
    writeNote(a, "Tasks/Foreign.md", { uid: "ft-f", type: "задача", status: "open", projects: ["[[Plan]]"], scheduled: TODAY });
  });
  const area = areaOf(await plugin.collect(false), "Work");
  await plugin.removeProject(area, projectOf(area, "Plan"));
  eq(frontmatter(app, "Tasks/Foreign.md").area, "Work", "the task that had no area got the project's");
  eq(plugin.orphans().length, 0, "nothing was left lost");
});

test("two deletes in a row: each notice puts back its own", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "First", { area: "Work", scheduled: TODAY });
    taskNote(a, "Second", { area: "Work", scheduled: TODAY });
  });
  const [one, two] = plugin.tasks();
  const undoOne = await plugin.removeTask(one);
  const undoTwo = await plugin.removeTask(two);
  await undoOne();
  eq(plugin.tasks().map((x) => x.text), ["First"], "the first delete was undone, the second stands");
  await undoTwo();
  eq(plugin.tasks().map((x) => x.text).sort(), ["First", "Second"], "and then the second");
});

test("a task that gains a uid keeps the place it was dragged to", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    writeNote(a, "Tasks/Foreign.md", { type: "задача", status: "open", area: "Work", scheduled: TODAY });
    taskNote(a, "Mine", { area: "Work", scheduled: TODAY });
  });
  const foreign = plugin.tasks().find((x) => x.text === "Foreign");
  const mine = plugin.tasks().find((x) => x.text === "Mine");
  await plugin.reorder([foreign], { into: false, after: false, target: { type: "task", task: mine } }, {});
  eq(names((await plugin.collect(false))[0].loose), ["Foreign", "Mine"], "dragged to the top");
  await plugin.setDate(plugin.tasks().find((x) => x.text === "Foreign"), TODAY);   // this writes the uid
  eq(names((await plugin.collect(false))[0].loose), ["Foreign", "Mine"], "still at the top after it got its uid");
});

test("the guard on a task that had no uid lets the next tick through", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    writeNote(a, "Tasks/Foreign.md", { type: "задача", status: "open", area: "Work", scheduled: TODAY });
  });
  await plugin.toggle(plugin.tasks()[0]);
  const second = await plugin.toggle(plugin.tasks()[0]);
  eq(second, true, "the second tick is not blocked by a stale guard");
  eq(frontmatter(app, "Tasks/Foreign.md").status, "open", "and it went back to open");
});

// --- the second review ------------------------------------------------------------------------------

test("a row read before the note had an identity does not write into a replacement", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    writeNote(a, "Tasks/Foo.md", { type: "задача", status: "open", area: "Work", scheduled: TODAY });
  });
  const stale = plugin.tasks()[0];
  app.vault.files.set("Tasks/Foo.md", "---\nuid: ft-other\ntype: задача\nstatus: open\narea: Work\n---\n");
  eq(await plugin.setDate(stale, DAY(2)), false, "the write is refused");
  eq(frontmatter(app, "Tasks/Foo.md").scheduled, undefined, "the replacement keeps its own state");
});

test("a refused write does not rename the note either", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Foo", { area: "Work", scheduled: TODAY });
  });
  const stale = plugin.tasks()[0];
  app.vault.files.set("Tasks/Foo.md", "---\nuid: ft-other\ntype: задача\nstatus: open\narea: Work\n---\n");
  await plugin.rename(stale, "Bar");
  ok(app.vault.files.has("Tasks/Foo.md"), "the other task kept its name");
  eq(app.vault.files.has("Tasks/Bar.md"), false, "nothing was renamed");
});

test("a task whose area and project disagree is shown where its project is", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    areaNote(a, "Home");
    projectNote(a, "Home", "Plan");
    writeNote(a, "Tasks/Odd.md", { uid: "ft-odd", type: "задача", status: "open", area: "Work", projects: ["[[Plan]]"], scheduled: TODAY });
  });
  const areas = await plugin.collect(false);
  eq(areaNames(areas), ["Home"], "the area of its project");
  eq(names(projectOf(areaOf(areas, "Home"), "Plan").tasks), ["Odd"], "and the row is there, not lost between two areas");
});

test("renaming a project keeps the order of its steps", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Plan");
    taskNote(a, "A", { area: "Work", project: "Plan", scheduled: TODAY });
    taskNote(a, "B", { area: "Work", project: "Plan", scheduled: TODAY });
  });
  const t = Object.fromEntries(plugin.tasks().map((x) => [x.text, x]));
  await plugin.reorder([t.B], { into: false, after: false, target: { type: "task", task: t.A } }, {});
  eq(names(projectOf(areaOf(await plugin.collect(false), "Work"), "Plan").tasks), ["B", "A"], "B was put first");
  await plugin.renameProject(app.vault.getAbstractFileByPath("Areas/Plan.md"), "Plan 2027");
  eq(names(projectOf(areaOf(await plugin.collect(false), "Work"), "Plan 2027").tasks), ["B", "A"], "and stays first after the rename");
});

test("making a project out of a row that has since changed is refused", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Big thing", { area: "Work", scheduled: TODAY }, "план");
  });
  const stale = plugin.tasks()[0];
  app.vault.files.set("Tasks/Big thing.md", "---\nuid: ft-other\ntype: задача\nstatus: open\narea: Work\n---\n");
  const made = await plugin.toProject(stale);
  eq(made, null, "refused");
  eq(app.vault.files.has("Areas/Big thing.md"), false, "no project was created from stale data");
  ok(app.vault.files.has("Tasks/Big thing.md"), "and the note that is there now was not trashed");
});

test("a cancelled task with no area is not asked about", async () => {
  const { plugin } = await stand((a) => {
    writeNote(a, "Tasks/Dropped.md", { uid: "ft-d", type: "задача", status: "cancelled" });
    writeNote(a, "Tasks/Maybe.md", { uid: "ft-m", type: "задача", status: "someday" });
    writeNote(a, "Tasks/Real.md", { uid: "ft-r", type: "задача", status: "open", scheduled: TODAY });
  });
  eq(names(plugin.orphans()), ["Real"], "only the open one needs a home");
});

// --- ⌘Z ------------------------------------------------------------------------------------------

test("undo takes back a completed task", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Run", { area: "Work", scheduled: TODAY });
  });
  await plugin.toggle(plugin.tasks()[0]);
  eq(frontmatter(app, "Tasks/Run.md").status, "done");
  await plugin.undo();
  eq(frontmatter(app, "Tasks/Run.md").status, "open", "back to open");
  eq(frontmatter(app, "Tasks/Run.md").completedDate, undefined, "and the day is gone");
});

test("undo takes back a date, one step at a time", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Run", { area: "Work", scheduled: TODAY });
  });
  await plugin.setDate(plugin.tasks()[0], DAY(1));
  await plugin.setDate(plugin.tasks()[0], DAY(5));
  await plugin.undo();
  eq(frontmatter(app, "Tasks/Run.md").scheduled, DAY(1), "the last date change is undone");
  await plugin.undo();
  eq(frontmatter(app, "Tasks/Run.md").scheduled, TODAY, "and the one before it");
});

test("undo takes back a date given to several rows at once", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "A", { area: "Work", scheduled: TODAY });
    taskNote(a, "B", { area: "Work", scheduled: TODAY });
  });
  await plugin.setDates(plugin.tasks(), null);
  eq(frontmatter(app, "Tasks/A.md").scheduled, undefined);
  await plugin.undo();
  eq(frontmatter(app, "Tasks/A.md").scheduled, TODAY, "both rows are back");
  eq(frontmatter(app, "Tasks/B.md").scheduled, TODAY);
});

test("undo takes back a new task by removing it", async () => {
  const { app, plugin } = await stand((a) => areaNote(a, "Work"));
  await plugin.createTask("Лишняя", { area: "Work", project: null }, TODAY);
  eq(plugin.tasks().length, 1);
  await plugin.undo();
  eq(plugin.tasks().length, 0, "the note it made is gone");
});

test("undo takes back a rename, name and text", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Старое имя", { area: "Work", scheduled: TODAY });
  });
  await plugin.rename(plugin.tasks()[0], "Новое имя");
  eq(plugin.tasks()[0].text, "Новое имя");
  await plugin.undo();
  eq(plugin.tasks()[0].text, "Старое имя", "the text is back");
  ok(app.vault.files.has("Tasks/Старое имя.md"), "and so is the file name");
});

test("undo takes back a move, with the order it wrote", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Plan");
    taskNote(a, "Step", { area: "Work", scheduled: TODAY });
  });
  const project = projectOf(areaOf(await plugin.collect(true), "Work"), "Plan");
  await plugin.drop({ type: "task", task: plugin.tasks()[0] }, { into: true, target: { type: "project", area: { name: "Work" }, project } }, { tasks: {} });
  eq(frontmatter(app, "Tasks/Step.md").projects?.length, 1, "it went into the project");
  await plugin.undo();
  eq(frontmatter(app, "Tasks/Step.md").projects, undefined, "and came back out");
});

test("undo takes back making a task into a project", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Большое дело", { area: "Work", scheduled: TODAY }, "план");
  });
  await plugin.toProject(plugin.tasks()[0]);
  ok(app.vault.files.has("Areas/Большое дело.md"), "the project was made");
  await plugin.undo();
  eq(app.vault.files.has("Areas/Большое дело.md"), false, "the project note is gone");
  eq(plugin.tasks().length, 1, "the task is back");
  ok(bodyOf(app, "Tasks/Большое дело.md").includes("план"), "with its description");
});

test("undo takes back a deleted task as well", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Run", { area: "Work", scheduled: TODAY });
  });
  await plugin.removeTask(plugin.tasks()[0]);
  eq(plugin.tasks().length, 0);
  await plugin.undo();
  eq(plugin.tasks().length, 1, "it is back");
});

test("undo does not touch what someone else has written since", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Run", { area: "Work", scheduled: TODAY });
  });
  await plugin.toggle(plugin.tasks()[0]);
  await app.fileManager.processFrontMatter(app.vault.getAbstractFileByPath("Tasks/Run.md"), (fm) => { fm.priority = "high"; });
  await plugin.undo();
  const fm = frontmatter(app, "Tasks/Run.md");
  eq(fm.status, "done", "the note was left as the other writer made it");
  eq(fm.priority, "high", "and their field is intact");
});

test("undo says when there is nothing left to undo", async () => {
  const { app, plugin } = await stand((a) => areaNote(a, "Work"));
  eq(await plugin.undo(), 0);
  ok(app.notices.length > 0, "and it says so");
});

test("the history does not grow without end", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Run", { area: "Work", scheduled: TODAY });
  });
  for (let i = 0; i < 40; i++) await plugin.setDate(plugin.tasks()[0], DAY(i % 7));
  ok(plugin.history.length <= 30, "at most thirty steps: " + plugin.history.length);
});

// --- fuzzing: nothing may vanish ----------------------------------------------------------------

// A pseudo-random vault of areas, projects and tasks with every kind of junk seen in the wild.
function junkVault(app, seed) {
  let x = seed;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const areas = ["Work", "🏗AI Hub", "Дом", "42", "Sport"];
  for (const a of areas) if (rnd() > 0.2) areaNote(app, a);
  const projects = [];
  for (let i = 0; i < 6; i++) {
    const name = "Project " + i;
    const area = pick(areas);
    if (rnd() > 0.15) { projectNote(app, area, name); projects.push({ name, area }); }
  }
  const dates = [TODAY, DAY(-3), DAY(-40), DAY(2), TODAY + "T09:00:00", "не дата", "", null];
  const statuses = ["open", "OPEN", "in-progress", "done", "DONE", "cancelled", "someday", "", "none"];
  const made = [];
  for (let i = 0; i < 60; i++) {
    const fields = { status: pick(statuses) };
    if (rnd() > 0.15) fields.area = pick(areas);
    if (rnd() > 0.5) {
      const pr = pick(projects.length ? projects : [{ name: "Ghost" }]);
      fields.projects = [pick([`[[${pr.name}]]`, `[[Areas/${pr.name}]]`, `[[${pr.name}|алиас]]`, pr.name])];
    }
    const d = pick(dates);
    if (d) fields.scheduled = d;
    if (fields.status.toLowerCase() === "done" && rnd() > 0.3) fields.completedDate = pick([TODAY, DAY(-1), TODAY + "T20:00"]);
    if (rnd() > 0.7) fields.priority = pick(["low", "normal", "high", "нет", 3]);
    if (rnd() > 0.8) fields.due = pick(dates.filter(Boolean));
    if (rnd() > 0.9) fields.title = pick(["", "Полное название задачи", 7]);
    const name = "T" + i + pick(["", " с пробелом", " ⚡", " (2)", "."]);
    writeNote(app, `Tasks/${name}.md`, { uid: rnd() > 0.05 ? "ft-f" + i : "", type: pick(["задача", "task", "ЗАДАЧА"]), ...fields },
      rnd() > 0.8 ? "описание\n- [ ] подшаг" : "");
    made.push(name);
  }
  return made;
}

test("fuzz: whatever is in the vault, every open task is somewhere on screen", async () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { plugin } = await stand((app) => junkVault(app, seed));
    const all = await plugin.collect(true);
    const shown = new Set();
    for (const area of all) {
      for (const t of [...area.loose, ...area.future.loose, ...area.done]) shown.add(t.file.path);
      for (const pr of [...area.projects, ...area.future.projects]) for (const t of [...pr.tasks, ...(pr.later || [])]) shown.add(t.file.path);
    }
    for (const t of plugin.orphans()) shown.add(t.file.path);
    const open = plugin.tasks().filter((t) => !["done", "cancelled", "someday"].includes(t.status));
    const lost = open.filter((t) => !shown.has(t.file.path)).map((t) => `${t.file.path} (area=${t.area}, project=${t.project})`);
    eq(lost, [], `seed ${seed}: tasks nobody can see`);
  }
});

test("fuzz: the focus never shows a task that is not due yet", async () => {
  for (let seed = 100; seed <= 130; seed++) {
    const { plugin } = await stand((app) => junkVault(app, seed));
    const focus = await plugin.collect(false);
    for (const area of focus) {
      const rows = [...area.loose, ...area.projects.flatMap((p) => p.tasks)];
      const wrong = rows.filter((t) => !(t.date && t.date <= TODAY)).map((t) => `${t.text}: ${t.date}`);
      eq(wrong, [], `seed ${seed}: not due yet but in the focus`);
    }
  }
});

test("fuzz: reading the same vault twice gives the same answer", async () => {
  for (let seed = 200; seed <= 210; seed++) {
    const { plugin } = await stand((app) => junkVault(app, seed));
    const once = JSON.stringify((await plugin.collect(false)).map((a) => [a.name, names(a.loose), a.projects.map((p) => names(p.tasks))]));
    const twice = JSON.stringify((await plugin.collect(false)).map((a) => [a.name, names(a.loose), a.projects.map((p) => names(p.tasks))]));
    eq(once, twice, `seed ${seed}: the list is not stable`);
  }
});

test("fuzz: every write leaves a note the plugin can still read", async () => {
  for (let seed = 300; seed <= 315; seed++) {
    const { app, plugin } = await stand((a) => junkVault(a, seed));
    const before = plugin.tasks().length;
    for (const task of plugin.tasks().slice(0, 8)) {
      await plugin.setDate(task, DAY(1));
      await plugin.toggle(task);
      await plugin.rename(task, task.text + " ×");
    }
    eq(plugin.tasks().length, before, `seed ${seed}: a task was lost by writing to it`);
    for (const task of plugin.tasks()) {
      ok(task.uid && task.text, `seed ${seed}: a task came back broken: ${JSON.stringify(task.file.path)}`);
    }
  }
});

// --- a week of use, and someone writing underneath ------------------------------------------------

test("a week of ordinary use leaves the vault consistent", async () => {
  const { app, plugin } = await stand((a) => {
    for (const name of ["Work", "Home", "Sport"]) areaNote(a, name);
    projectNote(a, "Work", "Launch");
  });
  const pick = (text) => plugin.tasks().find((x) => x.text === text);
  // Monday: three tasks come in, one straight into the project
  await plugin.createTask("Написать письмо", { area: "Work", project: null }, TODAY);
  await plugin.createTask("Собрать вещи", { area: "Home", project: null }, TODAY);
  await plugin.createTask("Первый шаг запуска", { area: "Work", project: "Launch" }, TODAY);
  eq(names((await plugin.collect(false)).flatMap((x) => [...x.loose, ...x.projects.flatMap((p) => p.tasks)])).sort(),
     ["Written".replace("Written", "Написать письмо"), "Первый шаг запуска", "Собрать вещи"].sort(), "all three are in the focus");
  // one is finished, one goes to tomorrow, one to the someday list
  await plugin.toggle(pick("Написать письмо"));
  await plugin.setDate(pick("Собрать вещи"), DAY(1));
  await plugin.setDate(pick("Первый шаг запуска"), null);
  let areas = await plugin.collect(false);
  eq(names(areaOf(areas, "Work").done), ["Написать письмо"], "what was finished is under Completed");
  eq(areaNames(areas), ["Work"], "the other areas have nothing due");
  // a task grows a plan and becomes a project
  await plugin.createTask("Ремонт кухни", { area: "Home", project: null }, TODAY);
  await plugin.update(pick("Ремонт кухни"), () => {});
  await app.vault.process(app.vault.getAbstractFileByPath("Tasks/Ремонт кухни.md"), (t0) => t0 + "\n- [ ] Замерить\n- [ ] Выбрать плитку\n");
  plugin.forgetScan();
  await plugin.toProject(pick("Ремонт кухни"));
  const home = areaOf(await plugin.collect(true), "Home");
  eq(projectOf(home, "Ремонт кухни").tasks.map((x) => x.text), ["Замерить", "Выбрать плитку"], "the plan became steps");
  // the day after: what was done yesterday is gone, what was moved is due
  const yesterday = plugin.tasks().find((x) => x.text === "Написать письмо");
  await plugin.setFields(yesterday, { completedDate: DAY(-1) });
  await plugin.setDate(pick("Собрать вещи"), TODAY);
  areas = await plugin.collect(false);
  eq(areaOf(areas, "Work"), undefined, "nothing is left in Work today");
  eq(names(areaOf(areas, "Home").loose), ["Собрать вещи"], "and Home has the task that was moved");
  // nothing was lost on the way
  eq(plugin.orphans().length, 0, "no task without a home");
  eq(plugin.tasks().length, 5, "four tasks and the two steps, minus the one that became a project");
});

test("someone writing the same notes underneath does not break the list", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Launch");
    for (let i = 0; i < 12; i++) taskNote(a, "Task " + i, { area: "Work", scheduled: i % 2 ? TODAY : DAY(2) });
  });
  // the other writer: a script that edits, renames and adds notes while the plugin works
  const meddle = async (round) => {
    const tasks = plugin.tasks();
    const victim = tasks[round % tasks.length];
    if (!victim) return;
    if (round % 3 === 0) {
      await app.fileManager.processFrontMatter(app.vault.getAbstractFileByPath(victim.file.path), (fm) => { fm.priority = "high"; });
    } else if (round % 3 === 1) {
      const to = `Tasks/Renamed ${round}.md`;
      if (!app.vault.files.has(to)) await app.vault.rename(app.vault.getAbstractFileByPath(victim.file.path), to);
    } else {
      taskNote(app, "Extra " + round, { area: "Work", scheduled: TODAY });
    }
    plugin.forgetScan();
  };
  for (let round = 0; round < 12; round++) {
    const before = plugin.tasks();
    const task = before[round % before.length];
    await Promise.all([
      round % 2 ? plugin.setDate(task, TODAY) : plugin.toggle(task),
      meddle(round),
    ]);
    const areas = await plugin.collect(true);
    ok(areas.length >= 1, `round ${round}: the list survived`);
    for (const t of plugin.tasks()) ok(t.uid && t.text, `round ${round}: a task came back broken`);
  }
  const open = plugin.tasks().filter((t) => !["done", "cancelled", "someday"].includes(t.status));
  const shown = new Set();
  for (const area of await plugin.collect(true)) {
    for (const t of [...area.loose, ...area.future.loose]) shown.add(t.file.path);
    for (const pr of [...area.projects, ...area.future.projects]) for (const t of pr.tasks) shown.add(t.file.path);
  }
  for (const t of plugin.orphans()) shown.add(t.file.path);
  eq(open.filter((t) => !shown.has(t.file.path)).map((t) => t.file.path), [], "every open task is still visible");
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
