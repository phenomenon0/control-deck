"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { WidgetContainer, TodoIcon } from "./WidgetContainer";
import type { TodoData, TodoItem } from "@/lib/widgets/types";

interface TodoWidgetProps {
  data?: TodoData;
  onUpdate?: (items: TodoItem[]) => void;
}

export function TodoWidget({ data, onUpdate }: TodoWidgetProps) {
  const [newTodo, setNewTodo] = useState("");
  
  const items = data?.items || [];
  const pendingCount = items.filter((t) => !t.done).length;
  const badge = pendingCount > 0 ? `${pendingCount}` : undefined;

  const handleAdd = () => {
    if (!newTodo.trim()) return;
    
    const newItem: TodoItem = {
      id: crypto.randomUUID(),
      text: newTodo.trim(),
      done: false,
      createdAt: new Date().toISOString(),
    };
    
    onUpdate?.([newItem, ...items]);
    setNewTodo("");
  };

  const handleToggle = (id: string) => {
    const updated = items.map((item) =>
      item.id === id ? { ...item, done: !item.done } : item
    );
    onUpdate?.(updated);
  };

  const handleDelete = (id: string) => {
    const updated = items.filter((item) => item.id !== id);
    onUpdate?.(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <WidgetContainer
      title="Tasks"
      icon={<TodoIcon />}
      badge={badge}
      defaultExpanded={true}
    >
      <div className="todo-content">
        {/* Add new todo */}
        <div className="todo-input-row">
          <input
            type="text"
            className="todo-input"
            placeholder="Add task..."
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="todo-add-btn"
            onClick={handleAdd}
            disabled={!newTodo.trim()}
          >
            +
          </button>
        </div>

        {/* Todo list */}
        <div className="todo-list">
          {items.length === 0 ? (
            <div className="todo-empty">No tasks yet</div>
          ) : (
            items.map((item) => (
              <div key={item.id} className={`todo-item ${item.done ? "done" : ""}`}>
                <button
                  className="todo-checkbox"
                  onClick={() => handleToggle(item.id)}
                  aria-label={item.done ? "Mark incomplete" : "Mark complete"}
                >
                  {item.done ? (
                    <CheckIcon />
                  ) : (
                    <span className="checkbox-empty" />
                  )}
                </button>
                <span className="todo-text">{item.text}</span>
                <button
                  className="todo-delete"
                  onClick={() => handleDelete(item.id)}
                  aria-label="Delete"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

function CheckIcon() {
  return <Check width={12} height={12} strokeWidth={3} />;
}
