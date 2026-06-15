# JelloBeat — 세션 인계 메모

> 다음 세션이 이 파일만 읽어도 현재 상태를 파악하고 작업을 이어갈 수 있도록 작성.

---

## 완료 단계

### Phase 0 — 스캐폴딩
- Tauri v2 + React + TypeScript 템플릿 생성
- `MediaSource` trait 정의 (`now_playing`, `transport`)
- `windows` 크레이트 의존성 추가

### Phase 1 — SMTC 현재 곡 표시
- `GlobalSystemMediaTransportControlsSessionManager`로 세션 구독
- `MediaPropertiesChanged` / `PlaybackInfoChanged` 이벤트 → `AppHandle.emit("media:update")`
- 앨범아트: thumbnail 스트림 → `Vec<u8>` + content_type → Base64 → 프론트
- 프론트: `useNowPlaying` 훅 + `NowPlayingCard` 컴포넌트

#### 세션 선택 — 점수제 (score-based)

| 조건 | 점수 |
|---|---|
| AUMID가 `KNOWN_MUSIC_APPS` 목록에 있음 | +100 |
| `PlaybackStatus == Playing` | +10 |
| 제목이 비어 있거나 Status가 Other/Closed | 후보 제외 |

동점 시 현재 잠긴 세션 유지(안정성 우선).

`KNOWN_MUSIC_APPS` (현재값, 추측 포함):
```
youtube-music-desktop-app.exe
spotify.exe          ← 실물 AUMID 확인 필요
applemusic.exe
itunes.exe
```

#### COM 객체 기반 세션 동일성 비교

Chrome은 탭/창이 바뀔 때 같은 AUMID(`chrome.exe`)로 새 COM 세션 객체를 생성한다.
`LockedSession`에 `session: GlobalSystemMediaTransportControlsSession` 저장 →
`CurrentSessionChanged` 발생 시 `Interface::as_raw()` 포인터 비교로 동일성 검사.

#### 진단 로그

`[SMTC]` 로그는 디버그 빌드에서만 동작. `#[cfg(debug_assertions)]` 게이트.

### Phase 2 — 재생 제어 완료

- `TransportCommand` enum + `WindowsSmtc::transport()` 구현
- Tauri command: `transport(cmd)` → `commands.rs`
- UI: ⏮ ▶/⏸ ⏭ 버튼 → transport() 연결

### Phase 3 — 오버레이 창 완료

**3-1** 투명·무테·항상위: `tauri.conf.json` + `App.css` background transparent

**3-2** 젤리박스 레이아웃 (레퍼런스 이미지 반영, 3:2 비율):
- `--jello-width: 240px` 절대 px 고정, `height: calc(--jello-width * 0.667)`
- 3레이어 배경: `jello-bg-base` / `jello-bg-art(blur)` / `jello-content`
- 오른쪽 3그룹: `jello-info`(소스+제목+아티스트) / `jello-mid`(진행바+시간+버튼) / `jello-volume`(🔈+슬라이더+🔊)

**3-3** 전체화면 투명창 + 클릭스루:
- `GetCursorPos()` 50ms 폴링 + `set_ignore_cursor_events` 토글
- `Arc<OverlayState>` → `hit_rect: Mutex<Option<HitRect>>` 스레드 공유
- `hit_rect=None` 초기에는 클릭스루 OFF
- Ctrl+Shift+Q 전역 단축키 안전 종료 (`tauri-plugin-global-shortcut`)

### Phase 4-1 — 기본 드래그 완료

**구조:** React `useState` 대신 `useRef` + DOM 직접 조작 (60fps RAF용)

**신규 파일:** `src/hooks/useJelloPhysics.ts`
- `useLayoutEffect`로 초기 위치 좌하단(x=24, y=innerHeight-boxH-24) 설정 — flash 없음
- `onSettleRef` 패턴: onSettle 콜백을 ref에 저장해 effect 재부착 없이 최신값 사용
- `onMouseDown`: `cancelAnimationFrame(rafId.current)` 호출 → 날아가는 박스 잡으면 물리 즉시 정지
- window mousemove/mouseup 리스너로 드래그 처리
- `rafId` ref 준비 완료 (Step 4-2 관성 구현 예정)

**`NowPlayingCard.tsx` 변경:**
- `updateHitRect`: `useCallback([], [])` 안정 콜백으로 분리
- `useJelloPhysics(boxRef, updateHitRect)` 연결
- idle / active 두 분기 모두 `onMouseDown` 연결

**`App.css` 변경:**
- `.overlay-root`: flex/padding 제거 (박스 absolute 포지셔닝으로 전환)
- `.jello-box`: `position: absolute`, `cursor: grab`
- `.jello-box.dragging`: `cursor: grabbing`

**hit_rect 갱신 시점:** 드래그 종료(onUp) + idle↔active 전환. 매 프레임 IPC 불필요.

### Phase 4-M1 — 가상 데스크탑 전체 창 확장 완료 (멀티모니터 대응)

**문제:** 기존 `fit_to_monitor()`는 창을 한 모니터 크기로만 설정 → 박스를 다른 모니터로 드래그하면 오버레이 밖으로 나가 사라짐.

**해결:** `fit_to_virtual_desktop()` 신규 추가 (`src-tauri/src/overlay/mod.rs`)
- `available_monitors()`로 전체 모니터 목록 순회
- `min(pos.x/y)` ~ `max(pos.x+w / pos.y+h)` 로 가상 데스크탑 bounding box 계산
- 창 위치 → `(min_x, min_y)`, 창 크기 → `(max_x-min_x) × (max_y-min_y)` (물리 픽셀)
- 실패 시 `fit_to_monitor()` fallback 유지
- `lib.rs`에서 호출을 `fit_to_virtual_desktop(&main_win)`으로 교체

**내 환경 (확인 완료):** 세로 배치 1920×2160·배율 1.0  
코드는 `available_monitors()` 계산값 기반 — 음수 좌표·좌우 배치·다중 모니터 구조적 대응.

**DPI 주의:** `Monitor::size()`는 물리 픽셀 반환이므로 창 크기 계산은 scale 무관.
혼합 DPI 환경(예: 1.0 + 1.5)에서 CSS 픽셀 공간 처리는 미검증 — 별도 Phase 예정.

**모니터 진단 로그** (`[MONITOR]`): `lib.rs` setup 블록에 항상 출력, 설계 검증용.

---

## 다음 작업 — Phase 4 계속

### Step 4-2: 관성 던지기 + 감속
`useJelloPhysics.ts`에 추가:
- 드래그 중 포인터 히스토리(최대 5개) 기록
- mouseup 시 속도 계산 → RAF 루프 시작
- DAMPING=0.92, STOP_THRESH=0.4
- **보완:** `onMouseDown` 진입 시 `vel = {0,0}` 초기화 (cancelAnimationFrame은 이미 있음)
- **보완:** 물리 루프 중 hit_rect를 100ms 주기(약 N프레임마다)로도 갱신 → 날아가는 박스도 잡을 수 있게

### Step 4-3: 벽 충돌 + 반사
- 경계는 `window.innerWidth × window.innerHeight` (가상 데스크탑 전체 기준 — 창이 이미 전체 커버)
- RESTITUTION=0.55, 각 축별 속도 반전

### Phase 4-5 — 드리블 (진행 중, JellySpring-css 브랜치)

**현재 상태:** 드리블 코드 점검 완료(죽은 코드 없음, 주석 2개 수정).
`e.buttons === 0` + Liang-Barsky 선분 판정 + 시간 정규화 normSpeed 방식으로 구현됨.

**미해결 버그:** 버튼(⏮▶⏸⏭) 위에 커서를 가져가면 드리블이 발동해 박스가 도망가서 버튼을 못 누름.
근본 원인: 드리블 발동 조건이 너무 헐거워서 버튼 클릭 의도로 천천히 이동할 때도 DRIBBLE_PAD=40 덕분에 hit 발생.

**다음 할 일:** '관통(가로지르기) 판정' 방식으로 전환.
박스에 들어가서 머물면(버튼 클릭 의도) 발동 안 하고, 가로질러 통과할 때만 발동.
→ Plan Mode로 설계부터.

**추가 수정:** `onMouseDown`에 `closest("button, input")` 가드 추가 → 버튼/슬라이더 클릭이 드래그로 가로채지지 않도록.

---

### Step 4-4: 스프링 기반 젤리 스쿼시 ✓ (CSS 방식에서 물리 스프링으로 교체)

**구현:** `useJelloPhysics.ts` — `squashTick` / `addSquashImpulse` / `resetSquash`

- 찌그러짐 상태 `(sqX, sqY)` + 속도 `(sqVX, sqVY)` → 매 프레임 `sqV += -k*sq - c*sqV` 스프링 방정식
- 벽 충돌 시 RESTITUTION 적용 전 impact 속도 캡처 → 세기에 비례해 스쿼시 누적
- 연속 충돌 시 이미 출렁이는 상태에 새 충격이 더해짐(덮어쓰기 X)
- `.jello-squash-wrap`에 `wrap.style.transform` 직접 적용 — 위치 물리(left/top)와 완전 분리
- `border-radius`도 찌그러짐 크기에 비례 변동 (12 + mag×30 px)
- 박스를 잡으면 `resetSquash()` 즉시 리셋
- 별도 `squashRafId` RAF — 물리 루프 정지 후에도 스프링이 남아 진동하다 수렴
- CSS `@keyframes jello-squash-h/v` + `.jello-squash-h/v` 클래스 + `--sq-compress/--sq-stretch` 변수 제거

**조절 상수** (`useJelloPhysics.ts` 상단):
```
SQUASH_STIFFNESS  = 0.25  // 복원 속도
SQUASH_DAMPING    = 0.05  // 감쇠 (낮을수록 더 오래 출렁)
SQUASH_IMPACT     = 0.004 // 충돌→찌그러짐 변환계수
SQUASH_COUPLE     = 0.5   // 반대축 늘어남 비율
```

---

## 미완/후순위

| 항목 | 상태 | 비고 |
|---|---|---|
| Phase 3-4 투명도 조절 | 미완 | `--bg-opacity` 변수 준비됨 |
| 진행바 실시간 위치 | 보류 | SMTC 미지원 |
| 볼륨 슬라이더 기능 | Phase 5 | Core Audio |
| 박스 크기 사용자 조절 | Phase 7 | `--jello-width` 준비됨 |
| 혼합 DPI 멀티모니터 | 미검증 | CSS 픽셀 공간 처리 필요 |
| Spotify AUMID | 확인 필요 | 실물 로그로 확인 후 수정 |
| 곡 스킵 깜빡임 | Known Limitation | Phase 7 디바운스로 개선 예정 |
| **YTM 정지 상태 시작 시 세션 미인식** | Known Bug (Phase 1) | YTM이 Paused/초기 상태에서 Other 타입으로 보고 → 후보 제외됨. 곡을 두 번 넘겨 Playing이 되면 그제야 잡힘. 향후 수정: Other 타입이라도 알려진 AUMID면 약한 점수로 후보 유지하거나, 정지 세션도 별도 처리 검토. |

---

## 이후 단계

### Phase 4-5 — 드리블 (기획 완료, 다음 구현 대상)

날아가는 젤리박스를 마우스 커서로 쳐서 농구공 드리블처럼 갖고 놀기.

**동작 방식:**
- 커서가 움직이는 박스 위를 지나갈 때 커서 이동 방향·속도에 비례한 impulse를 velocity에 누적.
  클릭 없이 접촉만으로 반응 (자동 impulse, 클릭 불필요 방식 채택).
- 박스 속도 임계값으로 모드 전환:
  - **드리블 모드** (빠름): 커서 접촉 → impulse 적용, 드래그 비활성
  - **잡기 모드** (느림/정지): 기존 드래그 동작 유지
- 기존 velocity RAF 루프 + 마우스 이벤트 조합. 새 물리 시스템 불필요.
- 드리블 추가 후 SQUASH_IMPACT 등 스프링 수치 재조정 필요할 수 있음.

**구현 전 결정할 사항:**
1. 드리블/잡기 전환 속도 임계값 — STOP_THRESH(0.40)와 별도 상수 or 공유 여부
2. hit_rect 갱신 주기 — 드리블 중 박스가 빠르게 움직이므로 HIT_RECT_MS(100ms) 단축 검토
3. impulse 적용 방식 — 박스를 통과하는 순간만 줄지, 커서가 박스 위에 머무는 동안 계속 줄지

→ Phase 5 볼륨(Core Audio) → Phase 6 Discord RPC → Phase 7 설정·모드·OBS
