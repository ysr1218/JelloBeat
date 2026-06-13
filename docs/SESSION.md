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

### Step 4-4: 스쿼시 + 착지 후 흔들림
- `@keyframes jello-squash-h/v` CSS 추가 (0.45s ease-out)
- `triggerBounce(axis)`: 클래스 제거 → reflow(`void offsetWidth`) → 클래스 추가

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

---

## 이후 단계

4-2 관성 → 4-3 벽충돌(가상 데스크탑 경계) → 4-4 스쿼시+흔들림 →
Phase 5 볼륨(Core Audio) → Phase 6 Discord RPC → Phase 7 설정·모드·OBS
