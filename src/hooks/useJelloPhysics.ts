import { RefObject, useEffect, useLayoutEffect, useRef } from "react";

// ── 물리 상수 ────────────────────────────────────────────────────────────────
const DAMPING            = 0.960; // 올릴수록 오래 미끄러짐 (0→즉시정지, 1→영원히)
const RESTITUTION        = 0.60;  // 올릴수록 벽에서 탱탱하게 튐 (0→흡수, 1→손실없음)
const STOP_THRESH        = 0.05;  // 낮출수록 더 오래 굴러가다 멈춤 (px/frame)
const THROW_MULTIPLIER   = 20;    // 올릴수록 살짝만 던져도 멀리 날아감 (포인터 속도 → px/frame 배율)
const MAX_SPEED          = 100;   // 올릴수록 더 빠르게 날아감 (너무 높으면 벽 통과)
const HIT_RECT_MS        = 100;   // 물리 중 hit_rect 갱신 주기 (ms)

// ── 드리블 상수 ─────────────────────────────────────────────────────────────
const DRIBBLE_MIN_SPEED = 4.0;   // 이 속도(px/프레임 기준) 미만 커서는 드리블 미발동. 잡기 의도 구분. 올릴수록 더 세게 쳐야 드리블.
const DRIBBLE_SCALE     = 0.3;   // 커서 속도(px/프레임 기준) → impulse 변환 계수. 올릴수록 같은 속도에 더 강하게 튕김.
const DRIBBLE_MAX       = 50.0;  // impulse 최대값 (px/프레임). 세게 쳐도 이 이상 커지지 않음.
const DRIBBLE_COOLDOWN  = 50;    // 연타 방지 쿨다운 (ms). 낮출수록 더 빠른 연타 가능.

// ── 스쿼시 스프링 상수 ───────────────────────────────────────────────────────
const SQUASH_STIFFNESS   = 0.25;  // 올릴수록 빠르게 복원 (스프링 강도)
const SQUASH_DAMPING     = 0.05;  // 올릴수록 빠르게 잦아듦 (감쇠)
const SQUASH_IMPACT      = 0.004; // 올릴수록 충돌 시 더 많이 찌그러짐 (속도→찌그러짐 변환계수)
const SQUASH_COUPLE      = 0.5;   // 충돌축 반대축 늘어남 비율 (0→없음, 1→동등)
const SQUASH_STOP        = 0.002; // 이 미만이면 스프링 정지.

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

  // Dribble state
  const prevCursor           = useRef<{ x: number; y: number; t: number } | null>(null);
  const dribbleCooldownUntil = useRef(0);
  const prevInBox            = useRef(false);

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

  // 커서 이동 선분[(ax,ay)→(bx,by)]이 사각형[rx1..rx2 × ry1..ry2]과 교차하는지 (Liang-Barsky)
  function segmentHitsRect(
    ax: number, ay: number, bx: number, by: number,
    rx1: number, ry1: number, rx2: number, ry2: number,
  ): boolean {
    const dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, ax - rx1], [dx, rx2 - ax], [-dy, ay - ry1], [dy, ry2 - ay]] as [number, number][]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; t0 = Math.max(t0, t); }
      else        { if (t < t0) return false; t1 = Math.min(t1, t); }
    }
    return t0 <= t1;
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

    // Refresh hit_rect every frame while moving (box too fast for 100ms throttle),
    // otherwise use HIT_RECT_MS throttle to avoid unnecessary IPC calls.
    const speed = Math.hypot(vel.current.x, vel.current.y);
    const now = performance.now();
    if (speed > STOP_THRESH || now - lastHitRectMs.current > HIT_RECT_MS) {
      lastHitRectMs.current = now;
      onSettleRef.current();
    }

    if (speed > STOP_THRESH) {
      rafId.current = requestAnimationFrame(tick);
    } else {
      rafId.current = 0; // sentinel: physics loop not running
      vel.current = { x: 0, y: 0 };
      onSettleRef.current(); // final hit_rect when fully stopped
    }
  }

  // ── Mouse down ──────────────────────────────────────────────────────────
  function onMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button, input")) return;
    cancelAnimationFrame(rafId.current);
    rafId.current = 0;
    resetSquash();
    vel.current = { x: 0, y: 0 };
    ptrHistory.current = [];
    prevInBox.current = false;

    const rect = boxRef.current!.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    isDragging.current = true;
    boxRef.current!.classList.add("dragging");
    e.preventDefault();
  }

  // ── Mouse move / up ─────────────────────────────────────────────────────
  useEffect(() => {
    function onMove(e: MouseEvent) {
      // ── 드리블: 커서가 박스를 탈출하는 순간 커서 방향으로 impulse ──────────────
      // 박스 안에 머무는 동안(클릭 의도)에는 발동 안 함 — 탈출 시에만 판정.
      const el = boxRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const inBox =
          e.clientX >= r.left && e.clientX <= r.right &&
          e.clientY >= r.top  && e.clientY <= r.bottom;

        // ── 진단 로그 (박스 근처 300px 이내일 때만) ──────────────────────────
        if (e.buttons === 0 && prevCursor.current) {
          const nearBox =
            e.clientX >= r.left - 300 && e.clientX <= r.right + 300 &&
            e.clientY >= r.top  - 300 && e.clientY <= r.bottom + 300;
          if (nearBox) {
            const segHit = segmentHitsRect(
              prevCursor.current.x, prevCursor.current.y,
              e.clientX, e.clientY,
              r.left, r.top, r.right, r.bottom,
            );
            const cvx = e.clientX - prevCursor.current.x;
            const cvy = e.clientY - prevCursor.current.y;
            const cvLen = Math.hypot(cvx, cvy);
            const dt = Math.max(e.timeStamp - prevCursor.current.t, 1);
            const normSpeed = cvLen / dt * 16;
            const cooldownOk = e.timeStamp >= dribbleCooldownUntil.current;
            if (segHit || prevInBox.current) {
              console.log("[dribble diag]", {
                inBox, prevInBox: prevInBox.current, segHit,
                normSpeed: normSpeed.toFixed(1), cooldownOk,
                cvLen: cvLen.toFixed(1), dt: dt.toFixed(1),
                cursor: [Math.round(e.clientX), Math.round(e.clientY)],
                prev: prevCursor.current ? [Math.round(prevCursor.current.x), Math.round(prevCursor.current.y)] : null,
                box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
              });
            }
          }
        }
        // ── 진단 로그 끝 ────────────────────────────────────────────────────

        if (
          e.buttons === 0 &&
          !inBox &&
          prevCursor.current &&
          e.timeStamp >= dribbleCooldownUntil.current &&
          (prevInBox.current || segmentHitsRect(
            prevCursor.current.x, prevCursor.current.y,
            e.clientX, e.clientY,
            r.left, r.top, r.right, r.bottom,
          ))
        ) {
          const cvx = e.clientX - prevCursor.current.x;
          const cvy = e.clientY - prevCursor.current.y;
          const cvLen = Math.hypot(cvx, cvy);
          const dt = Math.max(e.timeStamp - prevCursor.current.t, 1);
          // 시간 정규화 속도(px/프레임 기준) — 이벤트 빈도 차이를 제거
          const normSpeed = cvLen / dt * 16;
          if (cvLen > 0 && normSpeed >= DRIBBLE_MIN_SPEED) {
            const nx = cvx / cvLen, ny = cvy / cvLen;
            const impulse = Math.min(DRIBBLE_MAX, normSpeed * DRIBBLE_SCALE);
            vel.current.x += nx * impulse;
            vel.current.y += ny * impulse;
            const sp = Math.hypot(vel.current.x, vel.current.y);
            if (sp > MAX_SPEED) {
              const s = MAX_SPEED / sp;
              vel.current.x *= s;
              vel.current.y *= s;
            }
            addSquashImpulse(Math.abs(nx) >= Math.abs(ny) ? "h" : "v", impulse);
            if (rafId.current === 0) {
              lastHitRectMs.current = performance.now();
              rafId.current = requestAnimationFrame(tick);
            }
            dribbleCooldownUntil.current = e.timeStamp + DRIBBLE_COOLDOWN;
          }
        }

        prevInBox.current = inBox; // 드래그 여부 무관하게 항상 업데이트
      }

      // 커서 위치 항상 기록 (드리블 velocity 계산용, 드래그 여부 무관)
      prevCursor.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };

      if (!isDragging.current) return;

      // ── 기존 드래그 ────────────────────────────────────────────────────────
      pos.current = {
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      };
      boxRef.current!.style.left = pos.current.x + "px";
      boxRef.current!.style.top  = pos.current.y + "px";

      ptrHistory.current.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (ptrHistory.current.length > 5) ptrHistory.current.shift();
    }

    function onUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      prevInBox.current = false;
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
