import { useRef } from "react";

export function DragHandle() {
  return (
    <div className="flex justify-center pt-2 pb-0 -mt-1" aria-hidden>
      <div className="w-10 h-1 rounded-full bg-muted-foreground/25" />
    </div>
  );
}

export function useSwipeToClose(onClose: () => void, threshold = 80) {
  const startY = useRef<number | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      startY.current = e.touches[0].clientY;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (startY.current !== null) {
        const delta = e.changedTouches[0].clientY - startY.current;
        if (delta > threshold) onClose();
        startY.current = null;
      }
    },
  };
}
