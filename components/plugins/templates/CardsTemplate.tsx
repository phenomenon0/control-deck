"use client";

import { LayoutGrid, ExternalLink } from "lucide-react";

export interface CardItem {
  id?: string;
  title: string;
  subtitle?: string;
  value?: string | number;
  icon?: string;
  image?: string;
  color?: string;
  link?: string;
  meta?: Record<string, unknown>;
}

export interface CardsData {
  cards: CardItem[];
}

interface CardsTemplateProps {
  data: CardsData;
  maxCards?: number;
  layout?: "grid" | "list";
  onCardClick?: (card: CardItem) => void;
}

/**
 * CardsTemplate - Visual cards with optional images/icons
 * 
 * Displays data as cards in a grid or list layout.
 * Supports icons, images, colors, and click actions.
 */
export function CardsTemplate({ 
  data, 
  maxCards = 6,
  layout = "grid",
  onCardClick 
}: CardsTemplateProps) {
  const cards = data.cards.slice(0, maxCards);

  if (cards.length === 0) {
    return (
      <div className="cards-empty">
        <EmptyCardsIcon />
        <span>No cards to display</span>
      </div>
    );
  }

  const handleCardClick = (card: CardItem) => {
    if (card.link) {
      window.open(card.link, "_blank", "noopener,noreferrer");
    }
    onCardClick?.(card);
  };

  // Determine color class or style
  const getColorStyle = (color?: string) => {
    if (!color) return {};
    
    // Named colors map to CSS variables
    const namedColors: Record<string, string> = {
      green: "var(--color-success)",
      red: "var(--color-error)",
      yellow: "var(--color-warning)",
      blue: "var(--color-info)",
      purple: "var(--color-accent)",
      orange: "var(--color-warning)",
    };
    
    const resolvedColor = namedColors[color.toLowerCase()] || color;
    return { "--card-accent-color": resolvedColor } as React.CSSProperties;
  };

  return (
    <div className={`cards-container cards-${layout}`}>
      {cards.map((card, index) => {
        const cardId = card.id || String(index);
        const hasAction = !!card.link || !!onCardClick;
        
        return (
          <div
            key={cardId}
            className={`card-item ${hasAction ? "card-clickable" : ""} ${card.color ? "card-colored" : ""}`}
            style={getColorStyle(card.color)}
            onClick={() => hasAction && handleCardClick(card)}
            role={hasAction ? "button" : undefined}
          >
            {/* Card image (full width at top) */}
            {card.image && (
              <div className="card-image">
                <img 
                  src={card.image} 
                  alt={card.title}
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            )}
            
            {/* Card body */}
            <div className="card-body">
              {/* Icon (if no image) */}
              {!card.image && card.icon && (
                <div className="card-icon">
                  {card.icon}
                </div>
              )}
              
              {/* Content */}
              <div className="card-content">
                <div className="card-header">
                  <span className="card-title">{card.title}</span>
                  {card.link && <LinkIcon />}
                </div>
                
                {card.subtitle && (
                  <span className="card-subtitle">{card.subtitle}</span>
                )}
                
                {card.value !== undefined && (
                  <span className="card-value">{card.value}</span>
                )}
              </div>
            </div>
            
            {/* Color accent bar */}
            {card.color && <div className="card-accent-bar" />}
          </div>
        );
      })}
      
      {/* Show more indicator */}
      {data.cards.length > maxCards && (
        <div className="cards-more">
          +{data.cards.length - maxCards} more
        </div>
      )}
    </div>
  );
}

// Icons
function EmptyCardsIcon() {
  return <LayoutGrid width={24} height={24} strokeWidth={1.5} opacity={0.5} />;
}

function LinkIcon() {
  return <ExternalLink width={10} height={10} className="card-link-icon" />;
}
