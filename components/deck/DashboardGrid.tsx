"use client";

import { ReactNode, useState, useRef, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X, Plus } from "lucide-react";
import { type DashboardItem } from "@/lib/hooks/useDashboardLayout";
import { type WidgetMeta } from "@/lib/widgets/registry";

// CSS class map for grid sizing
const SIZE_CLASS_MAP: Record<DashboardItem["size"], string> = {
  "1x1": "grid-cell-1x1",
  "2x1": "grid-cell-2x1",
  "2x2": "grid-cell-2x2",
  "1x2": "grid-cell-1x2",
  "3x1": "grid-cell-3x1",
  "full": "grid-cell-full",
};

// Category labels for the widget picker
const CATEGORY_LABELS: Record<WidgetMeta["category"], string> = {
  system: "System",
  data: "Data",
  actions: "Actions",
  info: "Info",
};

interface SortableCellProps {
  item: DashboardItem;
  onRemove: (id: string) => void;
  children: ReactNode;
}

function SortableCell({ item, onRemove, children }: SortableCellProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const sizeClass = SIZE_CLASS_MAP[item.size] ?? "grid-cell-1x1";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`dashboard-cell ${sizeClass} group relative rounded-lg border border-border bg-card overflow-hidden`}
    >
      {/* Drag handle — top-left, visible on hover */}
      <button
        className="absolute left-1 top-1 z-20 flex h-5 w-5 cursor-grab items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100 active:cursor-grabbing text-muted-foreground"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* Remove button — top-right, visible on hover */}
      <button
        className="absolute right-1 top-1 z-20 flex h-5 w-5 cursor-pointer items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100 text-muted-foreground hover:text-destructive"
        aria-label="Remove widget"
        onClick={() => onRemove(item.id)}
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* Widget content */}
      <div className="h-full w-full">
        {children}
      </div>
    </div>
  );
}

interface WidgetPickerProps {
  availableWidgets: WidgetMeta[];
  onAdd: (id: string) => void;
  onClose: () => void;
}

function WidgetPicker({ availableWidgets, onAdd, onClose }: WidgetPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Group by category
  const grouped = availableWidgets.reduce<Record<string, WidgetMeta[]>>((acc, w) => {
    if (!acc[w.category]) acc[w.category] = [];
    acc[w.category].push(w);
    return acc;
  }, {});

  const categoryOrder: WidgetMeta["category"][] = ["system", "actions", "data", "info"];

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-border bg-popover shadow-lg"
    >
      <div className="border-b border-border px-3 py-2">
        <p className="text-sm font-medium text-popover-foreground">Add Widget</p>
      </div>

      {availableWidgets.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          All widgets are on the dashboard.
        </p>
      ) : (
        <div className="max-h-80 overflow-y-auto py-1">
          {categoryOrder.map(cat => {
            const widgets = grouped[cat];
            if (!widgets || widgets.length === 0) return null;
            return (
              <div key={cat}>
                <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {CATEGORY_LABELS[cat]}
                </p>
                {widgets.map(w => (
                  <button
                    key={w.id}
                    className="flex w-full flex-col px-3 py-2 text-left hover:bg-accent transition-colors"
                    onClick={() => {
                      onAdd(w.id);
                      onClose();
                    }}
                  >
                    <span className="text-sm font-medium text-popover-foreground">
                      {w.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {w.description}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface DashboardGridProps {
  items: DashboardItem[];
  availableWidgets: WidgetMeta[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  renderWidget: (widgetId: string) => ReactNode;
}

export function DashboardGrid({
  items,
  availableWidgets,
  onReorder,
  onAdd,
  onRemove,
  renderWidget,
}: DashboardGridProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6, // require 6px movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const fromIndex = items.findIndex(item => item.id === active.id);
    const toIndex = items.findIndex(item => item.id === over.id);

    if (fromIndex !== -1 && toIndex !== -1) {
      onReorder(fromIndex, toIndex);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-end">
        <div className="relative">
          <button
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-card-foreground shadow-sm transition-colors hover:bg-accent"
            onClick={() => setPickerOpen(prev => !prev)}
            aria-label="Add widget"
            aria-expanded={pickerOpen}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Widget</span>
          </button>

          {pickerOpen && (
            <WidgetPicker
              availableWidgets={availableWidgets}
              onAdd={onAdd}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      </div>

      {/* Grid */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items.map(i => i.id)} strategy={rectSortingStrategy}>
          <div className="dashboard-grid grid grid-cols-4 gap-3 auto-rows-[minmax(140px,auto)]">
            {items.map(item => (
              <SortableCell key={item.id} item={item} onRemove={onRemove}>
                {renderWidget(item.id)}
              </SortableCell>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">No widgets on the dashboard.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Click &ldquo;Add Widget&rdquo; to get started.
          </p>
        </div>
      )}
    </div>
  );
}
