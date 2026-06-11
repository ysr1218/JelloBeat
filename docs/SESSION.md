# JelloBeat — 세션 선택 구현 메모

> Phase 1 완료 기준 문서. 구현 결정과 알려진 제약을 기록한다.

---

## 완료 단계

### Phase 0 — 스캐폴딩
- Tauri v2 + React + TypeScript 템플릿 생성
- `MediaSource` trait 정의 (`now_playing`, `transport`)
- `windows` 크레이트 의존성 추가 (아직 호출 없음)
- `cargo check` 통과

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
AUMID 문자열만 비교하면 새 객체를 "같은 세션"으로 착각해 기존(죽은) 구독을 유지한다.

**해결**: `LockedSession`에 `session: GlobalSystemMediaTransportControlsSession` 저장 →
`CurrentSessionChanged` 발생 시 `Interface::as_raw()` 포인터 비교로 동일성 검사.
세션 객체가 교체됐으면 무조건 재구독.

#### 진단 로그

`[SMTC] [props]` / `[SMTC] [status]` / 세션 테이블 출력은 **디버그 빌드에서만** 동작.
`#[cfg(debug_assertions)]` + `log_sessions` / `trunc` 함수 자체도 동일하게 게이트.

---

## 다음 작업 — Phase 2: 재생 제어

- SMTC `TryPlayAsync` / `TryPauseAsync` / `TrySkipNextAsync` / `TrySkipPreviousAsync`
- `TransportCommand` enum → `WindowsSmtc::transport()` 구현
- 오버레이 UI에 재생/일시정지/이전/다음 버튼 추가

---

## 특이사항

- **Spotify AUMID 실물 확인 필요**: `cargo run` 후 Spotify 재생 시 터미널
  `[SMTC] ── sessions` 테이블에서 AUMID를 직접 확인한 뒤 `KNOWN_MUSIC_APPS` 수정.
- **Chrome 다중 탭 한계**: Chrome은 Windows SMTC에 탭 한 개만 노출한다.
  여러 탭을 동시에 선택하는 것은 브라우저 확장 없이 불가.
- **로그 정리 완료**: Phase 1에서 추가한 모든 진단 로그는 `debug_assertions` 게이트 처리됨.
  릴리스 빌드에서는 `eprintln!` 없음.
