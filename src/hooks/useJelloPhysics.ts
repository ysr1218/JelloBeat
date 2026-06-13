import { RefObject, useEffect, useLayoutEffect, useRef } from "react";

export function useJelloPhysics(
  boxRef: RefObject<HTMLDivElement | null>,
  onSettle: () => void,
) {
  // Keep onSettle in a ref so event-listener closures always call the latest version
  // without needing to re-attach listeners on every render.
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;

  const pos = useRef({ x: 24, y: 0 });
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  // rafId lives here so Step 4-2 can use it; cancel in onMouseDown too.
  const rafId = useRef(0);

  // Set initial position (bottom-left) before first paint to avoid flash.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    pos.current.y = window.innerHeight - el.offsetHeight - 24;
    el.style.left = pos.current.x + "px";
    el.style.top = pos.current.y + "px";
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Report initial hit rect after layout.
  useEffect(() => {
    onSettleRef.current();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function onMouseDown(e: React.MouseEvent) {
    // Stop any in-flight physics so the user can grab a moving box.
    cancelAnimationFrame(rafId.current);
    // vel will be reset in Step 4-2; rafId cancellation is enough for 4-1.

    const rect = boxRef.current!.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    isDragging.current = true;
    boxRef.current!.classList.add("dragging");
    e.preventDefault();
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isDragging.current) return;
      pos.current = {
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      };
      const el = boxRef.current!;
      el.style.left = pos.current.x + "px";
      el.style.top = pos.current.y + "px";
    }

    function onUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      boxRef.current?.classList.remove("dragging");
      // Step 4-2 will add velocity + RAF here.
      onSettleRef.current();
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      cancelAnimationFrame(rafId.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { onMouseDown };
}
