import * as React from "react";

interface PageHeaderProps {
  primaryText: string;
  accentText: string;
  description?: string;
}

export function PageHeader({ primaryText, accentText, description }: PageHeaderProps) {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">
        <span className="text-foreground">{primaryText}</span>{" "}
        <span className="text-primary">{accentText}</span>
      </h1>
      {description && (
        <p className="text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
