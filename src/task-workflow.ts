import type { TaskStatus } from "./types.ts";

export const taskTransitions: Record<TaskStatus, TaskStatus[]> = {
  todo: ["developing"],
  developing: ["review"],
  review: ["passed", "rework"],
  rework: ["developing", "review"],
  passed: ["integrated", "rework"],
  integrated: ["integration-review"],
  "integration-review": ["integration-passed", "rework"],
  "integration-passed": ["handtest", "rework"],
  handtest: ["done", "rework"],
  done: [],
};

export function canEditTaskScope(current: TaskStatus, next: TaskStatus) {
  return current === "todo" || current === "developing" ||
    (current === "rework" && next === "developing");
}
