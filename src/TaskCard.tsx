import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { hoursLabel, priorityLabels } from './formatters';
import type { Task } from './types';

export type TaskCardVariant = 'backlog' | 'gantt';

type TaskCardProps = {
  task: Task;
  variant: TaskCardVariant;
  allocatedHours?: number;
  pendingHours?: number;
  isDragging?: boolean;
  isGhost?: boolean;
  onEdit?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onAddChild?: (task: Task) => void;
  onToggle?: (task: Task) => void;
  expanded?: boolean;
  depth?: number;
  hasChildren?: boolean;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
};

export default function TaskCard({
  task,
  variant,
  allocatedHours = 0,
  pendingHours = 0,
  isDragging = false,
  isGhost = false,
  onEdit,
  onDelete,
  onAddChild,
  onToggle,
  expanded = true,
  depth = 1,
  hasChildren = false,
  onPointerDown,
}: TaskCardProps) {
  const canEdit = !isGhost && Boolean(onEdit) && task.status !== 'completed';
  const className = [
    'task-card',
    `task-card-${variant}`,
    isDragging ? 'dragging-source' : '',
    isGhost ? 'task-card-ghost' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isGhost) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button')) return;
    onPointerDown?.(event);
  };
  const handleClick = () => {
    if (canEdit) onEdit?.(task);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.key === 'Enter' || event.key === ' ') && canEdit) {
      event.preventDefault();
      onEdit?.(task);
    }
  };
  return (
    <article
      className={className}
      style={{ '--task-depth': depth } as CSSProperties}
      draggable={false}
      tabIndex={isGhost ? undefined : 0}
      aria-hidden={isGhost || undefined}
      onPointerDown={onPointerDown ? handlePointerDown : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {hasChildren && onToggle && (
        <button
          className="task-card-toggle"
          type="button"
          aria-label={`${expanded ? '收合' : '展開'} ${task.name}`}
          onClick={event => {
            event.stopPropagation();
            onToggle(task);
          }}
        >
          {expanded ? '⌄' : '›'}
        </button>
      )}
      <div className={`task-card-info${variant === 'gantt' ? ' task-link' : ''}`} draggable={false}>
        <b>{task.name}</b>
        <small>
          {variant === 'backlog' ? (
            <>
              <em className={`priority ${task.priority}`}>{priorityLabels[task.priority]}</em> ·
              預估 {hoursLabel(task.estimatedHours)}
            </>
          ) : (
            <>
              {task.deadline ? `截止 ${task.deadline} · ` : ''}
              {hasChildren
                ? '子樹彙總'
                : task.status === 'backlog'
                  ? '尚未排程'
                  : 'Allocation 由時間軸日期決定'}
            </>
          )}
        </small>
      </div>
      {variant === 'gantt' && (
        <div className="task-card-hours hours">
          <b>{hoursLabel(allocatedHours)}</b> / {hoursLabel(task.estimatedHours)}
          {pendingHours !== 0 && (
            <em>
              {pendingHours > 0
                ? `待安排 ${hoursLabel(pendingHours)}`
                : `需釋放 ${hoursLabel(Math.abs(pendingHours))}`}
            </em>
          )}
        </div>
      )}
      {!isGhost && onDelete && (
        <div className="task-card-actions">
          <button
            className="task-card-delete"
            type="button"
            aria-label={`刪除 ${task.name}`}
            onClick={event => {
              event.stopPropagation();
              onDelete(task.id);
            }}
          >
            ×
          </button>
        </div>
      )}
      {!isGhost && onAddChild && (
        <div className="task-card-actions">
          <button
            className="task-card-add-child"
            type="button"
            aria-label={`新增 ${task.name} 的子任務`}
            onClick={event => {
              event.stopPropagation();
              onAddChild(task);
            }}
          >
            ＋
          </button>
        </div>
      )}
    </article>
  );
}
