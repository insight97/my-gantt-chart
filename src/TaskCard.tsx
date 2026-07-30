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
  isGroup?: boolean;
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
  isGroup = false,
  onPointerDown,
}: TaskCardProps) {
  const canEdit = !isGhost && Boolean(onEdit) && task.status !== 'completed';
  const className = [
    'task-card',
    `task-card-${variant}`,
    isGroup ? 'task-card-group' : '',
    onPointerDown ? 'task-card-draggable' : '',
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
          aria-expanded={expanded}
          onClick={event => {
            event.stopPropagation();
            onToggle(task);
          }}
        >
          <svg
            className={`task-card-toggle-icon${expanded ? ' is-expanded' : ''}`}
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path
              d="m6 3 5 5-5 5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.75"
            />
          </svg>
        </button>
      )}
      <div className={`task-card-info${variant === 'gantt' ? ' task-link' : ''}`} draggable={false}>
        <b>{task.name}</b>
        {variant === 'backlog' && (
          <small>
            {isGroup ? (
              <>子項目彙總 · 預估 {hoursLabel(task.estimatedHours)}</>
            ) : (
              <>
                <em className={`priority ${task.priority}`}>{priorityLabels[task.priority]}</em> ·
                預估 {hoursLabel(task.estimatedHours)}
              </>
            )}
          </small>
        )}
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
      {!isGhost && (onDelete || onAddChild) && (
        <div className="task-card-actions">
          {onAddChild && (
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
          )}
          {onDelete && (
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
          )}
        </div>
      )}
    </article>
  );
}
