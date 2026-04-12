"use client";

import React, { useState, useCallback } from "react";
import { AlertCircle, CheckCircle } from "lucide-react";
import type { ConfigSchema, ConfigField } from "@/lib/plugins/types";

export interface FormData {
  fields: string[];
  schema: ConfigSchema;
  submitLabel?: string;
  resultDisplay?: "text" | "json" | "table";
}

interface FormTemplateProps {
  data: FormData;
  onSubmit: (values: Record<string, unknown>) => Promise<unknown>;
  initialValues?: Record<string, unknown>;
}

/**
 * FormTemplate - Input form with submit action
 * 
 * Renders a form based on config schema, handles submission,
 * and displays results.
 */
export function FormTemplate({ 
  data, 
  onSubmit,
  initialValues = {},
}: FormTemplateProps) {
  const { fields, schema, submitLabel: rawSubmitLabel, resultDisplay = "text" } = data;
  const submitLabel = rawSubmitLabel ?? "Submit";
  
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    // Initialize with defaults from schema + initial values
    const defaults: Record<string, unknown> = {};
    for (const fieldKey of fields) {
      const field = schema[fieldKey];
      if (field && "default" in field) {
        defaults[fieldKey] = field.default;
      }
    }
    return { ...defaults, ...initialValues };
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = useCallback((key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }));
    // Clear previous result when form changes
    setResult(null);
    setError(null);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      const response = await onSubmit(values);
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderField = (fieldKey: string) => {
    const field = schema[fieldKey];
    if (!field) return null;
    
    const value = values[fieldKey];
    const id = `form-field-${fieldKey}`;
    
    switch (field.type) {
      case "string":
        if (field.options && field.options.length > 0) {
          return (
            <select
              id={id}
              className="form-select"
              value={String(value ?? "")}
              onChange={(e) => handleChange(fieldKey, e.target.value)}
              disabled={isSubmitting}
            >
              <option value="">Select...</option>
              {field.options.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          );
        }
        return (
          <input
            id={id}
            type="text"
            className="form-input"
            value={String(value ?? "")}
            placeholder={field.placeholder}
            onChange={(e) => handleChange(fieldKey, e.target.value)}
            disabled={isSubmitting}
            minLength={field.minLength}
            maxLength={field.maxLength}
          />
        );
        
      case "number":
        return (
          <input
            id={id}
            type="number"
            className="form-input"
            value={value !== undefined ? String(value) : ""}
            onChange={(e) => handleChange(fieldKey, e.target.value ? Number(e.target.value) : undefined)}
            disabled={isSubmitting}
            min={field.min}
            max={field.max}
            step={field.step}
          />
        );
        
      case "boolean":
        return (
          <label className="form-checkbox">
            <input
              id={id}
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => handleChange(fieldKey, e.target.checked)}
              disabled={isSubmitting}
            />
            <span className="form-checkbox-label">{field.label}</span>
          </label>
        );
        
      case "array":
        // Simple comma-separated input for arrays
        return (
          <input
            id={id}
            type="text"
            className="form-input"
            value={Array.isArray(value) ? value.join(", ") : ""}
            placeholder="Enter values separated by commas"
            onChange={(e) => {
              const arr = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
              handleChange(fieldKey, arr);
            }}
            disabled={isSubmitting}
          />
        );
        
      default:
        return null;
    }
  };

  const renderResult = () => {
    if (!result) return null;
    
    switch (resultDisplay) {
      case "json":
        return (
          <pre className="form-result-json">
            {JSON.stringify(result, null, 2)}
          </pre>
        );
        
      case "table":
        if (Array.isArray(result) && result.length > 0) {
          const rows = result as Array<Record<string, unknown>>;
          const keys = Object.keys(rows[0]);
          return (
            <table className="form-result-table">
              <thead>
                <tr>
                  {keys.map(k => <th key={k}>{k}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((row, i) => (
                  <tr key={i}>
                    {keys.map(k => <td key={k}>{String(row[k] ?? "")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        return <div className="form-result-text">{JSON.stringify(result)}</div>;
        
      case "text":
      default:
        if (typeof result === "object" && result !== null) {
          const obj = result as Record<string, unknown>;
          // Try common result patterns
          const text = obj.text || obj.result || obj.message || obj.data || JSON.stringify(result);
          return <div className="form-result-text">{String(text)}</div>;
        }
        return <div className="form-result-text">{String(result)}</div>;
    }
  };

  return (
    <form className="form-container" onSubmit={handleSubmit}>
      {/* Form fields */}
      <div className="form-fields">
        {fields.map((fieldKey) => {
          const field = schema[fieldKey];
          if (!field) return null;
          
          // Boolean fields render inline with checkbox
          if (field.type === "boolean") {
            return (
              <div key={fieldKey} className="form-field form-field-checkbox">
                {renderField(fieldKey)}
              </div>
            );
          }
          
          return (
            <div key={fieldKey} className="form-field">
              <label htmlFor={`form-field-${fieldKey}`} className="form-label">
                {field.label}
                {field.required && <span className="form-required">*</span>}
              </label>
              {field.description && (
                <span className="form-description">{field.description}</span>
              )}
              {renderField(fieldKey)}
            </div>
          );
        })}
      </div>
      
      {/* Submit button */}
      <button
        type="submit"
        className="form-submit"
        disabled={isSubmitting}
      >
        {isSubmitting ? <Spinner /> : null}
        {isSubmitting ? "Submitting..." : submitLabel}
      </button>
      
      {/* Error display */}
      {error && (
        <div className="form-error">
          <ErrorIcon />
          {error}
        </div>
      )}
      
      {/* Result display */}
      {result !== null && (
        <div className="form-result">
          <div className="form-result-header">
            <SuccessIcon />
            <span>Result</span>
          </div>
          {renderResult()}
        </div>
      )}
    </form>
  );
}

// Icons
function Spinner() {
  return (
    <svg className="form-spinner" width="14" height="14" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeLinecap="round" />
    </svg>
  );
}

function ErrorIcon() {
  return <AlertCircle width={14} height={14} />;
}

function SuccessIcon() {
  return <CheckCircle width={14} height={14} />;
}
