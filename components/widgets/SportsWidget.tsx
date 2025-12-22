"use client";

import { WidgetContainer, SportsIcon } from "./WidgetContainer";
import type { SportsData, SportScore } from "@/lib/widgets/types";

interface SportsWidgetProps {
  data?: SportsData;
  isLoading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

export function SportsWidget({ data, isLoading, error, onRefresh }: SportsWidgetProps) {
  // Show latest score in badge
  const latestScore = data?.scores[0];
  const badge = latestScore
    ? `${latestScore.homeTeam} ${latestScore.homeScore}-${latestScore.awayScore}`
    : undefined;

  return (
    <WidgetContainer
      title="Sports"
      icon={<SportsIcon />}
      badge={badge}
      isLoading={isLoading}
      error={error}
      onRefresh={onRefresh}
      lastUpdated={data?.updatedAt}
      defaultExpanded={false}
    >
      {data && (
        <div className="sports-content">
          {data.scores.map((score) => (
            <ScoreCard key={score.id} score={score} />
          ))}
        </div>
      )}
    </WidgetContainer>
  );
}

function ScoreCard({ score }: { score: SportScore }) {
  return (
    <div className={`score-card status-${score.status}`}>
      <div className="score-header">
        <span className="score-league">{score.league}</span>
        <span className={`score-status ${score.status}`}>
          {score.status === "live" && <span className="live-dot" />}
          {score.status === "live" ? score.time || "LIVE" : score.status.toUpperCase()}
        </span>
      </div>
      <div className="score-teams">
        <div className="score-team">
          <span className="team-name">{score.homeTeam}</span>
          <span className="team-score">{score.homeScore}</span>
        </div>
        <div className="score-team">
          <span className="team-name">{score.awayTeam}</span>
          <span className="team-score">{score.awayScore}</span>
        </div>
      </div>
      {score.status === "upcoming" && score.startTime && (
        <div className="score-start">{score.startTime}</div>
      )}
    </div>
  );
}
