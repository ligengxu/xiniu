"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface ResizablePanelProps {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  side: "left" | "right";
  visible: boolean;
  children: React.ReactNode;
  storageKey?: string;
}

export function ResizablePanel({
  defaultWidth,
  minWidth,
  maxWidth,
  side,
  visible,
  children,
  storageKey,
}: ResizablePanelProps) {
  const [width, setWidth] = useState(() => {
    if (storageKey && typeof window !== "undefined") {
      const stored = localStorage.getItem(`xiniu-panel-${storageKey}`);
      if (stored) return Math.max(minWidth, Math.min(maxWidth, parseInt(stored, 10)));
    }
    return defaultWidth;
  });
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(`xiniu-panel-${storageKey}`, String(width));
    }
  }, [width, storageKey]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startX.current = e.clientX;
    startWidth.current = width;
  }, [width]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = side === "left"
        ? e.clientX - startX.current
        : startX.current - e.clientX;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth.current + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, side, minWidth, maxWidth]);

  const handleDoubleClick = () => {
    setWidth(defaultWidth);
  };

  if (!visible) return null;

  return (
    <div
      ref={panelRef}
      className="relative h-full shrink-0 overflow-hidden"
      style={{
        width: `${width}px`,
        transition: isDragging ? "none" : "width 0.2s ease-out",
      }}
    >
      {children}
      <div
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        className={`absolute top-0 ${side === "left" ? "right-0" : "left-0"} w-1 h-full cursor-col-resize z-10 group`}
      >
        <div
          className={`w-full h-full transition-colors ${
            isDragging ? "bg-[var(--accent)]" : "bg-transparent group-hover:bg-[var(--accent)]/30"
          }`}
        />
      </div>
    </div>
  );
}
