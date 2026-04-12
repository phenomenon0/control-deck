"use client";

import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, Table } from "lucide-react";

export interface TableColumn {
  key: string;
  label: string;
  width?: string;
  align?: "left" | "center" | "right";
  sortable?: boolean;
}

export interface TableData {
  columns: TableColumn[];
  rows: Array<Record<string, unknown>>;
}

interface TableTemplateProps {
  data: TableData;
  maxRows?: number;
  clickable?: boolean;
  striped?: boolean;
  onRowClick?: (row: Record<string, unknown>, index: number) => void;
}

type SortDirection = "asc" | "desc" | null;

/**
 * TableTemplate - Structured data grid
 * 
 * Displays tabular data with sorting, row selection, and responsive design.
 */
export function TableTemplate({ 
  data, 
  maxRows = 20,
  clickable = false,
  striped = true,
  onRowClick 
}: TableTemplateProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);

  const { columns, rows } = data;

  // Sort rows if needed
  const sortedRows = useMemo(() => {
    if (!sortKey || !sortDir) return rows;
    
    return [...rows].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      
      // Handle nulls
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortDir === "asc" ? -1 : 1;
      if (bVal == null) return sortDir === "asc" ? 1 : -1;
      
      // Compare values
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      const cmp = aStr.localeCompare(bStr);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  const displayRows = sortedRows.slice(0, maxRows);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      // Cycle: asc -> desc -> null
      if (sortDir === "asc") setSortDir("desc");
      else if (sortDir === "desc") { setSortKey(null); setSortDir(null); }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handleRowClick = (row: Record<string, unknown>, index: number) => {
    onRowClick?.(row, index);
  };

  // Format cell value for display
  const formatValue = (value: unknown): string => {
    if (value == null) return "-";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  if (rows.length === 0) {
    return (
      <div className="table-empty">
        <EmptyTableIcon />
        <span>No data to display</span>
      </div>
    );
  }

  return (
    <div className="table-container">
      <div className="table-scroll">
        <table className={`table-content ${striped ? "table-striped" : ""}`}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`table-header ${col.sortable !== false ? "table-sortable" : ""}`}
                  style={{ 
                    width: col.width,
                    textAlign: col.align || "left",
                  }}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                >
                  <div className="table-header-content">
                    <span>{col.label}</span>
                    {col.sortable !== false && sortKey === col.key && (
                      <SortIcon direction={sortDir} />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className={`table-row ${clickable ? "table-row-clickable" : ""}`}
                onClick={() => clickable && handleRowClick(row, rowIdx)}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className="table-cell"
                    style={{ textAlign: col.align || "left" }}
                  >
                    {formatValue(row[col.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Row count / more indicator */}
      <div className="table-footer">
        <span className="table-count">
          {displayRows.length === rows.length 
            ? `${rows.length} rows`
            : `Showing ${displayRows.length} of ${rows.length} rows`
          }
        </span>
      </div>
    </div>
  );
}

// Icons
function SortIcon({ direction }: { direction: SortDirection }) {
  if (direction === "asc") {
    return <ChevronUp width={10} height={10} />;
  }
  if (direction === "desc") {
    return <ChevronDown width={10} height={10} />;
  }
  return null;
}

function EmptyTableIcon() {
  return <Table width={24} height={24} strokeWidth={1.5} opacity={0.5} />;
}
