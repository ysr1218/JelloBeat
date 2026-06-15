import { RefObject, useEffect, useLayoutEffect, useRef } from "react";

// ── 물리 상수 ────────────────────────────────────────────────────────────────
const DAMPING            = 0.94;  // 올릴수록 오래 미끄러짐 (0→즉시정지, 1→영원히)
const RESTITUTION        = 0.60;  // 올릴수록 벽에서 탱탱하게 튐 (0→흡수, 1→손실없음)
const STOP_THRESH        = 0.40;  // 낮출수록 더 오래 굴러가다 멈춤 (px/frame)
const THROW_MULTIPLIER   = 40;    // 올릴수록 살짝만 던져도 멀리 날아감 (포인터 속도 → px/frame 배율)
const MAX_SPEED          = 150;   // 올릴수록 더 빠르게 날아감 (너무 높으면 벽 통과)
const HIT_RECT_MS        = 100;   // 물리 중 hit_rect 갱신 주기 (ms)

// ── 스쿼시 스프링 상수 ───────────────────────────────────────────────────────
const SQUASH_STIFFNESS   = 0.25;  // 올릴수록 빠르게 복원 (스프링 강도)
const SQUASH_DAMPING     = 0.05;  // 올릴수록 빠르게 잦아듦 (감쇠)
const SQUASH_IMPACT      = 0.004; // 올릴수록 충돌 시 더 많이 찌그러짐 (속도→찌그러짐 변환계수)
const SQUASH_COUPLE      = 0.5;   // 충돌축 반대축 늘어남 비율 (0→없음, 1→동등)
const SQUASH_STOP        = 0.002; // 이 미만이면 스프링 정지

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

  // Squash spring state — offsets from scale(1,1), converge to 0
  const sqX = useRef(0);
  const sqY = useRef(0);
  const sqVX = useRef(0);
  const sqVY = useRef(0);
  const squashRafId = useRef(0); // 0 = not running (sentinel)

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

  // ── Squash spring ────────────────────────────────────────────────────────
  function squashTick() {
    sqVX.current += -SQUASH_STIFFNESS * sqX.current - SQUASH_DAMPING * sqVX.current;
    sqVY.current += -SQUASH_STIFFNESS * sqY.current - SQUASH_DAMPING * sqVY.current;
    sqX.current += sqVX.current;
    sqY.current += sqVY.current;

    const wrap = boxRef.current?.querySelector<HTMLDivElement>(".jello-squash-wrap");
    if (wrap) {
      wrap.style.transform = `scaleX(${1 + sqX.current}) scaleY(${1 + sqY.current})`;
      const mag = Math.abs(sqX.current) + Math.abs(sqY.current);
      wrap.style.borderRadius = (12 + mag * 30) + "px";
    }

    const settled =
      Math.abs(sqX.current)  < SQUASH_STOP && Math.abs(sqY.current)  < SQUASH_STOP &&
      Math.abs(sqVX.current) < SQUASH_STOP && Math.abs(sqVY.current) < SQUASH_STOP;

    if (!settled) {
      squashRafId.current = requestAnimationFrame(squashTick);
    } else {
      squashRafId.current = 0;
      if (wrap) { wrap.style.transform = ""; wrap.style.borderRadius = ""; }
    }
  }

  // Add velocity impulse to the squash spring. Accumulates on already-oscillating state.
  function addSquashImpulse(axis: "h" | "v", impact: number) {
    const delta = impact * SQUASH_IMPACT;
    if (axis === "h") { sqX.current -= delta; sqY.current += delta * SQUASH_COUPLE; }
    else              { sqY.current -= delta; sqX.current += delta * SQUASH_COUPLE; }
    if (squashRafId.current === 0)
      squashRafId.current = requestAnimationFrame(squashTick);
  }

  function resetSquash() {
    cancelAnimationFrame(squashRafId.current);
    squashRafId.current = 0;
    sqX.current = sqY.current = sqVX.current = sqVY.current = 0;
    const wrap = boxRef.current?.querySelector<HTMLDivElement>(".jello-squash-wrap");
    if (wrap) { wrap.style.transform = ""; wrap.style.borderRadius = ""; }
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
    // Capture impact speed before RESTITUTION so squash impulse reflects true collision force.
    const maxX = window.innerWidth  - el.offsetWidth;
    const maxY = window.innerHeight - el.offsetHeight;

    if (pos.current.x < 0) {
      pos.current.x = 0;
      const impact = Math.abs(vel.current.x);
      vel.current.x = impact * RESTITUTION;
      addSquashImpulse("h", impact);
    }
    if (pos.current.x > maxX) {
      pos.current.x = maxX;
      const impact = Math.abs(vel.current.x);
      vel.current.x = -impact * RESTITUTION;
      addSquashImpulse("h", impact);
    }
    if (pos.current.y < 0) {
      pos.current.y = 0;
      const impact = Math.abs(vel.current.y);
      vel.current.y = impact * RESTITUTION;
      addSquashImpulse("v", impact);
    }
    if (pos.current.y > maxY) {
      pos.current.y = maxY;
      const impact = Math.abs(vel.current.y);
      vel.current.y = -impact * RESTITUTION;
      addSquashImpulse("v", impact);
    }

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
    resetSquash();
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
      cancelAnimationFrame(squashRafId.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { onMouseDown };
}
