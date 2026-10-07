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
// The piles of an area, as the old tests read them: the focus rows are tasks and projects mixed,
// these pull one kind out.
const loose = (a) => a.rows.filter((r) => r.kind === "task").map((r) => r.task);
const ahead = (a) => a.ahead.filter((r) => r.kind === "task").map((r) => r.task);
const focusProjects = (a) => a.rows.filter((r) => r.kind === "project").map((r) => r.project);
const aheadProjects = (a) => a.ahead.filter((r) => r.kind === "project").map((r) => ({ file: r.project.file, tasks: r.steps }));
const doneLoose = (a) => a.done.filter((t) => !t.project);

// --- what belongs where ------------------------------------------------------------------------

test("a dated task of an area is in the focus, an undated one is not", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    taskNote(app, "Run 5k", { area: "Sport", scheduled: TODAY });
    taskNote(app, "Buy shoes", { area: "Sport" });
    taskNote(app, "Race", { area: "Sport", scheduled: DAY(5) });
  });
  const areas = await plugin.collect(false);
  eq(names(loose(areaOf(areas, "Sport"))), ["Run 5k"], "focus");
  eq(names(ahead(areaOf(areas, "Sport"))), ["Race", "Buy shoes"], "upcoming: the nearest date first, undated last");
});

test("a task dated in the past is in the focus", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    taskNote(app, "Old", { area: "Sport", scheduled: DAY(-30) });
  });
  eq(names(loose((await plugin.collect(false))[0])), ["Old"]);
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

test("a note tagged archived is history, not a task — whatever folder it lies in", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    taskNote(app, "Live", { area: "Sport", scheduled: TODAY });
    taskNote(app, "Old", { area: "Sport", status: "done", completedDate: TODAY, tags: ["archived"] });
    taskNote(app, "Older", { area: "Sport", scheduled: TODAY, tags: "#archived" });
  });
  eq(names(plugin.tasks()).sort(), ["Live"], "only the live one is read");
  eq(plugin.closedToday().map((g) => names(g.tasks)), [], "and the archived one is not today's closed work either");
});

test("cancelled and someday tasks stay out of the list", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    taskNote(app, "Dropped", { area: "Sport", scheduled: TODAY, status: "cancelled" });
    taskNote(app, "Maybe", { area: "Sport", scheduled: TODAY, status: "someday" });
    taskNote(app, "Real", { area: "Sport", scheduled: TODAY });
  });
  eq(names(loose((await plugin.collect(true))[0])), ["Real"]);
});

test("what is in other hands is on its own shelf, not in the pile of what is not today", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    taskNote(app, "Running", { area: "Sport", scheduled: DAY(4), status: "waiting" });
    taskNote(app, "Someday", { area: "Sport" });
    taskNote(app, "Mine", { area: "Sport", scheduled: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  eq(names(loose(area)), ["Mine"], "the focus holds only what is mine to do today");
  eq(names(ahead(area)), ["Someday"], "the pile holds what is not today — and not what is in other hands");
  eq(names(area.waiting), ["Running"], "the waiting one is on the shelf");
  eq(area.running, 1, "and counted");
  // «in-progress» is not a state of this list any more: a task with it is an ordinary open one
  const { plugin: p2 } = await stand((app) => {
    areaNote(app, "Sport");
    taskNote(app, "Being done", { area: "Sport", scheduled: TODAY, status: "in-progress" });
  });
  eq(names(loose((await p2.collect(false))[0])), ["Being done"], "TaskNotes' in-progress reads as open work");
});

test("the shelf lists every area's waiting, soonest to look at first", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    areaNote(app, "Work");
    taskNote(app, "Later", { area: "Sport", scheduled: DAY(9), status: "waiting" });
    taskNote(app, "Sooner", { area: "Sport", scheduled: `${DAY(2)}T18:00`, status: "waiting" });
    taskNote(app, "Same day earlier", { area: "Sport", scheduled: `${DAY(2)}T09:00`, status: "waiting" });
    taskNote(app, "Elsewhere", { area: "Work", scheduled: DAY(3), status: "waiting" });
    taskNote(app, "Back today", { area: "Work", scheduled: DAY(-1), status: "waiting" });
  });
  const shelf = plugin.waitingAll();
  eq(shelf.map((g) => g.name), ["Sport", "Work"], "by area");
  eq(names(shelf[0].tasks), ["Same day earlier", "Sooner", "Later"], "by the day and hour to look again");
  eq(names(shelf[1].tasks), ["Elsewhere"], "one whose day came is back among the rows, not on the shelf");
});

test("the moment it is due back, a running task returns to the focus", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    taskNote(app, "Ripe today", { area: "Sport", scheduled: TODAY, status: "waiting" });
    taskNote(app, "Overdue", { area: "Sport", scheduled: DAY(-1), status: "waiting" });
    taskNote(app, "Not yet", { area: "Sport", scheduled: DAY(5), status: "waiting" });
    taskNote(app, "No day at all", { area: "Sport", status: "waiting" });
  });
  const areas = await plugin.collect(false);
  eq(areaNames(areas), ["Sport"], "the area is on screen: its day came");
  eq(names(loose(areas[0])).sort(), ["Overdue", "Ripe today"], "today and overdue are back among the rows");
  eq(names(ahead(areas[0])), [], "nothing of it in the pile");
  eq(names(areas[0].waiting).sort(), ["No day at all", "Not yet"], "the rest waits on the shelf");
});

test("an area whose only work is running keeps its place", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Work");
    taskNote(app, "Sent off", { area: "Work", scheduled: DAY(5), status: "waiting" });
  });
  const areas = await plugin.collect(false);
  // nothing open today: the area is out of the focus; the task waits in «All» and comes back on its day
  eq(areaNames(areas), [], "an area with nothing to do today is not in the focus");
  const all = areaOf(await plugin.collect(true), "Work");
  eq(names(loose(all)), ["Sent off"], "«All» shows it");
  eq(all.running, 1);
});

test("an hour of the day decides when a running task comes back", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Work");
    taskNote(app, "Later today", { area: "Work", scheduled: `${TODAY}T23:59`, status: "waiting" });
    taskNote(app, "Earlier today", { area: "Work", scheduled: `${TODAY}T00:00`, status: "waiting" });
  });
  const tasks = plugin.tasks();
  const at = (name) => tasks.find((x) => x.text === name);
  eq(at("Later today").date, TODAY, "the day is read as a day");
  eq(at("Later today").at, "23:59", "and the hour is kept beside it");
  const area = (await plugin.collect(false))[0];
  eq(names(loose(area)), ["Earlier today"], "its hour has passed: back among the rows");
  eq(names(area.waiting), ["Later today"], "this one's hour is still ahead: it waits on the shelf");
});

test("a task typed under another stays under it, not at the bottom", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Aaa first", { area: "Work", scheduled: TODAY });
    taskNote(a, "Bbb second", { area: "Work", scheduled: TODAY });
    taskNote(a, "Ccc third", { area: "Work", scheduled: TODAY });
  });
  const second = plugin.tasks().find((x) => x.text === "Bbb second");
  // the text sorts last by name and by date it ties with the rest: only the seat can hold it
  await plugin.insertAfter(second, "Zzz typed here", TODAY);
  eq(names(loose((await plugin.collect(false))[0])),
    ["Aaa first", "Bbb second", "Zzz typed here", "Ccc third"]);
});

test("a row keeps its seat through a tick and an untick", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Aaa first", { area: "Work", scheduled: TODAY });
    taskNote(a, "Ccc third", { area: "Work", scheduled: TODAY });
  });
  const first = plugin.tasks().find((x) => x.text === "Aaa first");
  await plugin.insertAfter(first, "Zzz typed here", TODAY);
  const typed = () => plugin.tasks().find((x) => x.text === "Zzz typed here");
  await plugin.toggle(typed());
  await plugin.insertAfter(first, "Yyy another", TODAY);   // перестраивает порядок списка
  await plugin.toggle(typed());
  eq(names(loose((await plugin.collect(false))[0])),
    ["Aaa first", "Yyy another", "Zzz typed here", "Ccc third"], "the ticked row came back to its place");
});

test("a task typed under a project's step stays inside that project", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Launch");
    taskNote(a, "Aaa step", { area: "Work", project: "Launch", scheduled: TODAY });
    taskNote(a, "Ccc step", { area: "Work", project: "Launch", scheduled: TODAY });
  });
  const first = plugin.tasks().find((x) => x.text === "Aaa step");
  await plugin.insertAfter(first, "Zzz new step", TODAY);
  const area = (await plugin.collect(false))[0];
  eq(names(area.projects[0].tasks), ["Aaa step", "Zzz new step", "Ccc step"]);
});

test("a group clock edit preserves completion received from another device and undoes as one date change", async () => {
  const { app, plugin } = await stand(a => {
    areaNote(a, "Work");
    taskNote(a, "Waiting A", { area: "Work", status: "waiting", scheduled: DAY(1)+"T08:10" }, "Keep A");
    taskNote(a, "Waiting B", { area: "Work", status: "waiting", scheduled: DAY(1)+"T17:25" }, "Keep B");
  });
  const tasks=plugin.tasks();
  const originalBody=bodyOf(app,'Tasks/Waiting B.md');
  await app.fileManager.processFrontMatter(tasks.find(t=>t.text==='Waiting B').file, fm=>{fm.status='done';fm.completedDate=TODAY;fm.time_entries=[{id:'external-session',minutes:25}];});
  await plugin.setDates(tasks, DAY(2), "16:30");
  eq(frontmatter(app,'Tasks/Waiting A.md').scheduled,DAY(2)+'T16:30');
  eq(frontmatter(app,'Tasks/Waiting B.md').status,'done');
  eq(frontmatter(app,'Tasks/Waiting B.md').completedDate,TODAY);
  eq(frontmatter(app,'Tasks/Waiting B.md').time_entries,[{id:'external-session',minutes:25}]);
  eq(bodyOf(app,'Tasks/Waiting B.md'),originalBody);
  eq(plugin.history.length,1);
  await plugin.undo();
  eq(frontmatter(app,'Tasks/Waiting A.md').scheduled,DAY(1)+'T08:10');
  eq(frontmatter(app,'Tasks/Waiting B.md').scheduled,DAY(1)+'T17:25');
  eq(frontmatter(app,'Tasks/Waiting B.md').status,'done');
  await plugin.setDates(plugin.tasks(),DAY(3),null);
  eq(frontmatter(app,'Tasks/Waiting A.md').scheduled,DAY(3));
  eq(frontmatter(app,'Tasks/Waiting B.md').scheduled,DAY(3));
  eq(frontmatter(app,'Tasks/Waiting B.md').status,'done');
});

test("sending a task off names the day it comes back; taking it back puts it in today's focus", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Ask the accountant", { area: "Work", scheduled: TODAY });
    taskNote(a, "Something of mine", { area: "Work", scheduled: TODAY });   // держит область на экране
  });
  const task = () => plugin.tasks().find((x) => x.text === "Ask the accountant");
  await plugin.setWaiting(task(), true, DAY(4));
  eq(task().status, "waiting");
  eq(task().date, DAY(4), "the status and the day it comes back are written in one change");
  eq(names(loose((await plugin.collect(false))[0])), ["Something of mine"], "и до этого дня её в фокусе нет");
  await plugin.setWaiting(task(), false);
  eq(task().status, "open");
  eq(task().date, TODAY, "a return day still ahead would keep it out of the focus it was pulled into");
  eq(names(loose((await plugin.collect(false))[0])).includes("Ask the accountant"), true, "снова в фокусе");
  await plugin.undo();
  eq(task().status, "waiting", "⌘Z puts it back where it was");
  eq(task().date, DAY(4), "with the day it was waiting for");
});

test("nothing running left: the project has no block to draw", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Launch");
    taskNote(a, "Sent off", { area: "Work", project: "Launch", scheduled: DAY(4), status: "waiting" });
    taskNote(a, "Mine today", { area: "Work", project: "Launch", scheduled: TODAY });
  });
  let area = (await plugin.collect(false))[0];
  eq(names(area.projects[0].later), [], "the step is not among the project's upcoming ones");
  eq(names(area.projects[0].waiting), ["Sent off"], "it waits on the project's own shelf");
  await plugin.setWaiting(plugin.tasks().find((x) => x.text === "Sent off"), false);
  area = (await plugin.collect(false))[0];
  eq(names(area.projects[0].tasks).includes("Sent off"), true, "and the task is back among today's steps");
});

test("taken back on its own day, a running task keeps that day", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Ripe today", { area: "Work", scheduled: TODAY, status: "waiting" });
    taskNote(a, "Long overdue", { area: "Work", scheduled: DAY(-3), status: "waiting" });
  });
  const task = (name) => plugin.tasks().find((x) => x.text === name);
  await plugin.setWaiting([task("Ripe today"), task("Long overdue")], false);
  eq(task("Ripe today").date, TODAY, "its day is here: nothing to move");
  eq(task("Long overdue").date, DAY(-3), "and an overdue one stays overdue — the focus must still nag");
});

test("a running task with its day taken away comes home instead of being stranded", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Sent off", { area: "Work", scheduled: DAY(4), status: "waiting" });
    taskNote(a, "Mine today", { area: "Work", scheduled: TODAY });
  });
  const task = () => plugin.tasks().find((x) => x.text === "Sent off");
  await plugin.setDate(task(), null);
  eq(task().status, "open", "nothing would ever bring it back, so it is mine again");
  eq(task().date, null);
  const area = (await plugin.collect(false))[0];
  eq(names(ahead(area)), ["Sent off"], "an ordinary task with no date: the отложка of its area");
});

test("what is not today is the pile alone; a promise made to somebody is on the shelf, not above the plans", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Planned for Friday", { area: "Work", scheduled: DAY(4) });
    taskNote(a, "Someday, no date", { area: "Work" });
    taskNote(a, "Sent to the lawyer", { area: "Work", scheduled: DAY(6), status: "waiting" });
    taskNote(a, "Mine today", { area: "Work", scheduled: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  eq(names(ahead(area)), ["Planned for Friday", "Someday, no date"], "the pile: dated first, then undated");
  eq(names(area.waiting), ["Sent to the lawyer"], "the promise waits on the shelf");
});

test("a running step stays inside its project, not in the area", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Launch");
    taskNote(a, "Sent to the lawyer", { area: "Work", project: "Launch", scheduled: DAY(3), status: "waiting" });
    taskNote(a, "Waiting on a reply", { area: "Work", scheduled: DAY(3), status: "waiting" });
    taskNote(a, "Mine today", { area: "Work", scheduled: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  eq(names(area.projects[0].waiting), ["Sent to the lawyer"], "the project keeps its own, on its shelf");
  eq(names(area.projects[0].later), [], "not among its upcoming steps");
  eq(names(area.waiting.filter((x) => !x.project)), ["Waiting on a reply"], "the area keeps the loose one");
  eq(names(ahead(area)), [], "the pile has neither");
  eq(names(loose(area)), ["Mine today"], "the focus is untouched by either");
});

test("the build line says which build is running, in words", async () => {
  const line = globalThis.__ftBuildText;
  eq(line(null), null, "an ordinary install has nothing to say");
  eq(line({ mode: "stable", subject: "Влитое", at: "2026-09-23T19:40:00.000Z" }).includes("Влитое"), true);
  eq(line({ mode: "test", subject: "На ревью", at: "2026-09-23T19:40:00.000Z" }).includes("На ревью"), true);
  eq(line({ mode: "stable", commit: "aaaa111" }).includes("aaaa111"), true, "no subject: the commit will do");
});

test("the queue line counts commits in the language's own forms", async () => {
  const say = globalThis.__ftPlural;
  const forms = ["коммит", "коммита", "коммитов"];
  eq([1, 2, 5, 11, 21, 104].map((n) => say(n, forms)),
     ["коммит", "коммита", "коммитов", "коммитов", "коммит", "коммита"]);
});

test("what is folded stays on this device, out of the vault's data", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Mine", { area: "Work", scheduled: TODAY });
  });
  await plugin.toggleShown("area:Work", false);
  eq(plugin.isShown("area:Work", false), false, "the area is folded here");
  await plugin.saveAll();
  const saved = (await plugin.loadData()) || {};   // what travels with the vault
  eq(!!(saved.folded || saved.opened), false, "and the vault's own data knows nothing about it");
  eq(!!saved.order, true, "the dragged order still belongs to the vault");
  const device = JSON.parse(app.loadLocalStorage("focus-tasks-folds") || "{}");
  eq(!!device.folded["area:Work"], true, "the device does");
});

test("a status nobody knows still counts as open", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    taskNote(app, "Odd", { area: "Sport", scheduled: TODAY, status: "выдумка" });
  });
  eq(names(loose((await plugin.collect(false))[0])), ["Odd"]);
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
  eq(names(loose(area)), ["Open"]);
});

test("a project's last step checked off today does not keep its area in the focus alone", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    projectNote(app, "Sport", "Marathon");
    taskNote(app, "Laced", { area: "Sport", project: "Marathon", status: "done", scheduled: TODAY, completedDate: TODAY });
  });
  eq(areaNames(await plugin.collect(false)), [], "nothing open: the area is out of the focus");
  eq(names(areaOf(await plugin.collect(true), "Sport").done), ["Laced"], "the done step is still counted in its area");
});

test("a task ticked out of the отложка does not drag its area into the focus", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Health");
    areaNote(a, "Work");
    taskNote(a, "Кровь", { area: "Health" });                                        // отложка, still open
    taskNote(a, "Физио", { area: "Health", status: "done", completedDate: TODAY });   // ticked today, no date
    taskNote(a, "Mine today", { area: "Work", scheduled: TODAY });
  });
  const areas = await plugin.collect(false);
  // the focus is what I decided to do today; a bonus out of the отложка is not that
  eq(areaNames(areas), ["Work"], "Health has nothing due today, and the tick does not put it there");
  const all = await plugin.collect(true);
  eq(names(all.find((a) => a.name === "Health").done), ["Физио"], "«All» still shows what was ticked");
});

test("a completed task remembers which project it came from", async () => {
  const { plugin } = await stand((app) => {
    areaNote(app, "Sport");
    projectNote(app, "Sport", "Marathon");
    taskNote(app, "Laced", { area: "Sport", project: "Marathon", status: "done", scheduled: TODAY, completedDate: TODAY });
  });
  const area = areaOf(await plugin.collect(true), "Sport");
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
  eq(focusProjects(area).length, 0, "no project in the focus");
  eq(aheadProjects(area).map((p) => p.file.basename), ["Marathon"], "in upcoming");
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

test("the priority mark can be taken off, and put back", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Agent added this", { area: "Work", scheduled: TODAY, priority: "low" });
  });
  const task = () => plugin.tasks().find((x) => x.text === "Agent added this");
  eq(task().priority, "low", "the dot is there to start with");
  await plugin.setPriority(task(), null);
  eq(task().priority, null, "and it comes off");
  eq("priority" in frontmatter(app, task().file.path), false, "the key is gone from the note");
  await plugin.setPriority(task(), "high");
  eq(task().priority, "high", "a level can be set just as easily");
  await plugin.undo();
  eq(task().priority, null, "⌘Z takes the level back");
});

test("a project on screen keeps its own upcoming steps, out of the area's pile", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Launch");
    taskNote(a, "Today's step", { area: "Work", project: "Launch", scheduled: TODAY });
    taskNote(a, "Next month", { area: "Work", project: "Launch", scheduled: DAY(30) });
    taskNote(a, "Someday step", { area: "Work", project: "Launch" });
    taskNote(a, "Loose later", { area: "Work" });
  });
  const area = (await plugin.collect(false))[0];
  eq(names(area.projects[0].tasks), ["Today's step"], "the focus keeps only what is due");
  eq(names(area.projects[0].later).sort(), ["Next month", "Someday step"], "the rest hangs off the project");
  // the not-today pile is one list of rows: the project is there once more, with its first later step
  eq(aheadProjects(area).map((x) => x.file.basename), ["Launch"], "the project has a row in the area's upcoming pile too");
  eq(names(aheadProjects(area)[0].tasks), ["Next month", "Someday step"], "with its own later steps behind it");
  eq(names(ahead(area)), ["Loose later"], "beside the area's own tasks");
});

test("a project with nothing due and nothing done today still waits under «upcoming»", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Later on");
    taskNote(a, "Some day", { area: "Work", project: "Later on" });
    taskNote(a, "Due now", { area: "Work", scheduled: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  eq(focusProjects(area).length, 0, "nothing of it is due");
  eq(aheadProjects(area).map((x) => x.file.basename), ["Later on"]);
  eq(names(aheadProjects(area)[0].tasks), ["Some day"]);
});

test("what a project closed today belongs to the project, not to the area", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Launch");
    taskNote(a, "Step done", { area: "Work", project: "Launch", status: "done", completedDate: TODAY });
    taskNote(a, "Step left", { area: "Work", project: "Launch", scheduled: TODAY });
    taskNote(a, "Loose done", { area: "Work", status: "done", completedDate: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  eq(names(area.projects[0].done), ["Step done"], "the project counts its own");
  eq(names(doneLoose(area)), ["Loose done"], "the area's block holds only what has no project");
  eq(names(area.done).sort(), ["Loose done", "Step done"], "and the area still knows the whole day");
});

test("checkbox lines left from 0.1.0 are counted, so the list can say why it is empty", async () => {
  const { app, plugin } = await stand((a) => writeNote(a, "Areas/Sport.md", { area: "Sport", type: "area" },
    "## Inbox\n- [ ] Run 5k ⏳ 2026-09-22\n- [x] Stretch ✅ 2026-09-21\n- not a task"));
  eq(plugin.tasks().length, 0, "none of them is a task note");
  eq(await plugin.checkboxLeftovers(), 2, "but both checkbox lines are seen");
});

test("TaskNotes is only «aimed» when it looks for our tasks where they are", async () => {
  const { app, plugin } = await stand((a) => areaNote(a, "Sport"));
  const tn = { settings: { taskIdentificationMethod: "tag", taskTag: "task", taskPropertyName: "",
    taskPropertyValue: "", tasksFolder: "TaskNotes/Tasks" }, saved: 0,
    async saveSettings() { this.saved++; } };
  app.plugins.plugins["tasknotes"] = tn;
  ok(!plugin.companionAimed(tn), "its own defaults find nothing of ours");
  ok(await plugin.tuneCompanion(true), "we can point it at them");
  eq(tn.settings.taskIdentificationMethod, "property");
  eq(tn.settings.taskPropertyName, "type");
  eq(tn.settings.taskPropertyValue, "задача");
  eq(tn.settings.tasksFolder, plugin.tasksFolder);
  eq(tn.saved, 1, "and its own save is what writes it");
  ok(plugin.companionAimed(tn), "now it is aimed");
  tn.settings.tasksFolder = "Somewhere else";
  ok(!plugin.companionAimed(tn), "moving the folder takes it off our notes again");
});

test("a TaskNotes that renamed its settings is left alone, not half-written", async () => {
  const { app, plugin } = await stand((a) => areaNote(a, "Sport"));
  const tn = { settings: { identifyTasksBy: "tag" }, async saveSettings() { throw new Error("must not be called"); } };
  app.plugins.plugins["tasknotes"] = tn;
  ok(!(await plugin.tuneCompanion(true)), "we say we could not, instead of guessing");
  eq(JSON.stringify(tn.settings), JSON.stringify({ identifyTasksBy: "tag" }), "its settings are untouched");
});

test("a link in the text becomes the words it shows in the file name", async () => {
  const { app, plugin } = await stand((a) => areaNote(a, "Sport"));
  const text = "Прочитать [[Books/Дюна|Дюну]] и [[Zettelkasten/План обучения]]";
  await plugin.createTask(text, { area: "Sport", project: null }, TODAY);
  const task = plugin.tasks()[0];
  eq(task.text, text, "the links are kept in the text");
  eq(task.file.basename, "Прочитать Дюну и План обучения", "and the file name reads as a sentence");
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
  await plugin.moveTasks([task], { into: true, target: { type: "project", area: { name: "Sport" }, project: { file: plugin.notes().find(n => n.project).file } } });
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

test("several selected tasks are deleted together and come back together", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Run", { area: "Sport", scheduled: TODAY });
    taskNote(a, "Swim", { area: "Sport", scheduled: TODAY });
    taskNote(a, "Stretch", { area: "Sport", scheduled: TODAY });
  });
  const [run, swim] = plugin.tasks().filter((x) => x.text !== "Stretch");
  const uids = [run.uid, swim.uid];
  await plugin.removeTasks([run, swim]);
  eq(plugin.tasks().map((x) => x.text), ["Stretch"], "both gone, the third stays");
  eq(plugin.history.length, 1, "one step of history for the pair");
  await plugin.undo();
  eq(plugin.tasks().map((x) => x.uid).filter((u) => uids.includes(u)).length, 2, "both back with their uids");
  eq(await plugin.removeTasks([]), null, "nothing to delete is not a step");
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

test("a project note is made with its steps block at the bottom; a description goes above it", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Run a marathon", { area: "Sport", scheduled: TODAY }, "Нужен план на 16 недель.");
  });
  const file = await plugin.toProject(plugin.tasks()[0]);
  const body = bodyOf(app, file.path);
  ok(/```focus-tasks\n```\s*$/.test(body), "the block is the last thing in the note: " + JSON.stringify(body));
  ok(body.indexOf("Нужен план") < body.indexOf("```focus-tasks"), "the description stands above the block");
  eq((body.match(/```focus-tasks/g) || []).length, 1, "one block");
  // the block is put into a project note that has none — once
  const areas = await plugin.collect(true);
  const made = await plugin.createProject(areaOf(areas, "Sport"), "Plain project");
  ok(bodyOf(app, made.path).includes("```focus-tasks\n```"), "a new project note carries the block");
  eq(await plugin.ensureStepsBlock(made), false, "nothing to add twice");
  const old = await app.vault.create("Areas/Old project.md", "---\narea: Sport\ntype: project\n---\nСтарая заметка без блока\n");
  eq(await plugin.ensureStepsBlock(old), true, "an old note gets one");
  ok(/Старая заметка без блока\n\n```focus-tasks\n```\n$/.test(bodyOf(app, old.path)), "appended after the text: " + JSON.stringify(bodyOf(app, old.path)));
  eq(await plugin.ensureStepsBlock(old), false, "and only once");
});

test("a block in a project's note shows that project; `project:` in the block names one anywhere", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    projectNote(a, "Sport", "Marathon");
    taskNote(a, "Run", { area: "Sport", projects: ["[[Marathon]]"], scheduled: TODAY });
    taskNote(a, "Plan", { area: "Sport", projects: ["[[Marathon]]"] });
    taskNote(a, "Old", { area: "Sport", projects: ["[[Marathon]]"], status: "done", completedDate: "2026-01-01" });
  });
  const marathon = app.vault.getAbstractFileByPath("Areas/Marathon.md");
  eq(plugin.blockPage("", "Areas/Marathon.md")?.project, marathon, "no text, in the project's note: that project");
  eq(plugin.blockPage("", "Areas/Sport.md")?.area?.path, "Areas/Sport.md", "in the area's note: that area's page");
  eq(plugin.blockPage("project: [[Marathon]]", "Notes/Dashboard.md")?.project, marathon, "named by link");
  eq(plugin.blockPage("project: Marathon", "Notes/Dashboard.md")?.project, marathon, "named by name");
  // the page reads every pile of the project, in the focus or not
  const areas = await plugin.collect(false, true);
  const project = projectOf(areaOf(areas, "Sport"), "Marathon");
  eq(names(project.tasks), ["Run"], "today's step");
  eq(names(project.later), ["Plan"], "the undated one is in the pile");
  const closed = plugin.tasks().filter((x) => x.status === "done" && plugin.projectFile(x)?.path === marathon.path);
  eq(names(closed), ["Old"], "the closed step is found for the page");
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
  ok(bodyOf(app, "Areas/Sport.md").includes("```focus-tasks"), "the area has a local view");
  ok(projectOf(areaOf(await plugin.collect(true), "Sport"), "Big thing"), "the converted project is listed in that view");
  ok(!bodyOf(app, "Areas/Sport.md").includes("- 📁 [["), "there is no duplicate static project list");
});

test("a task without an area can be placed into one", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    writeNote(a, "Tasks/Foreign.md", { uid: "ft-f", type: "задача", status: "open", scheduled: TODAY });
  });
  eq(names(plugin.orphans()), ["Foreign"]);
  await plugin.setFields(plugin.orphans()[0], { area: "Sport" });
  eq(plugin.orphans().length, 0, "not an orphan any more");
  eq(names(loose((await plugin.collect(false))[0])), ["Foreign"]);
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
  eq(names(loose(areaOf(areas, "Sport"))), ["Fine"]);
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
  eq(names(loose(area)).sort(), ["One", "Two"], "both are on screen");
  await plugin.toggle(loose(area).find((t) => t.text === "One"));
  eq(frontmatter(app, "Tasks/One.md").status, "done");
  eq(frontmatter(app, "Tasks/Two.md").status, "open", "the twin is untouched");
});

test("an area whose note is missing still shows its tasks", async () => {
  const { plugin } = await stand((a) => {
    taskNote(a, "Orphan work", { area: "Ghost", scheduled: TODAY });
  });
  const areas = await plugin.collect(false);
  eq(areaNames(areas), ["Ghost"]);
  eq(names(loose(areas[0])), ["Orphan work"]);
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
  eq(names(ahead(area).concat(loose(area))), ["Ship it"], "it is in the upcoming work");
});

test("sending a task to someday clears its date and keeps it in the area", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Later thing", { area: "Work", scheduled: TODAY });
  });
  await plugin.setDate(plugin.tasks()[0], null);
  eq(frontmatter(app, "Tasks/Later thing.md").scheduled, undefined, "no date");
  eq(names(loose(areaOf(await plugin.collect(true), "Work"))), ["Later thing"], "«All» shows it in the area");
});

test("a task stuck for two weeks is still in the focus, dated in the past", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Stuck", { area: "Work", scheduled: DAY(-14) });
  });
  const area = (await plugin.collect(false))[0];
  eq(names(loose(area)), ["Stuck"]);
  ok(loose(area)[0].date < TODAY, "the view paints it red by this");
});

test("evening: everything checked off today is counted in its area, and gone tomorrow", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Launch");
    taskNote(a, "One", { area: "Work", status: "done", scheduled: TODAY, completedDate: TODAY });
    taskNote(a, "Two", { area: "Work", project: "Launch", status: "done", scheduled: TODAY, completedDate: TODAY });
    taskNote(a, "Three", { area: "Work", status: "done", scheduled: DAY(-1), completedDate: DAY(-1) });
  });
  const area = areaOf(await plugin.collect(true), "Work");
  eq(names(area.done), ["One", "Two"], "today's two, the project's step included");
  eq(area.done.map((x) => x.project || ""), ["", "Launch"], "each row knows where it came from");
});

test("a project finished today alone does not keep its area in the focus", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Launch");
    taskNote(a, "Last step", { area: "Work", project: "Launch", status: "done", scheduled: TODAY, completedDate: TODAY });
  });
  eq(areaNames(await plugin.collect(false)), [], "nothing open in the area: out of the focus");
});

test("a project whose steps are all done today keeps its place, marked done", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Launch");
    taskNote(a, "Last step", { area: "Work", project: "Launch", status: "done", scheduled: TODAY, completedDate: TODAY });
    taskNote(a, "Other work", { area: "Work", scheduled: TODAY });   // keeps the area in the focus
  });
  const areas = await plugin.collect(false);
  eq(areaNames(areas), ["Work"]);
  eq(areas[0].projects.map((x) => x.file.basename), ["Launch"], "the project is still on screen");
  ok(areas[0].projects[0].finished, "and it reads as finished");
  eq(names(areas[0].projects[0].done), ["Last step"], "it counts what was done in it");
  eq(aheadProjects(areas[0]).length, 0, "and it is not doubled in the upcoming block");
  eq(names(areas[0].done), ["Last step"]);
});

test("a project finished on an earlier day is gone from the focus", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Launch");
    taskNote(a, "Old step", { area: "Work", project: "Launch", status: "done", completedDate: DAY(-1) });
    taskNote(a, "Something else", { area: "Work", scheduled: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  eq(focusProjects(area).length, 0, "yesterday's win does not follow me into today");
  eq(aheadProjects(area).map((x) => x.file.basename), ["Launch"], "it waits under «upcoming», empty");
});

test("a project with a step left open is not finished, however much was done today", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Launch");
    taskNote(a, "Done step", { area: "Work", project: "Launch", status: "done", completedDate: TODAY });
    taskNote(a, "Open step", { area: "Work", project: "Launch", scheduled: TODAY });
  });
  const area = (await plugin.collect(false))[0];
  ok(!area.projects[0].finished, "there is still work in it");
  eq(names(area.projects[0].tasks), ["Open step"]);
});

test("a new task in a project finished today brings it back to life", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Launch");
    taskNote(a, "Last step", { area: "Work", project: "Launch", status: "done", scheduled: TODAY, completedDate: TODAY });
  });
  await plugin.createTask("Next step", { area: "Work", project: "Launch" }, TODAY);
  const area = (await plugin.collect(false))[0];
  ok(!area.projects[0].finished, "it is an ordinary project again");
  eq(names(area.projects[0].tasks), ["Next step"]);
});

// --- dates and statuses as people (and other plugins) write them -------------------------------

test("a date written with a time still counts as that day", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Timed", { area: "Work", scheduled: TODAY + "T10:00:00" });
    taskNote(a, "Timed done", { area: "Work", status: "done", completedDate: TODAY + "T18:30:00+03:00" });
  });
  const area = (await plugin.collect(false))[0];
  eq(names(loose(area)), ["Timed"], "in the focus, not in some far future");
  eq(names(area.done), ["Timed done"], "counted as done today");
});

test("a status in capitals is still a status", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Shouted", { area: "Work", scheduled: TODAY, status: "DONE", completedDate: TODAY });
  });
  const area = areaOf(await plugin.collect(true), "Work");
  eq(names(area.done), ["Shouted"]);
  eq(loose(area).length, 0, "not open at the same time");
  eq(plugin.closedToday().map((g) => names(g.tasks)), [["Shouted"]], "and it is among the day's closed work");
});

test("a nonsense date does not throw the task out of sight", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    taskNote(a, "Broken date", { area: "Work", scheduled: "не дата" });
  });
  const area = areaOf(await plugin.collect(true), "Work");
  eq(names(loose(area).concat(ahead(area))), ["Broken date"]);
});

test("a number or a date object in a field does not break the row", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "42");
    taskNote(a, "Numbered", { area: 42, scheduled: TODAY, title: 7 });
  });
  const area = (await plugin.collect(false))[0];
  eq(area.name, "42");
  eq(names(loose(area)), ["7"]);
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
  eq(names(loose((await plugin.collect(false))[0])), ["C", "A", "B"], "C went first");
  await plugin.rename(plugin.tasks().find((t) => t.text === "C"), "C renamed");
  eq(names(loose((await plugin.collect(false))[0])), ["C renamed", "A", "B"], "the order held through the rename");
});

test("duplicating tasks inserts each copy above its source and undoes the whole group", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    projectNote(a, "Sport", "Training");
    taskNote(a, "Loose", { area: "Sport", scheduled: TODAY + "T13:00", priority: "low" }, "Keep this description");
    taskNote(a, "First", { area: "Sport", project: "Training", scheduled: TODAY });
    taskNote(a, "Second", { area: "Sport", project: "Training", scheduled: TODAY });
  });
  const original = Object.fromEntries(plugin.tasks().map((x) => [x.text, x]));
  plugin.data.order.tasks["area:Sport"] = ["p:Areas/Training.md", original.Loose.uid];
  plugin.data.order.tasks["project:Training"] = [original.Second.uid, original.First.uid];
  const orderBefore = JSON.stringify(plugin.data.order);
  const [looseCopy, secondCopy, firstCopy] = await plugin.duplicateTasks([original.Loose, original.Second, original.First, original.Loose]);
  eq(plugin.data.order.tasks["area:Sport"], ["p:Areas/Training.md", looseCopy.uid, original.Loose.uid]);
  eq(plugin.data.order.tasks["project:Training"], [secondCopy.uid, original.Second.uid, firstCopy.uid, original.First.uid]);
  ok(looseCopy.uid !== original.Loose.uid && secondCopy.uid !== original.Second.uid, "copies have independent identities");
  const copied = frontmatter(app, looseCopy.file.path);
  eq(copied.scheduled, TODAY + "T13:00");
  eq(copied.priority, "low");
  ok(bodyOf(app, looseCopy.file.path).includes("Keep this description"), "description preserved");
  await plugin.undo();
  eq(plugin.tasks().length, 3, "all copies removed by one undo");
  eq(JSON.stringify(plugin.data.order), orderBefore, "original order restored");
});

test("a copied completed task is open and contains no completion or time-tracking history", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Finished", { area: "Sport", scheduled: TODAY, status: "done", completedDate: TODAY,
      timeEntries: ["record"], time_entries: ["record"], completeInstances: [TODAY], complete_instances: [TODAY],
      skippedInstances: [TODAY], skipped_instances: [TODAY] });
  });
  const original = plugin.tasks()[0];
  const before = bodyOf(app, original.file.path);
  const [copy] = await plugin.duplicateTasks([original]);
  const copied = frontmatter(app, copy.file.path);
  eq(copied.status, "open");
  for (const key of ["completedDate", "timeEntries", "time_entries", "completeInstances", "complete_instances", "skippedInstances", "skipped_instances"])
    ok(!(key in copied), "copy has no " + key);
  eq(bodyOf(app, original.file.path), before, "original unchanged");
  eq(plugin.data.order.tasks["area:Sport"], [copy.uid, original.uid]);
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

test("an old unchecked row never reopens a task another device already completed", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Run", { area: "Sport", scheduled: TODAY });
  });
  const stale = plugin.tasks()[0];            // read while the task was open
  await plugin.setFields(stale, { status: "done", completedDate: TODAY });  // another device finished it
  await plugin.toggle(stale);                  // the user taps the box they saw as empty
  eq(frontmatter(app, "Tasks/Run.md").status, "done", "checking an old row is an idempotent completion intent");
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
  eq(names(loose((await plugin.collect(false))[0])), ["Foreign", "Mine"], "dragged to the top");
  await plugin.setDate(plugin.tasks().find((x) => x.text === "Foreign"), TODAY);   // this writes the uid
  eq(names(loose((await plugin.collect(false))[0])), ["Foreign", "Mine"], "still at the top after it got its uid");
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

test("a project made from an area in the focus starts in the focus, empty; one made elsewhere does not", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Sport");
    areaNote(a, "Reading");
    taskNote(a, "Run 5k", { area: "Sport", scheduled: TODAY });
  });
  const sport = areaOf(await plugin.collect(false), "Sport");
  const made = await plugin.createProject(sport, "Marathon");
  ok(made, "the project note was made");
  let areas = await plugin.collect(false);
  eq(focusProjects(areaOf(areas, "Sport")).map((p) => p.file.basename), ["Marathon"], "the new project has its row in the focus");
  eq(aheadProjects(areaOf(areas, "Sport")).length, 0, "and not in the pile as well");
  // an area with nothing due is not in the focus: a project made there stays out of it
  const reading = areaOf(await plugin.collect(true), "Reading");
  await plugin.createProject(reading, "Big books");
  areas = await plugin.collect(false);
  eq(areaOf(areas, "Reading"), undefined, "Reading did not come into the focus for it");
  // a task with no day turned into a project keeps the task's place: not in the focus
  await plugin.createTask("Someday thing", { area: "Sport", project: null }, null);
  await plugin.toProject(plugin.tasks().find((x) => x.text === "Someday thing"));
  areas = await plugin.collect(false);
  eq(focusProjects(areaOf(areas, "Sport")).map((p) => p.file.basename), ["Marathon"], "the project made of an undated task is not pulled into the focus");
});

test("a project renamed takes along the step that carries its name", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Run a marathon", { area: "Sport", scheduled: TODAY }, "Нужен план.");
  });
  const file = await plugin.toProject(plugin.tasks()[0]);
  ok(file, "the project note was made");
  // the step's link resolves to the step itself as far as Obsidian is concerned (same name, and the
  // task folder is where the link is written from) — a rename must re-point it by hand
  await plugin.renameProject(file, "Marathon 2027");
  eq(frontmatter(app, "Tasks/Run a marathon.md").projects, ["[[Marathon 2027]]"], "the step's link follows the project");
  eq(names(projectOf(areaOf(await plugin.collect(false), "Sport"), "Marathon 2027").tasks), ["Run a marathon"], "and the step is still in it");
});

test("a link that names the step's own path still finds the project", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Sport");
    projectNote(a, "Sport", "Plan the season");
    // what Obsidian leaves behind after a same-named step was renamed: a link to the step itself
    taskNote(a, "Plan the season", { area: "Sport", scheduled: TODAY, projects: ["[[Tasks/Plan the season]]"] });
  });
  eq(names(projectOf(areaOf(await plugin.collect(false), "Sport"), "Plan the season").tasks), ["Plan the season"], "the step is read as the project's");
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

test("two changes at once are two records: undoing the first does not take the second's note", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Run", { area: "Sport", scheduled: TODAY });
    taskNote(a, "Swim", { area: "Sport", scheduled: TODAY });
  });
  const [run, swim] = plugin.tasks();
  // a group date is still writing when a new task is typed in: the two must not merge into one record
  const dates = plugin.setDates([run, swim], DAY(1));
  const made = plugin.createTask("Newborn", { area: "Sport", project: null }, null);
  await Promise.all([dates, made]);
  eq(plugin.history.length, 2, "two records: " + JSON.stringify(plugin.history.map((h) => h.label)));
  ok(!plugin.history[0].snap.some((x) => /Newborn/.test(x.path)), "the new note is not in the date change's record");
  await plugin.undo();   // the newest: the creation
  eq(plugin.tasks().some((x) => x.text === "Newborn"), false, "undoing the creation removes the note");
  await plugin.undo();   // the date change
  eq(plugin.tasks().find((x) => x.text === "Run").date, TODAY, "and the dates are back");
});

test("a change that runs inside another joins its record, with the files it touches", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Run", { area: "Sport", scheduled: TODAY });
    taskNote(a, "Swim", { area: "Sport", scheduled: TODAY });
  });
  const [run, swim] = plugin.tasks();
  await plugin.setDates([run, swim], DAY(1));
  eq(plugin.history.length, 1, "one record for the group");
  eq(plugin.history[0].snap.map((x) => x.path).sort(), ["Tasks/Run.md", "Tasks/Swim.md"], "both notes in it");
  await plugin.undo();
  eq(plugin.tasks().map((x) => x.date), [TODAY, TODAY], "both back");
});

test("a delete that fails halfway keeps a record of what it did delete, and undo puts that back", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Run", { area: "Sport", scheduled: TODAY });
    taskNote(a, "Swim", { area: "Sport", scheduled: TODAY });
  });
  const [run, swim] = plugin.tasks();
  const orig = app.vault.trash.bind(app.vault);
  let n = 0;
  app.vault.trash = async (file) => { if (++n === 2) throw new Error("boom"); return orig(file); };
  await plugin.removeTasks([run, swim]);
  app.vault.trash = orig;
  eq(plugin.tasks().map((x) => x.text), ["Swim"], "the first went, the second stayed");
  eq(plugin.history.length, 1, "the partial delete has its record");
  await plugin.undo();
  eq(plugin.tasks().map((x) => x.text).sort(), ["Run", "Swim"], "undo brings the deleted one back");
  // the same task twice (a row on screen twice) is one note
  const [a1] = plugin.tasks();
  await plugin.removeTasks([a1, a1]);
  eq(plugin.tasks().length, 1, "deleted once");
  eq(plugin.history[plugin.history.length - 1].label, "Deleted: " + a1.text, "and recorded as one delete");
});

test("a drag that only changes the order is a change: ⌘Z puts the order back", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Run", { area: "Sport", scheduled: TODAY });
    taskNote(a, "Swim", { area: "Sport", scheduled: TODAY });
  });
  await plugin.setDate(plugin.tasks()[0], DAY(1));
  const was = plugin.orderState();
  const [run, swim] = plugin.tasks();
  await plugin.drop({ type: "task", task: swim }, { into: false, after: false, target: { type: "task", task: run } }, { tasks: {} });
  ok(plugin.orderState() !== was, "the order changed");
  eq(plugin.history.length, 2, "the drag has a record of its own");
  await plugin.undo();
  eq(plugin.orderState(), was, "⌘Z put the order back");
  eq(plugin.tasks().find((x) => x.text === "Run").date, DAY(1), "and did not touch the date before it");
});

test("a step made from a page goes to that very project, not the first of that name", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Plan");
  });
  const second = await app.vault.create("Areas/b/Plan.md", "---\narea: Work\ntype: project\n---\n");
  const task = await plugin.createTask("Step", { area: "Work", project: "Plan", projectFile: second }, null);
  eq(plugin.projectFile(plugin.tasks().find((x) => x.uid === task.uid))?.path, "Areas/b/Plan.md", "the step points at the second Plan");
  const byName = await plugin.createTask("Other", { area: "Work", project: "Plan" }, null);
  eq(plugin.projectFile(plugin.tasks().find((x) => x.uid === byName.uid))?.path, "Areas/Plan.md", "a name alone is the first one, as before");
});

test("a note two projects share gets a block for each; a block naming a missing project says so", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Alpha");
    projectNote(a, "Work", "Beta");
  });
  const shared = await app.vault.create("Notes/Shared.md", "---\n---\nОбщий план\n\n```focus-tasks\n```\n");
  const alpha = app.vault.getAbstractFileByPath("Areas/Alpha.md"), beta = app.vault.getAbstractFileByPath("Areas/Beta.md");
  eq(await plugin.ensureStepsBlock(shared, alpha), true, "a bare block is not Alpha's: one naming it is added");
  eq(await plugin.ensureStepsBlock(shared, beta), true, "and one for Beta");
  eq(await plugin.ensureStepsBlock(shared, alpha), false, "Alpha's is there already");
  const text = bodyOf(app, "Notes/Shared.md");
  ok(/project: \[\[Alpha\]\]/.test(text) && /project: \[\[Beta\]\]/.test(text), "both named: " + JSON.stringify(text));
  const missing = plugin.blockPage("project: [[Nope]]", "Notes/Shared.md");
  eq(missing.project, null, "not found");
  eq(missing.missing, "Nope", "and named, so the block can say so instead of showing everything");
});

test("a project with a day of its own goes by that day, its steps keep theirs", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Launch", { scheduled: DAY(3) });
    taskNote(a, "Step today", { area: "Work", project: "Launch", scheduled: TODAY });
    taskNote(a, "Step later", { area: "Work", project: "Launch" });
    taskNote(a, "Keeps the area", { area: "Work", scheduled: TODAY });
  });
  const launchRow = (a) => a.rows.find((r) => r.kind === "project" && r.project.file.basename === "Launch");
  let area = areaOf(await plugin.collect(false), "Work");
  eq(focusProjects(area).map((b) => b.file.basename), [], "a project dated ahead is not in the focus, whatever its steps say");
  const ahead = aheadProjects(area).find((r) => r.file.basename === "Launch");
  eq(names(ahead.tasks).sort(), ["Step later", "Step today"], "it waits in the pile with all of its steps");
  eq(plugin.tasks().find((x) => x.text === "Step today").date, TODAY, "the step's own day is untouched");
  // its day comes: in the focus, with its steps
  await plugin.setProjectDate(app.vault.getAbstractFileByPath("Areas/Launch.md"), TODAY);
  area = areaOf(await plugin.collect(false), "Work");
  eq(focusProjects(area).map((b) => b.file.basename), ["Launch"], "due, it is in the focus");
  eq(names(launchRow(area).steps), ["Step today"], "showing today's steps");
  // dated today with nothing due today: still in the focus, with what it has
  await plugin.setDate(plugin.tasks().find((x) => x.text === "Step today"), null);
  area = areaOf(await plugin.collect(false), "Work");
  eq(names(launchRow(area).steps).sort(), ["Step later", "Step today"], "a due project with no due step shows its pile");
  eq(aheadProjects(area).some((r) => r.file.basename === "Launch"), false, "and is not doubled in the pile");
  // the day off: back to the steps' rule
  await plugin.setProjectDate(app.vault.getAbstractFileByPath("Areas/Launch.md"), null);
  eq("scheduled" in frontmatter(app, "Areas/Launch.md"), false, "the key is gone from the note");
  area = areaOf(await plugin.collect(false), "Work");
  eq(focusProjects(area).length, 0, "no due step, no day of its own: out of the focus");
  await plugin.undo();
  eq(frontmatter(app, "Areas/Launch.md").scheduled, TODAY, "⌘Z puts the day back");
});

test("a drop into the pile takes today's day off; a drop among today's rows gives today", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Sport");
    taskNote(a, "Today", { area: "Sport", scheduled: TODAY });
    taskNote(a, "Mate", { area: "Sport", scheduled: TODAY });
    taskNote(a, "Someday", { area: "Sport" });
    taskNote(a, "Friday", { area: "Sport", scheduled: DAY(4) });
  });
  const t = (n) => plugin.tasks().find((x) => x.text === n);
  await plugin.moveTasks([t("Today")], { into: false, after: true, target: { type: "task", task: t("Someday") }, pile: "ahead" });
  eq(t("Today").date, null, "into the pile: no day");
  await plugin.moveTasks([t("Someday")], { into: false, after: true, target: { type: "task", task: t("Mate") }, pile: "focus" });
  eq(t("Someday").date, TODAY, "among today's rows: today");
  await plugin.moveTasks([t("Friday")], { into: false, after: true, target: { type: "task", task: t("Today") }, pile: "ahead" });
  eq(t("Friday").date, DAY(4), "a day ahead moved within the pile is kept");
  await plugin.moveTasks([t("Mate")], { into: false, after: false, target: { type: "task", task: t("Someday") }, pile: "focus" });
  eq(t("Mate").date, TODAY, "within today's list nothing changes");
});

test("an empty project sinks to the bottom of its list; the hand-set order holds above it", async () => {
  const { plugin } = await stand((a) => {
    areaNote(a, "Work");
    projectNote(a, "Work", "Aaa empty");
    projectNote(a, "Work", "Zzz busy");
    taskNote(a, "Loose", { area: "Work" });
    taskNote(a, "Step", { area: "Work", project: "Zzz busy" });
  });
  const area = areaOf(await plugin.collect(true), "Work");
  const order = area.rows.map((r) => (r.kind === "task" ? r.task.text : r.project.file.basename));
  eq(order, ["Loose", "Zzz busy", "Aaa empty"], "the empty project is last, though it sorts first by name");
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
      for (const t of [...loose(area), ...ahead(area), ...area.done]) shown.add(t.file.path);
      for (const pr of [...area.projects, ...aheadProjects(area)])
        for (const t of [...pr.tasks, ...(pr.later || [])]) shown.add(t.file.path);
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
      const rows = [...loose(area), ...area.projects.flatMap((p) => p.tasks)];
      const wrong = rows.filter((t) => !(t.date && t.date <= TODAY)).map((t) => `${t.text}: ${t.date}`);
      eq(wrong, [], `seed ${seed}: not due yet but in the focus`);
    }
  }
});

test("fuzz: reading the same vault twice gives the same answer", async () => {
  for (let seed = 200; seed <= 210; seed++) {
    const { plugin } = await stand((app) => junkVault(app, seed));
    const once = JSON.stringify((await plugin.collect(false)).map((a) => [a.name, names(loose(a)), a.projects.map((p) => names(p.tasks))]));
    const twice = JSON.stringify((await plugin.collect(false)).map((a) => [a.name, names(loose(a)), a.projects.map((p) => names(p.tasks))]));
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
  eq(names((await plugin.collect(false)).flatMap((x) => [...loose(x), ...x.projects.flatMap((p) => p.tasks)])).sort(),
     ["Written".replace("Written", "Написать письмо"), "Первый шаг запуска", "Собрать вещи"].sort(), "all three are in the focus");
  // one is finished, one goes to tomorrow, one to the someday list
  await plugin.toggle(pick("Написать письмо"));
  await plugin.setDate(pick("Собрать вещи"), DAY(1));
  await plugin.setDate(pick("Первый шаг запуска"), null);
  let areas = await plugin.collect(false);
  eq(plugin.closedToday().map((g) => [g.name, names(g.tasks)]), [["Work", ["Написать письмо"]]], "what was finished is in the day's closed block");
  eq(areaNames(areas), [], "nothing is due anywhere now: the focus is empty");
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
  eq(names(loose(areaOf(areas, "Home"))), ["Собрать вещи"], "and Home has the task that was moved");
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
    for (const t of [...loose(area), ...ahead(area)]) shown.add(t.file.path);
    for (const pr of [...area.projects, ...aheadProjects(area)]) for (const t of pr.tasks) shown.add(t.file.path);
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

test("creating a project uses the area's view without a duplicate Projects section", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    const note = a.vault.files.get("Areas/Work.md");
    a.vault.files.set("Areas/Work.md", note + "\nMy area notes\n");
  });
  const before = bodyOf(app, "Areas/Work.md");
  const area = areaOf(await plugin.collect(true), "Work");
  await plugin.createProject(area, "First project");
  const after = bodyOf(app, area.note.path);
  ok(after.startsWith(before.trimEnd()), "the area's own text is kept");
  eq((after.match(/```focus-tasks/g) || []).length, 1, "one local view");
  ok(!/^#+ Projects\s*$/m.test(after) && !after.includes("- 📁 [["), "no static duplicate project list");
  await plugin.createProject(area, "Second project");
  eq(bodyOf(app, area.note.path), after, "another project leaves the area note alone");
  await plugin.undo();
  await plugin.undo();
  eq(bodyOf(app, area.note.path), before, "Undo restores the original area text");
});

test("moving a project uses the destination view without recreating a Projects heading", async () => {
  const { app, plugin } = await stand((a) => {
    areaNote(a, "Work");
    areaNote(a, "Home");
    projectNote(a, "Work", "Plan");
    taskNote(a, "Step", { area: "Work", project: "Plan", scheduled: TODAY });
  });
  const areas = await plugin.collect(true);
  const from = areaOf(areas, "Work"), to = areaOf(areas, "Home");
  await plugin.moveProject(projectOf(from, "Plan"), from, to);
  const body = bodyOf(app, to.note.path);
  eq((body.match(/```focus-tasks/g) || []).length, 1, "the destination has a local view");
  ok(!/^#+ Projects\s*$/m.test(body) && !body.includes("- 📁 [["), "no recreated section or static project list");
  eq(frontmatter(app, "Tasks/Step.md").area, "Home", "the step follows its project");
  ok(projectOf(areaOf(await plugin.collect(true), "Home"), "Plan"), "the view includes the moved project");
});

test("calendar confirmation belongs to the current task, clock and state, not an earlier event", async () => {
  const { plugin } = await stand(a => { areaNote(a, "Work"); taskNote(a, "Call", { area: "Work", scheduled: TODAY + "T00:00" }); });
  const task = plugin.tasks()[0];
  const state = { enabled: true, connected: true, contract: "focus-view-at-start-v1", tasks: { [task.uid]: {
    file: task.file.path, title: task.text, scheduled: TODAY + "T00:00", waiting: false, status: "synced", checkedAt: new Date().toISOString(),
  } } };
  eq(plugin.calendarStatus(task, state), "synced", "explicit midnight is a timed event");
  for (const patch of [{ file: "Tasks/Other.md" }, { title: "Other" }, { scheduled: TODAY + "T01:00" },
    { waiting: true }, { status: "pending" }, { checkedAt: "broken" }]) {
    const stale = { ...state, tasks: { [task.uid]: { ...state.tasks[task.uid], ...patch } } };
    eq(plugin.calendarStatus(task, stale), "pending", "stale or unverified acknowledgement is never green");
  }
  eq(plugin.calendarStatus(task, { ...state, contract: "old-default-alert" }), "pending");
  eq(plugin.calendarStatus(task, { ...state, connected: false }), "error");
  eq(plugin.calendarStatus(task, { ...state, tasks: { [task.uid]: { ...state.tasks[task.uid], error: "ConnectionError" } } }), "error");
  eq(plugin.calendarStatus(task, null), "off");
  for (const status of ["done", "cancelled", "someday"]) eq(plugin.calendarStatus({ ...task, status }, state), null);
  eq(plugin.calendarStatus({ ...task, at: null }, state), null, "date-only has no reminder badge");
  eq(plugin.calendarStatus({ ...task, uid: "copied-uid" }, state), "pending", "a duplicate gets no borrowed acknowledgement");
  const waiting = { ...task, status: "waiting" };
  state.tasks[task.uid].waiting = true;
  eq(plugin.calendarStatus(waiting, state), "synced");
});

test("Calendar settings accept phone receipts without a heartbeat and show actual connection errors", async () => {
  const { plugin } = await stand();
  const state = { enabled: true, connected: true, contract: "focus-view-at-start-v1", tasks: {} };
  eq(plugin.calendarHasProblem(state), false, "unchanged phone receipt is healthy without updatedAt");
  eq(plugin.calendarHasProblem({ ...state, updatedAt: "broken" }), false);
  eq(plugin.calendarHasProblem({ ...state, connected: false }), true);
  eq(plugin.calendarHasProblem({ ...state, errors: ["ConnectionError"] }), true);
  eq(plugin.calendarHasProblem({ ...state, tasks: { one: { status: "pending", error: "ConnectionError" } } }), true);
  eq(plugin.calendarHasProblem({ ...state, contract: "old" }), true);
  eq(plugin.calendarHasProblem(null), false);
});

test("group clock changes invalidate every old calendar receipt until the new clock is confirmed", async () => {
  const { plugin } = await stand(a => {
    areaNote(a, "Work");
    taskNote(a, "A", { area: "Work", scheduled: DAY(1) + "T08:10" });
    taskNote(a, "B", { area: "Work", scheduled: DAY(1) + "T17:25" });
  });
  const tasks = plugin.tasks();
  const state = { enabled: true, connected: true, contract: "focus-view-at-start-v1", tasks: Object.fromEntries(tasks.map(task => [task.uid, {
    file: task.file.path, title: task.text, scheduled: `${task.date}T${task.at}`, waiting: false, status: "synced", checkedAt: new Date().toISOString(),
  }])) };
  for (const task of tasks) eq(plugin.calendarStatus(task, state), "synced");
  await plugin.setDates(tasks, DAY(2), "16:30");
  for (const task of plugin.tasks()) eq(plugin.calendarStatus(task, state), "pending");
  for (const receipt of Object.values(state.tasks)) receipt.scheduled = DAY(2) + "T16:30";
  for (const task of plugin.tasks()) eq(plugin.calendarStatus(task, state), "synced");
  await plugin.setDates(plugin.tasks(), DAY(2), null);
  for (const task of plugin.tasks()) eq(plugin.calendarStatus(task, state), null);
});

test("grouping a project and task never writes a notification clock into the project", async () => {
  const { app, plugin } = await stand(a => { areaNote(a, "Work"); projectNote(a, "Work", "Plan");taskNote(a, "Call", { area: "Work", scheduled: DAY(1) + "T08:10" }); });
  const area = areaOf(await plugin.collect(true), "Work"), project = projectOf(area, "Plan");
  const handle = { file: project.file, uid: "p:" + project.file.path, isProject: true, project, date: null, at: null, status: "open" };
  await plugin.setDates([handle, plugin.tasks()[0]], DAY(2), "16:30");
  eq(frontmatter(app, project.file.path).scheduled, DAY(2));
  eq(frontmatter(app, "Tasks/Call.md").scheduled, DAY(2) + "T16:30");
  await plugin.undo();
  eq(frontmatter(app, project.file.path).scheduled, undefined);
  eq(frontmatter(app, "Tasks/Call.md").scheduled, DAY(1) + "T08:10");
});

test("calendar receipts use Markdown on phones and refuse a malformed receipt instead of trusting stale JSON", async () => {
  const { app, plugin } = await stand(a => areaNote(a, "Work"));
  const files = new Map(), md = "Internals/FocusTasks/calendar-status.md", json = "Internals/FocusTasks/calendar-status.json";
  app.vault.adapter = { exists: async path => files.has(path), read: async path => files.get(path) };
  files.set(json, JSON.stringify({ enabled: true, contract: "legacy" }));
  eq((await plugin.calendarState()).contract, "legacy");
  files.set(md, '---\ntype: focus-tasks-calendar-status\n---\n\n```json\n{"enabled":true,"contract":"focus-view-at-start-v1"}\n```\n');
  eq((await plugin.calendarState()).contract, "focus-view-at-start-v1");
  files.set(md, "half synced receipt");
  eq(await plugin.calendarState(), null);
  files.set(md, "```json\n{invalid}\n```\n");
  eq(await plugin.calendarState(), null);
});

test("the Calendar protocol opens the Focus view without opening a task note", async () => {
  const { plugin } = await stand(a => areaNote(a, "Work"));
  let calls = 0;
  plugin.openView = async () => { calls++; };
  plugin.protocolHandlers["focus-tasks"]({ vault: "Test Vault", file: "Tasks/Ignore.md" });
  await Promise.resolve();
  eq(calls, 1);
});

test("a UID link selects the task after a rename and project move", async () => {
  const { app, plugin } = await stand(a => { areaNote(a,"Work");areaNote(a,"Home");projectNote(a,"Next","Home");taskNote(a,"Call",{area:"Work",scheduled:TODAY}); });
  const original=plugin.tasks()[0],uid=original.uid;
  await plugin.rename(original,"Changed title");await plugin.setFields(plugin.tasks().find(t=>t.uid===uid),{area:"Home",projects:["[[Next]]"]});
  let selected=null;plugin.openView=async()=>({view:{renderer:{reveal:async(item,openNote)=>{selected={item,openNote};return true;}}}});
  eq(await plugin.protocolHandlers["focus-tasks"]({uid,vault:"Test Vault",file:"Tasks/Stale name.md"}),true);
  eq(selected,{item:{kind:"task",uid},openNote:false});eq(plugin.tasks().find(t=>t.uid===uid).text,"Changed title");eq(plugin.tasks().find(t=>t.uid===uid).area,"Home");
});

test("a missing, duplicate or inactive UID never selects an arbitrary task", async () => {
  const { app, plugin } = await stand(a=>{areaNote(a,"Work");taskNote(a,"A",{area:"Work"});});
  let calls=0;plugin.openView=async()=>({view:{renderer:{reveal:async()=>{calls++;return true;}}}});
  eq(await plugin.openTask("missing"),false);eq(calls,0);eq(app.notices.length,1);
  const task=plugin.tasks()[0];
  for(const status of ["done","cancelled","someday"]){await plugin.setFields(task,{status});eq(await plugin.openTask(task.uid),false);}
  await plugin.setFields(task,{status:"open"});taskNote(app,"Copy",{uid:task.uid,area:"Work"});plugin.forgetScan();
  eq(await plugin.openTask(task.uid),false);eq(calls,0);
});

test("a task link preserves an unfinished edit and held drag", async () => {
  const { app,plugin }=await stand(a=>{areaNote(a,"Work");taskNote(a,"Call",{area:"Work"});});
  const task=plugin.tasks()[0],before=[...app.vault.files];let calls=0;
  for(const state of [{editing:true},{held:{}}]){plugin.openView=async()=>({view:{renderer:{...state,reveal:async()=>{calls++;}}}});eq(await plugin.openTask(task.uid),false);}
  eq(calls,0);eq([...app.vault.files],before,"no draft or task is rewritten by the link");
});

test("UID navigation waits for layout and serializes consecutive incoming links", async () => {
  const { app,plugin }=await stand(a=>{areaNote(a,"Work");taskNote(a,"A",{area:"Work"});taskNote(a,"B",{area:"Work"});});
  app.workspace.onLayoutReady=callback=>queueMicrotask(callback);
  const tasks=plugin.tasks(),events=[];let release;
  plugin.openView=async()=>({view:{renderer:{reveal:async item=>{events.push(item.uid);if(item.uid===tasks[0].uid)await new Promise(r=>release=r);return true;}}}});
  const first=plugin.openTask(tasks[0].uid),second=plugin.openTask(tasks[1].uid);
  while(!release)await new Promise(r=>setTimeout(r,0));eq(events,[tasks[0].uid]);release();
  await Promise.all([first,second]);eq(events,tasks.map(t=>t.uid));
});

test("a UID link checks embedded edits before activating the Focus leaf", async () => {
  const { plugin }=await stand(a=>{areaNote(a,"Work");taskNote(a,"A",{area:"Work"});});
  let activated=0;plugin.openView=async()=>{activated++;throw Error("must not blur editor");};
  for(const state of [{editing:true},{held:{}}]){plugin.views.add(state);eq(await plugin.openTask(plugin.tasks()[0].uid),false);plugin.views.delete(state);}
  eq(activated,0,"neither an edit nor a drag is interrupted by changing leaves");
});

test("a UID link waits for a saved Waiting status to reach the metadata index", async () => {
  const { app,plugin }=await stand(a=>{areaNote(a,"Work");taskNote(a,"A",{area:"Work",scheduled:TODAY});});
  const task=plugin.tasks()[0],old=structuredClone(app.metadataCache.getFileCache(task.file));
  await plugin.setWaiting(task,true,"2099-01-02","20:30");
  const read=app.metadataCache.getFileCache.bind(app.metadataCache);let stale=4,selected=null;
  app.metadataCache.getFileCache=file=>file.path===task.file.path&&stale-->0 ? old : read(file);
  plugin.openView=async()=>({view:{renderer:{reveal:async()=>{selected=plugin.tasks().find(t=>t.uid===task.uid).status;return true;}}}});
  eq(await plugin.openTask(task.uid),true);eq(selected,"waiting","navigation uses the saved status, not stale metadata");
});

test("a UID link survives a temporarily missing metadata entry during reindexing", async () => {
  const { app,plugin }=await stand(a=>{areaNote(a,"Work");taskNote(a,"A",{area:"Work"});});
  const task=plugin.tasks()[0],read=app.metadataCache.getFileCache.bind(app.metadataCache);let missing=4,selected=null;
  app.metadataCache.getFileCache=file=>file.path===task.file.path&&missing-->0 ? null : read(file);
  plugin.openView=async()=>({view:{renderer:{reveal:async item=>{selected=item.uid;return true;}}}});
  eq(await plugin.openTask(task.uid),true);eq(selected,task.uid);eq(app.notices.length,0);
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
