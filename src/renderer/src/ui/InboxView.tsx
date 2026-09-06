import { useMemo } from "react";
import type { HostSnapshot, Task } from "@shared/protocol";
import type { ClientHandle } from "../lib/client";
import { Composer } from "./Composer";
import { Icon } from "./Icons";
import { EmptyState, TaskRow } from "./bits";

interface InboxViewProps {
  snapshot: HostSnapshot;
  client: ClientHandle;
  selectedTaskId?: string;
  onOpenTask(taskId: string): void;
}

/**
 * The capture surface: anything typed here lands as an inbox item. Triage
 * happens inline (→ 待办 / 完成 / 删除) or by opening the task.
 */
export function InboxView({ snapshot, client, selectedTaskId, onOpenTask }: InboxViewProps): JSX.Element {
  const items = useMemo(
    () =>
      snapshot.tasks
        .filter((task) => task.status === "inbox")
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [snapshot.tasks],
  );
  const projects = snapshot.projects;

  const triage = async (task: Task, status: Task["status"]) => {
    await client.updateTask(task.id, { status });
  };

  return (
    <section className="screen inbox">
      <div className="screen__scroll">
        <div className="inbox__intro">
          <h2>收集箱</h2>
          <p className="muted">
            随手记下想法、bug、要做的事。回到电脑前再整理成待办，或者直接派给 Agent。
          </p>
        </div>
        {items.length === 0 ? (
          <EmptyState title="收集箱是空的" body="在下面输入一句话就会出现在这里。第一行是标题，后面是详情。" />
        ) : (
          <div className="task-list">
            {items.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                project={projects.find((project) => project.id === task.projectId)}
                run={task.latestRunId ? snapshot.runs.find((run) => run.id === task.latestRunId) : undefined}
                selected={task.id === selectedTaskId}
                onClick={() => onOpenTask(task.id)}
                actions={
                  <>
                    <button type="button" className="mini-btn" title="移到待办" onClick={() => void triage(task, "todo")}>
                      <Icon name="tasks" size={14} />
                      <span>待办</span>
                    </button>
                    <button type="button" className="mini-btn" title="标记完成" onClick={() => void triage(task, "done")}>
                      <Icon name="check" size={14} />
                    </button>
                    <button
                      type="button"
                      className="mini-btn mini-btn--danger"
                      title="删除"
                      onClick={() => {
                        if (window.confirm(`删除「${task.title}」？`)) {
                          void client.deleteTask(task.id);
                        }
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>
      <Composer
        surface={client.surface}
        placeholder="记一条想法，或贴一张截图…"
        autoFocus={client.surface === "desktop"}
        onSubmit={async (text) => {
          await client.capture(text);
        }}
        onFiles={async (files) => {
          for (const file of Array.from(files)) {
            await client.upload(file);
          }
        }}
        hint={client.surface === "desktop" ? "Enter 发送，Shift+Enter 换行；也可以直接粘贴图片。" : undefined}
      />
    </section>
  );
}
