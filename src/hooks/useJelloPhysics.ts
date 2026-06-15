import { RefObject, useEffect, useLayoutEffect, useRef } from "react";

const DAMPING            = 0.94;  // 올릴수록 오래 미끄러짐 (0→즉시정지, 1→영원히)
const RESTITUTION        = 0.60;  // 올릴수록 벽에서 탱탱하게 튐 (0→흡수, 1→손실없음)
const STOP_THRESH        = 0.40;  // 낮출수록 더 오래 굴러가다 멈춤 (px/frame)
const THROW_MULTIPLIER   = 40;    // 올릴수록 살짝만 던져도 멀리 날아감 (포인터 속도 → px/frame 배율)
const MAX_SPEED          = 130;   // 올릴수록 더 빠르게 날아감 — 단일 프레임 최대 이동 px (너무 높으면 벽 통과)
const HIT_RECT_MS        = 100;   // 물리 중 hit_rect 갱신 주기 (ms)
const SQUASH_DURATION_MS = 800;   // 찌그러짐 지속시간 (ms) — 길수록 오래 출렁 (강도는 App.css --sq-compress/--sq-stretch)

export function useJelloPhysics(
  boxRef: RefObject<HTMLDivElement | null>,
  onSettle: () => void,
) {
  // Always-current callback reference — avoids re-attaching listeners on re-render.
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;

  const pos = useRef({ x: 24, y: 0 });
  const vel = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const ptrHistory = useRef<{ x: number; y: number; t: number }[]>([]);
  const rafId = useRef(0);
  const lastHitRectMs = useRef(0);

  // Set initial position (bottom-left) before first paint — no flash.
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

  // ── Squash animation ────────────────────────────────────────────────────
  // Targets the inner .jello-squash-wrap so transform(scale) never touches
  // the outer .jello-box that owns left/top positioning.
  function triggerBounce(axis: 'h' | 'v') {
    const wrap = boxRef.current?.querySelector<HTMLDivElement>('.jello-squash-wrap');
    if (!wrap) return;
    wrap.classList.remove('jello-squash-h', 'jello-squash-v');
    void wrap.offsetWidth; // reflow: restart animation from keyframe 0%
    wrap.classList.add(axis === 'h' ? 'jello-squash-h' : 'jello-squash-v');
    wrap.style.animationDuration = SQUASH_DURATION_MS + 'ms';
  }

  // ── Physics tick ────────────────────────────────────────────────────────
  function tick() {
    vel.current.x *= DAMPING;
    vel.current.y *= DAMPING;
    pos.current.x += vel.current.x;
    pos.current.y += vel.current.y;

    const el = boxRef.current;
    if (!el) return;

    // Wall collision — bounds are the full virtual desktop (window spans all monitors).
    // Math.abs() on the reflected component guarantees velocity points away from the wall
    // even if floating-point drift pushed pos slightly past the boundary.
    const maxX = window.innerWidth  - el.offsetWidth;
    const maxY = window.innerHeight - el.offsetHeight;

    if (pos.current.x < 0)    { pos.current.x = 0;    vel.current.x =  Math.abs(vel.current.x) * RESTITUTION; triggerBounce('h'); }
    if (pos.current.x > maxX) { pos.current.x = maxX; vel.current.x = -Math.abs(vel.current.x) * RESTITUTION; triggerBounce('h'); }
    if (pos.current.y < 0)    { pos.current.y = 0;    vel.current.y =  Math.abs(vel.current.y) * RESTITUTION; triggerBounce('v'); }
    if (pos.current.y > maxY) { pos.current.y = maxY; vel.current.y = -Math.abs(vel.current.y) * RESTITUTION; triggerBounce('v'); }

    el.style.left = pos.current.x + "px";
    el.style.top  = pos.current.y + "px";

    // Periodically refresh hit_rect so the user can grab a moving box.
    const now = performance.now();
    if (now - lastHitRectMs.current > HIT_RECT_MS) {
      lastHitRectMs.current = now;
      onSettleRef.current();
    }

    if (Math.hypot(vel.current.x, vel.current.y) > STOP_THRESH) {
      rafId.current = requestAnimationFrame(tick);
    } else {
      vel.current = { x: 0, y: 0 };
      onSettleRef.current(); // final hit_rect when fully stopped
    }
  }

  // ── Mouse down ──────────────────────────────────────────────────────────
  function onMouseDown(e: React.MouseEvent) {
    cancelAnimationFrame(rafId.current);
    vel.current = { x: 0, y: 0 };
    ptrHistory.current = [];

    const rect = boxRef.current!.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    isDragging.current = true;
    boxRef.current!.classList.add("dragging");
    e.preventDefault();
  }

  // ── Mouse move / up ─────────────────────────────────────────────────────
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isDragging.current) return;
      pos.current = {
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      };
      const el = boxRef.current!;
      el.style.left = pos.current.x + "px";
      el.style.top  = pos.current.y + "px";

      ptrHistory.current.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (ptrHistory.current.length > 5) ptrHistory.current.shift();
    }

    function onUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      boxRef.current?.classList.remove("dragging");

      const h = ptrHistory.current;
      if (h.length >= 2) {
        const a = h[h.length - 2];
        const b = h[h.length - 1];
        const dt = Math.max(b.t - a.t, 1);
        const vx = ((b.x - a.x) / dt) * THROW_MULTIPLIER;
        const vy = ((b.y - a.y) / dt) * THROW_MULTIPLIER;
        const speed = Math.hypot(vx, vy);
        const scale = speed > MAX_SPEED ? MAX_SPEED / speed : 1;
        vel.current = { x: vx * scale, y: vy * scale };
      }
      ptrHistory.current = [];

      if (Math.hypot(vel.current.x, vel.current.y) > STOP_THRESH) {
        lastHitRectMs.current = performance.now();
        rafId.current = requestAnimationFrame(tick);
      } else {
        vel.current = { x: 0, y: 0 };
        onSettleRef.current();
      }
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
