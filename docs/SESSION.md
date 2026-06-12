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

`[SMTC] [props]` / `[SMTC] [status]` / 세션 테이블 출력은 **디버그 빌드에서만** 동작.
`#[cfg(debug_assertions)]` 게이트.

### Phase 2 — 재생 제어 완료

- `TransportCommand` enum + `WindowsSmtc::transport()` 구현
- Tauri command: `transport(cmd)` → `commands.rs`
- UI: ⏮ ▶/⏸ ⏭ 버튼 → transport() 연결

### Phase 3-1 — 투명·무테·항상위 창 완료

- `tauri.conf.json`: `transparent: true`, `decorations: false`, `alwaysOnTop: true`
- `App.css`: `:root`, `body` background를 `transparent`로 설정

### Phase 3-2 — 젤리박스 레이아웃 완료 (동작 확인됨)

가로형 글래스모피즘 박스, 화면 좌하단 고정.

**3레이어 배경 구조:**
```
.jello-bg-base   어두운 반투명(rgba 8,8,18 / 0.72)        z-index: 0
.jello-bg-art    앨범아트 div, blur(20px), opacity 0.4     z-index: 1
.jello-content   실제 콘텐츠                               z-index: 2
```

**레이아웃 (레퍼런스 이미지 반영, 3:2 비율):**
- 왼쪽: `--jello-width * 0.4` 정사각 앨범아트(border-radius 8px), 없으면 회색 폴백
- 오른쪽 상단(`.jello-info`): ♪ 소스명(회색 9px) → 제목(흰색 11px 굵음) → 아티스트(회색 9px)
- 오른쪽 중앙(`.jello-mid`): 진행바 → 시간(space-between) → ⏮ ⏸(28px 핑크 원) ⏭ (가운데정렬)
- 오른쪽 하단(`.jello-volume`): 🔈 + flex 슬라이더 + 🔊

**CSS 변수 (`--jello-width` 하나로 전체 크기 제어):**
```css
--jello-width: 240px;   /* 절대 px 고정 — vw 미사용 */
height: calc(var(--jello-width) * 0.667);  /* 3:2 비율 자동계산 */
--art-blur: 20px;
--art-opacity: 0.4;
--bg-opacity: 0.72;
```
박스 크기 조절은 `--jello-width` 하나만 바꾸면 됨. 사용자 UI 조절은 Phase 7 예정.

**변경 파일:**
- `src/App.tsx`: `<div className="overlay-root">` 래퍼
- `src/components/NowPlayingCard.tsx`: 3-그룹 레이아웃 (jello-info / jello-mid / jello-volume)
- `src/App.css`: 전체 jello 섹션

### Phase 3-3 — 전체화면 투명창 + 클릭스루 완료

**전체화면 투명창:**
- `fit_to_monitor()`: `current_monitor()` → `primary_monitor()` → 1920×1080 폴백 순으로 해상도 감지
- 하드코딩 없음 — 어떤 모니터에서도 자동 맞춤
- `src-tauri/src/overlay/mod.rs`

**클릭스루 (Rust 백그라운드 폴링, 50ms 주기):**
- `GetCursorPos()` + `window.outer_position()` → 상대 좌표 계산
- `HitRect`(프론트에서 전달)와 비교 → 상태 변화 시만 `set_ignore_cursor_events(!inside)` 호출
- `hit_rect = None`(초기)이면 클릭스루 OFF(최소한 박스는 항상 잡힘)
- `Arc<OverlayState>` manage: Tauri 상태를 폴링 스레드에 공유하는 방식

**프론트 → Rust 히트렉트 전달:**
- `NowPlayingCard`의 `useEffect([np !== null])`: 박스 `getBoundingClientRect()` → `invoke("set_hit_rect")`
- idle↔active 전환 시 박스 크기가 바뀌므로 재호출 필요 → `[np !== null]` 의존성

**Ctrl+Shift+Q 안전 종료:**
- `tauri-plugin-global-shortcut`으로 전역 단축키 등록
- 클릭스루 켜진 상태에서도 앱 종료 가능

**변경 파일:**
- `src-tauri/src/overlay/mod.rs`: `fit_to_monitor`, `HitRect`, `OverlayState`
- `src-tauri/src/commands.rs`: `set_hit_rect` command
- `src-tauri/src/lib.rs`: 전체화면 설정, SMTC 스레드, 폴링 스레드, 단축키
- `src-tauri/Cargo.toml`: `tauri-plugin-global-shortcut`, `Win32_UI_WindowsAndMessaging` feature

---

## 다음 작업 — Phase 3-4: 투명도 조절 (미완)

박스 전체 투명도를 실시간으로 조절하는 슬라이더/설정.
`--bg-opacity`, `--art-opacity` CSS 변수 + Tauri command or 프론트 상태로 제어.

---

## 미완/후순위 디테일

| 항목 | 상태 | 비고 |
|---|---|---|
| Phase 3-4 투명도 조절 | 미완 | `--bg-opacity` 변수는 준비됨 |
| 박스 모양·색감 디테일 다듬기 | 미완 | 기능 우선, 레퍼런스와 세부 차이 있음 |
| 진행바 실시간 위치 | 보류 | SMTC에서 현재 재생 위치 이벤트 미지원 |
| 볼륨 슬라이더 기능 연결 | Phase 5 | Core Audio — `IAudioSessionManager2`/`ISimpleAudioVolume` |
| 박스 크기 사용자 조절 UI | Phase 7 | `--jello-width` 변수 준비됨 |
| 크롬 다중 탭 | Known Limitation | 브라우저 확장 없이 탭 구분 불가 |
| 곡 스킵 시 깜빡임 | Known Limitation | Phase 7 세션 전환 디바운스로 개선 예정 |
| Spotify AUMID | 확인 필요 | 실물 기기에서 SMTC 로그로 확인 후 `KNOWN_MUSIC_APPS` 수정 |

---

## 이후 단계 순서

Phase 3-4 투명도 조절 → **Phase 4 젤리 물리** (드래그·던지기·벽 충돌·일렁임) →
Phase 5 볼륨(Core Audio) → 진행바 실시간(Phase 5 이후) → Phase 6 Discord RPC → Phase 7 설정·모드
