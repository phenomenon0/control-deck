"use client";

import { useState, useEffect, useRef } from "react";

interface JSONSchemaProperty {
  type: "string" | "number" | "boolean" | "array" | "object";
  title?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  format?: "email" | "uri" | "date" | "date-time" | "time";
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

interface JSONSchema {
  type: "object";
  title?: string;
  description?: string;
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface GenerativeFormProps {
  schema: JSONSchema;
  initialData?: Record<string, unknown>;
  onSubmit?: (data: Record<string, unknown>) => void;
  onChange?: (data: Record<string, unknown>) => void;
  isGenerating?: boolean;
  title?: string;
}

export function GenerativeForm({
  schema,
  initialData = {},
  onSubmit,
  onChange,
  isGenerating = false,
  title,
}: GenerativeFormProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const initializedRef = useRef(false);
  const schemaKeyRef = useRef<string>("");

  useEffect(() => {
    // Create a stable key from schema to detect actual schema changes
    const schemaKey = schema.title || JSON.stringify(Object.keys(schema.properties || {}));
    
    // Only reinitialize if schema actually changed (by key) or first mount
    if (!initializedRef.current || schemaKeyRef.current !== schemaKey) {
      const defaults: Record<string, unknown> = {};
      Object.entries(schema.properties || {}).forEach(([key, prop]) => {
        if (prop.default !== undefined) {
          defaults[key] = prop.default;
        }
      });
      setFormData({ ...defaults, ...initialData });
      initializedRef.current = true;
      schemaKeyRef.current = schemaKey;
    }
  }, [schema, initialData]);

  const handleChange = (name: string, value: unknown) => {
    const newData = { ...formData, [name]: value };
    setFormData(newData);
    onChange?.(newData);

    // Clear error on change
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    (schema.required || []).forEach((field) => {
      const value = formData[field];
      if (value === undefined || value === null || value === "") {
        newErrors[field] = "This field is required";
      }
    });

    Object.entries(schema.properties || {}).forEach(([key, prop]) => {
      const value = formData[key];
      if (value !== undefined && value !== null && value !== "") {
        if (prop.type === "string" && typeof value === "string") {
          if (prop.minLength && value.length < prop.minLength) {
            newErrors[key] = `Minimum ${prop.minLength} characters`;
          }
          if (prop.maxLength && value.length > prop.maxLength) {
            newErrors[key] = `Maximum ${prop.maxLength} characters`;
          }
          if (prop.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            newErrors[key] = "Invalid email format";
          }
        }
        if (prop.type === "number" && typeof value === "number") {
          if (prop.minimum !== undefined && value < prop.minimum) {
            newErrors[key] = `Minimum value is ${prop.minimum}`;
          }
          if (prop.maximum !== undefined && value > prop.maximum) {
            newErrors[key] = `Maximum value is ${prop.maximum}`;
          }
        }
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSubmit?.(formData);
    }
  };

  const renderField = (name: string, prop: JSONSchemaProperty) => {
    const isRequired = schema.required?.includes(name);
    const error = errors[name];
    const value = formData[name];

    const label = (
      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
        {prop.title || name}
        {isRequired && <span className="text-red-400 ml-1">*</span>}
      </label>
    );

    const hint = prop.description && (
      <p className="text-[10px] text-[var(--text-muted)] mt-1">{prop.description}</p>
    );

    const errorMsg = error && (
      <p className="text-[10px] text-red-400 mt-1">{error}</p>
    );

    if (prop.enum) {
      return (
        <div key={name} className="mb-3">
          {label}
          <select
            className={`select w-full text-sm ${error ? "border-red-400" : ""}`}
            value={String(value || "")}
            onChange={(e) => handleChange(name, e.target.value)}
          >
            <option value="">Select...</option>
            {prop.enum.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {hint}
          {errorMsg}
        </div>
      );
    }

    if (prop.type === "boolean") {
      return (
        <div key={name} className="mb-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => handleChange(name, e.target.checked)}
              className="w-4 h-4 rounded border-[var(--border)] bg-[var(--bg-primary)]"
            />
            <span className="text-sm text-[var(--text-primary)]">
              {prop.title || name}
            </span>
          </label>
          {hint}
          {errorMsg}
        </div>
      );
    }

    const inputType = prop.format === "email" ? "email" :
                      prop.format === "date" ? "date" :
                      prop.format === "date-time" ? "datetime-local" :
                      prop.format === "time" ? "time" :
                      prop.type === "number" ? "number" : "text";

    return (
      <div key={name} className="mb-3">
        {label}
        <input
          type={inputType}
          className={`input w-full text-sm ${error ? "border-red-400" : ""}`}
          value={String(value ?? "")}
          onChange={(e) =>
            handleChange(
              name,
              prop.type === "number" ? Number(e.target.value) : e.target.value
            )
          }
          placeholder={prop.description || `Enter ${prop.title || name}...`}
          min={prop.minimum}
          max={prop.maximum}
          minLength={prop.minLength}
          maxLength={prop.maxLength}
        />
        {hint}
        {errorMsg}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] p-4 max-w-md animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">📝</span>
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {title || schema.title || "Generated Form"}
          </h3>
          {schema.description && (
            <p className="text-xs text-[var(--text-muted)]">{schema.description}</p>
          )}
        </div>
        {isGenerating && (
          <div className="ml-auto">
            <div className="tool-spinner" />
          </div>
        )}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit}>
        {Object.entries(schema.properties || {}).map(([name, prop]) =>
          renderField(name, prop)
        )}

        <button
          type="submit"
          className="btn btn-primary w-full text-sm mt-2"
          disabled={isGenerating}
        >
          Submit
        </button>
      </form>
    </div>
  );
}
