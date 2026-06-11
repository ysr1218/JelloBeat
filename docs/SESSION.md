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
.jello-bg-art    앨범아트 div, blur(40px), opacity 0.4     z-index: 1
.jello-content   실제 콘텐츠                               z-index: 2
```

**레이아웃:**
- 왼쪽: 88×88px 정사각 앨범아트(border-radius 12px), 없으면 회색 폴백
- 오른쪽 1행: 제목(흰색·굵음, 말줄임) + 아티스트(회색) | ⏮ ⏸(대형 핑크 원) ⏭
- 오른쪽 2행: 진행바 (UI only, value=0 고정)
- 오른쪽 3행: "0:00" + formatDuration(duration_secs) | 🔊 + 볼륨 슬라이더(onChange=console.log)

**CSS 변수:** `.jello-box`에 `--art-blur`, `--art-opacity`, `--bg-opacity` 정의.
`backdrop-filter` 미사용 (투명 Tauri 창에서 동작 안 함).

**변경 파일:**
- `src/App.tsx`: `<div className="overlay-root">` 래퍼 (position:fixed, inset:0, pointer-events:none)
- `src/components/NowPlayingCard.tsx`: 전체 재설계
- `src/App.css`: `.overlay-root`, `.jello-box` 등 CSS 추가

---

## 다음 작업 — Phase 3-3단계: 클릭스루

**목표:** 빈 영역은 마우스 클릭이 뒤 창으로 통과, 젤리박스 위에서만 입력 받기.

**방식:**
- CSS 쪽은 이미 완료: `.overlay-root { pointer-events: none }`, `.jello-box { pointer-events: auto }`
- Rust 쪽 추가 필요: `set_ignore_cursor_events(true)`로 OS 레벨 클릭스루 활성화
  - 단, 젤리박스 위로 마우스가 올라오면 `set_ignore_cursor_events(false)`로 전환해야 클릭이 먹힘
  - 방법: 프론트에서 `mouseenter`/`mouseleave` 이벤트 → `invoke("set_click_through", { enable })` Tauri command

**구현할 파일:**
1. `src-tauri/src/overlay/mod.rs` (또는 `commands.rs`): `set_click_through(enable: bool, window)` command
2. `src/App.tsx` 또는 `src/components/NowPlayingCard.tsx`: mouseenter/mouseleave → invoke

그다음 **Phase 3-4단계**: 투명도 슬라이더 (0~100%, 실시간 적용).

---

## 미완/후순위 디테일

| 항목 | 상태 | 비고 |
|---|---|---|
| 박스 모양·색감 디테일 다듬기 | 미완 | 현재 기능만 됨, 레퍼런스 이미지와 세부 차이 있음 |
| 진행바 실시간 위치 | 보류 | SMTC에서 현재 재생 위치 이벤트 미지원 |
| 볼륨 슬라이더 기능 연결 | Phase 5 | Core Audio — `IAudioSessionManager2`/`ISimpleAudioVolume` |
| 크롬 다중 탭 | Known Limitation | 브라우저 확장 없이 탭 구분 불가 |
| 곡 스킵 시 깜빡임 | Known Limitation | Phase 7 세션 전환 디바운스로 개선 예정 |
| Spotify AUMID | 확인 필요 | 실물 기기에서 SMTC 로그로 확인 후 `KNOWN_MUSIC_APPS` 수정 |

---

## 이후 단계 순서

Phase 3-3 클릭스루 → Phase 3-4 투명도 조절 → **Phase 4 젤리 물리** (드래그·던지기·벽 충돌) →
Phase 5 볼륨(Core Audio) → 진행바 실시간(Phase 5 이후) → Phase 6 Discord RPC → Phase 7 설정·모드
