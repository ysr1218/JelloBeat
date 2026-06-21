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

## 다음 작업

**Phase 4 전체 완료 → main 브랜치 병합(JellySpring-css → main) → Phase 5**

### Phase 5 — 볼륨 제어 (Core Audio)
- Windows Core Audio: `IAudioSessionManager2` / `ISimpleAudioVolume`
- 대상 앱(브라우저/YTM)의 오디오 세션 볼륨을 AUMID로 매핑해 조절
- `src-tauri/src/audio/` 모듈 신설
- UI: 볼륨 슬라이더 실제 연결 (현재 `console.log`만)

### Phase 6 — Discord Rich Presence
- `discord-rich-presence` 크레이트, IPC 방식
- on/off 토글, 앱 시작 시 자동 연결

### Phase 4-5 — 드리블 ✓

**완료:**
- 관통(탈출) 판정 방식: `prevInBox` ref, 탈출 순간에만 impulse, `DRIBBLE_PAD` 제거.
- 버튼(⏮▶⏸⏭) 클릭 정상화, `closest("button, input")` + `e.button !== 0` 가드.
- Rust 커서 폴링 50ms → 16ms 단축.
- **방법 C — 운동 중 click-through 전면 해제** (`OverlayState.force_interactive` + `set_motion_mode` Tauri 커맨드):
  - 박스가 운동 중(physics RAF 또는 squash RAF 동작)이면 `force_interactive=true` → Rust 폴링 루프가 `ignore_cursor_events=false` 상시 유지 → 모든 mousemove 이벤트 JS 수신 가능.
  - 박스 정지 시 `force_interactive=false` → 기존 hit_rect 폴링으로 복귀.
  - `syncMotionMode()` 호출 위치: tick 계속/정지, squashTick 정착, addSquashImpulse 시작, onMouseDown 잡기, onUp 던지기, onMove 드리블 RAF 시작.
- **우클릭 더블클릭(≤300ms) = 즉시 정지**: `onContextMenu` → vel 초기화 + 두 RAF 취소 + syncMotionMode → 클릭스루 즉시 복귀.
- 우클릭 컨텍스트 메뉴 항상 차단 (`preventDefault`).
- 진단 로그(`[dribble diag]`) 제거.

**트레이드오프 (운동 중 차단):**
박스가 날아다니는 3~5초 동안 가상 데스크탑 전체의 빈 공간 클릭이 뒤 창으로 전달 안 됨. 우클릭 더블클릭으로 즉시 해제 가능.

---

### Phase 4-6 — 음악 버튼 낙관적 업데이트 ✓

- `useNowPlaying`: `optimisticIsPlaying` state 추가. `applyOptimistic(bool|null)` 노출.
- SMTC `media:update` 이벤트 수신 시 `setOptimisticIsPlaying(null)` → 실제 상태로 자동 보정.
- `NowPlayingCard`: ▶/⏸ 버튼 클릭 시 즉시 아이콘 토글, `invoke("transport")` 실패 시 `applyOptimistic(null)`로 자동 리버트.
- ⏮/⏭는 아이콘 변화 없어 낙관적 업데이트 불필요.

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
| 곡 전환 시 제목/앨범아트 1~2초 지연 | Known Limitation | SMTC 구조적 지연 — 음악 앱이 새 곡 메타데이터를 SMTC에 전달하는 타이밍이 앱마다 다름. 코드 쪽 추가 지연 없음(디바운스 없음, 썸네일 직렬화 50ms 미만). |
| 화면 off→on 시 박스 사라짐 | Known Bug | 디스플레이 재초기화 시 가상 데스크탑 좌표 계산 틀어져 박스가 화면 밖으로 이동하는 것으로 추정. Phase 7에서 디스플레이 변경 이벤트 구독 + fit_to_virtual_desktop 재호출 + 위치 보정으로 해결 예정. |
