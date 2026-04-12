"use client";

import { useState, useCallback } from "react";
import type { PluginInstance, ConfigSchema, ConfigField } from "@/lib/plugins/types";
import { mergeConfigValues } from "@/lib/plugins";

interface PluginConfigProps {
  plugin: PluginInstance;
  onSave: (configValues: Record<string, unknown>) => void;
  onCancel: () => void;
}

/**
 * PluginConfig - Auto-generated configuration form from plugin schema
 * 
 * Renders form fields based on the plugin's config schema,
 * with validation and save/cancel actions.
 */
export function PluginConfig({ plugin, onSave, onCancel }: PluginConfigProps) {
  const schema = plugin.bundle.config.schema;
  
  // Initialize values from schema defaults + bundle defaults + saved values
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    return mergeConfigValues(
      schema,
      plugin.bundle.config.defaults,
      plugin.configValues
    );
  });
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);

  const handleChange = useCallback((key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
    // Clear error for this field
    setErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    
    for (const [key, field] of Object.entries(schema)) {
      const value = values[key];
      
      // Required check
      if (field.required && (value === undefined || value === "" || value === null)) {
        newErrors[key] = `${field.label} is required`;
        continue;
      }
      
      // Type-specific validation
      if (value !== undefined && value !== null && value !== "") {
        switch (field.type) {
          case "string": {
            const strField = field as typeof field & { minLength?: number; maxLength?: number; pattern?: string };
            const strValue = String(value);
            
            if (strField.minLength && strValue.length < strField.minLength) {
              newErrors[key] = `Minimum ${strField.minLength} characters`;
            } else if (strField.maxLength && strValue.length > strField.maxLength) {
              newErrors[key] = `Maximum ${strField.maxLength} characters`;
            } else if (strField.pattern) {
              try {
                const regex = new RegExp(strField.pattern);
                if (!regex.test(strValue)) {
                  newErrors[key] = `Invalid format`;
                }
              } catch {
                // Invalid regex, skip validation
              }
            }
            break;
          }
          
          case "number": {
            const numField = field as typeof field & { min?: number; max?: number };
            const numValue = Number(value);
            
            if (isNaN(numValue)) {
              newErrors[key] = `Must be a number`;
            } else if (numField.min !== undefined && numValue < numField.min) {
              newErrors[key] = `Minimum value is ${numField.min}`;
            } else if (numField.max !== undefined && numValue > numField.max) {
              newErrors[key] = `Maximum value is ${numField.max}`;
            }
            break;
          }
          
          case "array": {
            const arrField = field as typeof field & { maxItems?: number };
            if (Array.isArray(value) && arrField.maxItems && value.length > arrField.maxItems) {
              newErrors[key] = `Maximum ${arrField.maxItems} items`;
            }
            break;
          }
        }
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [schema, values]);

  const handleSave = useCallback(() => {
    if (validate()) {
      onSave(values);
    }
  }, [validate, values, onSave]);

  const handleReset = useCallback(() => {
    const defaults = mergeConfigValues(schema, plugin.bundle.config.defaults, {});
    setValues(defaults);
    setIsDirty(true);
    setErrors({});
  }, [schema, plugin.bundle.config.defaults]);

  const renderField = (key: string, field: ConfigField) => {
    const value = values[key];
    const error = errors[key];
    const id = `config-field-${key}`;
    
    switch (field.type) {
      case "string": {
        const strField = field as typeof field & { options?: string[]; placeholder?: string };
        
        if (strField.options && strField.options.length > 0) {
          return (
            <select
              id={id}
              className={`config-select ${error ? "config-error" : ""}`}
              value={String(value ?? "")}
              onChange={(e) => handleChange(key, e.target.value)}
            >
              <option value="">Select...</option>
              {strField.options.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          );
        }
        
        return (
          <input
            id={id}
            type="text"
            className={`config-input ${error ? "config-error" : ""}`}
            value={String(value ?? "")}
            placeholder={strField.placeholder}
            onChange={(e) => handleChange(key, e.target.value)}
          />
        );
      }
        
      case "number": {
        const numField = field as typeof field & { min?: number; max?: number; step?: number };
        return (
          <input
            id={id}
            type="number"
            className={`config-input ${error ? "config-error" : ""}`}
            value={value !== undefined ? String(value) : ""}
            onChange={(e) => handleChange(key, e.target.value ? Number(e.target.value) : undefined)}
            min={numField.min}
            max={numField.max}
            step={numField.step}
          />
        );
      }
        
      case "boolean":
        return (
          <label className="config-checkbox">
            <input
              id={id}
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => handleChange(key, e.target.checked)}
            />
            <span className="config-checkbox-slider" />
          </label>
        );
        
      case "array":
        return (
          <input
            id={id}
            type="text"
            className={`config-input ${error ? "config-error" : ""}`}
            value={Array.isArray(value) ? value.join(", ") : ""}
            placeholder="Enter values separated by commas"
            onChange={(e) => {
              const arr = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
              handleChange(key, arr);
            }}
          />
        );
        
      default:
        return null;
    }
  };

  const fieldKeys = Object.keys(schema);

  return (
    <div className="config-container">
      {/* Header */}
      <div className="config-header">
        <div className="config-title">
          <span className="config-name">{plugin.name}</span>
          <span className="config-subtitle">Settings</span>
        </div>
      </div>
      
      {/* Fields */}
      <div className="config-fields">
        {fieldKeys.length === 0 ? (
          <div className="config-empty">
            <span>This plugin has no configuration options.</span>
          </div>
        ) : (
          fieldKeys.map((key) => {
            const field = schema[key];
            const error = errors[key];
            
            // Boolean fields render inline
            if (field.type === "boolean") {
              return (
                <div key={key} className="config-field config-field-inline">
                  <div className="config-field-header">
                    <label htmlFor={`config-field-${key}`} className="config-label">
                      {field.label}
                    </label>
                    {renderField(key, field)}
                  </div>
                  {field.description && (
                    <span className="config-description">{field.description}</span>
                  )}
                </div>
              );
            }
            
            return (
              <div key={key} className="config-field">
                <label htmlFor={`config-field-${key}`} className="config-label">
                  {field.label}
                  {field.required && <span className="config-required">*</span>}
                </label>
                {field.description && (
                  <span className="config-description">{field.description}</span>
                )}
                {renderField(key, field)}
                {error && <span className="config-error-text">{error}</span>}
              </div>
            );
          })
        )}
      </div>
      
      {/* Actions */}
      <div className="config-actions">
        <button 
          type="button" 
          className="config-btn config-btn-secondary"
          onClick={handleReset}
          title="Reset to defaults"
        >
          Reset
        </button>
        <div className="config-actions-right">
          <button 
            type="button" 
            className="config-btn config-btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button 
            type="button" 
            className="config-btn config-btn-primary"
            onClick={handleSave}
            disabled={!isDirty}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
