import { useMemo, useState } from "react";
import { type HostSnapshot, STATUS_LABELS, type Task, type TaskStatus } from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { Icon } from "./Icons";
import { EmptyState, Segmented, TaskRow } from "./bits";

interface TaskListViewProps {
  snapshot: HostSnapshot;
  client: ClientHandle;
  filter: TaskStatus | "all";
  selectedTaskId?: string;
  onFilter(status: TaskStatus | "all"): void;
  onOpenTask(taskId: string): void;
}

const ORDER: Record<TaskStatus, number> = { doing: 0, todo: 1, inbox: 2, done: 3 };

export function TaskListView({ snapshot, client, filter, selectedTaskId, onFilter, onOpenTask }: TaskListViewProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const counts = useMemo(() => {
    const result: Record<TaskStatus, number> = { inbox: 0, todo: 0, doing: 0, done: 0 };
    for (const task of snapshot.tasks) {
      result[task.status] += 1;
    }
    return result;
  }, [snapshot.tasks]);

  const tasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return snapshot.tasks
      .filter((task) => (filter === "all" ? task.status !== "done" || needle : task.status === filter))
      .filter((task) => !needle || `${task.title}\n${task.details}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        if (filter === "all" && ORDER[a.status] !== ORDER[b.status]) {
          return ORDER[a.status] - ORDER[b.status];
        }
        if (a.priority !== b.priority) {
          return a.priority === "high" ? -1 : 1;
        }
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      });
  }, [snapshot.tasks, filter, query]);

  const grouped = useMemo(() => {
    if (filter !== "all") {
      return [{ status: filter, tasks }];
    }
    const groups: { status: TaskStatus; tasks: Task[] }[] = [];
    for (const task of tasks) {
      const group = groups.find((item) => item.status === task.status);
      if (group) {
        group.tasks.push(task);
      } else {
        groups.push({ status: task.status, tasks: [task] });
      }
    }
    return groups;
  }, [tasks, filter]);

  const createTask = async () => {
    const title = newTitle.trim();
    if (!title) {
      return;
    }
    const task = await client.createTask({ title, status: filter === "all" || filter === "inbox" ? "todo" : filter });
    setNewTitle("");
    setCreating(false);
    onOpenTask(task.id);
  };

  return (
    <section className="screen tasks">
      <div className="tasks__toolbar">
        <Segmented
          value={filter}
          onChange={onFilter}
          options={[
            { value: "all", label: "全部" },
            { value: "todo", label: "待办", count: counts.todo },
            { value: "doing", label: "进行中", count: counts.doing },
            { value: "done", label: "已完成" },
          ]}
        />
        <div className="tasks__tools">
          <label className="search">
            <Icon name="search" size={14} />
            <input value={query} placeholder="搜索" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button type="button" className="primary primary--icon" onClick={() => setCreating(true)} title="新建任务">
            <Icon name="plus" size={16} />
            <span>新建</span>
          </button>
        </div>
      </div>
      {creating ? (
        <form
          className="quick-create"
          onSubmit={(event) => {
            event.preventDefault();
            void createTask();
          }}
        >
          <input autoFocus value={newTitle} placeholder="任务标题" onChange={(event) => setNewTitle(event.target.value)} />
          <button type="submit" className="primary" disabled={!newTitle.trim()}>
            添加
          </button>
          <button type="button" className="ghost" onClick={() => setCreating(false)}>
            取消
          </button>
        </form>
      ) : null}
      <div className="screen__scroll">
        {tasks.length === 0 ? (
          <EmptyState
            title={query ? "没有匹配的任务" : filter === "done" ? "还没有完成的任务" : "这里还没有任务"}
            body={query ? undefined : "从收集箱整理过来，或者点右上角「新建」。"}
          />
        ) : (
          grouped.map((group) => (
            <div className="task-group" key={group.status}>
              {filter === "all" ? (
                <div className="task-group__head">
                  <span>{STATUS_LABELS[group.status]}</span>
                  <span className="muted">{group.tasks.length}</span>
                </div>
              ) : null}
              <div className="task-list">
                {group.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    project={snapshot.projects.find((project) => project.id === task.projectId)}
                    run={task.latestRunId ? snapshot.runs.find((run) => run.id === task.latestRunId) : undefined}
                    selected={task.id === selectedTaskId}
                    onClick={() => onOpenTask(task.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
