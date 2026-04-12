"use client";

import { WidgetContainer, StocksIcon } from "./WidgetContainer";
import type { StocksData, StockQuote } from "@/lib/widgets/types";

interface StocksWidgetProps {
  data?: StocksData;
  isLoading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

export function StocksWidget({ data, isLoading, error, onRefresh }: StocksWidgetProps) {
  // Show multiple tickers in badge for quick overview
  const badge = data?.quotes.slice(0, 3).map(q => 
    `${q.symbol} ${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(1)}%`
  ).join("  ") || undefined;

  return (
    <WidgetContainer
      title="Stocks"
      icon={<StocksIcon />}
      badge={badge}
      isLoading={isLoading}
      error={error}
      onRefresh={onRefresh}
      lastUpdated={data?.updatedAt}
      defaultExpanded={false}
    >
      {data && (
        <div className="stocks-content">
          {data.quotes.map((quote) => (
            <StockRow key={quote.symbol} quote={quote} />
          ))}
        </div>
      )}
    </WidgetContainer>
  );
}

function StockRow({ quote }: { quote: StockQuote }) {
  const isPositive = quote.change >= 0;
  
  return (
    <div className="stock-row">
      <div className="stock-info">
        <span className="stock-symbol">{quote.symbol}</span>
        <span className="stock-name">{quote.name}</span>
      </div>
      <div className="stock-data">
        {quote.sparkline && quote.sparkline.length > 1 && (
          <Sparkline data={quote.sparkline} positive={isPositive} />
        )}
        <div className="stock-price">
          <span className="price-value">${quote.price.toFixed(2)}</span>
          <span className={`price-change ${isPositive ? "positive" : "negative"}`}>
            {isPositive ? "+" : ""}{quote.changePercent.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  
  const height = 20;
  const width = 40;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        points={points}
        fill="none"
        stroke={positive ? "var(--success)" : "var(--error)"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
