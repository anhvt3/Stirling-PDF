import React from "react";
import { useMantineColorScheme } from "@mantine/core";

interface WordmarkProps {
  alt?: string;
  muted?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Clevai brand wordmark — "PDFMagic". Rendered as two-tone text so it themes with light/dark and
 * needs no image asset. Used in the sidebar header and the landing hero.
 */
export function Wordmark({
  muted = false,
  className,
  style,
}: WordmarkProps) {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const base = isDark ? "#ffffff" : muted ? "#868e96" : "#1a1a1a";

  // Brand name is fixed regardless of the caller's legacy `alt` (kept in props for compatibility).
  return (
    <span
      className={className}
      role="img"
      aria-label="PDFMagic"
      style={{
        fontWeight: 800,
        fontSize: "1.35rem",
        letterSpacing: "-0.02em",
        lineHeight: 1,
        whiteSpace: "nowrap",
        color: base,
        ...style,
      }}
    >
      PDF<span style={{ color: "#e8590c" }}>Magic</span>
    </span>
  );
}
