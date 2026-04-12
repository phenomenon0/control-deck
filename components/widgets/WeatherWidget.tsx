"use client";

import { WidgetContainer, WeatherIcon } from "./WidgetContainer";
import type { WeatherData } from "@/lib/widgets/types";

interface WeatherWidgetProps {
  data?: WeatherData;
  isLoading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

export function WeatherWidget({ data, isLoading, error, onRefresh }: WeatherWidgetProps) {
  // Show temp + condition in badge for more info when collapsed
  const badge = data ? `${data.temp}°F ${data.condition}` : undefined;

  return (
    <WidgetContainer
      title="Weather"
      icon={<WeatherIcon condition={data?.condition} />}
      badge={badge}
      isLoading={isLoading}
      error={error}
      onRefresh={onRefresh}
      lastUpdated={data?.updatedAt}
      defaultExpanded={false}
    >
      {data && (
        <div className="weather-content">
          {/* Current conditions */}
          <div className="weather-current">
            <div className="weather-temp-large">{data.temp}°F</div>
            <div className="weather-details">
              <span className="weather-condition">{data.condition}</span>
              <span className="weather-feels">Feels like {data.feelsLike}°F</span>
              <div className="weather-stats">
                <span>💧 {data.humidity}%</span>
                <span>💨 {data.wind} mph</span>
              </div>
            </div>
          </div>

          {/* Forecast */}
          {data.forecast.length > 0 && (
            <div className="weather-forecast">
              {data.forecast.map((day, i) => (
                <div key={i} className="forecast-day">
                  <span className="forecast-name">{day.day}</span>
                  <WeatherIcon condition={day.condition} />
                  <span className="forecast-temps">
                    <span className="forecast-high">{day.high}°</span>
                    <span className="forecast-low">{day.low}°</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </WidgetContainer>
  );
}
